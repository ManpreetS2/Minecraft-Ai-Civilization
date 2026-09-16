export const COGNITIVE_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS cognitive_schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cognitive_identities (
  citizen_id TEXT PRIMARY KEY,
  name TEXT,
  deceased INTEGER NOT NULL DEFAULT 0,
  deceased_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objective_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  game_time REAL,
  location_x REAL,
  location_y REAL,
  location_z REAL,
  actor_citizen_id TEXT,
  target_citizen_id TEXT,
  participants_json TEXT NOT NULL,
  facts_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS citizen_memories (
  id TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  game_time REAL,
  summary TEXT NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  location_x REAL,
  location_y REAL,
  location_z REAL,
  objective_facts_json TEXT NOT NULL DEFAULT '{}',
  subjective_appraisal_json TEXT,
  emotional_salience REAL NOT NULL DEFAULT 0,
  importance REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  tags_json TEXT NOT NULL DEFAULT '[]',
  related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_recalled_at TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0,
  compressed INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  target_citizen_id TEXT,
  supporting_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_citizen_memories_citizen ON citizen_memories(citizen_id, importance DESC, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_memories_type ON citizen_memories(citizen_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_citizen_memories_event ON citizen_memories(event_type);

CREATE TABLE IF NOT EXISTS memory_participants (
  memory_id TEXT NOT NULL,
  citizen_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant',
  PRIMARY KEY (memory_id, citizen_id),
  FOREIGN KEY (memory_id) REFERENCES citizen_memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS citizen_psych_state (
  citizen_id TEXT PRIMARY KEY,
  mood_valence REAL NOT NULL,
  stress REAL NOT NULL,
  fear REAL NOT NULL,
  anger REAL NOT NULL,
  sadness REAL NOT NULL,
  positive_affect REAL NOT NULL,
  confidence REAL NOT NULL,
  current_concerns_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS learned_associations (
  id TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  association_type TEXT NOT NULL,
  strength REAL NOT NULL,
  confidence REAL NOT NULL,
  supporting_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  last_reinforced_at TEXT NOT NULL,
  last_contradicted_at TEXT,
  UNIQUE (citizen_id, subject_type, subject_key, association_type),
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS activity_experience (
  citizen_id TEXT NOT NULL,
  activity TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  recent_results_json TEXT NOT NULL DEFAULT '[]',
  familiarity REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.4,
  last_performed_at TEXT,
  PRIMARY KEY (citizen_id, activity),
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  context_key TEXT NOT NULL,
  action TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  strength REAL NOT NULL DEFAULT 0,
  last_reinforced_at TEXT NOT NULL,
  UNIQUE (citizen_id, context_key, action),
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS social_beliefs (
  observer_citizen_id TEXT NOT NULL,
  target_citizen_id TEXT NOT NULL,
  familiarity REAL NOT NULL DEFAULT 0,
  trust_evidence REAL NOT NULL DEFAULT 0,
  affection_evidence REAL NOT NULL DEFAULT 0,
  respect_evidence REAL NOT NULL DEFAULT 0,
  resentment_evidence REAL NOT NULL DEFAULT 0,
  known_facts_json TEXT NOT NULL DEFAULT '[]',
  rumors_json TEXT NOT NULL DEFAULT '[]',
  relevant_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.3,
  last_updated_at TEXT NOT NULL,
  PRIMARY KEY (observer_citizen_id, target_citizen_id),
  FOREIGN KEY (observer_citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS social_evidence (
  id TEXT PRIMARY KEY,
  observer_citizen_id TEXT NOT NULL,
  target_citizen_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL,
  informant_id TEXT,
  confidence REAL NOT NULL,
  memory_id TEXT,
  objective_event_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observer_citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_social_evidence_pair ON social_evidence(observer_citizen_id, target_citizen_id);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES citizen_memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS behavior_observations (
  citizen_id TEXT PRIMARY KEY,
  dangerous_attempts INTEGER NOT NULL DEFAULT 0,
  dangerous_avoided INTEGER NOT NULL DEFAULT 0,
  retries_after_failure INTEGER NOT NULL DEFAULT 0,
  task_failures INTEGER NOT NULL DEFAULT 0,
  social_interactions INTEGER NOT NULL DEFAULT 0,
  cooperative_acts INTEGER NOT NULL DEFAULT 0,
  conflict_acts INTEGER NOT NULL DEFAULT 0,
  exploration_acts INTEGER NOT NULL DEFAULT 0,
  familiar_task_choices INTEGER NOT NULL DEFAULT 0,
  total_task_choices INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS routine_aggregates (
  citizen_id TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL,
  PRIMARY KEY (citizen_id, bucket_key, period),
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reflection_triggers (
  id TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_id TEXT,
  salience REAL NOT NULL,
  created_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (citizen_id) REFERENCES cognitive_identities(citizen_id) ON DELETE RESTRICT
);
`;

export const COGNITIVE_MIGRATIONS = [{ name: "001_cognitive_foundation", sql: COGNITIVE_SCHEMA_V1 }] as const;
