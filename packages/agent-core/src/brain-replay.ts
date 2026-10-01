import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Commitment, RelationshipBelief } from "@civ/shared";
import { serializeCommitmentTarget, type CommitmentTarget } from "@civ/shared";
import { BrainPersistence, type VerifiedTransferBrainEvent } from "./brain-persistence.js";
import { CivilizationStore } from "./store.js";

export type ReplayCommitmentSeed = {
  id: string;
  ownerCitizenId: string;
  counterpartyId?: string;
  goal: string;
  target: CommitmentTarget;
  createdAt: string;
};

export type BrainReplayInput = {
  commitments?: ReplayCommitmentSeed[];
  events: VerifiedTransferBrainEvent[];
};

export type BrainReplaySnapshot = {
  commitments: Array<{
    id: string;
    status: Commitment["status"];
    progressDelivered: number;
    progressRequired: number;
    completionEvidenceEventId?: string;
    progressEventIds: string[];
  }>;
  beliefs: Array<{
    observerId: string;
    subjectId: string;
    trust: number;
    familiarity: number;
    recentPositive: number;
    recentNegative: number;
    resourceTransfers: number;
    cooperationCount: number;
    evidenceCount: number;
  }>;
  learned: Array<{
    eventId: string;
    citizenId: string;
    dimension: string;
    direction: number;
    weight: number;
  }>;
  appliedEventKeys: string[];
};

/**
 * Deterministic brain replay harness (TEMP DB).
 * Rebuild from ordered verified events → comparable snapshot.
 * Excludes nondeterministic wall-clock fields; uses event timestamps / deterministic ids.
 */
export function replayBrainState(input: BrainReplayInput): {
  snapshot: BrainReplaySnapshot;
  storePath: string;
  close: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "civ-replay-"));
  const path = join(dir, "replay.sqlite");
  const store = new CivilizationStore(path);
  const brain = new BrainPersistence(store);

  for (const c of input.commitments ?? []) {
    brain.createCommitmentPersistent({
      id: c.id,
      ownerCitizenId: c.ownerCitizenId,
      counterpartyId: c.counterpartyId,
      goal: c.goal,
      payload: serializeCommitmentTarget(c.target),
      createdAt: c.createdAt,
    });
  }

  const ordered = [...input.events].sort((a, b) => {
    const t = a.timestamp.localeCompare(b.timestamp);
    return t !== 0 ? t : a.eventId.localeCompare(b.eventId);
  });
  for (const event of ordered) {
    brain.applyVerifiedTransfer(event);
  }

  const snapshot = captureBrainSnapshot(brain, store);
  return {
    snapshot,
    storePath: path,
    close: () => store.close(),
  };
}

export function captureBrainSnapshot(brain: BrainPersistence, store: CivilizationStore): BrainReplaySnapshot {
  const commitmentRows = store.db
    .prepare(`SELECT id FROM commitments ORDER BY id ASC`)
    .all() as Array<{ id: string }>;
  const commitments = commitmentRows.map((row) => {
    const c = brain.getCommitment(row.id)!;
    const progress = brain.getCommitmentProgress(row.id);
    return {
      id: c.id,
      status: c.status,
      progressDelivered: progress?.delivered ?? 0,
      progressRequired: progress?.required ?? 0,
      completionEvidenceEventId: c.completionEvidenceEventId,
      progressEventIds: progress?.eventIds ?? [],
    };
  });

  const beliefRows = store.db
    .prepare(
      `SELECT observer_citizen_id, subject_citizen_id FROM relationship_beliefs
       ORDER BY observer_citizen_id ASC, subject_citizen_id ASC`,
    )
    .all() as Array<{ observer_citizen_id: string; subject_citizen_id: string }>;
  const beliefs = beliefRows.map((row) => {
    const b = brain.getRelationshipBelief(row.observer_citizen_id, row.subject_citizen_id)!;
    return compactBelief(b);
  });

  const learned = brain
    // list all citizens' learned evidence via SQL for full snapshot
    ? (store.db
        .prepare(
          `SELECT event_id, citizen_id, dimension, direction, weight
           FROM learned_behavior_evidence
           ORDER BY event_id ASC, citizen_id ASC, dimension ASC`,
        )
        .all() as Array<{
        event_id: string;
        citizen_id: string;
        dimension: string;
        direction: number;
        weight: number;
      }>).map((r) => ({
        eventId: r.event_id,
        citizenId: r.citizen_id,
        dimension: r.dimension,
        direction: r.direction,
        weight: r.weight,
      }))
    : [];

  const appliedEventKeys = (
    store.db
      .prepare(
        `SELECT event_id, effect_kind, citizen_id FROM brain_applied_events
         ORDER BY event_id ASC, effect_kind ASC, citizen_id ASC`,
      )
      .all() as Array<{ event_id: string; effect_kind: string; citizen_id: string }>
  ).map((r) => `${r.event_id}|${r.effect_kind}|${r.citizen_id}`);

  return { commitments, beliefs, learned, appliedEventKeys };
}

function compactBelief(b: RelationshipBelief) {
  return {
    observerId: b.observerId,
    subjectId: b.subjectId,
    trust: round6(b.trust),
    familiarity: round6(b.familiarity),
    recentPositive: b.recentPositive,
    recentNegative: b.recentNegative,
    resourceTransfers: b.resourceTransfers,
    cooperationCount: b.cooperationCount,
    evidenceCount: b.evidenceCount,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
