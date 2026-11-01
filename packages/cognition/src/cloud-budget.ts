import { estimateCloudCostUsd, hasCloudModelPrice } from "./cloud-prices.js";

export type CloudRefusalCode = "closed" | "request_budget" | "concurrency" | "spend" | "input_too_large";

export type CloudAdmissionDecision =
  | { ok: true; reservationId: string; reservedUsd: number }
  | { ok: false; reason: string; code: CloudRefusalCode };

/** The most one request may cost, taken from the model's price and bounded token counts. */
export type CloudAdmissionEstimate = {
  attemptBoundUsd: number;
  maxAttempts: number;
};

export type CloudUsageReport = {
  inputTokens: number;
  outputTokens: number;
  model: string;
};

type Reservation = {
  remainingUsd: number;
  attemptBoundUsd: number;
};

/** Refused before any network call, so nothing was reserved or billed. */
export class CloudAdmissionError extends Error {
  constructor(
    message: string,
    readonly code: CloudRefusalCode,
  ) {
    super(message);
    this.name = "CloudAdmissionError";
  }
}

/** What a provider needs from a budget. A citizen-attributed view of the shared gate implements this too. */
export type CloudBudget = Pick<
  CloudBudgetGate,
  | "snapshot"
  | "close"
  | "tryAdmit"
  | "tryChargeRetry"
  | "holdAttempt"
  | "reconcile"
  | "settleUnknownUsage"
  | "releaseWithoutCharge"
>;

/**
 * Run-level admission control for cloud LLM calls.
 * Every attempt a request may make is reserved before the first network call, and a call is refused
 * unless reported spend, unverified holds and all live reservations still fit the allowance.
 * This bounds estimates from the local price table and token bounds; it is not an invoice guarantee.
 */
export class CloudBudgetGate {
  private inFlight = 0;
  private requestsUsed = 0;
  /** Estimated from provider-reported usage. */
  private spendUsd = 0;
  /** Attempts that may have been billed but reported no usage. Never confirmed billing. */
  private heldUsd = 0;
  private closed = false;
  private closedReason: string | undefined;
  private readonly reservations = new Map<string, Reservation>();

  constructor(
    private readonly limits: {
      maxConcurrency: number;
      maxRequestsPerRun: number;
      spendAllowanceUsd: number;
    },
  ) {
    if (!Number.isSafeInteger(limits.maxConcurrency) || limits.maxConcurrency < 1) {
      throw new RangeError("maxConcurrency must be a positive integer");
    }
    if (!Number.isSafeInteger(limits.maxRequestsPerRun) || limits.maxRequestsPerRun < 0) {
      throw new RangeError("maxRequestsPerRun must be a non-negative integer");
    }
    if (!Number.isFinite(limits.spendAllowanceUsd) || limits.spendAllowanceUsd < 0) {
      throw new RangeError("spendAllowanceUsd must be finite and non-negative");
    }
  }

  get snapshot() {
    const reservedUsd = this.reservedUsd();
    return {
      inFlight: this.inFlight,
      requestsUsed: this.requestsUsed,
      spendUsd: this.spendUsd,
      heldUsd: this.heldUsd,
      reservedUsd,
      availableUsd: this.limits.spendAllowanceUsd - this.spendUsd - this.heldUsd - reservedUsd,
      closed: this.closed,
      closedReason: this.closedReason,
      maxConcurrency: this.limits.maxConcurrency,
      maxRequestsPerRun: this.limits.maxRequestsPerRun,
      spendAllowanceUsd: this.limits.spendAllowanceUsd,
    };
  }

  /** Carries spending from before a restart in the same run, so restarting cannot reset the ceiling. */
  restoreCommitted(prior: { spendUsd: number; heldUsd: number; requestsUsed: number }): void {
    for (const value of Object.values(prior)) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError("restored budget values must be finite and non-negative");
    }
    this.spendUsd += prior.spendUsd;
    this.heldUsd += prior.heldUsd;
    this.requestsUsed += prior.requestsUsed;
  }

  /** Without a reason this is a normal shutdown; with one it records why cost safety closed the gate. */
  close(faultReason?: string): void {
    this.closed = true;
    this.closedReason ??= faultReason;
  }

  tryAdmit(estimate: CloudAdmissionEstimate): CloudAdmissionDecision {
    if (this.closed) {
      return { ok: false, code: "closed", reason: this.closedReason ?? "cloud cognition shut down" };
    }
    if (this.requestsUsed >= this.limits.maxRequestsPerRun) {
      return { ok: false, code: "request_budget", reason: "cloud request budget exhausted" };
    }
    if (this.inFlight >= this.limits.maxConcurrency) {
      return { ok: false, code: "concurrency", reason: "cloud concurrency limit reached" };
    }
    if (
      !Number.isFinite(estimate.attemptBoundUsd) ||
      estimate.attemptBoundUsd <= 0 ||
      !Number.isSafeInteger(estimate.maxAttempts) ||
      estimate.maxAttempts < 1
    ) {
      const reason = "cloud admissions closed for this run: request cost could not be bounded";
      this.close(reason);
      return { ok: false, code: "closed", reason };
    }
    const required = estimate.attemptBoundUsd * estimate.maxAttempts;
    const available = this.limits.spendAllowanceUsd - this.spendUsd - this.heldUsd - this.reservedUsd();
    if (required > available) {
      return {
        ok: false,
        code: "spend",
        reason: `cloud spend allowance cannot cover the required reservation ($${required.toFixed(6)} needed, $${available.toFixed(6)} available)`,
      };
    }
    const reservationId = crypto.randomUUID();
    this.reservations.set(reservationId, { remainingUsd: required, attemptBoundUsd: estimate.attemptBoundUsd });
    this.inFlight += 1;
    this.requestsUsed += 1;
    return { ok: true, reservationId, reservedUsd: required };
  }

  /** A retry is another HTTP request, so it draws on the same per-run request budget. */
  tryChargeRetry(): boolean {
    if (this.closed || this.requestsUsed >= this.limits.maxRequestsPerRun) {
      return false;
    }
    this.requestsUsed += 1;
    return true;
  }

  /**
   * An attempt ended without usage and may have been billed, such as a timeout or 5xx.
   * Its bound moves from the reservation to a hold, and the budget stays open because the cost is bounded.
   * Returns the amount held.
   */
  holdAttempt(reservationId: string): number {
    const reservation = this.getReservation(reservationId);
    const held = Math.min(reservation.attemptBoundUsd, reservation.remainingUsd);
    reservation.remainingUsd -= held;
    this.heldUsd += held;
    return held;
  }

  reconcile(reservationId: string, usage: CloudUsageReport | undefined, failed: boolean): number {
    // Malformed provider token accounting must not turn spendUsd into NaN and fail open.
    if (
      !failed &&
      (usage === undefined ||
        !Number.isSafeInteger(usage.inputTokens) ||
        usage.inputTokens < 0 ||
        !Number.isSafeInteger(usage.outputTokens) ||
        usage.outputTokens < 0 ||
        !hasCloudModelPrice(usage.model))
    ) {
      const reason = "cloud admissions closed for this run: usage report was invalid or unpriced";
      this.settleUnknownUsage(reservationId, reason);
      throw new Error(reason);
    }
    const reservation = this.takeReservation(reservationId);
    if (failed || !usage) {
      return 0;
    }
    const actual = estimateCloudCostUsd({
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    this.spendUsd += actual;
    if (actual > reservation.attemptBoundUsd) {
      // The charge above stays recorded, but the bound that admission relied on did not hold.
      this.close(
        `cloud admissions closed for this run: reported usage cost $${actual.toFixed(6)} exceeded the admission bound $${reservation.attemptBoundUsd.toFixed(6)}`,
      );
    }
    return actual;
  }

  /**
   * The provider accepted the call but its cost cannot be determined.
   * One attempt's bound stays as an unverified hold, unused attempts are released, and no further calls are admitted.
   * Returns the amount held.
   */
  settleUnknownUsage(reservationId: string, faultReason: string): number {
    const held = this.holdAttempt(reservationId);
    this.takeReservation(reservationId);
    this.close(faultReason);
    return held;
  }

  releaseWithoutCharge(reservationId: string): void {
    this.reconcile(reservationId, undefined, true);
  }

  private reservedUsd(): number {
    let total = 0;
    for (const reservation of this.reservations.values()) {
      total += reservation.remainingUsd;
    }
    return total;
  }

  private getReservation(reservationId: string): Reservation {
    // Never release an unrelated in-flight request when an unknown/settled ID is supplied.
    const reservation = this.reservations.get(reservationId);
    if (reservation === undefined) {
      throw new Error("cloud reservation is unknown or already reconciled");
    }
    return reservation;
  }

  private takeReservation(reservationId: string): Reservation {
    const reservation = this.getReservation(reservationId);
    this.reservations.delete(reservationId);
    this.inFlight -= 1;
    return reservation;
  }
}
