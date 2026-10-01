import type Database from "better-sqlite3";

/** Versioned brain schema. Idempotent via schema_migrations.name. */
export const BRAIN_MIGRATION_V2 = "brain_persistence_v2";
export const BRAIN_MIGRATION_V3 = "brain_integrity_v3";

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

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const cols = tableColumns(db, table);
  if (!cols.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function applyBrainV3(db: Database.Database): void {
  // Additive llm_calls fields for durable budget reconstruction.
  ensureColumn(db, "llm_calls", "decision_category", "decision_category TEXT");
  ensureColumn(db, "llm_calls", "mc_day", "mc_day INTEGER");
  ensureColumn(db, "llm_calls", "provider", "provider TEXT");
  ensureColumn(db, "llm_calls", "model", "model TEXT");
  ensureColumn(db, "llm_calls", "fallback_used", "fallback_used INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "llm_calls", "decision_id", "decision_id TEXT");
  ensureColumn(
    db,
    "llm_calls",
    "counts_toward_budget",
    "counts_toward_budget INTEGER NOT NULL DEFAULT 0",
  );

  // Provenance on belief evidence — source_event_id is the verified Minecraft event.
  // event_id remains an effect-row key and must never be treated as an independent MC event.
  ensureColumn(db, "relationship_belief_evidence", "source_event_id", "source_event_id TEXT");
  ensureColumn(
    db,
    "relationship_belief_evidence",
    "effect_role",
    "effect_role TEXT NOT NULL DEFAULT 'direct'",
  );

  db.exec(`
    UPDATE relationship_belief_evidence
    SET source_event_id = CASE
          WHEN event_id LIKE '%:recv' THEN substr(event_id, 1, length(event_id) - 5)
          WHEN instr(event_id, '#') > 0 THEN substr(event_id, 1, instr(event_id, '#') - 1)
          ELSE event_id
        END,
        effect_role = CASE
          WHEN event_id LIKE '%:recv' THEN 'transfer_receiver'
          WHEN event_id LIKE '%#transfer_receiver' THEN 'transfer_receiver'
          WHEN event_id LIKE '%#transfer_giver' THEN 'transfer_giver'
          ELSE COALESCE(NULLIF(effect_role, ''), 'direct')
        END
    WHERE source_event_id IS NULL OR source_event_id = '';
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_belief_evidence_provenance
      ON relationship_belief_evidence(source_event_id, effect_role, observer_citizen_id, subject_citizen_id);

    CREATE TABLE IF NOT EXISTS commitment_progress_events (
      id TEXT PRIMARY KEY,
      commitment_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      item TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      UNIQUE (commitment_id, source_event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_commitment_progress_commitment
      ON commitment_progress_events(commitment_id);

    CREATE TABLE IF NOT EXISTS pending_reconsideration (
      citizen_id TEXT NOT NULL,
      signal TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (citizen_id, signal)
    );
  `);
}

function migrationApplied(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM schema_migrations WHERE name = ?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function recordMigration(db: Database.Database, name: string): void {
  db.prepare(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`).run(
    name,
    new Date().toISOString(),
  );
}

export function applyBrainMigrations(db: Database.Database): string[] {
  const applied: string[] = [];

  if (!migrationApplied(db, BRAIN_MIGRATION_V2)) {
    const tx = db.transaction(() => {
      db.exec(BRAIN_V2_SQL);
      recordMigration(db, BRAIN_MIGRATION_V2);
    });
    tx();
    applied.push(BRAIN_MIGRATION_V2);
  } else {
    db.exec(BRAIN_V2_SQL);
  }

  if (!migrationApplied(db, BRAIN_MIGRATION_V3)) {
    const tx = db.transaction(() => {
      applyBrainV3(db);
      recordMigration(db, BRAIN_MIGRATION_V3);
    });
    tx();
    applied.push(BRAIN_MIGRATION_V3);
  } else {
    // Idempotent repair for additive columns/tables.
    applyBrainV3(db);
  }

  return applied;
}

export function listAppliedMigrations(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT name FROM schema_migrations ORDER BY id, name`)
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}
