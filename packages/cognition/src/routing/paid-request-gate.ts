/**
 * The last check before a paid provider request leaves this process. It denies unless the owner approved this exact run,
 * and it is consulted for every attempt rather than once at startup.
 *
 * Two independent things must agree: an approval record supplied by code, and an environment variable the owner sets
 * for this launch naming the same run. A code path alone cannot enable spending, and neither can a stray variable.
 * This guards against accidents, not against code that sets both. The approval reference is recorded, not authenticated.
 */
export const PAID_RUN_APPROVAL_ENV = "CIV_APPROVE_PAID_RUN";

export type PaidRequestApproval = {
  ownerApprovalReference: string;
  runId: string;
  /** Total attempts this approval covers, across all citizens. */
  maxRequests: number;
  /** ISO timestamp. An approval without an expiry would outlive the decision that granted it. */
  expiresAt: string;
};

export type PaidRequestGateSnapshot = {
  approved: boolean;
  ownerApprovalReference?: string;
  runId?: string;
  requestsTaken: number;
  maxRequests: number;
  denied: number;
  revokedFor?: string;
};

export class PaidRequestGate {
  private taken = 0;
  private denied = 0;
  private revokedFor: string | undefined;

  private constructor(
    private readonly approval: PaidRequestApproval | undefined,
    private readonly env: Record<string, string | undefined>,
    private readonly now: () => Date,
  ) {}

  /** The default. Every request is refused. */
  static denyAll(): PaidRequestGate {
    return new PaidRequestGate(undefined, {}, () => new Date());
  }

  /** Malformed approvals are not errors here: they produce a gate that denies and says why. */
  static fromApproval(
    approval: PaidRequestApproval | undefined,
    options: { env?: Record<string, string | undefined>; now?: () => Date } = {},
  ): PaidRequestGate {
    return new PaidRequestGate(approval, options.env ?? process.env, options.now ?? (() => new Date()));
  }

  /** Why a request may not be sent now, or undefined. Takes nothing. */
  refusal(): string | undefined {
    const approval = this.approval;
    if (!approval) return "paid requests are not approved";
    if (this.revokedFor) return `paid request approval was revoked: ${this.revokedFor}`;
    if (typeof approval.ownerApprovalReference !== "string" || !approval.ownerApprovalReference.trim()) {
      return "no owner approval reference was supplied";
    }
    if (typeof approval.runId !== "string" || !approval.runId.trim()) return "the approval names no run";
    if (this.env[PAID_RUN_APPROVAL_ENV] !== approval.runId) {
      return `${PAID_RUN_APPROVAL_ENV} does not name this run`;
    }
    if (!Number.isSafeInteger(approval.maxRequests) || approval.maxRequests < 1) {
      return "the approval has no valid request ceiling";
    }
    const expires = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expires)) return "the approval has no valid expiry";
    if (this.now().getTime() >= expires) return "the approval has expired";
    if (this.taken >= approval.maxRequests) return "the approved request ceiling is used up";
    return undefined;
  }

  /** Claims one attempt, immediately before sending. Returns why it was refused, or undefined. */
  take(): string | undefined {
    const refusal = this.refusal();
    if (refusal) {
      this.denied += 1;
      return refusal;
    }
    this.taken += 1;
    return undefined;
  }

  /** Permanent for this gate. Use it when a run is stopped or something looks wrong. */
  revoke(reason: string): void {
    this.revokedFor ??= reason;
  }

  get snapshot(): PaidRequestGateSnapshot {
    return {
      approved: this.refusal() === undefined,
      ownerApprovalReference: this.approval?.ownerApprovalReference,
      runId: this.approval?.runId,
      requestsTaken: this.taken,
      maxRequests: this.approval?.maxRequests ?? 0,
      denied: this.denied,
      revokedFor: this.revokedFor,
    };
  }
}

/**
 * Only a Claude Console API key may authenticate these requests. OAuth tokens from a Claude subscription or Claude Code
 * (`sk-ant-oat...`) and admin keys (`sk-ant-admin...`) are refused. Checks the prefix only, not that the key is valid.
 */
export function isClaudeApiKeyFormat(value: string | undefined): boolean {
  return typeof value === "string" && /^sk-ant-api\d*-\S+$/.test(value);
}
