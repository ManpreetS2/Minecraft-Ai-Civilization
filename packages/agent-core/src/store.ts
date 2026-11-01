import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_CITIZENS,
  authorizeEventWithAudience,
  createCommunityDirectory,
  readEventAudience,
  summarizeBulletinEvent,
  type EventAudience,
  type CommunityDirectory,
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
import type { CitizenHome, HomeMembership, HomeRecord } from "./home-types.js";
import { KnowledgeProvenance } from "./knowledge-provenance.js";

/** True for the existing row of an upsert when it is quarantined: a flagged fact is never overwritten, only released manually. */
// A flag covers the fact row it was raised on AND any row for the same (citizen, key): a re-written fact with a
// fresh id must not shed the quarantine.
const FLAGGED_FACT_SQL = `EXISTS (SELECT 1 FROM citizen_persistent_fact_flags g WHERE g.released_at IS NULL AND (g.fact_id = citizen_persistent_facts.id OR (g.citizen_id = citizen_persistent_facts.citizen_id AND g.fact_key = citizen_persistent_facts.fact_key)))`;
const FACT_FLAG_MIGRATION_KEY = "sec001_fact_flags_v1";

/** SEC-001: result of re-checking legacy facts / deliveries against their source events (never contains fact content). */
export type LegacyFactMigrationReport = {
  generatedAt: string;
  communitiesKnown: number;
  facts: {
    examined: number;
    kept: number;
    alreadyFlagged: number;
    toFlag: Array<{ factId: string; citizenId: string; factKey: string; sourceEventId?: string; reason: string }>;
  };
  deliveries: {
    examined: number;
    unauthorized: Array<{ citizenId: string; eventId: string; reason: string }>;
  };
  /** Memories whose text contains a to-be-flagged fact's text (best-effort second-order taint; ids only). */
  memories: {
    toFlag: Array<{ memoryId: string; citizenId: string; viaFactId: string }>;
  };
};

/**
 * SEC-001: every community / membership write must carry this audit context. The only legitimate actor is the
 * orchestrator's own configuration path (community-config.ts); nothing derived from LLM, tool or HTTP input may
 * construct one. The literal type plus the runtime check make an accidental pass-through fail loudly.
 */
export type CommunityAudit = { actor: "orchestrator-config"; reason: string };
function assertCommunityAudit(audit: CommunityAudit): void {
  if (!audit || audit.actor !== "orchestrator-config" || typeof audit.reason !== "string" || !audit.reason.trim()) {
    throw new Error("community writes require an orchestrator-config audit context");
  }
}

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
  construction_json TEXT,
  project_json TEXT,
  workstations_json TEXT,
  storage_contents_json TEXT
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

CREATE TABLE IF NOT EXISTS homes (
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

CREATE TABLE IF NOT EXISTS home_memberships (
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
`;

export type StoreWriteResult =
  | { ok: true }
  | { ok: false; reason: "closed" }
  | { ok: false; reason: "error"; error: unknown };

export type StoreReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "closed" }
  | { ok: false; reason: "error"; error: unknown };

export class CivilizationStore {
  readonly db: Database.Database;
  private open = true;
  private readonly filePath: string;
  readonly knowledge: KnowledgeProvenance;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(resolve(filePath)), { recursive: true });
    this.db = new Database(filePath);
    this.knowledge = new KnowledgeProvenance(this.db, this);
    try {
      this.db.pragma("journal_mode = WAL");
      this.db.exec(SCHEMA);
      this.migrate();
      this.seed();
    } catch (error) {
      this.open = false;
      this.db.close();
      throw error;
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * Read without throwing after close. Unexpected read errors are not treated as data.
   */
  safeRead<T>(label: string, read: () => T): StoreReadResult<T> {
    if (!this.open) {
      return { ok: false, reason: "closed" };
    }
    try {
      return { ok: true, value: read() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[store] unexpected read error (${label}): ${message}`);
      return { ok: false, reason: "error", error };
    }
  }

  /**
   * Persist with an explicit outcome.
   * - `closed`: expected skip after shutdown (not an action success).
   * - `error`: unexpected SQLite/runtime failure — callers must not treat as durable success.
   */
  safeWrite(label: string, write: () => void): StoreWriteResult {
    if (!this.open) {
      console.warn(`[store] skipped write after close: ${label}`);
      return { ok: false, reason: "closed" };
    }
    try {
      write();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[store] unexpected write error (${label}): ${message}`);
      return { ok: false, reason: "error", error };
    }
  }

  private migrate(): void {
    const cols = this.db.prepare(`PRAGMA table_info(citizens)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((col) => col.name));
    if (!names.has("died_at")) this.db.exec(`ALTER TABLE citizens ADD COLUMN died_at TEXT`);
    if (!names.has("death_x")) this.db.exec(`ALTER TABLE citizens ADD COLUMN death_x REAL`);
    if (!names.has("death_y")) this.db.exec(`ALTER TABLE citizens ADD COLUMN death_y REAL`);
    if (!names.has("death_z")) this.db.exec(`ALTER TABLE citizens ADD COLUMN death_z REAL`);
    const settlementCols = this.db.prepare(`PRAGMA table_info(settlement)`).all() as Array<{ name: string }>;
    const settlementNames = new Set(settlementCols.map((col) => col.name));
    if (!settlementNames.has("project_json")) this.db.exec(`ALTER TABLE settlement ADD COLUMN project_json TEXT`);
    if (!settlementNames.has("workstations_json")) this.db.exec(`ALTER TABLE settlement ADD COLUMN workstations_json TEXT`);
    if (!settlementNames.has("storage_contents_json")) this.db.exec(`ALTER TABLE settlement ADD COLUMN storage_contents_json TEXT`);
    if (!names.has("personality_json")) this.db.exec(`ALTER TABLE citizens ADD COLUMN personality_json TEXT`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS sim_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS human_directives (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS citizen_event_delivery (
        citizen_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        delivered_at TEXT NOT NULL,
        PRIMARY KEY (citizen_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_citizen_event_delivery_citizen
        ON citizen_event_delivery(citizen_id, delivered_at);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS citizen_persistent_facts (
        id TEXT PRIMARY KEY,
        citizen_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        content TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'observed_fact',
        created_at TEXT NOT NULL,
        UNIQUE(citizen_id, fact_key)
      );
    `);
    this.migrateCommunities();
    this.migrateHomes();
    this.knowledge.initialize(this.filePath);
  }

  /**
   * SEC-001: persisted community directory + non-destructive quarantine FLAGS for facts derived from unverified
   * audiences. Events carry their audience inside payload.visibility.audience, so no events-table change is needed;
   * every event written before this migration has no audience and therefore reaches nobody.
   *
   * HARD RULE (owner policy): no historical row is ever deleted or moved. A fact is quarantined by a row in
   * citizen_persistent_fact_flags that points at it; the fact row itself, with its content, stays exactly where it is
   * and is excluded at read time (listPersistentFacts). Flags are released manually only.
   */
  private migrateCommunities(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS citizen_persistent_fact_revisions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_id TEXT NOT NULL,
        citizen_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        content TEXT NOT NULL,
        kind TEXT NOT NULL,
        audience TEXT,
        source_event_id TEXT,
        replaced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS communities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS community_members (
        citizen_id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL REFERENCES communities(id),
        joined_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS community_audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        action TEXT NOT NULL,
        community_id TEXT NOT NULL,
        citizen_id TEXT,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS citizen_persistent_fact_flags (
        fact_id TEXT PRIMARY KEY,
        citizen_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        flagged_at TEXT NOT NULL,
        released_at TEXT
      );
      CREATE TABLE IF NOT EXISTS citizen_memory_flags (
        memory_id TEXT PRIMARY KEY,
        citizen_id TEXT NOT NULL,
        via_fact_id TEXT,
        reason TEXT NOT NULL,
        flagged_at TEXT NOT NULL,
        released_at TEXT
      );
      CREATE TABLE IF NOT EXISTS citizen_event_delivery_flags (
        citizen_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        flagged_at TEXT NOT NULL,
        PRIMARY KEY (citizen_id, event_id)
      );
    `);
    // Persistent facts record which audience authorized them and which event they came from (idempotent).
    const factCols = new Set(
      (this.db.prepare(`PRAGMA table_info(citizen_persistent_facts)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    if (!factCols.has("audience")) this.db.exec(`ALTER TABLE citizen_persistent_facts ADD COLUMN audience TEXT`);
    if (!factCols.has("source_event_id")) this.db.exec(`ALTER TABLE citizen_persistent_facts ADD COLUMN source_event_id TEXT`);
    if (this.db.prepare(`SELECT value FROM sim_meta WHERE key = ?`).get(FACT_FLAG_MIGRATION_KEY)) {
      this.backfillFactProvenance();
      return;
    }
    const factRows = (this.db.prepare(`SELECT COUNT(*) AS n FROM citizen_persistent_facts`).get() as { n: number }).n;
    const deliveryRows = (this.db.prepare(`SELECT COUNT(*) AS n FROM citizen_event_delivery`).get() as { n: number }).n;
    const now = new Date().toISOString();
    if (factRows === 0 && deliveryRows === 0) {
      // Nothing historical to protect or check (fresh database).
      this.db.prepare(`INSERT OR REPLACE INTO sim_meta (key, value) VALUES (?, ?)`).run(FACT_FLAG_MIGRATION_KEY, `${now} fresh`);
      return;
    }
    // 1. back up the database file BEFORE touching anything (throws, and aborts the open, if it cannot).
    const backupPath = this.backupBeforeLegacyMigration(now);
    // 2. dry run: re-check every fact and delivery against its source event (read-only).
    const report = this.dryRunLegacyFactMigration();
    if (backupPath) {
      writeFileSync(`${backupPath}.dry-run-report.json`, JSON.stringify(report, null, 2));
    }
    // 3. apply flags (inserts into the flag tables only; no fact, event or delivery row is changed or removed).
    const applied = this.applyLegacyFactMigration(report, now);
    this.db
      .prepare(`INSERT OR REPLACE INTO sim_meta (key, value) VALUES (?, ?)`)
      .run(FACT_FLAG_MIGRATION_KEY, `${now} backup=${backupPath ?? "none"} flaggedFacts=${applied.factsFlagged} flaggedDeliveries=${applied.deliveriesFlagged}`);
    this.backfillFactProvenance();
  }

  /**
   * Consistent snapshot of the database file (VACUUM INTO includes WAL content). Returns the backup path, or
   * undefined for an in-memory database. Throws if the snapshot cannot be written or does not verify.
   */
  private backupBeforeLegacyMigration(at: string): string | undefined {
    if (!this.filePath || this.filePath === ":memory:" || this.filePath.startsWith("file::memory:")) return undefined;
    const stamp = at.replace(/[:.]/g, "-");
    let backupPath = `${resolve(this.filePath)}.pre-sec001-${stamp}.bak`;
    for (let i = 1; existsSync(backupPath); i += 1) backupPath = `${resolve(this.filePath)}.pre-sec001-${stamp}-${i}.bak`;
    try {
      this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
      if (!existsSync(backupPath) || statSync(backupPath).size === 0) throw new Error("backup file missing or empty");
      const copy = new Database(backupPath, { readonly: true });
      try {
        const live = (this.db.prepare(`SELECT COUNT(*) AS n FROM citizen_persistent_facts`).get() as { n: number }).n;
        const saved = (copy.prepare(`SELECT COUNT(*) AS n FROM citizen_persistent_facts`).get() as { n: number }).n;
        if (live !== saved) throw new Error(`backup fact count ${saved} != live ${live}`);
      } finally {
        copy.close();
      }
    } catch (error) {
      throw new Error(`SEC-001 legacy fact migration aborted: cannot back up the database first (${error instanceof Error ? error.message : String(error)})`);
    }
    return backupPath;
  }

  /**
   * READ-ONLY. Re-checks every event-derived fact and every delivery record against its SOURCE event and the
   * persisted community directory. Facts that are not event-derived (note:*, etc.) are never examined. An actor_private
   * fact survives when its reader is the actor; a community-labelled fact survives only for an actual member.
   */
  dryRunLegacyFactMigration(at = new Date().toISOString()): LegacyFactMigrationReport {
    const directory = this.getCommunityDirectory();
    const report: LegacyFactMigrationReport = {
      generatedAt: at,
      communitiesKnown: (this.db.prepare(`SELECT COUNT(*) AS n FROM communities`).get() as { n: number }).n,
      facts: { examined: 0, kept: 0, alreadyFlagged: 0, toFlag: [] },
      deliveries: { examined: 0, unauthorized: [] },
      memories: { toFlag: [] },
    };
    const flagged = new Set(
      (this.db.prepare(`SELECT fact_id FROM citizen_persistent_fact_flags WHERE released_at IS NULL`).all() as Array<{ fact_id: string }>).map((r) => r.fact_id),
    );
    const facts = this.db
      .prepare(`SELECT id, citizen_id, fact_key, source_event_id FROM citizen_persistent_facts WHERE fact_key LIKE 'event:%' OR source_event_id IS NOT NULL ORDER BY id`)
      .all() as Array<{ id: string; citizen_id: string; fact_key: string; source_event_id: string | null }>;
    for (const fact of facts) {
      report.facts.examined += 1;
      if (flagged.has(fact.id)) {
        report.facts.alreadyFlagged += 1;
        continue;
      }
      const eventId = fact.source_event_id ?? fact.fact_key.slice("event:".length);
      const event = this.getEventById(eventId);
      if (!event) {
        report.facts.toFlag.push({ factId: fact.id, citizenId: fact.citizen_id, factKey: fact.fact_key, sourceEventId: eventId, reason: "source event not found" });
        continue;
      }
      const decision = authorizeEventWithAudience(fact.citizen_id, event.payload, directory, event.citizenId);
      if (decision.allowed) report.facts.kept += 1;
      else report.facts.toFlag.push({ factId: fact.id, citizenId: fact.citizen_id, factKey: fact.fact_key, sourceEventId: eventId, reason: `source event not authorized for reader: ${decision.reason}` });
    }
    const deliveries = this.db
      .prepare(`SELECT citizen_id, event_id FROM citizen_event_delivery ORDER BY citizen_id, event_id`)
      .all() as Array<{ citizen_id: string; event_id: string }>;
    for (const d of deliveries) {
      report.deliveries.examined += 1;
      const event = this.getEventById(d.event_id);
      if (!event) {
        report.deliveries.unauthorized.push({ citizenId: d.citizen_id, eventId: d.event_id, reason: "source event not found" });
        continue;
      }
      const decision = authorizeEventWithAudience(d.citizen_id, event.payload, directory, event.citizenId);
      if (!decision.allowed) report.deliveries.unauthorized.push({ citizenId: d.citizen_id, eventId: d.event_id, reason: decision.reason });
    }
    // Include active flags so a later import cannot escape a repeated quarantine scan.
    const existingFlags = this.db.prepare(
      "SELECT fact_id AS factId, citizen_id AS citizenId FROM citizen_persistent_fact_flags WHERE released_at IS NULL",
    ).all() as Array<{ factId: string; citizenId: string }>;
    report.memories.toFlag = this.findTaintedMemories([
      ...existingFlags,
      ...report.facts.toFlag.map((f) => ({ factId: f.factId, citizenId: f.citizenId })),
    ]);
    return report;
  }

  /**
   * Best-effort second-order quarantine: memories carry no provenance, so a memory is treated as tainted when its
   * text contains a flagged fact's text (or is wholly contained in it). Paraphrases cannot be traced. READ-ONLY.
   */
  private findTaintedMemories(facts: Array<{ factId: string; citizenId: string }>): Array<{ memoryId: string; citizenId: string; viaFactId: string }> {
    const out: Array<{ memoryId: string; citizenId: string; viaFactId: string }> = [];
    const seen = new Set<string>();
    const getFact = this.db.prepare(`SELECT content FROM citizen_persistent_facts WHERE id = ?`);
    const memories = this.db.prepare(
      `SELECT id, content FROM memories WHERE citizen_id = ? AND id NOT IN (SELECT memory_id FROM citizen_memory_flags WHERE released_at IS NULL)`,
    );
    for (const fact of facts) {
      const row = getFact.get(fact.factId) as { content: string } | undefined;
      const needle = row?.content.trim().toLowerCase() ?? "";
      if (needle.length < 12) continue; // too short to match without false positives
      for (const memory of memories.all(fact.citizenId) as Array<{ id: string; content: string }>) {
        if (seen.has(memory.id)) continue;
        if (this.knowledge.isEligible("memory", memory.id)) continue;
        const text = memory.content.toLowerCase();
        if (text.includes(needle) || (text.length >= 20 && needle.includes(text))) {
          seen.add(memory.id);
          out.push({ memoryId: memory.id, citizenId: fact.citizenId, viaFactId: fact.factId });
        }
      }
    }
    return out;
  }

  private flagMemories(items: Array<{ memoryId: string; citizenId: string; viaFactId: string }>, reason: string, at: string): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO citizen_memory_flags (memory_id, citizen_id, via_fact_id, reason, flagged_at) VALUES (?, ?, ?, ?, ?)`,
    );
    let n = 0;
    for (const m of items) n += insert.run(m.memoryId, m.citizenId, m.viaFactId, reason, at).changes;
    return n;
  }

  listFlaggedMemoryIds(citizenId?: string): string[] {
    const rows = (citizenId
      ? this.db.prepare(`SELECT memory_id FROM citizen_memory_flags WHERE released_at IS NULL AND citizen_id = ? ORDER BY memory_id`).all(citizenId)
      : this.db.prepare(`SELECT memory_id FROM citizen_memory_flags WHERE released_at IS NULL ORDER BY memory_id`).all()) as Array<{ memory_id: string }>;
    return rows.map((r) => r.memory_id);
  }

  /**
   * Apply a dry-run report by INSERTING flag rows. Never updates or deletes a fact, event or delivery row. A fact
   * that was already flagged (or flagged and manually released) keeps its existing flag row.
   */
  applyLegacyFactMigration(report: LegacyFactMigrationReport, at = new Date().toISOString()): { factsFlagged: number; deliveriesFlagged: number } {
    const flagFact = this.db.prepare(
      `INSERT OR IGNORE INTO citizen_persistent_fact_flags (fact_id, citizen_id, fact_key, reason, source, flagged_at) VALUES (?, ?, ?, ?, 'legacy-migration', ?)`,
    );
    const flagDelivery = this.db.prepare(
      `INSERT OR IGNORE INTO citizen_event_delivery_flags (citizen_id, event_id, reason, flagged_at) VALUES (?, ?, ?, ?)`,
    );
    let factsFlagged = 0;
    let deliveriesFlagged = 0;
    this.db.transaction(() => {
      for (const f of report.facts.toFlag) factsFlagged += flagFact.run(f.factId, f.citizenId, f.factKey, f.reason, at).changes;
      for (const d of report.deliveries.unauthorized) deliveriesFlagged += flagDelivery.run(d.citizenId, d.eventId, d.reason, at).changes;
      this.flagMemories(report.memories.toFlag, "text derived from a quarantined fact", at);
    })();
    return { factsFlagged, deliveriesFlagged };
  }

  /**
   * Fill source_event_id (provenance) for event-derived facts written before the column existed. The AUDIENCE stamp is
   * only written when the fact is not flagged AND its source event authorizes this fact's reader today, so a stamp
   * never vouches for a fact the migration refused. Idempotent.
   */
  private backfillFactProvenance(): void {
    const rows = this.db
      .prepare(`SELECT id, citizen_id, fact_key FROM citizen_persistent_facts WHERE source_event_id IS NULL AND fact_key LIKE 'event:%'`)
      .all() as Array<{ id: string; citizen_id: string; fact_key: string }>;
    if (rows.length === 0) return;
    const directory = this.getCommunityDirectory();
    const flagged = new Set(
      (this.db.prepare(`SELECT fact_id FROM citizen_persistent_fact_flags WHERE released_at IS NULL`).all() as Array<{ fact_id: string }>).map((r) => r.fact_id),
    );
    const update = this.db.prepare(`UPDATE citizen_persistent_facts SET source_event_id = ?, audience = ? WHERE id = ?`);
    this.db.transaction(() => {
      for (const row of rows) {
        const eventId = row.fact_key.slice("event:".length);
        const event = this.getEventById(eventId);
        let stamp: string | null = null;
        if (event && !flagged.has(row.id) && authorizeEventWithAudience(row.citizen_id, event.payload, directory, event.citizenId).allowed) {
          const audience = readEventAudience(event.payload);
          stamp = audience ? JSON.stringify(audience) : null;
        }
        update.run(eventId, stamp, row.id);
      }
    })();
  }

  private auditCommunity(audit: CommunityAudit, action: string, communityId: string, citizenId: string | null, at: string): void {
    this.db
      .prepare(`INSERT INTO community_audit (at, action, community_id, citizen_id, actor, reason) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(at, action, communityId, citizenId, audit.actor, audit.reason);
  }

  /** Create (or rename) a community. Orchestrator-config path only (see CommunityAudit). */
  upsertCommunity(id: string, name: string, audit: CommunityAudit, at = new Date().toISOString()): void {
    assertCommunityAudit(audit);
    if (!id.trim() || id !== id.trim()) throw new Error("community id must be a non-empty trimmed string");
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO communities (id, name, created_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
        )
        .run(id, name, at);
      this.auditCommunity(audit, "upsert_community", id, null, at);
    })();
  }

  /**
   * A citizen belongs to at most one community (PRIMARY KEY on citizen_id). Re-adding to another community throws.
   * Orchestrator-config path only (see CommunityAudit). Returns true when a row was added.
   */
  addCommunityMember(communityId: string, citizenId: string, audit: CommunityAudit, at = new Date().toISOString()): boolean {
    assertCommunityAudit(audit);
    const existing = this.db
      .prepare(`SELECT community_id FROM community_members WHERE citizen_id = ?`)
      .get(citizenId) as { community_id: string } | undefined;
    if (existing && existing.community_id !== communityId) {
      throw new Error(`citizen ${citizenId} already belongs to community ${existing.community_id}`);
    }
    if (existing) return false;
    if (!this.db.prepare(`SELECT 1 FROM communities WHERE id = ?`).get(communityId)) {
      throw new Error(`unknown community ${communityId}`);
    }
    this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO community_members (citizen_id, community_id, joined_at) VALUES (?, ?, ?)`)
        .run(citizenId, communityId, at);
      this.auditCommunity(audit, "add_member", communityId, citizenId, at);
    })();
    return true;
  }

  /**
   * Audited removal. Facts the citizen stored on the strength of that community's audience are FLAGGED in place
   * (excluded from reads, content and row untouched, never moved or deleted), because the authorization that
   * justified them is gone. Orchestrator-config path only (see CommunityAudit).
   * Returns false when the citizen was not a member.
   */
  removeCommunityMember(communityId: string, citizenId: string, audit: CommunityAudit, at = new Date().toISOString()): boolean {
    assertCommunityAudit(audit);
    const row = this.db
      .prepare(`SELECT community_id FROM community_members WHERE citizen_id = ? AND community_id = ?`)
      .get(citizenId, communityId);
    if (!row) return false;
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM community_members WHERE citizen_id = ? AND community_id = ?`).run(citizenId, communityId);
      const facts = this.db
        .prepare(`SELECT id, citizen_id, fact_key, audience FROM citizen_persistent_facts WHERE citizen_id = ? AND audience IS NOT NULL`)
        .all(citizenId) as Array<{ id: string; citizen_id: string; fact_key: string; audience: string }>;
      const flag = this.db.prepare(
        `INSERT OR IGNORE INTO citizen_persistent_fact_flags (fact_id, citizen_id, fact_key, reason, source, flagged_at)
         VALUES (?, ?, ?, ?, 'membership-removal', ?)`,
      );
      const flaggedNow: Array<{ factId: string; citizenId: string }> = [];
      for (const fact of facts) {
        let audienceCommunity: string | undefined;
        try {
          const parsed = JSON.parse(fact.audience) as { scope?: string; communityId?: string };
          if (parsed.scope === "community") audienceCommunity = parsed.communityId;
        } catch {
          audienceCommunity = communityId; // unreadable audience: treat as revoked (fail closed)
        }
        if (audienceCommunity !== communityId) continue;
        flag.run(fact.id, fact.citizen_id, fact.fact_key, `membership of ${communityId} removed`, at);
        flaggedNow.push({ factId: fact.id, citizenId: fact.citizen_id });
      }
      this.flagMemories(this.findTaintedMemories(flaggedNow), `derived from a fact flagged when ${communityId} membership was removed`, at);
      this.auditCommunity(audit, "remove_member", communityId, citizenId, at);
    })();
    return true;
  }

  listCommunityAudit(): Array<{ seq: number; at: string; action: string; communityId: string; citizenId?: string; actor: string; reason: string }> {
    const rows = this.db.prepare(`SELECT * FROM community_audit ORDER BY seq ASC`).all() as Array<{
      seq: number; at: string; action: string; community_id: string; citizen_id: string | null; actor: string; reason: string;
    }>;
    return rows.map((r) => ({ seq: r.seq, at: r.at, action: r.action, communityId: r.community_id, citizenId: r.citizen_id ?? undefined, actor: r.actor, reason: r.reason }));
  }

  /** True when the most recent audited action for this (community, citizen) pair is an explicit removal. */
  wasMemberRemoved(communityId: string, citizenId: string): boolean {
    const row = this.db
      .prepare(`SELECT action FROM community_audit WHERE community_id = ? AND citizen_id = ? AND action IN ('add_member','remove_member') ORDER BY seq DESC LIMIT 1`)
      .get(communityId, citizenId) as { action: string } | undefined;
    return row?.action === "remove_member";
  }

  /** Fresh directory snapshot from the persisted tables (survives restart; never cached across calls). */
  /** True once any community exists: the world is then multi-community and shared settlement state is off limits. */
  hasCommunities(): boolean {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM communities`).get() as { n: number }).n > 0;
  }

  getCommunityDirectory(): CommunityDirectory {
    const communities = this.db.prepare(`SELECT id FROM communities ORDER BY id`).all() as Array<{ id: string }>;
    const members = this.db
      .prepare(`SELECT citizen_id, community_id FROM community_members ORDER BY citizen_id`)
      .all() as Array<{ citizen_id: string; community_id: string }>;
    return createCommunityDirectory(
      communities.map((c) => ({
        id: c.id,
        memberIds: members.filter((m) => m.community_id === c.id).map((m) => m.citizen_id),
      })),
    );
  }

  /** Facts currently flagged (still stored in citizen_persistent_facts, excluded from reads). Oldest flag first by id. */
  listQuarantinedFacts(citizenId?: string): Array<{ id: string; citizenId: string; factKey: string; content: string; reason: string; source: string }> {
    const sql = `SELECT f.id AS id, f.citizen_id AS citizen_id, f.fact_key AS fact_key, f.content AS content, g.reason AS reason, g.source AS source
      FROM citizen_persistent_fact_flags g JOIN citizen_persistent_facts f ON f.id = g.fact_id
      WHERE g.released_at IS NULL ${citizenId ? "AND f.citizen_id = ?" : ""} ORDER BY f.id`;
    const rows = (citizenId ? this.db.prepare(sql).all(citizenId) : this.db.prepare(sql).all()) as Array<{
      id: string; citizen_id: string; fact_key: string; content: string; reason: string; source: string;
    }>;
    return rows.map((r) => ({ id: r.id, citizenId: r.citizen_id, factKey: r.fact_key, content: r.content, reason: r.reason, source: r.source }));
  }

  listFlaggedDeliveries(citizenId?: string): Array<{ citizenId: string; eventId: string; reason: string }> {
    const rows = (
      citizenId
        ? this.db.prepare(`SELECT * FROM citizen_event_delivery_flags WHERE citizen_id = ? ORDER BY event_id`).all(citizenId)
        : this.db.prepare(`SELECT * FROM citizen_event_delivery_flags ORDER BY citizen_id, event_id`).all()
    ) as Array<{ citizen_id: string; event_id: string; reason: string }>;
    return rows.map((r) => ({ citizenId: r.citizen_id, eventId: r.event_id, reason: r.reason }));
  }

  private migrateHomes(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS homes (
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
      CREATE TABLE IF NOT EXISTS home_memberships (
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_home_bed_claimed
        ON home_memberships(bed_x, bed_y, bed_z)
        WHERE status IN ('active', 'displaced');
      CREATE UNIQUE INDEX IF NOT EXISTS idx_home_personal_chest_claimed
        ON home_memberships(personal_chest_x, personal_chest_y, personal_chest_z)
        WHERE status IN ('active', 'displaced') AND personal_chest_x IS NOT NULL;
    `);
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

  restoreLivingIdentity(id: string, reason = "development identity restored"): boolean {
    const existing = this.getCitizen(id);
    if (!existing) return false;
    this.db
      .prepare(
        `UPDATE citizens SET status = 'offline', died_at = NULL, death_x = NULL, death_y = NULL, death_z = NULL, reason = ?
         WHERE id = ?`,
      )
      .run(reason, id);
    return true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
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
        decision_source, reason, died_at, death_x, death_y, death_z, personality_json
      ) VALUES (
        @id, @name, @minecraftUsername, @createdAt, @status, @lastX, @lastY, @lastZ,
        @health, @hunger, @occupation, @homeId, @currentGoal, @currentTask, @currentAction,
        @decisionSource, @reason, @diedAt, @deathX, @deathY, @deathZ, @personalityJson
      )
      ON CONFLICT(id) DO UPDATE SET
        status = CASE WHEN citizens.status = 'dead' THEN 'dead' ELSE excluded.status END,
        last_x = excluded.last_x,
        last_y = excluded.last_y,
        last_z = excluded.last_z,
        health = excluded.health,
        hunger = excluded.hunger,
        occupation = excluded.occupation,
        home_id = COALESCE(excluded.home_id, citizens.home_id),
        current_goal = excluded.current_goal,
        current_task = excluded.current_task,
        current_action = excluded.current_action,
        decision_source = excluded.decision_source,
        reason = CASE WHEN citizens.status = 'dead' THEN citizens.reason ELSE excluded.reason END,
        died_at = COALESCE(citizens.died_at, excluded.died_at),
        death_x = COALESCE(citizens.death_x, excluded.death_x),
        death_y = COALESCE(citizens.death_y, excluded.death_y),
        death_z = COALESCE(citizens.death_z, excluded.death_z),
        personality_json = COALESCE(citizens.personality_json, excluded.personality_json)
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
        personalityJson: record.personalityJson ?? null,
      });
  }

  /**
   * Persist personality only when none exists yet. Never silently overwrites.
   * Returns true when a new record was written.
   */
  ensurePersonality(citizenId: string, personalityJson: string): boolean {
    const row = this.db.prepare(`SELECT personality_json FROM citizens WHERE id = ?`).get(citizenId) as
      | { personality_json: string | null }
      | undefined;
    if (!row) return false;
    if (row.personality_json) return false;
    this.db.prepare(`UPDATE citizens SET personality_json = ? WHERE id = ? AND personality_json IS NULL`).run(personalityJson, citizenId);
    return true;
  }

  getDeliveredEventIds(citizenId: string): Set<string> {
    const rows = this.db
      .prepare(`SELECT event_id FROM citizen_event_delivery WHERE citizen_id = ?`)
      .all(citizenId) as Array<{ event_id: string }>;
    return new Set(rows.map((r) => r.event_id));
  }

  /**
   * Record delivered event IDs after bulletin state is ready. Idempotent.
   * Call only after associated decision context was safely built.
   */
  markEventsDelivered(citizenId: string, eventIds: string[], at = new Date().toISOString()): void {
    if (eventIds.length === 0) return;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO citizen_event_delivery (citizen_id, event_id, delivered_at) VALUES (?, ?, ?)`,
    );
    const run = this.db.transaction(() => {
      for (const eventId of eventIds) {
        insert.run(citizenId, eventId, at);
      }
    });
    run();
  }

  upsertPersistentFact(fact: {
    id: string;
    citizenId: string;
    factKey: string;
    content: string;
    /** reported_speech: the speech happened; what it claims has not been verified. */
    kind?: "observed_fact" | "suspicion" | "reported_speech";
    createdAt?: string;
    /** SEC-001: the verified audience that authorized this fact (omit for private/non-broadcast facts). */
    audience?: EventAudience;
    /** SEC-001: the event this fact was derived from. */
    sourceEventId?: string;
  }): void {
    this.db.transaction(() => {
      const priorFact = this.db
        .prepare("SELECT id FROM citizen_persistent_facts WHERE citizen_id=? AND fact_key=?")
        .get(fact.citizenId, fact.factKey);
      this.recordFactRevision(fact);
      this.db
        .prepare(
          `INSERT INTO citizen_persistent_facts (id, citizen_id, fact_key, content, kind, created_at, audience, source_event_id)
         VALUES (@id, @citizenId, @factKey, @content, @kind, @createdAt, @audience, @sourceEventId)
         ON CONFLICT(citizen_id, fact_key) DO UPDATE SET
           content = CASE WHEN ${FLAGGED_FACT_SQL} THEN content ELSE excluded.content END,
           kind = CASE WHEN ${FLAGGED_FACT_SQL} THEN kind ELSE COALESCE(@explicitKind, kind) END,
           audience = CASE WHEN ${FLAGGED_FACT_SQL} THEN audience ELSE excluded.audience END,
           source_event_id = CASE WHEN ${FLAGGED_FACT_SQL} THEN source_event_id ELSE excluded.source_event_id END`,
        )
        .run({
          audience: fact.audience ? JSON.stringify(fact.audience) : null,
          sourceEventId: fact.sourceEventId ?? null,
          id: fact.id,
          citizenId: fact.citizenId,
          factKey: fact.factKey,
          content: fact.content,
          kind: fact.kind ?? "observed_fact",
          // A replacement takes its own trust class. One that names no kind keeps the old class, so it can't be promoted.
          explicitKind: fact.kind ?? null,
          createdAt: fact.createdAt ?? new Date().toISOString(),
        });
      const stored = this.db
        .prepare("SELECT id FROM citizen_persistent_facts WHERE citizen_id=? AND fact_key=?")
        .get(fact.citizenId, fact.factKey) as { id: string };
      this.knowledge.recordWrite(
        "fact",
        stored.id,
        fact.sourceEventId ??
          (fact.factKey.startsWith("event:") ? fact.factKey.slice(6) : undefined),
        Boolean(priorFact),
      );
    })();
  }

  /** SEC-001 audit: what a same-key replacement is about to overwrite is copied out first, never lost. */
  private recordFactRevision(fact: { citizenId: string; factKey: string; content: string; kind?: string }): void {
    const prior = this.db
      .prepare(`SELECT id, content, kind, audience, source_event_id FROM citizen_persistent_facts WHERE citizen_id = ? AND fact_key = ?`)
      .get(fact.citizenId, fact.factKey) as
      | { id: string; content: string; kind: string; audience: string | null; source_event_id: string | null }
      | undefined;
    if (!prior || (prior.content === fact.content && prior.kind === (fact.kind ?? prior.kind))) return;
    this.db
      .prepare(
        `INSERT INTO citizen_persistent_fact_revisions (fact_id, citizen_id, fact_key, content, kind, audience, source_event_id, replaced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(prior.id, fact.citizenId, fact.factKey, prior.content, prior.kind, prior.audience, prior.source_event_id, new Date().toISOString());
  }

  /** Observer audit: prior versions of a fact, oldest first. Never read by cognition. */
  listPersistentFactRevisions(citizenId: string, factKey: string): Array<{ factId: string; content: string; kind: string; replacedAt: string }> {
    return (
      this.db
        .prepare(`SELECT fact_id, content, kind, replaced_at FROM citizen_persistent_fact_revisions WHERE citizen_id = ? AND fact_key = ? ORDER BY seq`)
        .all(citizenId, factKey) as Array<{ fact_id: string; content: string; kind: string; replaced_at: string }>
    ).map((row) => ({ factId: row.fact_id, content: row.content, kind: row.kind, replacedAt: row.replaced_at }));
  }

  listPersistentFacts(
    citizenId: string,
    limit = 20,
  ): Array<{
    id: string;
    citizenId: string;
    factKey: string;
    content: string;
    kind: string;
    createdAt: string;
    audience?: EventAudience;
    sourceEventId?: string;
  }> {
    return this.knowledge.withSnapshot(() => {
      if (limit <= 0) return [];
      const candidates = this.db
        .prepare(
          // SEC-001: flagged (quarantined) facts stay in the table but are excluded from every read. This is the single
          // chokepoint for facts that reach a prompt (manager.ts:485 and anything else).
          `SELECT * FROM citizen_persistent_facts
         WHERE citizen_id = ? AND NOT ${FLAGGED_FACT_SQL}
         ORDER BY created_at DESC`,
        )
        .iterate(citizenId) as Iterable<{
        id: string;
        citizen_id: string;
        fact_key: string;
        content: string;
        kind: string;
        created_at: string;
        audience: string | null;
        source_event_id: string | null;
      }>;
      const rows: Array<{
        id: string;
        citizen_id: string;
        fact_key: string;
        content: string;
        kind: string;
        created_at: string;
        audience: string | null;
        source_event_id: string | null;
      }> = [];
      for (const row of candidates) {
        if (!this.knowledge.isEligible("fact", row.id)) continue;
        rows.push(row);
        if (rows.length >= limit) break;
      }
      return rows.map((row) => {
        let audience: EventAudience | undefined;
        if (row.audience) {
          try {
            audience = readEventAudience({ visibility: { audience: JSON.parse(row.audience) } });
          } catch {
            audience = undefined;
          }
        }
        return {
          id: row.id,
          citizenId: row.citizen_id,
          factKey: row.fact_key,
          content: row.content,
          kind: row.kind,
          createdAt: row.created_at,
          audience,
          sourceEventId: this.knowledge.sourceFor("fact", row.id)?.id,
        };
      });
    });
  }

  /** Observer audit: all events newest-first (no citizen visibility filter). */
  listAllEventsForObserver(limit = 500): SimEvent[] {
    return this.recentEvents(limit);
  }

  /** One stored event by id (the trusted source for sharing and write-time audience re-checks). */
  getEventById(id: string): SimEvent | undefined {
    const row = this.db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined;
    if (!row) return undefined;
    try {
      return {
        id: row.id,
        type: row.type as SimEvent["type"],
        timestamp: row.timestamp,
        citizenId: row.citizen_id ?? undefined,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
      };
    } catch {
      return undefined;
    }
  }

  /** The NEWEST `limit` events, returned oldest-first (so a long history never hides the latest events). */
  listEventsAscending(limit = 500): SimEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (SELECT * FROM events ORDER BY timestamp DESC, id DESC LIMIT ?) ORDER BY timestamp ASC, id ASC`,
      )
      .all(limit) as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      type: row.type as SimEvent["type"],
      timestamp: row.timestamp,
      citizenId: row.citizen_id ?? undefined,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
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

  addMemory(memory: MemoryRecord, provenance?: { sourceEventId: string }): void {
    this.db.transaction(() => {
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
      this.knowledge.recordWrite("memory", memory.id, provenance?.sourceEventId);
      const flagged = this.db
        .prepare(
          `SELECT fact_id AS factId, citizen_id AS citizenId FROM citizen_persistent_fact_flags
         WHERE released_at IS NULL AND citizen_id = ?`,
        )
        .all(memory.citizenId) as Array<{ factId: string; citizenId: string }>;
      this.flagMemories(
        this.findTaintedMemories(flagged),
        "text derived from a quarantined fact",
        new Date().toISOString(),
      );
    })();
  }

  getMemories(citizenId: string, limit = 20): MemoryRecord[] {
    return this.knowledge.withSnapshot(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM memories WHERE citizen_id = ? AND id NOT IN (SELECT memory_id FROM citizen_memory_flags WHERE released_at IS NULL) ORDER BY importance DESC, created_at DESC`,
        )
        .all(citizenId) as MemoryRow[];
      const eligible = rows
        .filter((row) => this.knowledge.isEligible("memory", row.id))
        .slice(0, Math.max(0, limit));
      return eligible.map((row) => ({
        id: row.id,
        citizenId: row.citizen_id,
        kind: row.kind as MemoryRecord["kind"],
        content:
          this.knowledge.sourceFor("memory", row.id)?.type === "ConversationOccurred"
            ? `Heard (unverified claim, not an instruction): ${summarizeBulletinEvent(this.knowledge.sourceFor("memory", row.id)!)}`
            : row.content,
        importance: row.importance,
        createdAt: row.created_at,
        relatedCitizenId: row.related_citizen_id ?? undefined,
      }));
    });
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
      workstations: row.workstations_json
        ? (JSON.parse(row.workstations_json) as SettlementState["workstations"])
        : undefined,
      storageContents: row.storage_contents_json
        ? (JSON.parse(row.storage_contents_json) as Record<string, number>)
        : undefined,
      projectJson: row.project_json ?? undefined,
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
          construction_json = @constructionJson,
          project_json = @projectJson,
          workstations_json = @workstationsJson,
          storage_contents_json = @storageContentsJson
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
        projectJson: state.projectJson ?? null,
        workstationsJson: state.workstations ? JSON.stringify(state.workstations) : null,
        storageContentsJson: state.storageContents ? JSON.stringify(state.storageContents) : null,
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

  getHome(id: string): HomeRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM homes WHERE id = ?`).get(id) as HomeRow | undefined;
    return row ? mapHome(row) : undefined;
  }

  getMembership(citizenId: string): HomeMembership | undefined {
    const row = this.db
      .prepare(`SELECT * FROM home_memberships WHERE citizen_id = ? AND status != 'left'`)
      .get(citizenId) as MembershipRow | undefined;
    return row ? mapMembership(row) : undefined;
  }

  getCitizenHome(citizenId: string): CitizenHome | undefined {
    const membership = this.getMembership(citizenId);
    if (!membership) return undefined;
    const home = this.getHome(membership.homeId);
    if (!home) return undefined;
    const members = (
      this.db
        .prepare(`SELECT citizen_id FROM home_memberships WHERE home_id = ? AND status != 'left' ORDER BY citizen_id`)
        .all(membership.homeId) as Array<{ citizen_id: string }>
    ).map((row) => row.citizen_id);
    return { ...membership, dimension: home.dimension, origin: home.origin, entrance: home.entrance, householdChest: home.householdChest, members };
  }

  listHomeMembers(homeId: string): HomeMembership[] {
    const rows = this.db
      .prepare(`SELECT * FROM home_memberships WHERE home_id = ? AND status != 'left' ORDER BY citizen_id`)
      .all(homeId) as MembershipRow[];
    return rows.map(mapMembership);
  }

  bedClaimOwner(bed: Vec3): string | undefined {
    const row = this.db
      .prepare(
        `SELECT citizen_id FROM home_memberships
         WHERE bed_x = ? AND bed_y = ? AND bed_z = ? AND status IN ('active', 'displaced')`,
      )
      .get(Math.floor(bed.x), Math.floor(bed.y), Math.floor(bed.z)) as { citizen_id: string } | undefined;
    return row?.citizen_id;
  }

  personalChestOwner(chest: Vec3): string | undefined {
    const row = this.db
      .prepare(
        `SELECT citizen_id FROM home_memberships
         WHERE personal_chest_x = ? AND personal_chest_y = ? AND personal_chest_z = ?
           AND status IN ('active', 'displaced')`,
      )
      .get(Math.floor(chest.x), Math.floor(chest.y), Math.floor(chest.z)) as { citizen_id: string } | undefined;
    return row?.citizen_id;
  }

  isClaimedPersonalChest(chest: Vec3): boolean {
    return Boolean(this.personalChestOwner(chest));
  }

  writeHomeClaim(input: { home: HomeRecord; membership: HomeMembership; previousHomeId?: string }): void {
    const run = this.db.transaction(() => {
      const existingHome = this.getHome(input.home.id);
      this.db
        .prepare(
          `INSERT INTO homes (
            id, dimension, origin_x, origin_y, origin_z, entrance_x, entrance_y, entrance_z,
            household_chest_x, household_chest_y, household_chest_z, created_at, updated_at
          ) VALUES (
            @id, @dimension, @originX, @originY, @originZ, @entranceX, @entranceY, @entranceZ,
            @householdChestX, @householdChestY, @householdChestZ, @createdAt, @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            dimension = excluded.dimension,
            origin_x = excluded.origin_x,
            origin_y = excluded.origin_y,
            origin_z = excluded.origin_z,
            entrance_x = COALESCE(excluded.entrance_x, homes.entrance_x),
            entrance_y = COALESCE(excluded.entrance_y, homes.entrance_y),
            entrance_z = COALESCE(excluded.entrance_z, homes.entrance_z),
            household_chest_x = COALESCE(excluded.household_chest_x, homes.household_chest_x),
            household_chest_y = COALESCE(excluded.household_chest_y, homes.household_chest_y),
            household_chest_z = COALESCE(excluded.household_chest_z, homes.household_chest_z),
            updated_at = excluded.updated_at`,
        )
        .run({
          id: input.home.id,
          dimension: input.home.dimension,
          originX: Math.floor(input.home.origin.x),
          originY: Math.floor(input.home.origin.y),
          originZ: Math.floor(input.home.origin.z),
          entranceX: input.home.entrance ? Math.floor(input.home.entrance.x) : null,
          entranceY: input.home.entrance ? Math.floor(input.home.entrance.y) : null,
          entranceZ: input.home.entrance ? Math.floor(input.home.entrance.z) : null,
          householdChestX: input.home.householdChest ? Math.floor(input.home.householdChest.x) : null,
          householdChestY: input.home.householdChest ? Math.floor(input.home.householdChest.y) : null,
          householdChestZ: input.home.householdChest ? Math.floor(input.home.householdChest.z) : null,
          createdAt: existingHome?.createdAt ?? input.home.createdAt,
          updatedAt: input.home.updatedAt,
        });

      this.db
        .prepare(
          `INSERT INTO home_memberships (
            citizen_id, home_id, bed_x, bed_y, bed_z, personal_chest_x, personal_chest_y, personal_chest_z,
            storage_access, status, created_at
          ) VALUES (
            @citizenId, @homeId, @bedX, @bedY, @bedZ, @chestX, @chestY, @chestZ, @access, 'active', @createdAt
          )
          ON CONFLICT(citizen_id) DO UPDATE SET
            home_id = excluded.home_id,
            bed_x = excluded.bed_x,
            bed_y = excluded.bed_y,
            bed_z = excluded.bed_z,
            personal_chest_x = excluded.personal_chest_x,
            personal_chest_y = excluded.personal_chest_y,
            personal_chest_z = excluded.personal_chest_z,
            storage_access = excluded.storage_access,
            status = 'active'`,
        )
        .run({
          citizenId: input.membership.citizenId,
          homeId: input.membership.homeId,
          bedX: Math.floor(input.membership.bed.x),
          bedY: Math.floor(input.membership.bed.y),
          bedZ: Math.floor(input.membership.bed.z),
          chestX: input.membership.personalChest ? Math.floor(input.membership.personalChest.x) : null,
          chestY: input.membership.personalChest ? Math.floor(input.membership.personalChest.y) : null,
          chestZ: input.membership.personalChest ? Math.floor(input.membership.personalChest.z) : null,
          access: input.membership.storageAccess,
          createdAt: input.membership.createdAt,
        });

      this.db.prepare(`UPDATE citizens SET home_id = ? WHERE id = ?`).run(input.membership.homeId, input.membership.citizenId);
    });
    run();
  }

  markHomeDisplaced(citizenId: string, _reason: string): void {
    this.db
      .prepare(`UPDATE home_memberships SET status = 'displaced' WHERE citizen_id = ? AND status = 'active'`)
      .run(citizenId);
  }

  leaveHome(citizenId: string): void {
    const run = this.db.transaction(() => {
      this.db.prepare(`UPDATE home_memberships SET status = 'left' WHERE citizen_id = ? AND status != 'left'`).run(citizenId);
      this.db.prepare(`UPDATE citizens SET home_id = NULL WHERE id = ?`).run(citizenId);
    });
    run();
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
  if (!row.shelter_complete) needs.push("NEED_HOUSING");
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
  personality_json?: string | null;
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
  project_json: string | null;
  workstations_json: string | null;
  storage_contents_json: string | null;
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
    personalityJson: row.personality_json ?? undefined,
  };
}

type HomeRow = {
  id: string;
  dimension: string;
  origin_x: number;
  origin_y: number;
  origin_z: number;
  entrance_x: number | null;
  entrance_y: number | null;
  entrance_z: number | null;
  household_chest_x: number | null;
  household_chest_y: number | null;
  household_chest_z: number | null;
  created_at: string;
  updated_at: string;
};

type MembershipRow = {
  citizen_id: string;
  home_id: string;
  bed_x: number;
  bed_y: number;
  bed_z: number;
  personal_chest_x: number | null;
  personal_chest_y: number | null;
  personal_chest_z: number | null;
  storage_access: HomeMembership["storageAccess"];
  status: HomeMembership["status"];
  created_at: string;
};

function optionalCell(x: number | null, y: number | null, z: number | null): Vec3 | undefined {
  if (x == null || y == null || z == null) return undefined;
  return { x, y, z };
}

function mapHome(row: HomeRow): HomeRecord {
  return {
    id: row.id,
    dimension: row.dimension,
    origin: { x: row.origin_x, y: row.origin_y, z: row.origin_z },
    entrance: optionalCell(row.entrance_x, row.entrance_y, row.entrance_z),
    householdChest: optionalCell(row.household_chest_x, row.household_chest_y, row.household_chest_z),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembership(row: MembershipRow): HomeMembership {
  return {
    citizenId: row.citizen_id,
    homeId: row.home_id,
    bed: { x: row.bed_x, y: row.bed_y, z: row.bed_z },
    personalChest: optionalCell(row.personal_chest_x, row.personal_chest_y, row.personal_chest_z),
    storageAccess: row.storage_access,
    status: row.status,
    createdAt: row.created_at,
  };
}
