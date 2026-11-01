-- Authentic schema generated from production base 953d61ee768304fb0f824d724bf65c5bf542ad41 (migrate + seed on :memory:).
CREATE TABLE schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
CREATE TABLE citizens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  minecraft_username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  last_x REAL,
  last_y REAL,
  last_z REAL,
  health REAL,
  hunger REAL,
  occupation TEXT,
  home_id TEXT,
  current_goal TEXT,
  current_task TEXT,
  current_action TEXT,
  decision_source TEXT,
  reason TEXT
, died_at TEXT, death_x REAL, death_y REAL, death_z REAL, personality_json TEXT);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  citizen_id TEXT,
  payload TEXT NOT NULL
);
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL,
  created_at TEXT NOT NULL,
  related_citizen_id TEXT
);
CREATE TABLE relationships (
  citizen_id TEXT NOT NULL,
  other_id TEXT NOT NULL,
  trust REAL NOT NULL DEFAULT 0,
  affection REAL NOT NULL DEFAULT 0,
  respect REAL NOT NULL DEFAULT 0,
  resentment REAL NOT NULL DEFAULT 0,
  familiarity REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (citizen_id, other_id)
);
CREATE TABLE settlement (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  food INTEGER NOT NULL DEFAULT 0,
  wood INTEGER NOT NULL DEFAULT 0,
  stone INTEGER NOT NULL DEFAULT 0,
  beds INTEGER NOT NULL DEFAULT 0,
  housing_capacity INTEGER NOT NULL DEFAULT 0,
  tools INTEGER NOT NULL DEFAULT 0,
  shelter_complete INTEGER NOT NULL DEFAULT 0,
  storage_x REAL,
  storage_y REAL,
  storage_z REAL,
  origin_x REAL,
  origin_y REAL,
  origin_z REAL,
  construction_json TEXT,
  project_json TEXT,
  workstations_json TEXT,
  storage_contents_json TEXT
);
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource TEXT,
  citizen_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE llm_calls (
  id TEXT PRIMARY KEY,
  citizen_id TEXT,
  timestamp TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  goal TEXT,
  reason TEXT,
  error TEXT
);
CREATE TABLE sim_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE human_directives (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL DEFAULT 'overworld',
  origin_x INTEGER NOT NULL,
  origin_y INTEGER NOT NULL,
  origin_z INTEGER NOT NULL,
  entrance_x INTEGER,
  entrance_y INTEGER,
  entrance_z INTEGER,
  household_chest_x INTEGER,
  household_chest_y INTEGER,
  household_chest_z INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE home_memberships (
  citizen_id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  bed_x INTEGER NOT NULL,
  bed_y INTEGER NOT NULL,
  bed_z INTEGER NOT NULL,
  personal_chest_x INTEGER,
  personal_chest_y INTEGER,
  personal_chest_z INTEGER,
  storage_access TEXT NOT NULL DEFAULT 'personal',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (home_id) REFERENCES homes(id)
);
CREATE TABLE citizen_event_delivery (
        citizen_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        delivered_at TEXT NOT NULL,
        PRIMARY KEY (citizen_id, event_id)
      );
CREATE INDEX idx_citizen_event_delivery_citizen
        ON citizen_event_delivery(citizen_id, delivered_at);
CREATE TABLE citizen_persistent_facts (
        id TEXT PRIMARY KEY,
        citizen_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        content TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'observed_fact',
        created_at TEXT NOT NULL,
        UNIQUE(citizen_id, fact_key)
      );
CREATE UNIQUE INDEX idx_home_bed_claimed
        ON home_memberships(bed_x, bed_y, bed_z)
        WHERE status IN ('active', 'displaced');
CREATE UNIQUE INDEX idx_home_personal_chest_claimed
        ON home_memberships(personal_chest_x, personal_chest_y, personal_chest_z)
        WHERE status IN ('active', 'displaced') AND personal_chest_x IS NOT NULL;
