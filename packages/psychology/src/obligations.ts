export type ObligationStatus = "ACTIVE" | "FULFILLED" | "BROKEN" | "CANCELLED" | "IMPOSSIBLE" | "DISPUTED";

export type Obligation = {
  id: string;
  promisorId: string;
  promiseeId: string;
  description: string;
  physical: boolean;
  status: ObligationStatus;
  createdAt: string;
  speechActId?: string;
  evidenceEventId?: string;
};

/**
 * Speech can create an ACTIVE obligation.
 * Only a verified runtime outcome may FULFILL a physical promise.
 */
export class ObligationBoard {
  private readonly items = new Map<string, Obligation>();

  list(citizenId?: string): Obligation[] {
    const all = [...this.items.values()];
    if (!citizenId) return all;
    return all.filter((row) => row.promisorId === citizenId || row.promiseeId === citizenId);
  }

  create(input: Omit<Obligation, "status"> & { status?: ObligationStatus }): Obligation {
    const row: Obligation = { ...input, status: input.status ?? "ACTIVE" };
    this.items.set(row.id, row);
    return row;
  }

  /**
   * Talking about the promise again does not fulfill it.
   */
  noteSpeech(id: string, _speechActId: string): Obligation | undefined {
    return this.items.get(id);
  }

  fulfill(id: string, evidenceEventId: string): { ok: true; obligation: Obligation } | { ok: false; error: string } {
    const existing = this.items.get(id);
    if (!existing) return { ok: false, error: "Unknown obligation." };
    if (!evidenceEventId) return { ok: false, error: "Verified evidence is required." };
    if (existing.physical && !evidenceEventId.startsWith("evt_") && !evidenceEventId.startsWith("verified:")) {
      return { ok: false, error: "Physical promises require a verified world event id." };
    }
    existing.status = "FULFILLED";
    existing.evidenceEventId = evidenceEventId;
    return { ok: true, obligation: existing };
  }

  mark(id: string, status: Exclude<ObligationStatus, "FULFILLED">): Obligation | undefined {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    existing.status = status;
    return existing;
  }
}

export function isCooperation(args: {
  sharedProjectId?: string;
  sharedGoal?: string;
  verifiedContributionA?: boolean;
  verifiedContributionB?: boolean;
}): boolean {
  if (args.sharedProjectId && args.verifiedContributionA && args.verifiedContributionB) return true;
  if (args.sharedGoal && args.verifiedContributionA && args.verifiedContributionB) return true;
  return false;
}
