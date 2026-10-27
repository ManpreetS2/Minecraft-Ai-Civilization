import { estimateCloudCostUsd } from "./cloud-prices.js";

export type CloudAdmissionDecision =
  | { ok: true; reservationId: string; reservedUsd: number }
  | { ok: false; reason: string };

export type CloudUsageReport = {
  inputTokens: number;
  outputTokens: number;
  model: string;
};

/**
 * Run-level admission control for cloud LLM calls.
 * Reserves a conservative estimate before the network call, then reconciles actual usage.
 */
export class CloudBudgetGate {
  private inFlight = 0;
  private requestsUsed = 0;
  private spendUsd = 0;
  private closed = false;
  private readonly reservations = new Map<string, number>();

  constructor(
    private readonly limits: {
      maxConcurrency: number;
      maxRequestsPerRun: number;
      spendAllowanceUsd: number;
      /** Conservative pre-request reserve when usage is unknown. */
      reserveUsdPerRequest?: number;
    },
  ) {}

  get snapshot() {
    return {
      inFlight: this.inFlight,
      requestsUsed: this.requestsUsed,
      spendUsd: this.spendUsd,
      closed: this.closed,
      maxConcurrency: this.limits.maxConcurrency,
      maxRequestsPerRun: this.limits.maxRequestsPerRun,
      spendAllowanceUsd: this.limits.spendAllowanceUsd,
    };
  }

  close(): void {
    this.closed = true;
  }

  tryAdmit(): CloudAdmissionDecision {
    if (this.closed) {
      return { ok: false, reason: "cloud cognition shut down" };
    }
    if (this.requestsUsed >= this.limits.maxRequestsPerRun) {
      return { ok: false, reason: "cloud request budget exhausted" };
    }
    if (this.inFlight >= this.limits.maxConcurrency) {
      return { ok: false, reason: "cloud concurrency limit reached" };
    }
    const reserve = this.limits.reserveUsdPerRequest ?? 0.01;
    if (this.spendUsd + reserve > this.limits.spendAllowanceUsd + 1e-9) {
      return { ok: false, reason: "cloud spend allowance exhausted" };
    }
    const reservationId = crypto.randomUUID();
    this.reservations.set(reservationId, reserve);
    this.inFlight += 1;
    this.requestsUsed += 1;
    this.spendUsd += reserve;
    return { ok: true, reservationId, reservedUsd: reserve };
  }

  reconcile(reservationId: string, usage: CloudUsageReport | undefined, failed: boolean): number {
    const reserved = this.reservations.get(reservationId) ?? 0;
    this.reservations.delete(reservationId);
    this.inFlight = Math.max(0, this.inFlight - 1);
    let actual = 0;
    if (!failed && usage) {
      actual = estimateCloudCostUsd({
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    }
    this.spendUsd = Math.max(0, this.spendUsd - reserved + actual);
    return actual;
  }

  releaseWithoutCharge(reservationId: string): void {
    this.reconcile(reservationId, undefined, true);
  }
}
