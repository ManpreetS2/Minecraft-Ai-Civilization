import type Database from "better-sqlite3";

/** Versioned brain schema. Idempotent via schema_migrations.name. */
export const BRAIN_MIGRATION_V2 = "brain_persistence_v2";

const BRAIN_V2_SQL = `
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  owner_citizen_id TEXT NOT NULL,
  counterparty_citizen_id TEXT,
  goal TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reconsider_at TEXT,
  expires_at TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  completion_evidence_json TEXT NOT NULL DEFAULT '[]',
  completion_evidence_event_id TEXT,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_commitments_owner ON commitments(owner_citizen_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);

CREATE TABLE IF NOT EXISTS relationship_beliefs (
  observer_citizen_id TEXT NOT NULL,
  subject_citizen_id TEXT NOT NULL,
  trust REAL NOT NULL,
  familiarity REAL NOT NULL,
  recent_positive REAL NOT NULL DEFAULT 0,
  recent_negative REAL NOT NULL DEFAULT 0,
  unresolved_requests_json TEXT NOT NULL DEFAULT '[]',
  unresolved_promises_json TEXT NOT NULL DEFAULT '[]',
  resource_transfers INTEGER NOT NULL DEFAULT 0,
  cooperation_count INTEGER NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL,
  PRIMARY KEY (observer_citizen_id, subject_citizen_id)
);

CREATE TABLE IF NOT EXISTS relationship_belief_evidence (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  observer_citizen_id TEXT NOT NULL,
  subject_citizen_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  first_person INTEGER NOT NULL,
  detail TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (event_id, observer_citizen_id, subject_citizen_id)
);

CREATE TABLE IF NOT EXISTS learned_behavior_evidence (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  citizen_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  direction INTEGER NOT NULL,
  weight REAL NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  UNIQUE (event_id, citizen_id, dimension)
);

CREATE INDEX IF NOT EXISTS idx_learned_citizen ON learned_behavior_evidence(citizen_id);

CREATE TABLE IF NOT EXISTS cognition_state (
  citizen_id TEXT PRIMARY KEY,
  current_high_level_goal TEXT,
  goal_started_at TEXT,
  last_deliberation_at TEXT,
  reconsider_after TEXT,
  last_major_event_id TEXT,
  last_decision_category TEXT,
  mood_label TEXT,
  mood_intensity REAL,
  mood_evidence_count INTEGER,
  mood_updated_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_applied_events (
  event_id TEXT NOT NULL,
  effect_kind TEXT NOT NULL,
  citizen_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (event_id, effect_kind, citizen_id)
);
`;

export function applyBrainMigrations(db: Database.Database): string[] {
  const applied: string[] = [];
  const has = db
    .prepare(`SELECT 1 AS ok FROM schema_migrations WHERE name = ?`)
    .get(BRAIN_MIGRATION_V2) as { ok: number } | undefined;

  if (!has) {
    const tx = db.transaction(() => {
      db.exec(BRAIN_V2_SQL);
      db.prepare(
        `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
      ).run(BRAIN_MIGRATION_V2, new Date().toISOString());
    });
    tx();
    applied.push(BRAIN_MIGRATION_V2);
  } else {
    // Idempotent repair: ensure tables exist even if migration row was present.
    db.exec(BRAIN_V2_SQL);
  }
  return applied;
}

export function listAppliedMigrations(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT name FROM schema_migrations ORDER BY id, name`)
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}
