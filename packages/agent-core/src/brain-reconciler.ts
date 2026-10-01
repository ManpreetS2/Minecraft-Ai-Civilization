import type { SimEvent } from "@civ/shared";
import type { BrainPersistence, VerifiedTransferBrainEvent } from "./brain-persistence.js";
import type { CivilizationStore } from "./store.js";

export type ReconciliationFailure = {
  eventId: string;
  reason: string;
  code: "MALFORMED" | "UNSUPPORTED" | "APPLY_ERROR";
};

export type ReconciliationResult = {
  examined: number;
  applied: number;
  skippedAlreadyApplied: number;
  unsupported: number;
  failures: ReconciliationFailure[];
};

export type ReconcilerOptions = {
  /** Max verified events to examine in one pass. */
  batchSize?: number;
  /** Optional citizen filter for isolation. */
  citizenId?: string;
};

/**
 * Bounded reconciler for the crash window:
 * Minecraft succeeds → verified event durable → process dies before brain effects.
 *
 * Operates on durable VERIFIED events only. Never invents world success.
 */
export class BrainReconciler {
  constructor(
    private readonly store: CivilizationStore,
    private readonly brain: BrainPersistence,
  ) {}

  reconcile(options: ReconcilerOptions = {}): ReconciliationResult {
    const batchSize = options.batchSize ?? 50;
    const events = this.loadVerifiedCandidates(batchSize, options.citizenId);
    const result: ReconciliationResult = {
      examined: 0,
      applied: 0,
      skippedAlreadyApplied: 0,
      unsupported: 0,
      failures: [],
    };

    // Deterministic replay order: timestamp ASC, id ASC
    events.sort((a, b) => {
      const t = a.timestamp.localeCompare(b.timestamp);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });

    for (const event of events) {
      result.examined += 1;
      if (event.type !== "ItemTransferred") {
        result.unsupported += 1;
        result.failures.push({
          eventId: event.id,
          reason: `unsupported event type for reconciler: ${event.type}`,
          code: "UNSUPPORTED",
        });
        continue;
      }

      const parsed = parseVerifiedTransferEvent(event);
      if (!parsed.ok) {
        result.failures.push({ eventId: event.id, reason: parsed.error, code: "MALFORMED" });
        continue;
      }

      const already = this.brain.hasAppliedEvent(
        parsed.event.eventId,
        "composite",
        parsed.event.giverCitizenId,
      );
      if (already) {
        result.skippedAlreadyApplied += 1;
        continue;
      }

      try {
        const out = this.brain.applyVerifiedTransfer(parsed.event);
        if (out.applied) result.applied += 1;
        else result.skippedAlreadyApplied += 1;
      } catch (error) {
        result.failures.push({
          eventId: event.id,
          reason: error instanceof Error ? error.message : String(error),
          code: "APPLY_ERROR",
        });
      }
    }

    return result;
  }

  private loadVerifiedCandidates(limit: number, citizenId?: string): SimEvent[] {
    const rows = citizenId
      ? (this.store.db
          .prepare(
            `SELECT * FROM events
             WHERE type = 'ItemTransferred'
               AND (citizen_id = ? OR instr(payload, ?) > 0)
             ORDER BY timestamp ASC, id ASC
             LIMIT ?`,
          )
          .all(citizenId, citizenId, limit) as EventRow[])
      : (this.store.db
          .prepare(
            `SELECT * FROM events
             WHERE type = 'ItemTransferred'
             ORDER BY timestamp ASC, id ASC
             LIMIT ?`,
          )
          .all(limit) as EventRow[]);

    return rows.map((row) => ({
      id: row.id,
      type: row.type as SimEvent["type"],
      timestamp: row.timestamp,
      citizenId: row.citizen_id ?? undefined,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
  }
}

type EventRow = {
  id: string;
  type: string;
  timestamp: string;
  citizen_id: string | null;
  payload: string;
};

export function parseVerifiedTransferEvent(
  event: SimEvent,
): { ok: true; event: VerifiedTransferBrainEvent } | { ok: false; error: string } {
  if (event.type !== "ItemTransferred") {
    return { ok: false, error: "not ItemTransferred" };
  }
  const p = event.payload;
  if (p.verified !== true) {
    return { ok: false, error: "event not marked verified=true; refusing to invent success" };
  }
  const item = typeof p.item === "string" ? p.item : "";
  const to = typeof p.to === "string" ? p.to : "";
  const quantity = p.quantity;
  const giver = event.citizenId;
  if (!giver) return { ok: false, error: "missing giver citizenId" };
  if (!item) return { ok: false, error: "missing item" };
  if (!to) return { ok: false, error: "missing recipient (to)" };
  if (!Number.isInteger(quantity) || (quantity as number) <= 0) {
    return { ok: false, error: "missing/invalid verified quantity" };
  }
  const candidates = Array.isArray(p.candidateCommitmentIds)
    ? p.candidateCommitmentIds.filter((x): x is string => typeof x === "string")
    : typeof p.commitmentId === "string"
      ? [p.commitmentId]
      : undefined;

  return {
    ok: true,
    event: {
      eventId: event.id,
      type: "ItemTransferred",
      timestamp: event.timestamp,
      giverCitizenId: giver,
      receiverCitizenId: to,
      item,
      quantity: quantity as number,
      candidateCommitmentIds: candidates,
      learned: Array.isArray(p.learned)
        ? (p.learned as VerifiedTransferBrainEvent["learned"])
        : undefined,
    },
  };
}
