import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_CITIZENS,
  type CitizenRecord,
  type ConstructionState,
  type MemoryRecord,
  type Relationship,
  type SettlementNeed,
  type SettlementState,
  type SimEvent,
  type Vec3,
  type HumanDirective,
} from "@civ/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS citizens (
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
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  citizen_id TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL,
  created_at TEXT NOT NULL,
  related_citizen_id TEXT
);

CREATE TABLE IF NOT EXISTS relationships (
  citizen_id TEXT NOT NULL,
  other_id TEXT NOT NULL,
  trust REAL NOT NULL DEFAULT 0,
  affection REAL NOT NULL DEFAULT 0,
  respect REAL NOT NULL DEFAULT 0,
  resentment REAL NOT NULL DEFAULT 0,
  familiarity REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (citizen_id, other_id)
);

CREATE TABLE IF NOT EXISTS settlement (
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
  construction_json TEXT
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource TEXT,
  citizen_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  citizen_id TEXT,
  timestamp TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  goal TEXT,
  reason TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS sim_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_directives (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export class CivilizationStore {
  readonly db: Database.Database;

  constructor(filePath: string) {
    mkdirSync(dirname(resolve(filePath)), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.migrate();
    this.seed();
  }

  private migrate(): void {
    const cols = this.db.prepare(`PRAGMA table_info(citizens)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((col) => col.name));
    if (!names.has("died_at")) this.db.exec(`ALTER TABLE citizens ADD COLUMN died_at TEXT`);
    if (!names.has("death_x")) this.db.exec(`ALTER TABLE citizens ADD COLUMN death_x REAL`);
    if (!names.has("death_y")) this.db.exec(`ALTER TABLE citizens ADD COLUMN death_y REAL`);
    if (!names.has("death_z")) this.db.exec(`ALTER TABLE citizens ADD COLUMN death_z REAL`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS sim_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS human_directives (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    );
  }

  markDeceased(id: string, at = new Date().toISOString(), position?: Vec3): boolean {
    const existing = this.getCitizen(id);
    if (!existing) return false;
    if (existing.status === "dead") return false;
    this.db
      .prepare(
        `UPDATE citizens SET status = 'dead', died_at = ?, death_x = ?, death_y = ?, death_z = ?, reason = 'deceased'
         WHERE id = ? AND status != 'dead'`,
      )
      .run(at, position?.x ?? null, position?.y ?? null, position?.z ?? null, id);
    return true;
  }

  isDeceased(id: string): boolean {
    return this.getCitizen(id)?.status === "dead";
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM sim_meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`INSERT INTO sim_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  saveDirective(directive: HumanDirective): void {
    this.db
      .prepare(`INSERT INTO human_directives (id, json, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`)
      .run(directive.id, JSON.stringify(directive), directive.createdAt);
  }

  getDirective(id: string): HumanDirective | undefined {
    const row = this.db.prepare(`SELECT json FROM human_directives WHERE id = ?`).get(id) as { json: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.json) as HumanDirective;
  }

  listDirectives(limit = 40): HumanDirective[] {
    const rows = this.db
      .prepare(`SELECT json FROM human_directives ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as HumanDirective);
  }

  private seed(): void {
    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO citizens (id, name, minecraft_username, created_at, status)
      VALUES (@id, @name, @username, @createdAt, 'offline')
    `);
    for (const citizen of DEFAULT_CITIZENS) {
      insert.run({ id: citizen.id, name: citizen.name, username: citizen.name, createdAt: now });
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO settlement (id, name) VALUES ('settlement_first', 'First Settlement')`,
      )
      .run();
  }

  getCitizens(): CitizenRecord[] {
    const rows = this.db.prepare(`SELECT * FROM citizens ORDER BY name`).all() as CitizenRow[];
    return rows.map(mapCitizen);
  }

  getCitizen(id: string): CitizenRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM citizens WHERE id = ?`).get(id) as CitizenRow | undefined;
    return row ? mapCitizen(row) : undefined;
  }

  upsertCitizen(record: CitizenRecord): void {
    this.db
      .prepare(
        `
      INSERT INTO citizens (
        id, name, minecraft_username, created_at, status, last_x, last_y, last_z,
        health, hunger, occupation, home_id, current_goal, current_task, current_action,
        decision_source, reason, died_at, death_x, death_y, death_z
      ) VALUES (
        @id, @name, @minecraftUsername, @createdAt, @status, @lastX, @lastY, @lastZ,
        @health, @hunger, @occupation, @homeId, @currentGoal, @currentTask, @currentAction,
        @decisionSource, @reason, @diedAt, @deathX, @deathY, @deathZ
      )
      ON CONFLICT(id) DO UPDATE SET
        status = CASE WHEN citizens.status = 'dead' THEN 'dead' ELSE excluded.status END,
        last_x = excluded.last_x,
        last_y = excluded.last_y,
        last_z = excluded.last_z,
        health = excluded.health,
        hunger = excluded.hunger,
        occupation = excluded.occupation,
        home_id = excluded.home_id,
        current_goal = excluded.current_goal,
        current_task = excluded.current_task,
        current_action = excluded.current_action,
        decision_source = excluded.decision_source,
        reason = CASE WHEN citizens.status = 'dead' THEN citizens.reason ELSE excluded.reason END,
        died_at = COALESCE(citizens.died_at, excluded.died_at),
        death_x = COALESCE(citizens.death_x, excluded.death_x),
        death_y = COALESCE(citizens.death_y, excluded.death_y),
        death_z = COALESCE(citizens.death_z, excluded.death_z)
    `,
      )
      .run({
        id: record.id,
        name: record.name,
        minecraftUsername: record.minecraftUsername,
        createdAt: record.createdAt,
        status: record.status,
        lastX: record.lastKnownPosition?.x ?? null,
        lastY: record.lastKnownPosition?.y ?? null,
        lastZ: record.lastKnownPosition?.z ?? null,
        health: record.health ?? null,
        hunger: record.hunger ?? null,
        occupation: record.occupation ?? null,
        homeId: record.homeId ?? null,
        currentGoal: record.currentGoal ?? null,
        currentTask: record.currentTask ?? null,
        currentAction: record.currentAction ?? null,
        decisionSource: record.decisionSource ?? null,
        reason: record.reason ?? null,
        diedAt: record.diedAt ?? null,
        deathX: record.deathPosition?.x ?? null,
        deathY: record.deathPosition?.y ?? null,
        deathZ: record.deathPosition?.z ?? null,
      });
  }

  appendEvent(event: SimEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (id, type, timestamp, citizen_id, payload) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(event.id, event.type, event.timestamp, event.citizenId ?? null, JSON.stringify(event.payload));
  }

  recentEvents(limit = 100): SimEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      type: row.type as SimEvent["type"],
      timestamp: row.timestamp,
      citizenId: row.citizen_id ?? undefined,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
  }

  addMemory(memory: MemoryRecord): void {
    this.db
      .prepare(
        `INSERT INTO memories (id, citizen_id, kind, content, importance, created_at, related_citizen_id)
         VALUES (@id, @citizenId, @kind, @content, @importance, @createdAt, @relatedCitizenId)`,
      )
      .run({
        id: memory.id,
        citizenId: memory.citizenId,
        kind: memory.kind,
        content: memory.content,
        importance: memory.importance,
        createdAt: memory.createdAt,
        relatedCitizenId: memory.relatedCitizenId ?? null,
      });
  }

  getMemories(citizenId: string, limit = 20): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE citizen_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?`,
      )
      .all(citizenId, limit) as MemoryRow[];
    return rows.map((row) => ({
      id: row.id,
      citizenId: row.citizen_id,
      kind: row.kind as MemoryRecord["kind"],
      content: row.content,
      importance: row.importance,
      createdAt: row.created_at,
      relatedCitizenId: row.related_citizen_id ?? undefined,
    }));
  }

  getRelationship(citizenId: string, otherId: string): Relationship {
    const row = this.db
      .prepare(`SELECT * FROM relationships WHERE citizen_id = ? AND other_id = ?`)
      .get(citizenId, otherId) as RelationshipRow | undefined;
    if (row) {
      return {
        citizenId: row.citizen_id,
        otherId: row.other_id,
        trust: row.trust,
        affection: row.affection,
        respect: row.respect,
        resentment: row.resentment,
        familiarity: row.familiarity,
      };
    }
    const created: Relationship = {
      citizenId,
      otherId,
      trust: 0,
      affection: 0,
      respect: 0,
      resentment: 0,
      familiarity: 0,
    };
    this.saveRelationship(created);
    return created;
  }

  saveRelationship(rel: Relationship): void {
    this.db
      .prepare(
        `INSERT INTO relationships (citizen_id, other_id, trust, affection, respect, resentment, familiarity)
         VALUES (@citizenId, @otherId, @trust, @affection, @respect, @resentment, @familiarity)
         ON CONFLICT(citizen_id, other_id) DO UPDATE SET
           trust = excluded.trust,
           affection = excluded.affection,
           respect = excluded.respect,
           resentment = excluded.resentment,
           familiarity = excluded.familiarity`,
      )
      .run(rel);
  }

  listRelationships(citizenId: string): Relationship[] {
    const rows = this.db
      .prepare(`SELECT * FROM relationships WHERE citizen_id = ?`)
      .all(citizenId) as RelationshipRow[];
    return rows.map((row) => ({
      citizenId: row.citizen_id,
      otherId: row.other_id,
      trust: row.trust,
      affection: row.affection,
      respect: row.respect,
      resentment: row.resentment,
      familiarity: row.familiarity,
    }));
  }

  getSettlement(): SettlementState {
    const row = this.db.prepare(`SELECT * FROM settlement WHERE id = 'settlement_first'`).get() as SettlementRow;
    const construction = row.construction_json
      ? (JSON.parse(row.construction_json) as ConstructionState)
      : undefined;
    const needs = computeNeeds(row);
    return {
      id: row.id,
      name: row.name,
      food: row.food,
      wood: row.wood,
      stone: row.stone,
      beds: row.beds,
      housingCapacity: row.housing_capacity,
      tools: row.tools,
      shelterComplete: Boolean(row.shelter_complete),
      storage:
        row.storage_x != null && row.storage_y != null && row.storage_z != null
          ? { x: row.storage_x, y: row.storage_y, z: row.storage_z }
          : undefined,
      origin:
        row.origin_x != null && row.origin_y != null && row.origin_z != null
          ? { x: row.origin_x, y: row.origin_y, z: row.origin_z }
          : undefined,
      construction,
      needs,
    };
  }

  saveSettlement(state: SettlementState): void {
    this.db
      .prepare(
        `UPDATE settlement SET
          food = @food, wood = @wood, stone = @stone, beds = @beds,
          housing_capacity = @housingCapacity, tools = @tools,
          shelter_complete = @shelterComplete,
          storage_x = @storageX, storage_y = @storageY, storage_z = @storageZ,
          origin_x = @originX, origin_y = @originY, origin_z = @originZ,
          construction_json = @constructionJson
        WHERE id = @id`,
      )
      .run({
        id: state.id,
        food: state.food,
        wood: state.wood,
        stone: state.stone,
        beds: state.beds,
        housingCapacity: state.housingCapacity,
        tools: state.tools,
        shelterComplete: state.shelterComplete ? 1 : 0,
        storageX: state.storage?.x ?? null,
        storageY: state.storage?.y ?? null,
        storageZ: state.storage?.z ?? null,
        originX: state.origin?.x ?? null,
        originY: state.origin?.y ?? null,
        originZ: state.origin?.z ?? null,
        constructionJson: state.construction ? JSON.stringify(state.construction) : null,
      });
  }

  reserve(kind: string, citizenId: string, resource?: string): boolean {
    const existing = this.db
      .prepare(`SELECT id FROM reservations WHERE kind = ? AND (resource = ? OR ? IS NULL)`)
      .get(kind, resource ?? null, resource ?? null) as { id: string } | undefined;
    if (existing && resource) {
      const owned = this.db
        .prepare(`SELECT citizen_id FROM reservations WHERE kind = ? AND resource = ?`)
        .get(kind, resource) as { citizen_id: string } | undefined;
      return owned?.citizen_id === citizenId;
    }
    this.db
      .prepare(
        `INSERT INTO reservations (id, kind, resource, citizen_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), kind, resource ?? null, citizenId, new Date().toISOString());
    return true;
  }

  clearReservations(citizenId: string): void {
    this.db.prepare(`DELETE FROM reservations WHERE citizen_id = ?`).run(citizenId);
  }

  activeReservations(): Array<{ kind: string; resource: string | null; citizenId: string }> {
    return (
      this.db.prepare(`SELECT kind, resource, citizen_id FROM reservations`).all() as Array<{
        kind: string;
        resource: string | null;
        citizen_id: string;
      }>
    ).map((row) => ({ kind: row.kind, resource: row.resource, citizenId: row.citizen_id }));
  }

  logLlmCall(entry: {
    citizenId?: string;
    latencyMs: number;
    ok: boolean;
    goal?: string;
    reason?: string;
    error?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO llm_calls (id, citizen_id, timestamp, latency_ms, ok, goal, reason, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        entry.citizenId ?? null,
        new Date().toISOString(),
        entry.latencyMs,
        entry.ok ? 1 : 0,
        entry.goal ?? null,
        entry.reason ?? null,
        entry.error ?? null,
      );
  }

  recentLlmCalls(limit = 50): Array<Record<string, unknown>> {
    return this.db.prepare(`SELECT * FROM llm_calls ORDER BY timestamp DESC LIMIT ?`).all(limit) as Array<
      Record<string, unknown>
    >;
  }
}

export function computeNeeds(row: {
  food: number;
  wood: number;
  stone: number;
  beds: number;
  housing_capacity: number;
  tools: number;
  shelter_complete: number;
}): SettlementNeed[] {
  const needs: SettlementNeed[] = [];
  if (row.food < 16) needs.push("NEED_FOOD");
  if (row.wood < 32) needs.push("NEED_WOOD");
  if (row.stone < 16) needs.push("NEED_STONE");
  if (row.tools < 5) needs.push("NEED_TOOLS");
  if (row.beds < 5) needs.push("NEED_BEDS");
  if (!row.shelter_complete || row.housing_capacity < 5) needs.push("NEED_HOUSING");
  return needs;
}

type CitizenRow = {
  id: string;
  name: string;
  minecraft_username: string;
  created_at: string;
  status: CitizenRecord["status"];
  last_x: number | null;
  last_y: number | null;
  last_z: number | null;
  health: number | null;
  hunger: number | null;
  occupation: string | null;
  home_id: string | null;
  current_goal: string | null;
  current_task: string | null;
  current_action: string | null;
  decision_source: CitizenRecord["decisionSource"] | null;
  reason: string | null;
  died_at: string | null;
  death_x: number | null;
  death_y: number | null;
  death_z: number | null;
};

type EventRow = {
  id: string;
  type: string;
  timestamp: string;
  citizen_id: string | null;
  payload: string;
};

type MemoryRow = {
  id: string;
  citizen_id: string;
  kind: string;
  content: string;
  importance: number;
  created_at: string;
  related_citizen_id: string | null;
};

type RelationshipRow = {
  citizen_id: string;
  other_id: string;
  trust: number;
  affection: number;
  respect: number;
  resentment: number;
  familiarity: number;
};

type SettlementRow = {
  id: string;
  name: string;
  food: number;
  wood: number;
  stone: number;
  beds: number;
  housing_capacity: number;
  tools: number;
  shelter_complete: number;
  storage_x: number | null;
  storage_y: number | null;
  storage_z: number | null;
  origin_x: number | null;
  origin_y: number | null;
  origin_z: number | null;
  construction_json: string | null;
};

function mapCitizen(row: CitizenRow): CitizenRecord {
  const lastKnownPosition: Vec3 | undefined =
    row.last_x != null && row.last_y != null && row.last_z != null
      ? { x: row.last_x, y: row.last_y, z: row.last_z }
      : undefined;
  return {
    id: row.id,
    name: row.name,
    minecraftUsername: row.minecraft_username,
    createdAt: row.created_at,
    status: row.status,
    lastKnownPosition,
    health: row.health ?? undefined,
    hunger: row.hunger ?? undefined,
    occupation: row.occupation ?? undefined,
    homeId: row.home_id ?? undefined,
    currentGoal: row.current_goal ?? undefined,
    currentTask: row.current_task ?? undefined,
    currentAction: row.current_action ?? undefined,
    decisionSource: row.decision_source ?? undefined,
    reason: row.reason ?? undefined,
    diedAt: row.died_at ?? undefined,
    deathPosition:
      row.death_x != null && row.death_y != null && row.death_z != null
        ? { x: row.death_x, y: row.death_y, z: row.death_z }
        : undefined,
  };
}
