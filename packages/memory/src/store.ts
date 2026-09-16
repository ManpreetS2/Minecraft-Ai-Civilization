import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_PSYCH } from "./bounds.js";
import { parseJson, toJson } from "./json.js";
import { COGNITIVE_MIGRATIONS } from "./schema.js";
import type {
  BehaviorObservations,
  CognitiveIdentity,
  ObjectiveWorldEvent,
  RoutineAggregate,
  StoredMemory,
} from "./types.js";
import type { Vec3 } from "@civ/shared";

export type PsychRow = {
  citizenId: string;
  moodValence: number;
  stress: number;
  fear: number;
  anger: number;
  sadness: number;
  positiveAffect: number;
  confidence: number;
  currentConcernsJson: string;
  updatedAt: string;
};

export type AssociationRow = {
  id: string;
  citizenId: string;
  subjectType: string;
  subjectKey: string;
  associationType: string;
  strength: number;
  confidence: number;
  supportingMemoryIdsJson: string;
  lastReinforcedAt: string;
  lastContradictedAt?: string;
};

export type ActivityRow = {
  citizenId: string;
  activity: string;
  attempts: number;
  successes: number;
  failures: number;
  recentResultsJson: string;
  familiarity: number;
  confidence: number;
  lastPerformedAt?: string;
};

export type HabitRow = {
  id: string;
  citizenId: string;
  contextKey: string;
  action: string;
  occurrences: number;
  successes: number;
  failures: number;
  strength: number;
  lastReinforcedAt: string;
};

export type BeliefRow = {
  observerCitizenId: string;
  targetCitizenId: string;
  familiarity: number;
  trustEvidence: number;
  affectionEvidence: number;
  respectEvidence: number;
  resentmentEvidence: number;
  knownFactsJson: string;
  rumorsJson: string;
  relevantMemoryIdsJson: string;
  confidence: number;
  lastUpdatedAt: string;
};

export type EvidenceRow = {
  id: string;
  observerCitizenId: string;
  targetCitizenId: string;
  kind: string;
  summary: string;
  source: string;
  informantId?: string;
  confidence: number;
  memoryId?: string;
  objectiveEventId?: string;
  createdAt: string;
};

export type ReflectionRow = {
  id: string;
  citizenId: string;
  kind: string;
  eventId?: string;
  salience: number;
  createdAt: string;
  consumed: boolean;
};

export type EmbeddingRecord = {
  memoryId: string;
  citizenId: string;
  model: string;
  dims: number;
  vector: number[];
  createdAt: string;
};

type MemorySqlRow = {
  id: string;
  citizen_id: string;
  memory_type: StoredMemory["memoryType"];
  event_type: string;
  timestamp: string;
  game_time: number | null;
  summary: string;
  participants_json: string;
  location_x: number | null;
  location_y: number | null;
  location_z: number | null;
  objective_facts_json: string;
  subjective_appraisal_json: string | null;
  emotional_salience: number;
  importance: number;
  source: StoredMemory["source"];
  confidence: number;
  tags_json: string;
  related_entity_ids_json: string;
  created_at: string;
  last_recalled_at: string | null;
  recall_count: number;
  compressed: number;
  expires_at: string | null;
  target_citizen_id: string | null;
  supporting_memory_ids_json: string;
};

/**
 * Isolated cognitive persistence.
 *
 * Can open its own SQLite file or attach to an existing better-sqlite3 Database
 * (later: CivilizationStore.db) without rewriting the agent-core schema.
 *
 * Deceased identities are never deleted; ON DELETE RESTRICT keeps history.
 */
export class CognitiveStore {
  readonly db: Database.Database;
  private readonly ownsConnection: boolean;

  constructor(source: string | Database.Database) {
    if (typeof source === "string") {
      if (source !== ":memory:") {
        mkdirSync(dirname(resolve(source)), { recursive: true });
      }
      this.db = new Database(source);
      this.ownsConnection = true;
    } else {
      this.db = source;
      this.ownsConnection = false;
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cognitive_schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      (
        this.db.prepare(`SELECT name FROM cognitive_schema_migrations`).all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    for (const migration of COGNITIVE_MIGRATIONS) {
      if (applied.has(migration.name)) continue;
      this.db.exec(migration.sql);
      this.db
        .prepare(`INSERT INTO cognitive_schema_migrations (name, applied_at) VALUES (?, ?)`)
        .run(migration.name, new Date().toISOString());
    }
  }

  upsertIdentity(citizenId: string, name?: string, createdAt = new Date().toISOString()): void {
    this.db
      .prepare(
        `INSERT INTO cognitive_identities (citizen_id, name, deceased, created_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(citizen_id) DO UPDATE SET
           name = COALESCE(excluded.name, cognitive_identities.name)`,
      )
      .run(citizenId, name ?? null, createdAt);
  }

  markDeceased(citizenId: string, at = new Date().toISOString()): void {
    this.upsertIdentity(citizenId);
    this.db
      .prepare(
        `UPDATE cognitive_identities SET deceased = 1, deceased_at = COALESCE(deceased_at, ?) WHERE citizen_id = ?`,
      )
      .run(at, citizenId);
  }

  getIdentity(citizenId: string): CognitiveIdentity | undefined {
    const row = this.db
      .prepare(`SELECT * FROM cognitive_identities WHERE citizen_id = ?`)
      .get(citizenId) as
      | {
          citizen_id: string;
          name: string | null;
          deceased: number;
          deceased_at: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      citizenId: row.citizen_id,
      name: row.name ?? undefined,
      deceased: Boolean(row.deceased),
      deceasedAt: row.deceased_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  listIdentities(): CognitiveIdentity[] {
    const rows = this.db.prepare(`SELECT * FROM cognitive_identities ORDER BY citizen_id`).all() as Array<{
      citizen_id: string;
      name: string | null;
      deceased: number;
      deceased_at: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      citizenId: row.citizen_id,
      name: row.name ?? undefined,
      deceased: Boolean(row.deceased),
      deceasedAt: row.deceased_at ?? undefined,
      createdAt: row.created_at,
    }));
  }

  putObjectiveEvent(event: ObjectiveWorldEvent): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO objective_events (
          id, category, timestamp, game_time, location_x, location_y, location_z,
          actor_citizen_id, target_citizen_id, participants_json, facts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.category,
        event.timestamp,
        event.gameTime ?? null,
        event.location?.x ?? null,
        event.location?.y ?? null,
        event.location?.z ?? null,
        event.actorCitizenId ?? null,
        event.targetCitizenId ?? null,
        toJson(event.participants),
        toJson(event.facts),
      );
  }

  getObjectiveEvent(id: string): ObjectiveWorldEvent | undefined {
    const row = this.db.prepare(`SELECT * FROM objective_events WHERE id = ?`).get(id) as
      | {
          id: string;
          category: ObjectiveWorldEvent["category"];
          timestamp: string;
          game_time: number | null;
          location_x: number | null;
          location_y: number | null;
          location_z: number | null;
          actor_citizen_id: string | null;
          target_citizen_id: string | null;
          participants_json: string;
          facts_json: string;
        }
      | undefined;
    if (!row) return undefined;
    return mapObjective(row);
  }

  listObjectiveEvents(): ObjectiveWorldEvent[] {
    const rows = this.db.prepare(`SELECT * FROM objective_events ORDER BY timestamp`).all() as Array<{
      id: string;
      category: ObjectiveWorldEvent["category"];
      timestamp: string;
      game_time: number | null;
      location_x: number | null;
      location_y: number | null;
      location_z: number | null;
      actor_citizen_id: string | null;
      target_citizen_id: string | null;
      participants_json: string;
      facts_json: string;
    }>;
    return rows.map(mapObjective);
  }

  putMemory(memory: StoredMemory): void {
    this.upsertIdentity(memory.citizenId);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO citizen_memories (
          id, citizen_id, memory_type, event_type, timestamp, game_time, summary, participants_json,
          location_x, location_y, location_z, objective_facts_json, subjective_appraisal_json,
          emotional_salience, importance, source, confidence, tags_json, related_entity_ids_json,
          created_at, last_recalled_at, recall_count, compressed, expires_at, target_citizen_id,
          supporting_memory_ids_json
        ) VALUES (
          @id, @citizenId, @memoryType, @eventType, @timestamp, @gameTime, @summary, @participants,
          @locationX, @locationY, @locationZ, @facts, @appraisal,
          @salience, @importance, @source, @confidence, @tags, @related,
          @createdAt, @lastRecalledAt, @recallCount, @compressed, @expiresAt, @targetCitizenId,
          @supporting
        )`,
      )
      .run({
        id: memory.id,
        citizenId: memory.citizenId,
        memoryType: memory.memoryType,
        eventType: memory.eventType,
        timestamp: memory.timestamp,
        gameTime: memory.gameTime ?? null,
        summary: memory.summary,
        participants: toJson(memory.participants),
        locationX: memory.location?.x ?? null,
        locationY: memory.location?.y ?? null,
        locationZ: memory.location?.z ?? null,
        facts: toJson(memory.objectiveFacts),
        appraisal: memory.subjectiveAppraisal ? toJson(memory.subjectiveAppraisal) : null,
        salience: memory.emotionalSalience,
        importance: memory.importance,
        source: memory.source,
        confidence: memory.confidence,
        tags: toJson(memory.tags),
        related: toJson(memory.relatedEntityIds),
        createdAt: memory.createdAt,
        lastRecalledAt: memory.lastRecalledAt ?? null,
        recallCount: memory.recallCount,
        compressed: memory.compressed ? 1 : 0,
        expiresAt: memory.expiresAt ?? null,
        targetCitizenId: memory.targetCitizenId ?? null,
        supporting: toJson(memory.supportingMemoryIds),
      });
    this.db.prepare(`DELETE FROM memory_participants WHERE memory_id = ?`).run(memory.id);
    const insertP = this.db.prepare(
      `INSERT OR IGNORE INTO memory_participants (memory_id, citizen_id, role) VALUES (?, ?, ?)`,
    );
    for (const participant of memory.participants) {
      insertP.run(memory.id, participant, "participant");
    }
    if (memory.targetCitizenId) {
      insertP.run(memory.id, memory.targetCitizenId, "target");
    }
  }

  getMemory(id: string): StoredMemory | undefined {
    const row = this.db.prepare(`SELECT * FROM citizen_memories WHERE id = ?`).get(id) as MemorySqlRow | undefined;
    return row ? mapMemory(row) : undefined;
  }

  listMemories(
    citizenId: string,
    opts: { memoryType?: StoredMemory["memoryType"]; limit?: number; includeCompressed?: boolean } = {},
  ): StoredMemory[] {
    const limit = opts.limit ?? 200;
    const rows = this.db
      .prepare(
        `SELECT * FROM citizen_memories
         WHERE citizen_id = ?
           AND (? IS NULL OR memory_type = ?)
           AND (? = 1 OR compressed = 0)
         ORDER BY importance DESC, timestamp DESC
         LIMIT ?`,
      )
      .all(
        citizenId,
        opts.memoryType ?? null,
        opts.memoryType ?? null,
        opts.includeCompressed ? 1 : 0,
        limit,
      ) as MemorySqlRow[];
    return rows.map(mapMemory);
  }

  listDurableMemories(citizenId: string, limit = 200): StoredMemory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM citizen_memories
         WHERE citizen_id = ? AND memory_type != 'immediate'
         ORDER BY importance DESC, timestamp DESC
         LIMIT ?`,
      )
      .all(citizenId, limit) as MemorySqlRow[];
    return rows.map(mapMemory);
  }

  deleteMemory(id: string): void {
    this.db.prepare(`DELETE FROM memory_participants WHERE memory_id = ?`).run(id);
    this.db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(id);
    this.db.prepare(`DELETE FROM citizen_memories WHERE id = ?`).run(id);
  }

  markCompressed(ids: string[]): void {
    const stmt = this.db.prepare(`UPDATE citizen_memories SET compressed = 1 WHERE id = ?`);
    for (const id of ids) stmt.run(id);
  }

  markRecalled(id: string, at: string): void {
    this.db
      .prepare(
        `UPDATE citizen_memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?`,
      )
      .run(at, id);
  }

  expireImmediate(citizenId: string, nowIso: string): number {
    const result = this.db
      .prepare(
        `DELETE FROM citizen_memories
         WHERE citizen_id = ? AND memory_type = 'immediate' AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .run(citizenId, nowIso);
    return result.changes;
  }

  getPsych(citizenId: string): PsychRow {
    this.upsertIdentity(citizenId);
    const row = this.db.prepare(`SELECT * FROM citizen_psych_state WHERE citizen_id = ?`).get(citizenId) as
      | {
          citizen_id: string;
          mood_valence: number;
          stress: number;
          fear: number;
          anger: number;
          sadness: number;
          positive_affect: number;
          confidence: number;
          current_concerns_json: string;
          updated_at: string;
        }
      | undefined;
    if (row) {
      return {
        citizenId: row.citizen_id,
        moodValence: row.mood_valence,
        stress: row.stress,
        fear: row.fear,
        anger: row.anger,
        sadness: row.sadness,
        positiveAffect: row.positive_affect,
        confidence: row.confidence,
        currentConcernsJson: row.current_concerns_json,
        updatedAt: row.updated_at,
      };
    }
    const created: PsychRow = {
      citizenId,
      moodValence: DEFAULT_PSYCH.moodValence,
      stress: DEFAULT_PSYCH.stress,
      fear: DEFAULT_PSYCH.fear,
      anger: DEFAULT_PSYCH.anger,
      sadness: DEFAULT_PSYCH.sadness,
      positiveAffect: DEFAULT_PSYCH.positiveAffect,
      confidence: DEFAULT_PSYCH.confidence,
      currentConcernsJson: "[]",
      updatedAt: new Date().toISOString(),
    };
    this.savePsych(created);
    return created;
  }

  savePsych(row: PsychRow): void {
    this.upsertIdentity(row.citizenId);
    this.db
      .prepare(
        `INSERT INTO citizen_psych_state (
          citizen_id, mood_valence, stress, fear, anger, sadness, positive_affect, confidence,
          current_concerns_json, updated_at
        ) VALUES (
          @citizenId, @moodValence, @stress, @fear, @anger, @sadness, @positiveAffect, @confidence,
          @currentConcernsJson, @updatedAt
        )
        ON CONFLICT(citizen_id) DO UPDATE SET
          mood_valence = excluded.mood_valence,
          stress = excluded.stress,
          fear = excluded.fear,
          anger = excluded.anger,
          sadness = excluded.sadness,
          positive_affect = excluded.positive_affect,
          confidence = excluded.confidence,
          current_concerns_json = excluded.current_concerns_json,
          updated_at = excluded.updated_at`,
      )
      .run(row);
  }

  getAssociation(
    citizenId: string,
    subjectType: string,
    subjectKey: string,
    associationType: string,
  ): AssociationRow | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM learned_associations
         WHERE citizen_id = ? AND subject_type = ? AND subject_key = ? AND association_type = ?`,
      )
      .get(citizenId, subjectType, subjectKey, associationType) as
      | {
          id: string;
          citizen_id: string;
          subject_type: string;
          subject_key: string;
          association_type: string;
          strength: number;
          confidence: number;
          supporting_memory_ids_json: string;
          last_reinforced_at: string;
          last_contradicted_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return mapAssociation(row);
  }

  listAssociations(citizenId: string): AssociationRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM learned_associations WHERE citizen_id = ? ORDER BY strength DESC`)
      .all(citizenId) as Array<{
      id: string;
      citizen_id: string;
      subject_type: string;
      subject_key: string;
      association_type: string;
      strength: number;
      confidence: number;
      supporting_memory_ids_json: string;
      last_reinforced_at: string;
      last_contradicted_at: string | null;
    }>;
    return rows.map(mapAssociation);
  }

  saveAssociation(row: AssociationRow): void {
    this.upsertIdentity(row.citizenId);
    this.db
      .prepare(
        `INSERT INTO learned_associations (
          id, citizen_id, subject_type, subject_key, association_type, strength, confidence,
          supporting_memory_ids_json, last_reinforced_at, last_contradicted_at
        ) VALUES (
          @id, @citizenId, @subjectType, @subjectKey, @associationType, @strength, @confidence,
          @supportingMemoryIdsJson, @lastReinforcedAt, @lastContradictedAt
        )
        ON CONFLICT(citizen_id, subject_type, subject_key, association_type) DO UPDATE SET
          strength = excluded.strength,
          confidence = excluded.confidence,
          supporting_memory_ids_json = excluded.supporting_memory_ids_json,
          last_reinforced_at = excluded.last_reinforced_at,
          last_contradicted_at = excluded.last_contradicted_at`,
      )
      .run({ ...row, lastContradictedAt: row.lastContradictedAt ?? null });
  }

  getActivity(citizenId: string, activity: string): ActivityRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM activity_experience WHERE citizen_id = ? AND activity = ?`)
      .get(citizenId, activity) as
      | {
          citizen_id: string;
          activity: string;
          attempts: number;
          successes: number;
          failures: number;
          recent_results_json: string;
          familiarity: number;
          confidence: number;
          last_performed_at: string | null;
        }
      | undefined;
    return row ? mapActivity(row) : undefined;
  }

  listActivities(citizenId: string): ActivityRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM activity_experience WHERE citizen_id = ? ORDER BY familiarity DESC`)
      .all(citizenId) as Array<{
      citizen_id: string;
      activity: string;
      attempts: number;
      successes: number;
      failures: number;
      recent_results_json: string;
      familiarity: number;
      confidence: number;
      last_performed_at: string | null;
    }>;
    return rows.map(mapActivity);
  }

  saveActivity(row: ActivityRow): void {
    this.upsertIdentity(row.citizenId);
    this.db
      .prepare(
        `INSERT INTO activity_experience (
          citizen_id, activity, attempts, successes, failures, recent_results_json,
          familiarity, confidence, last_performed_at
        ) VALUES (
          @citizenId, @activity, @attempts, @successes, @failures, @recentResultsJson,
          @familiarity, @confidence, @lastPerformedAt
        )
        ON CONFLICT(citizen_id, activity) DO UPDATE SET
          attempts = excluded.attempts,
          successes = excluded.successes,
          failures = excluded.failures,
          recent_results_json = excluded.recent_results_json,
          familiarity = excluded.familiarity,
          confidence = excluded.confidence,
          last_performed_at = excluded.last_performed_at`,
      )
      .run({ ...row, lastPerformedAt: row.lastPerformedAt ?? null });
  }

  getHabit(citizenId: string, contextKey: string, action: string): HabitRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM habits WHERE citizen_id = ? AND context_key = ? AND action = ?`)
      .get(citizenId, contextKey, action) as
      | {
          id: string;
          citizen_id: string;
          context_key: string;
          action: string;
          occurrences: number;
          successes: number;
          failures: number;
          strength: number;
          last_reinforced_at: string;
        }
      | undefined;
    return row ? mapHabit(row) : undefined;
  }

  listHabits(citizenId: string): HabitRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM habits WHERE citizen_id = ? ORDER BY strength DESC`)
      .all(citizenId) as Array<{
      id: string;
      citizen_id: string;
      context_key: string;
      action: string;
      occurrences: number;
      successes: number;
      failures: number;
      strength: number;
      last_reinforced_at: string;
    }>;
    return rows.map(mapHabit);
  }

  saveHabit(row: HabitRow): void {
    this.upsertIdentity(row.citizenId);
    this.db
      .prepare(
        `INSERT INTO habits (
          id, citizen_id, context_key, action, occurrences, successes, failures, strength, last_reinforced_at
        ) VALUES (
          @id, @citizenId, @contextKey, @action, @occurrences, @successes, @failures, @strength, @lastReinforcedAt
        )
        ON CONFLICT(citizen_id, context_key, action) DO UPDATE SET
          occurrences = excluded.occurrences,
          successes = excluded.successes,
          failures = excluded.failures,
          strength = excluded.strength,
          last_reinforced_at = excluded.last_reinforced_at`,
      )
      .run(row);
  }

  getBelief(observerId: string, targetId: string): BeliefRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM social_beliefs WHERE observer_citizen_id = ? AND target_citizen_id = ?`)
      .get(observerId, targetId) as
      | {
          observer_citizen_id: string;
          target_citizen_id: string;
          familiarity: number;
          trust_evidence: number;
          affection_evidence: number;
          respect_evidence: number;
          resentment_evidence: number;
          known_facts_json: string;
          rumors_json: string;
          relevant_memory_ids_json: string;
          confidence: number;
          last_updated_at: string;
        }
      | undefined;
    return row ? mapBelief(row) : undefined;
  }

  listBeliefs(observerId: string): BeliefRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM social_beliefs WHERE observer_citizen_id = ?`)
      .all(observerId) as Array<{
      observer_citizen_id: string;
      target_citizen_id: string;
      familiarity: number;
      trust_evidence: number;
      affection_evidence: number;
      respect_evidence: number;
      resentment_evidence: number;
      known_facts_json: string;
      rumors_json: string;
      relevant_memory_ids_json: string;
      confidence: number;
      last_updated_at: string;
    }>;
    return rows.map(mapBelief);
  }

  saveBelief(row: BeliefRow): void {
    this.upsertIdentity(row.observerCitizenId);
    this.db
      .prepare(
        `INSERT INTO social_beliefs (
          observer_citizen_id, target_citizen_id, familiarity, trust_evidence, affection_evidence,
          respect_evidence, resentment_evidence, known_facts_json, rumors_json, relevant_memory_ids_json,
          confidence, last_updated_at
        ) VALUES (
          @observerCitizenId, @targetCitizenId, @familiarity, @trustEvidence, @affectionEvidence,
          @respectEvidence, @resentmentEvidence, @knownFactsJson, @rumorsJson, @relevantMemoryIdsJson,
          @confidence, @lastUpdatedAt
        )
        ON CONFLICT(observer_citizen_id, target_citizen_id) DO UPDATE SET
          familiarity = excluded.familiarity,
          trust_evidence = excluded.trust_evidence,
          affection_evidence = excluded.affection_evidence,
          respect_evidence = excluded.respect_evidence,
          resentment_evidence = excluded.resentment_evidence,
          known_facts_json = excluded.known_facts_json,
          rumors_json = excluded.rumors_json,
          relevant_memory_ids_json = excluded.relevant_memory_ids_json,
          confidence = excluded.confidence,
          last_updated_at = excluded.last_updated_at`,
      )
      .run(row);
  }

  addEvidence(row: EvidenceRow): void {
    this.upsertIdentity(row.observerCitizenId);
    this.db
      .prepare(
        `INSERT INTO social_evidence (
          id, observer_citizen_id, target_citizen_id, kind, summary, source, informant_id,
          confidence, memory_id, objective_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.observerCitizenId,
        row.targetCitizenId,
        row.kind,
        row.summary,
        row.source,
        row.informantId ?? null,
        row.confidence,
        row.memoryId ?? null,
        row.objectiveEventId ?? null,
        row.createdAt,
      );
  }

  listEvidence(observerId: string, targetId?: string): EvidenceRow[] {
    const rows = (
      targetId
        ? this.db
            .prepare(
              `SELECT * FROM social_evidence WHERE observer_citizen_id = ? AND target_citizen_id = ? ORDER BY created_at`,
            )
            .all(observerId, targetId)
        : this.db
            .prepare(`SELECT * FROM social_evidence WHERE observer_citizen_id = ? ORDER BY created_at`)
            .all(observerId)
    ) as Array<{
      id: string;
      observer_citizen_id: string;
      target_citizen_id: string;
      kind: string;
      summary: string;
      source: string;
      informant_id: string | null;
      confidence: number;
      memory_id: string | null;
      objective_event_id: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      observerCitizenId: row.observer_citizen_id,
      targetCitizenId: row.target_citizen_id,
      kind: row.kind,
      summary: row.summary,
      source: row.source,
      informantId: row.informant_id ?? undefined,
      confidence: row.confidence,
      memoryId: row.memory_id ?? undefined,
      objectiveEventId: row.objective_event_id ?? undefined,
      createdAt: row.created_at,
    }));
  }

  getObservations(citizenId: string): BehaviorObservations {
    this.upsertIdentity(citizenId);
    const row = this.db.prepare(`SELECT * FROM behavior_observations WHERE citizen_id = ?`).get(citizenId) as
      | {
          citizen_id: string;
          dangerous_attempts: number;
          dangerous_avoided: number;
          retries_after_failure: number;
          task_failures: number;
          social_interactions: number;
          cooperative_acts: number;
          conflict_acts: number;
          exploration_acts: number;
          familiar_task_choices: number;
          total_task_choices: number;
          updated_at: string;
        }
      | undefined;
    if (row) return mapObservations(row);
    const created: BehaviorObservations = {
      citizenId,
      dangerousAttempts: 0,
      dangerousAvoided: 0,
      retriesAfterFailure: 0,
      taskFailures: 0,
      socialInteractions: 0,
      cooperativeActs: 0,
      conflictActs: 0,
      explorationActs: 0,
      familiarTaskChoices: 0,
      totalTaskChoices: 0,
      updatedAt: new Date().toISOString(),
    };
    this.saveObservations(created);
    return created;
  }

  saveObservations(row: BehaviorObservations): void {
    this.upsertIdentity(row.citizenId);
    this.db
      .prepare(
        `INSERT INTO behavior_observations (
          citizen_id, dangerous_attempts, dangerous_avoided, retries_after_failure, task_failures,
          social_interactions, cooperative_acts, conflict_acts, exploration_acts, familiar_task_choices,
          total_task_choices, updated_at
        ) VALUES (
          @citizenId, @dangerousAttempts, @dangerousAvoided, @retriesAfterFailure, @taskFailures,
          @socialInteractions, @cooperativeActs, @conflictActs, @explorationActs, @familiarTaskChoices,
          @totalTaskChoices, @updatedAt
        )
        ON CONFLICT(citizen_id) DO UPDATE SET
          dangerous_attempts = excluded.dangerous_attempts,
          dangerous_avoided = excluded.dangerous_avoided,
          retries_after_failure = excluded.retries_after_failure,
          task_failures = excluded.task_failures,
          social_interactions = excluded.social_interactions,
          cooperative_acts = excluded.cooperative_acts,
          conflict_acts = excluded.conflict_acts,
          exploration_acts = excluded.exploration_acts,
          familiar_task_choices = excluded.familiar_task_choices,
          total_task_choices = excluded.total_task_choices,
          updated_at = excluded.updated_at`,
      )
      .run(row);
  }

  bumpRoutine(citizenId: string, bucketKey: string, period: string, success: boolean, at: string): RoutineAggregate {
    this.upsertIdentity(citizenId);
    this.db
      .prepare(
        `INSERT INTO routine_aggregates (citizen_id, bucket_key, period, count, success_count, last_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(citizen_id, bucket_key, period) DO UPDATE SET
           count = count + 1,
           success_count = success_count + excluded.success_count,
           last_at = excluded.last_at`,
      )
      .run(citizenId, bucketKey, period, success ? 1 : 0, at);
    const row = this.db
      .prepare(
        `SELECT * FROM routine_aggregates WHERE citizen_id = ? AND bucket_key = ? AND period = ?`,
      )
      .get(citizenId, bucketKey, period) as {
      citizen_id: string;
      bucket_key: string;
      period: string;
      count: number;
      success_count: number;
      last_at: string;
    };
    return {
      citizenId: row.citizen_id,
      bucketKey: row.bucket_key,
      period: row.period,
      count: row.count,
      successCount: row.success_count,
      lastAt: row.last_at,
    };
  }

  listRoutines(citizenId: string, period?: string): RoutineAggregate[] {
    const rows = (
      period
        ? this.db
            .prepare(`SELECT * FROM routine_aggregates WHERE citizen_id = ? AND period = ?`)
            .all(citizenId, period)
        : this.db.prepare(`SELECT * FROM routine_aggregates WHERE citizen_id = ?`).all(citizenId)
    ) as Array<{
      citizen_id: string;
      bucket_key: string;
      period: string;
      count: number;
      success_count: number;
      last_at: string;
    }>;
    return rows.map((row) => ({
      citizenId: row.citizen_id,
      bucketKey: row.bucket_key,
      period: row.period,
      count: row.count,
      successCount: row.success_count,
      lastAt: row.last_at,
    }));
  }

  saveEmbedding(record: EmbeddingRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memory_embeddings (memory_id, citizen_id, model, dims, vector, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.memoryId,
        record.citizenId,
        record.model,
        record.dims,
        encodeVector(record.vector),
        record.createdAt,
      );
  }

  getEmbedding(memoryId: string): EmbeddingRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM memory_embeddings WHERE memory_id = ?`).get(memoryId) as
      | { memory_id: string; citizen_id: string; model: string; dims: number; vector: Buffer; created_at: string }
      | undefined;
    if (!row) return undefined;
    return {
      memoryId: row.memory_id,
      citizenId: row.citizen_id,
      model: row.model,
      dims: row.dims,
      vector: decodeVector(row.vector),
      createdAt: row.created_at,
    };
  }

  listEmbeddings(citizenId: string): EmbeddingRecord[] {
    const rows = this.db.prepare(`SELECT * FROM memory_embeddings WHERE citizen_id = ?`).all(citizenId) as Array<{
      memory_id: string;
      citizen_id: string;
      model: string;
      dims: number;
      vector: Buffer;
      created_at: string;
    }>;
    return rows.map((row) => ({
      memoryId: row.memory_id,
      citizenId: row.citizen_id,
      model: row.model,
      dims: row.dims,
      vector: decodeVector(row.vector),
      createdAt: row.created_at,
    }));
  }

  putReflection(row: ReflectionRow): void {
    this.upsertIdentity(row.citizenId);
    this.db
      .prepare(
        `INSERT INTO reflection_triggers (id, citizen_id, kind, event_id, salience, created_at, consumed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.citizenId, row.kind, row.eventId ?? null, row.salience, row.createdAt, row.consumed ? 1 : 0);
  }

  listPendingReflections(citizenId: string): ReflectionRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM reflection_triggers WHERE citizen_id = ? AND consumed = 0 ORDER BY created_at`)
      .all(citizenId) as Array<{
      id: string;
      citizen_id: string;
      kind: string;
      event_id: string | null;
      salience: number;
      created_at: string;
      consumed: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      citizenId: row.citizen_id,
      kind: row.kind,
      eventId: row.event_id ?? undefined,
      salience: row.salience,
      createdAt: row.created_at,
      consumed: Boolean(row.consumed),
    }));
  }

  consumeReflection(id: string): void {
    this.db.prepare(`UPDATE reflection_triggers SET consumed = 1 WHERE id = ?`).run(id);
  }
}

function mapObjective(row: {
  id: string;
  category: ObjectiveWorldEvent["category"];
  timestamp: string;
  game_time: number | null;
  location_x: number | null;
  location_y: number | null;
  location_z: number | null;
  actor_citizen_id: string | null;
  target_citizen_id: string | null;
  participants_json: string;
  facts_json: string;
}): ObjectiveWorldEvent {
  const location: Vec3 | undefined =
    row.location_x != null && row.location_y != null && row.location_z != null
      ? { x: row.location_x, y: row.location_y, z: row.location_z }
      : undefined;
  return {
    id: row.id,
    category: row.category,
    timestamp: row.timestamp,
    gameTime: row.game_time ?? undefined,
    location,
    actorCitizenId: row.actor_citizen_id ?? undefined,
    targetCitizenId: row.target_citizen_id ?? undefined,
    participants: parseJson<string[]>(row.participants_json, []),
    facts: parseJson<Record<string, unknown>>(row.facts_json, {}),
  };
}

function mapMemory(row: MemorySqlRow): StoredMemory {
  const location: Vec3 | undefined =
    row.location_x != null && row.location_y != null && row.location_z != null
      ? { x: row.location_x, y: row.location_y, z: row.location_z }
      : undefined;
  return {
    id: row.id,
    citizenId: row.citizen_id,
    memoryType: row.memory_type,
    eventType: row.event_type,
    timestamp: row.timestamp,
    gameTime: row.game_time ?? undefined,
    summary: row.summary,
    participants: parseJson<string[]>(row.participants_json, []),
    location,
    objectiveFacts: parseJson<Record<string, unknown>>(row.objective_facts_json, {}),
    subjectiveAppraisal: row.subjective_appraisal_json
      ? parseJson(row.subjective_appraisal_json, undefined)
      : undefined,
    emotionalSalience: row.emotional_salience,
    importance: row.importance,
    source: row.source,
    confidence: row.confidence,
    tags: parseJson<string[]>(row.tags_json, []),
    relatedEntityIds: parseJson<string[]>(row.related_entity_ids_json, []),
    createdAt: row.created_at,
    lastRecalledAt: row.last_recalled_at ?? undefined,
    recallCount: row.recall_count,
    compressed: Boolean(row.compressed),
    expiresAt: row.expires_at ?? undefined,
    targetCitizenId: row.target_citizen_id ?? undefined,
    supportingMemoryIds: parseJson<string[]>(row.supporting_memory_ids_json, []),
  };
}

function mapAssociation(row: {
  id: string;
  citizen_id: string;
  subject_type: string;
  subject_key: string;
  association_type: string;
  strength: number;
  confidence: number;
  supporting_memory_ids_json: string;
  last_reinforced_at: string;
  last_contradicted_at: string | null;
}): AssociationRow {
  return {
    id: row.id,
    citizenId: row.citizen_id,
    subjectType: row.subject_type,
    subjectKey: row.subject_key,
    associationType: row.association_type,
    strength: row.strength,
    confidence: row.confidence,
    supportingMemoryIdsJson: row.supporting_memory_ids_json,
    lastReinforcedAt: row.last_reinforced_at,
    lastContradictedAt: row.last_contradicted_at ?? undefined,
  };
}

function mapActivity(row: {
  citizen_id: string;
  activity: string;
  attempts: number;
  successes: number;
  failures: number;
  recent_results_json: string;
  familiarity: number;
  confidence: number;
  last_performed_at: string | null;
}): ActivityRow {
  return {
    citizenId: row.citizen_id,
    activity: row.activity,
    attempts: row.attempts,
    successes: row.successes,
    failures: row.failures,
    recentResultsJson: row.recent_results_json,
    familiarity: row.familiarity,
    confidence: row.confidence,
    lastPerformedAt: row.last_performed_at ?? undefined,
  };
}

function mapHabit(row: {
  id: string;
  citizen_id: string;
  context_key: string;
  action: string;
  occurrences: number;
  successes: number;
  failures: number;
  strength: number;
  last_reinforced_at: string;
}): HabitRow {
  return {
    id: row.id,
    citizenId: row.citizen_id,
    contextKey: row.context_key,
    action: row.action,
    occurrences: row.occurrences,
    successes: row.successes,
    failures: row.failures,
    strength: row.strength,
    lastReinforcedAt: row.last_reinforced_at,
  };
}

function mapBelief(row: {
  observer_citizen_id: string;
  target_citizen_id: string;
  familiarity: number;
  trust_evidence: number;
  affection_evidence: number;
  respect_evidence: number;
  resentment_evidence: number;
  known_facts_json: string;
  rumors_json: string;
  relevant_memory_ids_json: string;
  confidence: number;
  last_updated_at: string;
}): BeliefRow {
  return {
    observerCitizenId: row.observer_citizen_id,
    targetCitizenId: row.target_citizen_id,
    familiarity: row.familiarity,
    trustEvidence: row.trust_evidence,
    affectionEvidence: row.affection_evidence,
    respectEvidence: row.respect_evidence,
    resentmentEvidence: row.resentment_evidence,
    knownFactsJson: row.known_facts_json,
    rumorsJson: row.rumors_json,
    relevantMemoryIdsJson: row.relevant_memory_ids_json,
    confidence: row.confidence,
    lastUpdatedAt: row.last_updated_at,
  };
}

function mapObservations(row: {
  citizen_id: string;
  dangerous_attempts: number;
  dangerous_avoided: number;
  retries_after_failure: number;
  task_failures: number;
  social_interactions: number;
  cooperative_acts: number;
  conflict_acts: number;
  exploration_acts: number;
  familiar_task_choices: number;
  total_task_choices: number;
  updated_at: string;
}): BehaviorObservations {
  return {
    citizenId: row.citizen_id,
    dangerousAttempts: row.dangerous_attempts,
    dangerousAvoided: row.dangerous_avoided,
    retriesAfterFailure: row.retries_after_failure,
    taskFailures: row.task_failures,
    socialInteractions: row.social_interactions,
    cooperativeActs: row.cooperative_acts,
    conflictActs: row.conflict_acts,
    explorationActs: row.exploration_acts,
    familiarTaskChoices: row.familiar_task_choices,
    totalTaskChoices: row.total_task_choices,
    updatedAt: row.updated_at,
  };
}

export function encodeVector(values: number[]): Buffer {
  const f32 = new Float32Array(values);
  return Buffer.from(f32.buffer);
}

export function decodeVector(buffer: Buffer): number[] {
  const f32 = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
  return Array.from(f32);
}
