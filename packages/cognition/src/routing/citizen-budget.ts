import type {
  CloudAdmissionDecision,
  CloudAdmissionEstimate,
  CloudBudget,
  CloudBudgetGate,
  CloudUsageReport,
} from "../cloud-budget.js";

/** Optional limits for one citizen, inside the experiment-wide allowance. */
export type CitizenBudgetLimits = {
  maxRequests?: number;
  spendAllowanceUsd?: number;
};

/** What one citizen has used. Holds may never have been billed; they are not spend. */
export type CitizenAccount = {
  requests: number;
  retries: number;
  refused: number;
  inputTokens: number;
  outputTokens: number;
  estimatedSpendUsd: number;
  unverifiedHoldUsd: number;
  reservedUsd: number;
};

export function emptyCitizenAccount(): CitizenAccount {
  return {
    requests: 0,
    retries: 0,
    refused: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedSpendUsd: 0,
    unverifiedHoldUsd: 0,
    reservedUsd: 0,
  };
}

type Reservation = { remainingUsd: number; attemptBoundUsd: number };

/**
 * One citizen's view of the shared experiment budget. Every charge goes through the shared gate, so the experiment
 * ceiling holds, and is also attributed here. Closing a view stops only this citizen. A cost-safety closure (a fault
 * reason) still closes the shared gate, because an unbounded cost affects the whole experiment's ceiling.
 */
export class CitizenBudgetView implements CloudBudget {
  private closed = false;
  private readonly reservations = new Map<string, Reservation>();

  constructor(
    private readonly shared: CloudBudgetGate,
    private readonly limits: CitizenBudgetLimits,
    private readonly account: CitizenAccount,
    private readonly onChange: () => void = () => undefined,
  ) {
    for (const [name, value] of Object.entries(limits)) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new RangeError(`${name} must be finite and non-negative`);
      }
    }
  }

  get snapshot() {
    const shared = this.shared.snapshot;
    return { ...shared, closed: this.closed || shared.closed };
  }

  close(faultReason?: string): void {
    if (faultReason) this.shared.close(faultReason);
    else this.closed = true;
  }

  tryAdmit(estimate: CloudAdmissionEstimate): CloudAdmissionDecision {
    const decision = this.admit(estimate);
    if (decision.ok) {
      this.reservations.set(decision.reservationId, {
        remainingUsd: decision.reservedUsd,
        attemptBoundUsd: estimate.attemptBoundUsd,
      });
      this.account.requests += 1;
      this.account.reservedUsd += decision.reservedUsd;
    } else {
      this.account.refused += 1;
    }
    this.onChange();
    return decision;
  }

  private admit(estimate: CloudAdmissionEstimate): CloudAdmissionDecision {
    if (this.closed) return { ok: false, code: "closed", reason: "cloud cognition shut down" };
    const { maxRequests, spendAllowanceUsd } = this.limits;
    if (maxRequests !== undefined && this.account.requests >= maxRequests) {
      return { ok: false, code: "request_budget", reason: "citizen request budget exhausted" };
    }
    if (spendAllowanceUsd !== undefined) {
      const required = estimate.attemptBoundUsd * estimate.maxAttempts;
      const committed = this.account.estimatedSpendUsd + this.account.unverifiedHoldUsd + this.account.reservedUsd;
      // A NaN estimate falls through so the shared gate can close on it.
      if (required > spendAllowanceUsd - committed) {
        return { ok: false, code: "spend", reason: "citizen spend allowance cannot cover the required reservation" };
      }
    }
    return this.shared.tryAdmit(estimate);
  }

  tryChargeRetry(): boolean {
    if (this.closed) return false;
    const { maxRequests } = this.limits;
    if (maxRequests !== undefined && this.account.requests >= maxRequests) return false;
    if (!this.shared.tryChargeRetry()) return false;
    this.account.requests += 1;
    this.account.retries += 1;
    this.onChange();
    return true;
  }

  holdAttempt(reservationId: string): number {
    const held = this.shared.holdAttempt(reservationId);
    const reservation = this.reservations.get(reservationId);
    if (reservation) reservation.remainingUsd -= held;
    this.account.reservedUsd -= held;
    this.account.unverifiedHoldUsd += held;
    this.onChange();
    return held;
  }

  reconcile(reservationId: string, usage: CloudUsageReport | undefined, failed: boolean): number {
    let actual: number;
    try {
      actual = this.shared.reconcile(reservationId, usage, failed);
    } catch (error) {
      this.attributeUnknownUsage(reservationId);
      throw error;
    }
    this.release(reservationId);
    if (!failed && usage) {
      this.account.inputTokens += usage.inputTokens;
      this.account.outputTokens += usage.outputTokens;
      this.account.estimatedSpendUsd += actual;
    }
    this.onChange();
    return actual;
  }

  settleUnknownUsage(reservationId: string, faultReason: string): number {
    const held = this.shared.settleUnknownUsage(reservationId, faultReason);
    const reservation = this.reservations.get(reservationId);
    if (reservation) reservation.remainingUsd -= held;
    this.account.reservedUsd -= held;
    this.account.unverifiedHoldUsd += held;
    this.release(reservationId);
    this.onChange();
    return held;
  }

  releaseWithoutCharge(reservationId: string): void {
    this.reconcile(reservationId, undefined, true);
  }

  /** The gate settled the reservation as unknown usage before throwing. Mirror what it held. */
  private attributeUnknownUsage(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    const held = Math.min(reservation.attemptBoundUsd, reservation.remainingUsd);
    reservation.remainingUsd -= held;
    this.account.reservedUsd -= held;
    this.account.unverifiedHoldUsd += held;
    this.release(reservationId);
    this.onChange();
  }

  private release(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    this.account.reservedUsd -= reservation.remainingUsd;
    this.reservations.delete(reservationId);
    // Clear floating-point residue so an idle citizen reports exactly zero reserved.
    if (this.reservations.size === 0) this.account.reservedUsd = 0;
  }
}
