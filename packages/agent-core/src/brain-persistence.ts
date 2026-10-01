import type {
  CognitionState,
  Commitment,
  CommitmentStatus,
  DecisionCategory,
  LearnedBehaviorEvidenceRow,
  LearnedDimension,
  RelationshipBelief,
} from "@civ/shared";
import { parseCommitmentPayload } from "@civ/shared";
import {
  completeCommitment,
  createCommitment,
  expireCommitments,
  updateCommitmentStatus,
} from "@civ/cognition";
import { summarizeLearnedBehavior, type BehaviorEvidence } from "@civ/memory";
import { applyBeliefEvent, blankBelief, type BeliefEvent } from "@civ/society";
import {
  matchItemTransferCommitment,
  progressFromLedger,
  type CommitmentProgressView,
} from "./commitment-predicate.js";
import {
  beliefEffectKey,
  learnedEvidenceId,
  memoryIdForTransfer,
  progressLedgerId,
  type BeliefEffectRole,
} from "./event-provenance.js";
import type { CivilizationStore } from "./store.js";

export type BrainEffectKind =
  | "commitment"
  | "relationship_belief"
  | "learned_behavior"
  | "memory"
  | "cognition_state"
  | "composite";

export type PendingReconsiderSignal =
  | "REQUEST_PENDING"
  | "COMMITMENT_CONFLICT"
  | "TASK_FAILURE"
  | "GOAL_INVALIDATED"
  | "SURVIVAL_CHANGED"
  | "MAJOR_RELATIONSHIP";

export type VerifiedTransferBrainEvent = {
  eventId: string;
  type: "ItemTransferred";
  timestamp: string;
  /** Citizen who gave the item (physical actor). */
  giverCitizenId: string;
  /** Citizen who received the item. */
  receiverCitizenId: string;
  item: string;
  /** Verified positive integer quantity — never inferred from narration. */
  quantity: number;
  /**
   * Optional candidate commitment ids. Predicates still decide match/progress.
   * Passing an id never forces COMPLETE.
   */
  candidateCommitmentIds?: string[];
  /** @deprecated Use candidateCommitmentIds — kept for Pass-4 call sites; still predicate-gated. */
  completesCommitmentId?: string;
  /** Optional learned-behavior dimensions for giver. */
  learned?: Array<{
    citizenId: string;
    dimension: LearnedDimension;
    direction: -1 | 1;
    weight?: number;
    source?: string;
    confidence?: number;
  }>;
};

/**
 * Durable brain writes for one verified world event.
 * Call only AFTER Minecraft physical verification.
 * Minecraft inventory + SQLite are NOT one atomic transaction.
 */
export class BrainPersistence {
  constructor(readonly store: CivilizationStore) {}

  withTransaction<T>(fn: () => T): T {
    return this.store.db.transaction(fn)();
  }

  hasAppliedEvent(eventId: string, effectKind: BrainEffectKind, citizenId: string): boolean {
    const row = this.store.db
      .prepare(
        `SELECT 1 AS ok FROM brain_applied_events
         WHERE event_id = ? AND effect_kind = ? AND citizen_id = ?`,
      )
      .get(eventId, effectKind, citizenId) as { ok: number } | undefined;
    return Boolean(row);
  }

  markApplied(eventId: string, effectKind: BrainEffectKind, citizenId: string, at?: string): void {
    this.store.db
      .prepare(
        `INSERT OR IGNORE INTO brain_applied_events (event_id, effect_kind, citizen_id, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(eventId, effectKind, citizenId, at ?? new Date().toISOString());
  }

  // --- Commitments ---

  upsertCommitment(commitment: Commitment): void {
    this.store.db
      .prepare(
        `INSERT INTO commitments (
          id, owner_citizen_id, counterparty_citizen_id, goal, payload, status,
          created_at, updated_at, reconsider_at, expires_at,
          evidence_json, completion_evidence_json, completion_evidence_event_id, failure_reason
        ) VALUES (
          @id, @owner, @counterparty, @goal, @payload, @status,
          @createdAt, @updatedAt, @reconsiderAt, @expiresAt,
          @evidence, @completionEvidence, @completionEventId, @failureReason
        )
        ON CONFLICT(id) DO UPDATE SET
          owner_citizen_id = excluded.owner_citizen_id,
          counterparty_citizen_id = excluded.counterparty_citizen_id,
          goal = excluded.goal,
          payload = excluded.payload,
          status = excluded.status,
          updated_at = excluded.updated_at,
          reconsider_at = excluded.reconsider_at,
          expires_at = excluded.expires_at,
          evidence_json = excluded.evidence_json,
          completion_evidence_json = excluded.completion_evidence_json,
          completion_evidence_event_id = excluded.completion_evidence_event_id,
          failure_reason = excluded.failure_reason`,
      )
      .run({
        id: commitment.id,
        owner: commitment.ownerCitizenId,
        counterparty: commitment.counterpartyId ?? null,
        goal: commitment.goal,
        payload: commitment.payload ?? null,
        status: commitment.status,
        createdAt: commitment.createdAt,
        updatedAt: commitment.updatedAt ?? commitment.createdAt,
        reconsiderAt: commitment.reconsiderAt ?? null,
        expiresAt: commitment.expiresAt ?? null,
        evidence: JSON.stringify(commitment.evidence ?? []),
        completionEvidence: JSON.stringify(commitment.completionEvidence ?? []),
        completionEventId: commitment.completionEvidenceEventId ?? null,
        failureReason: commitment.failureReason ?? null,
      });
  }

  getCommitment(id: string): Commitment | undefined {
    const row = this.store.db.prepare(`SELECT * FROM commitments WHERE id = ?`).get(id) as
      | CommitmentRow
      | undefined;
    return row ? mapCommitment(row) : undefined;
  }

  listCommitmentsFor(citizenId: string): Commitment[] {
    const rows = this.store.db
      .prepare(
        `SELECT * FROM commitments
         WHERE owner_citizen_id = ? OR counterparty_citizen_id = ?
         ORDER BY created_at ASC`,
      )
      .all(citizenId, citizenId) as CommitmentRow[];
    return rows.map(mapCommitment);
  }

  listActiveCommitments(citizenId: string): Commitment[] {
    return this.listCommitmentsFor(citizenId).filter((c) => c.status === "ACTIVE");
  }

  createCommitmentPersistent(input: Parameters<typeof createCommitment>[0]): Commitment {
    const c = createCommitment(input);
    this.upsertCommitment(c);
    return c;
  }

  /**
   * Complete commitment only with verified evidence + event id.
   * Idempotent: second call with same event returns existing COMPLETED without error fabrication.
   */
  completeCommitmentPersistent(
    commitmentId: string,
    verifiedEvidence: string[],
    completionEvidenceEventId: string,
    now = new Date().toISOString(),
  ): { ok: true; commitment: Commitment; already: boolean } | { ok: false; error: string } {
    const existing = this.getCommitment(commitmentId);
    if (!existing) return { ok: false, error: "commitment not found" };
    if (existing.status === "COMPLETED") {
      if (existing.completionEvidenceEventId === completionEvidenceEventId) {
        return { ok: true, commitment: existing, already: true };
      }
      return { ok: false, error: "Commitment already COMPLETED with different evidence" };
    }
    if (existing.status === "EXPIRED" || existing.status === "CANCELLED" || existing.status === "FAILED") {
      return { ok: false, error: `Cannot complete ${existing.status} commitment` };
    }
    const result = completeCommitment(existing, verifiedEvidence, {
      completionEvidenceEventId,
      now,
    });
    if ("error" in result) return { ok: false, error: result.error };
    this.upsertCommitment(result);
    return { ok: true, commitment: result, already: false };
  }

  expireDueCommitments(nowIso: string): Commitment[] {
    const rows = this.store.db
      .prepare(`SELECT * FROM commitments WHERE status = 'ACTIVE'`)
      .all() as CommitmentRow[];
    const expired = expireCommitments(rows.map(mapCommitment), nowIso).filter(
      (c) => c.status === "EXPIRED",
    );
    for (const c of expired) this.upsertCommitment(c);
    return expired;
  }

  failCommitment(commitmentId: string, reason: string): Commitment | undefined {
    const existing = this.getCommitment(commitmentId);
    if (!existing || existing.status !== "ACTIVE") return undefined;
    const next = updateCommitmentStatus(existing, "FAILED", reason, reason);
    this.upsertCommitment(next);
    return next;
  }

  // --- Relationship beliefs ---

  saveRelationshipBelief(belief: RelationshipBelief): void {
    const confidence = belief.evidenceCount > 0 ? Math.min(0.95, 1 - Math.exp(-belief.evidenceCount / 3)) : 0;
    this.store.db
      .prepare(
        `INSERT INTO relationship_beliefs (
          observer_citizen_id, subject_citizen_id, trust, familiarity,
          recent_positive, recent_negative, unresolved_requests_json, unresolved_promises_json,
          resource_transfers, cooperation_count, evidence_count, confidence, last_updated
        ) VALUES (
          @observer, @subject, @trust, @familiarity,
          @pos, @neg, @requests, @promises,
          @transfers, @coop, @evidenceCount, @confidence, @updatedAt
        )
        ON CONFLICT(observer_citizen_id, subject_citizen_id) DO UPDATE SET
          trust = excluded.trust,
          familiarity = excluded.familiarity,
          recent_positive = excluded.recent_positive,
          recent_negative = excluded.recent_negative,
          unresolved_requests_json = excluded.unresolved_requests_json,
          unresolved_promises_json = excluded.unresolved_promises_json,
          resource_transfers = excluded.resource_transfers,
          cooperation_count = excluded.cooperation_count,
          evidence_count = excluded.evidence_count,
          confidence = excluded.confidence,
          last_updated = excluded.last_updated`,
      )
      .run({
        observer: belief.observerId,
        subject: belief.subjectId,
        trust: belief.trust,
        familiarity: belief.familiarity,
        pos: belief.recentPositive,
        neg: belief.recentNegative,
        requests: JSON.stringify(belief.unresolvedRequests),
        promises: JSON.stringify(belief.unresolvedPromises),
        transfers: belief.resourceTransfers,
        coop: belief.cooperationCount,
        evidenceCount: belief.evidenceCount,
        confidence,
        updatedAt: belief.updatedAt,
      });
  }

  getRelationshipBelief(observerId: string, subjectId: string): RelationshipBelief | undefined {
    const row = this.store.db
      .prepare(
        `SELECT * FROM relationship_beliefs
         WHERE observer_citizen_id = ? AND subject_citizen_id = ?`,
      )
      .get(observerId, subjectId) as BeliefRow | undefined;
    return row ? mapBelief(row) : undefined;
  }

  listRelationshipBeliefs(observerId: string): RelationshipBelief[] {
    const rows = this.store.db
      .prepare(`SELECT * FROM relationship_beliefs WHERE observer_citizen_id = ?`)
      .all(observerId) as BeliefRow[];
    return rows.map(mapBelief);
  }

  /**
   * Apply directional belief event idempotently.
   * `sourceEventId` is the verified Minecraft event; `effectRole` distinguishes
   * multiple directional effects from the same source without inventing MC events.
   */
  applyBeliefEventPersistent(
    sourceEventId: string,
    event: BeliefEvent,
    effectRole: BeliefEffectRole = "direct",
  ): { belief: RelationshipBelief; applied: boolean } {
    const effectKey = beliefEffectKey(sourceEventId, effectRole);
    const inserted = this.store.db
      .prepare(
        `INSERT OR IGNORE INTO relationship_belief_evidence (
          id, event_id, observer_citizen_id, subject_citizen_id, kind, first_person, detail, observed_at,
          source_event_id, effect_role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        effectKey,
        effectKey,
        event.observerId,
        event.subjectId,
        event.kind,
        event.firstPerson ? 1 : 0,
        event.detail ?? null,
        event.at ?? new Date().toISOString(),
        sourceEventId,
        effectRole,
      );
    if (inserted.changes === 0) {
      const existing =
        this.getRelationshipBelief(event.observerId, event.subjectId) ??
        blankBelief(event.observerId, event.subjectId);
      return { belief: existing, applied: false };
    }
    const base =
      this.getRelationshipBelief(event.observerId, event.subjectId) ??
      blankBelief(event.observerId, event.subjectId, event.at);
    const next = applyBeliefEvent(base, event);
    this.saveRelationshipBelief(next);
    return { belief: next, applied: true };
  }

  // --- Commitment progress (reconstructable from verified event ledger) ---

  listCommitmentProgressEvents(commitmentId: string): Array<{
    sourceEventId: string;
    quantity: number;
    item: string;
    appliedAt: string;
  }> {
    const rows = this.store.db
      .prepare(
        `SELECT source_event_id, quantity, item, applied_at
         FROM commitment_progress_events
         WHERE commitment_id = ?
         ORDER BY applied_at ASC, source_event_id ASC`,
      )
      .all(commitmentId) as Array<{
      source_event_id: string;
      quantity: number;
      item: string;
      applied_at: string;
    }>;
    return rows.map((r) => ({
      sourceEventId: r.source_event_id,
      quantity: r.quantity,
      item: r.item,
      appliedAt: r.applied_at,
    }));
  }

  getCommitmentProgress(commitmentId: string): CommitmentProgressView | undefined {
    const commitment = this.getCommitment(commitmentId);
    if (!commitment) return undefined;
    const parsed = parseCommitmentPayload(commitment.payload);
    const required =
      parsed.ok && parsed.target.type === "item_transfer" ? parsed.target.quantity : 0;
    const rows = this.listCommitmentProgressEvents(commitmentId);
    return progressFromLedger(
      commitmentId,
      required,
      rows.map((r) => ({ sourceEventId: r.sourceEventId, quantity: r.quantity })),
    );
  }

  /**
   * Credit verified transfer quantity toward matching commitments.
   * Idempotent per (commitmentId, sourceEventId). Completes only when ledger sum >= required.
   */
  applyTransferToCommitments(transfer: {
    eventId: string;
    giverCitizenId: string;
    receiverCitizenId: string;
    item: string;
    quantity: number;
    timestamp: string;
    candidateCommitmentIds?: string[];
  }): { credited: Array<{ commitmentId: string; progress: CommitmentProgressView }>; completed: Commitment[] } {
    if (!Number.isInteger(transfer.quantity) || transfer.quantity <= 0) {
      throw new Error("transfer quantity must be a positive integer");
    }
    const candidates = new Set(transfer.candidateCommitmentIds ?? []);
    const active = this.listActiveCommitments(transfer.giverCitizenId);
    const considered = active.filter((c) => candidates.size === 0 || candidates.has(c.id));
    const credited: Array<{ commitmentId: string; progress: CommitmentProgressView }> = [];
    const completed: Commitment[] = [];

    for (const commitment of considered) {
      const match = matchItemTransferCommitment(commitment, transfer);
      if (!match.matches) continue;

      const ledgerId = progressLedgerId(commitment.id, transfer.eventId);
      const inserted = this.store.db
        .prepare(
          `INSERT OR IGNORE INTO commitment_progress_events (
            id, commitment_id, source_event_id, quantity, item, applied_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ledgerId,
          commitment.id,
          transfer.eventId,
          match.creditedQuantity,
          transfer.item,
          transfer.timestamp,
        );
      if (inserted.changes === 0) {
        const progress = this.getCommitmentProgress(commitment.id)!;
        credited.push({ commitmentId: commitment.id, progress });
        continue;
      }

      const progress = this.getCommitmentProgress(commitment.id)!;
      credited.push({ commitmentId: commitment.id, progress });
      const evidence = [
        `transfer:${transfer.item}x${transfer.quantity}:${transfer.giverCitizenId}->${transfer.receiverCitizenId}`,
        `event:${transfer.eventId}`,
        `progress:${progress.delivered}/${progress.required}`,
      ];
      if (progress.complete) {
        const done = this.completeCommitmentPersistent(
          commitment.id,
          evidence,
          transfer.eventId,
          transfer.timestamp,
        );
        if (done.ok) completed.push(done.commitment);
      } else {
        const updated: Commitment = {
          ...commitment,
          updatedAt: transfer.timestamp,
          evidence: [...commitment.evidence, ...evidence],
        };
        this.upsertCommitment(updated);
      }
    }
    return { credited, completed };
  }

  // --- Pending reconsideration signals ---

  upsertPendingReconsideration(
    citizenId: string,
    signal: PendingReconsiderSignal,
    detail?: string,
    at = new Date().toISOString(),
  ): void {
    this.store.db
      .prepare(
        `INSERT INTO pending_reconsideration (citizen_id, signal, detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(citizen_id, signal) DO UPDATE SET
           detail = excluded.detail,
           updated_at = excluded.updated_at`,
      )
      .run(citizenId, signal, detail ?? null, at, at);
  }

  listPendingReconsideration(citizenId: string): Array<{
    signal: PendingReconsiderSignal;
    detail?: string;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.store.db
      .prepare(
        `SELECT signal, detail, created_at, updated_at FROM pending_reconsideration
         WHERE citizen_id = ? ORDER BY created_at ASC`,
      )
      .all(citizenId) as Array<{
      signal: string;
      detail: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      signal: r.signal as PendingReconsiderSignal,
      detail: r.detail ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  clearPendingReconsideration(citizenId: string, signal?: PendingReconsiderSignal): void {
    if (signal) {
      this.store.db
        .prepare(`DELETE FROM pending_reconsideration WHERE citizen_id = ? AND signal = ?`)
        .run(citizenId, signal);
      return;
    }
    this.store.db.prepare(`DELETE FROM pending_reconsideration WHERE citizen_id = ?`).run(citizenId);
  }

  /** Rebuild belief from stored evidence (ordered). Used for restart equivalence checks. */
  reconstructBeliefFromEvidence(observerId: string, subjectId: string): RelationshipBelief {
    const rows = this.store.db
      .prepare(
        `SELECT * FROM relationship_belief_evidence
         WHERE observer_citizen_id = ? AND subject_citizen_id = ?
         ORDER BY observed_at ASC, event_id ASC`,
      )
      .all(observerId, subjectId) as BeliefEvidenceRow[];
    let belief = blankBelief(observerId, subjectId);
    for (const row of rows) {
      belief = applyBeliefEvent(belief, {
        kind: row.kind as BeliefEvent["kind"],
        observerId: row.observer_citizen_id,
        subjectId: row.subject_citizen_id,
        detail: row.detail ?? undefined,
        at: row.observed_at,
        firstPerson: Boolean(row.first_person),
      });
    }
    return belief;
  }

  // --- Learned behavior ---

  insertLearnedEvidence(row: LearnedBehaviorEvidenceRow): boolean {
    const result = this.store.db
      .prepare(
        `INSERT OR IGNORE INTO learned_behavior_evidence (
          id, event_id, citizen_id, dimension, direction, weight, observed_at, source, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.eventId,
        row.citizenId,
        row.dimension,
        row.direction,
        row.weight,
        row.observedAt,
        row.source,
        row.confidence,
      );
    return result.changes > 0;
  }

  listLearnedEvidence(citizenId: string): LearnedBehaviorEvidenceRow[] {
    const rows = this.store.db
      .prepare(
        `SELECT * FROM learned_behavior_evidence WHERE citizen_id = ? ORDER BY observed_at ASC`,
      )
      .all(citizenId) as LearnedRow[];
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      citizenId: r.citizen_id,
      dimension: r.dimension as LearnedDimension,
      direction: r.direction as -1 | 1,
      weight: r.weight,
      observedAt: r.observed_at,
      source: r.source,
      confidence: r.confidence,
    }));
  }

  summarizeLearned(citizenId: string, now?: number) {
    const evidence: BehaviorEvidence[] = this.listLearnedEvidence(citizenId).map((e) => ({
      dimension: e.dimension,
      direction: e.direction,
      weight: e.weight,
      at: e.observedAt,
    }));
    return summarizeLearnedBehavior(evidence, { now });
  }

  // --- Cognition state ---

  saveCognitionState(state: CognitionState): void {
    this.store.db
      .prepare(
        `INSERT INTO cognition_state (
          citizen_id, current_high_level_goal, goal_started_at, last_deliberation_at,
          reconsider_after, last_major_event_id, last_decision_category,
          mood_label, mood_intensity, mood_evidence_count, mood_updated_at, updated_at
        ) VALUES (
          @citizenId, @goal, @goalStarted, @lastDelib,
          @reconsider, @majorEvent, @category,
          @moodLabel, @moodIntensity, @moodEvidence, @moodUpdated, @updatedAt
        )
        ON CONFLICT(citizen_id) DO UPDATE SET
          current_high_level_goal = excluded.current_high_level_goal,
          goal_started_at = excluded.goal_started_at,
          last_deliberation_at = excluded.last_deliberation_at,
          reconsider_after = excluded.reconsider_after,
          last_major_event_id = excluded.last_major_event_id,
          last_decision_category = excluded.last_decision_category,
          mood_label = excluded.mood_label,
          mood_intensity = excluded.mood_intensity,
          mood_evidence_count = excluded.mood_evidence_count,
          mood_updated_at = excluded.mood_updated_at,
          updated_at = excluded.updated_at`,
      )
      .run({
        citizenId: state.citizenId,
        goal: state.currentHighLevelGoal ?? null,
        goalStarted: state.goalStartedAt ?? null,
        lastDelib: state.lastDeliberationAt ?? null,
        reconsider: state.reconsiderAfter ?? null,
        majorEvent: state.lastMajorEventId ?? null,
        category: state.lastDecisionCategory ?? null,
        moodLabel: state.moodLabel ?? null,
        moodIntensity: state.moodIntensity ?? null,
        moodEvidence: state.moodEvidenceCount ?? null,
        moodUpdated: state.moodUpdatedAt ?? null,
        updatedAt: state.updatedAt,
      });
  }

  getCognitionState(citizenId: string): CognitionState | undefined {
    const row = this.store.db
      .prepare(`SELECT * FROM cognition_state WHERE citizen_id = ?`)
      .get(citizenId) as CognitionRow | undefined;
    return row ? mapCognition(row) : undefined;
  }

  /**
   * Apply a verified item-transfer event to brain tables in one SQLite transaction.
   * Idempotent on eventId. Does not touch Minecraft state.
   * Commitment completion is predicate + progress gated — never forced by id alone.
   */
  applyVerifiedTransfer(event: VerifiedTransferBrainEvent): {
    applied: boolean;
    commitment?: Commitment;
    progress?: CommitmentProgressView[];
  } {
    if (!Number.isInteger(event.quantity) || event.quantity <= 0) {
      throw new Error("VerifiedTransferBrainEvent.quantity must be a positive integer");
    }

    return this.withTransaction(() => {
      const candidateIds = [
        ...(event.candidateCommitmentIds ?? []),
        ...(event.completesCommitmentId ? [event.completesCommitmentId] : []),
      ];

      if (this.hasAppliedEvent(event.eventId, "composite", event.giverCitizenId)) {
        const progress = candidateIds
          .map((id) => this.getCommitmentProgress(id))
          .filter((p): p is CommitmentProgressView => Boolean(p));
        return {
          applied: false,
          commitment: candidateIds[0] ? this.getCommitment(candidateIds[0]) : undefined,
          progress,
        };
      }

      const qtyLabel = event.quantity === 1 ? event.item : `${event.quantity} ${event.item}`;

      // Deterministic memory ids for replay equality.
      this.store.addMemoryIdempotent({
        id: memoryIdForTransfer(event.eventId, "giver"),
        citizenId: event.giverCitizenId,
        kind: "social",
        content: `Gave ${qtyLabel} to ${event.receiverCitizenId}`,
        importance: 0.7,
        createdAt: event.timestamp,
        relatedCitizenId: event.receiverCitizenId,
      });
      this.store.addMemoryIdempotent({
        id: memoryIdForTransfer(event.eventId, "receiver"),
        citizenId: event.receiverCitizenId,
        kind: "social",
        content: `Received ${qtyLabel} from ${event.giverCitizenId}`,
        importance: 0.75,
        createdAt: event.timestamp,
        relatedCitizenId: event.giverCitizenId,
      });

      // Directional beliefs share the SAME source verified event id.
      this.applyBeliefEventPersistent(
        event.eventId,
        {
          kind: "shared_resource",
          observerId: event.giverCitizenId,
          subjectId: event.receiverCitizenId,
          detail: qtyLabel,
          at: event.timestamp,
          firstPerson: true,
        },
        "transfer_giver",
      );
      this.applyBeliefEventPersistent(
        event.eventId,
        {
          kind: "was_helped",
          observerId: event.receiverCitizenId,
          subjectId: event.giverCitizenId,
          detail: qtyLabel,
          at: event.timestamp,
          firstPerson: true,
        },
        "transfer_receiver",
      );

      const { completed, credited } = this.applyTransferToCommitments({
        eventId: event.eventId,
        giverCitizenId: event.giverCitizenId,
        receiverCitizenId: event.receiverCitizenId,
        item: event.item,
        quantity: event.quantity,
        timestamp: event.timestamp,
        candidateCommitmentIds: candidateIds.length > 0 ? candidateIds : undefined,
      });

      for (const learned of event.learned ?? []) {
        this.insertLearnedEvidence({
          id: learnedEvidenceId(event.eventId, learned.citizenId, learned.dimension),
          eventId: event.eventId,
          citizenId: learned.citizenId,
          dimension: learned.dimension,
          direction: learned.direction,
          weight: learned.weight ?? 1,
          observedAt: event.timestamp,
          source: learned.source ?? "verified_transfer",
          confidence: learned.confidence ?? 0.7,
        });
      }

      this.store.appendEventIdempotent({
        id: event.eventId,
        type: "ItemTransferred",
        timestamp: event.timestamp,
        citizenId: event.giverCitizenId,
        payload: {
          to: event.receiverCitizenId,
          item: event.item,
          quantity: event.quantity,
          verified: true,
          candidateCommitmentIds: candidateIds.length > 0 ? candidateIds : undefined,
          learned: event.learned,
        },
      });

      this.markApplied(event.eventId, "composite", event.giverCitizenId, event.timestamp);
      this.markApplied(event.eventId, "composite", event.receiverCitizenId, event.timestamp);
      return {
        applied: true,
        commitment: completed[0] ?? (candidateIds[0] ? this.getCommitment(candidateIds[0]) : undefined),
        progress: credited.map((c) => c.progress),
      };
    });
  }
}

type CommitmentRow = {
  id: string;
  owner_citizen_id: string;
  counterparty_citizen_id: string | null;
  goal: string;
  payload: string | null;
  status: CommitmentStatus;
  created_at: string;
  updated_at: string;
  reconsider_at: string | null;
  expires_at: string | null;
  evidence_json: string;
  completion_evidence_json: string;
  completion_evidence_event_id: string | null;
  failure_reason: string | null;
};

type BeliefRow = {
  observer_citizen_id: string;
  subject_citizen_id: string;
  trust: number;
  familiarity: number;
  recent_positive: number;
  recent_negative: number;
  unresolved_requests_json: string;
  unresolved_promises_json: string;
  resource_transfers: number;
  cooperation_count: number;
  evidence_count: number;
  confidence: number;
  last_updated: string;
};

type BeliefEvidenceRow = {
  id: string;
  event_id: string;
  observer_citizen_id: string;
  subject_citizen_id: string;
  kind: string;
  first_person: number;
  detail: string | null;
  observed_at: string;
};

type LearnedRow = {
  id: string;
  event_id: string;
  citizen_id: string;
  dimension: string;
  direction: number;
  weight: number;
  observed_at: string;
  source: string;
  confidence: number;
};

type CognitionRow = {
  citizen_id: string;
  current_high_level_goal: string | null;
  goal_started_at: string | null;
  last_deliberation_at: string | null;
  reconsider_after: string | null;
  last_major_event_id: string | null;
  last_decision_category: string | null;
  mood_label: string | null;
  mood_intensity: number | null;
  mood_evidence_count: number | null;
  mood_updated_at: string | null;
  updated_at: string;
};

function mapCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.id,
    ownerCitizenId: row.owner_citizen_id,
    counterpartyId: row.counterparty_citizen_id ?? undefined,
    goal: row.goal,
    payload: row.payload ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reconsiderAt: row.reconsider_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    evidence: JSON.parse(row.evidence_json) as string[],
    completionEvidence: JSON.parse(row.completion_evidence_json) as string[],
    completionEvidenceEventId: row.completion_evidence_event_id ?? undefined,
    failureReason: row.failure_reason ?? undefined,
  };
}

function mapBelief(row: BeliefRow): RelationshipBelief {
  return {
    observerId: row.observer_citizen_id,
    subjectId: row.subject_citizen_id,
    trust: row.trust,
    familiarity: row.familiarity,
    recentPositive: row.recent_positive,
    recentNegative: row.recent_negative,
    unresolvedRequests: JSON.parse(row.unresolved_requests_json) as string[],
    unresolvedPromises: JSON.parse(row.unresolved_promises_json) as string[],
    resourceTransfers: row.resource_transfers,
    cooperationCount: row.cooperation_count,
    evidenceCount: row.evidence_count,
    updatedAt: row.last_updated,
  };
}

function mapCognition(row: CognitionRow): CognitionState {
  return {
    citizenId: row.citizen_id,
    currentHighLevelGoal: row.current_high_level_goal ?? undefined,
    goalStartedAt: row.goal_started_at ?? undefined,
    lastDeliberationAt: row.last_deliberation_at ?? undefined,
    reconsiderAfter: row.reconsider_after ?? undefined,
    lastMajorEventId: row.last_major_event_id ?? undefined,
    lastDecisionCategory: (row.last_decision_category as DecisionCategory | null) ?? undefined,
    moodLabel: (row.mood_label as CognitionState["moodLabel"]) ?? undefined,
    moodIntensity: row.mood_intensity ?? undefined,
    moodEvidenceCount: row.mood_evidence_count ?? undefined,
    moodUpdatedAt: row.mood_updated_at ?? undefined,
    updatedAt: row.updated_at,
  };
}
