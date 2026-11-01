import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig, withAudience, type CitizenRecord, type SimEvent } from "@civ/shared";
import { buildCitizenContextPack } from "./citizen-context.js";
import { applyCommunityConfig } from "./community-config.js";
import { CivilizationStore, type CommunityAudit } from "./store.js";

/**
 * SEC-001 round 3: owner policy "no historical data deleted automatically".
 * Quarantine FLAGS facts in place; legacy migration = backup -> dry-run report -> apply flags; no row is ever
 * moved or removed by migration or by membership removal.
 */
const READERS = ["GPT-A", "GPT-B", "Claude-A", "Claude-B"] as const;
const COMMUNITIES_JSON = JSON.stringify([
  { id: "gpt", memberIds: ["GPT-A", "GPT-B"] },
  { id: "claude", memberIds: ["Claude-A", "Claude-B"] },
]);
const config = loadConfig({
  DEMO_PROFILE: "none",
  SIM_CITIZEN_COUNT: "4",
  DEMO_BULLETIN_TARGET_TOKENS: "400",
  LLM_PROVIDER: "none",
  LLM_ENABLED: "false",
  CLOUD_LLM_ENABLED: "false",
  COMMUNITIES_JSON,
});
const AUDIT: CommunityAudit = { actor: "orchestrator-config", reason: "test" };
const SECRET = "ROUND3-SECRET-9191";

const tmpDirs: string[] = [];
const stores: CivilizationStore[] = [];
const dbPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "sec001r3-"));
  tmpDirs.push(dir);
  return join(dir, "civ.db");
};
const open = (path: string) => {
  const s = new CivilizationStore(path);
  stores.push(s);
  return s;
};
afterAll(() => {
  for (const s of stores) {
    try {
      s.close();
    } catch {
      /* closed */
    }
  }
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});
const record = (id: string): CitizenRecord => ({ id, name: id, minecraftUsername: id.replace(/-/g, "_"), createdAt: "2026-10-31T00:00:00.000Z", status: "online" });
let tick = 0;
const evt = (id: string, payload: Record<string, unknown>, citizenId = "GPT-A", type: SimEvent["type"] = "ConversationOccurred"): SimEvent => ({
  id,
  type,
  timestamp: new Date(Date.UTC(2026, 9, 31, 1, 0, 0, tick++)).toISOString(),
  citizenId,
  payload,
});

/** Every row of every table (the whole database), for exact before/after comparison. */
function dumpAll(db: Database.Database, tables?: string[]): Record<string, unknown[]> {
  const names =
    tables ??
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map((t) => t.name);
  return Object.fromEntries(names.map((n) => [n, db.prepare(`SELECT * FROM "${n}" ORDER BY rowid`).all()]));
}
const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/**
 * A database that looks like it predates the quarantine migration: a directory exists (so membership can be
 * checked), facts of every kind are stored, and there are no flag tables, no marker and no provenance columns' values.
 */
function legacyDb(): string {
  const path = dbPath();
  const store = open(path);
  for (const id of READERS) store.upsertCitizen(record(id));
  applyCommunityConfig(store, config);
  store.appendEvent(evt("private-claude-a", { message: "claude-a private", visibility: { class: "actor_private" } }, "Claude-A"));
  store.appendEvent(evt("gpt-secret", withAudience({ message: SECRET }, "settlement_public", { scope: "community", communityId: "gpt" })));
  store.appendEvent(evt("unlabeled", { message: "old broadcast", visibility: { class: "world_public" } }));
  store.appendEvent(evt("world-ok", withAudience({ message: "hello world" }, "world_public", { scope: "world" })));
  const fact = (id: string, citizenId: string, factKey: string, content: string) =>
    store.upsertPersistentFact({ id, citizenId, factKey, content, createdAt: "2026-10-30T00:00:00.000Z" });
  fact("f-private-ok", "Claude-A", "event:private-claude-a", "my own private fact"); // actor_private, reader is the actor -> keep
  fact("f-private-leak", "GPT-A", "event:private-claude-a", SECRET + " private-leak"); // someone else's private event -> flag
  fact("f-gpt-member", "GPT-A", "event:gpt-secret", "member fact"); // community member -> keep
  fact("f-gpt-outsider", "Claude-A", "event:gpt-secret", SECRET); // not a member -> flag
  fact("f-unlabeled", "Claude-B", "event:unlabeled", "unlabeled fact"); // no audience -> flag
  fact("f-orphan", "GPT-B", "event:ghost", "orphan fact"); // event gone -> flag
  fact("f-world", "GPT-B", "event:world-ok", "world fact"); // verified world audience, reader known -> keep
  fact("f-note", "Claude-A", "note:home", "my home is here"); // not event-derived -> untouched
  const mem = (id: string, citizenId: string, content: string) =>
    store.addMemory({ id, citizenId, kind: "episodic", content, importance: 0.5, createdAt: "2026-10-30T00:00:00.000Z" });
  mem("m-tainted", "Claude-A", `I overheard: ${SECRET} (from the gpt team)`); // contains a flagged fact's text -> flag
  mem("m-clean", "Claude-A", "Chopped wood near the river");
  mem("m-other-citizen", "Claude-B", `unrelated to ${SECRET}`); // Claude-B's flagged fact is a different text -> keep
  store.markEventsDelivered("Claude-A", ["gpt-secret", "world-ok"]); // gpt-secret delivery is a leak
  store.markEventsDelivered("GPT-A", ["unlabeled", "gpt-secret"]);
  store.close();
  const raw = new Database(path);
  raw.exec(`DROP TABLE citizen_persistent_fact_flags; DROP TABLE citizen_event_delivery_flags; DROP TABLE IF EXISTS citizen_memory_flags; UPDATE citizen_persistent_facts SET audience = NULL, source_event_id = NULL;`);
  raw.prepare(`DELETE FROM sim_meta WHERE key = 'sec001_fact_flags_v1'`).run();
  raw.close();
  return path;
}
const backups = (path: string) => readdirSync(dirname(path)).filter((f) => f.includes(".pre-sec001-") && f.endsWith(".bak"));
const FLAGGED = ["f-gpt-outsider", "f-orphan", "f-private-leak", "f-unlabeled"];

describe("legacy migration: backup -> dry run -> flags, never a delete", () => {
  it("flags exactly the unauthorized facts, keeps actor_private/member/world/non-event facts, and removes NO row from any table", () => {
    const path = legacyDb();
    const raw = new Database(path, { readonly: true });
    const before = dumpAll(raw);
    raw.close();
    const store = open(path);
    // no row count decreased anywhere, and every pre-existing fact/event/delivery row is byte-identical
    const after = dumpAll(store.db);
    for (const table of Object.keys(before)) {
      if (["sim_meta", "citizen_persistent_facts"].includes(table)) continue;
      expect(after[table], table).toEqual(before[table]);
    }
    const strip = (rows: unknown[]) => (rows as Array<Record<string, unknown>>).map(({ audience: _a, source_event_id: _s, ...rest }) => rest);
    expect(strip(after.citizen_persistent_facts!)).toEqual(strip(before.citizen_persistent_facts!));
    expect(count(store.db, "citizen_persistent_facts")).toBe(8);
    expect(count(store.db, "events")).toBe(4);
    expect(count(store.db, "citizen_event_delivery")).toBe(4);
    // decisions
    expect(store.listQuarantinedFacts().map((q) => q.id).sort()).toEqual(FLAGGED);
    expect(store.listQuarantinedFacts().every((q) => q.source === "legacy-migration")).toBe(true);
    expect(store.listQuarantinedFacts().find((q) => q.id === "f-gpt-outsider")?.content).toBe(SECRET); // content stays in place
    const visible = (id: string) => store.listPersistentFacts(id, 50).map((f) => f.id).sort();
    expect(visible("Claude-A")).toEqual(["f-note", "f-private-ok"]);
    expect(visible("GPT-A")).toEqual(["f-gpt-member"]);
    expect(visible("GPT-B")).toEqual(["f-world"]);
    expect(visible("Claude-B")).toEqual([]);
    // deliveries are re-checked against the source event too (flagged for audit, never removed)
    expect(store.listFlaggedDeliveries().map((d) => `${d.citizenId}:${d.eventId}`)).toEqual(["Claude-A:gpt-secret", "GPT-A:unlabeled"]);
  });

  it("takes a verified backup of the database file BEFORE any flag is written, plus a dry-run report without fact content", () => {
    const path = legacyDb();
    const raw = new Database(path, { readonly: true });
    const before = dumpAll(raw, ["citizen_persistent_facts", "events", "citizen_event_delivery"]);
    raw.close();
    open(path);
    const files = backups(path);
    expect(files).toHaveLength(1);
    const bak = join(dirname(path), files[0]!);
    const copy = new Database(bak, { readonly: true });
    // the backup is the pre-migration state: same rows, and no flag exists in it yet
    expect(dumpAll(copy, ["citizen_persistent_facts", "events", "citizen_event_delivery"])).toEqual(before);
    expect(count(copy, "citizen_persistent_fact_flags")).toBe(0);
    copy.close();
    const reportFile = `${bak}.dry-run-report.json`;
    expect(existsSync(reportFile)).toBe(true);
    const text = readFileSync(reportFile, "utf8");
    const report = JSON.parse(text);
    expect(report.facts.toFlag.map((f: { factId: string }) => f.factId).sort()).toEqual(FLAGGED);
    expect(text).not.toContain(SECRET); // reports never copy fact content
  });

  it("dry run does not mutate anything; apply only inserts flags and is idempotent", () => {
    const path = legacyDb();
    const store = open(path);
    store.db.exec(`DELETE FROM citizen_persistent_fact_flags; DELETE FROM citizen_event_delivery_flags`);
    const before = dumpAll(store.db);
    const report = store.dryRunLegacyFactMigration("2026-10-31T12:00:00.000Z");
    const again = store.dryRunLegacyFactMigration("2026-10-31T12:00:00.000Z");
    expect(dumpAll(store.db)).toEqual(before); // byte-for-byte identical database
    expect(again).toEqual(report);
    expect(report.facts.examined).toBe(7);
    expect(report.facts.kept).toBe(3);
    expect(report.facts.toFlag.map((f) => f.factId).sort()).toEqual(FLAGGED);
    expect(report.deliveries).toMatchObject({ examined: 4 });
    expect(JSON.stringify(report)).not.toContain(SECRET);
    // not yet flagged => not yet hidden
    expect(store.listPersistentFacts("Claude-A", 50).map((f) => f.id)).toContain("f-gpt-outsider");
    const factsBefore = dumpAll(store.db, ["citizen_persistent_facts", "events", "citizen_event_delivery"]);
    expect(store.applyLegacyFactMigration(report)).toEqual({ factsFlagged: 4, deliveriesFlagged: 2 });
    expect(store.applyLegacyFactMigration(report)).toEqual({ factsFlagged: 0, deliveriesFlagged: 0 });
    expect(dumpAll(store.db, ["citizen_persistent_facts", "events", "citizen_event_delivery"])).toEqual(factsBefore);
    expect(store.listPersistentFacts("Claude-A", 50).map((f) => f.id)).not.toContain("f-gpt-outsider");
  });

  it("restart: no second migration, no second backup, flags and rows persist, hidden facts stay out of the prompt surface", () => {
    const path = legacyDb();
    open(path).close();
    expect(backups(path)).toHaveLength(1);
    const second = open(path);
    const snapshot = dumpAll(second.db);
    second.close();
    const third = open(path);
    expect(dumpAll(third.db)).toEqual(snapshot);
    expect(backups(path)).toHaveLength(1);
    expect(third.listQuarantinedFacts().map((q) => q.id).sort()).toEqual(FLAGGED);
    expect(count(third.db, "citizen_persistent_facts")).toBe(8);
    for (const id of READERS) {
      const pack = buildCitizenContextPack({ store: third, config, citizenId: id });
      const surface = JSON.stringify({ pack, facts: third.listPersistentFacts(id, 100) });
      if (id !== "GPT-A" && id !== "GPT-B") expect(surface).not.toContain(SECRET);
    }
  });

  it("a flagged fact is never overwritten by a later upsert (content kept for review, still hidden)", () => {
    const store = open(legacyDb());
    store.upsertPersistentFact({ id: "other-id", citizenId: "Claude-B", factKey: "event:unlabeled", content: "re-derived" });
    expect(store.listQuarantinedFacts("Claude-B")).toEqual([expect.objectContaining({ id: "f-unlabeled", content: "unlabeled fact" })]);
    expect(store.listPersistentFacts("Claude-B", 50)).toEqual([]);
    expect(count(store.db, "citizen_persistent_facts")).toBe(8);
  });

  it("a fresh database makes no backup and flags nothing; an in-memory database works", () => {
    const path = dbPath();
    const store = open(path);
    expect(backups(path)).toEqual([]);
    expect(store.listQuarantinedFacts()).toEqual([]);
    const mem = open(":memory:");
    expect(mem.listQuarantinedFacts()).toEqual([]);
  });
});

describe("removeCommunityMember flags in place", () => {
  function setup(path: string) {
    const store = open(path);
    for (const id of READERS) store.upsertCitizen(record(id));
    applyCommunityConfig(store, config);
    store.appendEvent(evt("gpt-plan", withAudience({ message: SECRET }, "settlement_public", { scope: "community", communityId: "gpt" })));
    buildCitizenContextPack({ store, config, citizenId: "GPT-B" }); // GPT-B stores the urgent fact with its audience
    store.upsertPersistentFact({ id: "mine", citizenId: "GPT-B", factKey: "note:mine", content: "my own note" });
    return store;
  }
  it("no fact row is moved or deleted: counts, ids and content are unchanged; reads exclude the flagged fact", () => {
    const path = dbPath();
    const store = setup(path);
    const rowsBefore = dumpAll(store.db, ["citizen_persistent_facts", "events", "citizen_event_delivery"]);
    expect(store.listPersistentFacts("GPT-B", 50).map((f) => f.factKey).sort()).toEqual(["event:gpt-plan", "note:mine"]);
    expect(store.removeCommunityMember("gpt", "GPT-B", { actor: "orchestrator-config", reason: "left" })).toBe(true);
    expect(dumpAll(store.db, ["citizen_persistent_facts", "events", "citizen_event_delivery"])).toEqual(rowsBefore);
    expect(count(store.db, "citizen_persistent_facts")).toBe(2);
    expect(store.listPersistentFacts("GPT-B", 50).map((f) => f.factKey)).toEqual(["note:mine"]);
    expect(store.listQuarantinedFacts("GPT-B")).toEqual([
      expect.objectContaining({ factKey: "event:gpt-plan", content: expect.stringContaining(SECRET), reason: "membership of gpt removed", source: "membership-removal" }),
    ]);
    expect(JSON.stringify(buildCitizenContextPack({ store, config, citizenId: "GPT-B" }))).not.toContain(SECRET);
    // restart
    store.close();
    const again = open(path);
    expect(count(again.db, "citizen_persistent_facts")).toBe(2);
    expect(again.listQuarantinedFacts("GPT-B")).toHaveLength(1);
    expect(again.listPersistentFacts("GPT-B", 50).map((f) => f.factKey)).toEqual(["note:mine"]);
    expect(JSON.stringify(buildCitizenContextPack({ store: again, config, citizenId: "GPT-B" }))).not.toContain(SECRET);
    expect(backups(path)).toEqual([]); // a fresh DB never needed a legacy backup
  });
  it("other members' facts and another community's facts are not flagged", () => {
    const store = setup(dbPath());
    buildCitizenContextPack({ store, config, citizenId: "GPT-A" });
    store.removeCommunityMember("gpt", "GPT-B", AUDIT);
    expect(store.listQuarantinedFacts("GPT-A")).toEqual([]);
    expect(store.listPersistentFacts("GPT-A", 50).map((f) => f.factKey)).toContain("event:gpt-plan");
  });
});


describe("round 3 review fixes (F1, F2, memories, config revocation, required directory)", () => {
  it("F1: a re-written fact with the same (citizen, key) and a NEW id stays quarantined (row survives, content untouched)", () => {
    const store = open(dbPath());
    for (const id of READERS) store.upsertCitizen(record(id));
    applyCommunityConfig(store, config);
    store.appendEvent(evt("gpt-news", withAudience({ message: "gpt news" }, "settlement_public", { scope: "community", communityId: "gpt" })));
    store.upsertPersistentFact({
      id: "fact-1", citizenId: "GPT-B", factKey: "event:gpt-news", content: "gpt news " + SECRET,
      audience: { scope: "community", communityId: "gpt" }, sourceEventId: "gpt-news",
    });
    expect(store.removeCommunityMember("gpt", "GPT-B", AUDIT)).toBe(true);
    expect(store.listPersistentFacts("GPT-B")).toEqual([]);
    // same key, different id: ON CONFLICT folds it into the flagged row; still hidden, content untouched
    store.upsertPersistentFact({ id: "fact-2", citizenId: "GPT-B", factKey: "event:gpt-news", content: "REWRITTEN" });
    expect(store.listPersistentFacts("GPT-B")).toEqual([]);
    expect(store.listQuarantinedFacts().map((q) => [q.id, q.content])).toEqual([["fact-1", "gpt news " + SECRET]]);
    // the row is gone from the table by an outside actor and a new id is written: the flag still matches by (citizen, key)
    store.db.prepare(`DELETE FROM citizen_persistent_facts WHERE id = 'fact-1'`).run();
    store.upsertPersistentFact({ id: "fact-3", citizenId: "GPT-B", factKey: "event:gpt-news", content: "again" });
    expect(count(store.db, "citizen_persistent_facts")).toBe(1);
    expect(store.listPersistentFacts("GPT-B")).toEqual([]);
    // a different key is unaffected
    store.upsertPersistentFact({ id: "fact-4", citizenId: "GPT-B", factKey: "note:x", content: "fine" });
    expect(store.listPersistentFacts("GPT-B").map((f) => f.id)).toEqual(["fact-4"]);
  });

  it("F2: migration never stamps an audience on a fact it refused, and keeps provenance for every event fact", () => {
    const store = open(legacyDb());
    const row = (id: string) =>
      store.db.prepare(`SELECT audience, source_event_id FROM citizen_persistent_facts WHERE id = ?`).get(id) as { audience: string | null; source_event_id: string | null };
    for (const id of FLAGGED) expect(row(id).audience, id).toBeNull();
    expect(row("f-gpt-outsider").source_event_id).toBe("gpt-secret"); // provenance kept for audit
    expect(row("f-orphan").source_event_id).toBe("ghost");
    expect(JSON.parse(row("f-gpt-member").audience ?? "null")).toEqual({ scope: "community", communityId: "gpt" });
    expect(row("f-private-ok").audience).toBeNull(); // actor_private carries no broadcast audience
    expect(store.listPersistentFacts("Claude-A").map((f) => f.id)).toContain("f-private-ok");
  });

  it("memories: those quoting a flagged fact are excluded at read time, in place; the dry run lists them without content", () => {
    const path = legacyDb();
    const dry = (() => {
      // a fresh open would apply; compute the report from a store whose marker is already set
      const s = open(path);
      return s.dryRunLegacyFactMigration();
    })();
    expect(JSON.stringify(dry)).not.toContain(SECRET);
    const store = open(path);
    expect(count(store.db, "memories")).toBe(3); // nothing deleted
    expect(store.listFlaggedMemoryIds()).toEqual(["m-tainted"]);
    expect(store.getMemories("Claude-A").map((m) => m.id)).toEqual(["m-clean"]);
    expect(store.getMemories("Claude-B").map((m) => m.id)).toEqual(["m-other-citizen"]);
  });

  it("memories: membership removal flags memories quoting the facts it flagged", () => {
    const store = open(dbPath());
    for (const id of READERS) store.upsertCitizen(record(id));
    applyCommunityConfig(store, config);
    store.upsertPersistentFact({ id: "f", citizenId: "GPT-B", factKey: "event:e1", content: "the cache is behind the red barn", audience: { scope: "community", communityId: "gpt" }, sourceEventId: "e1" });
    store.addMemory({ id: "m1", citizenId: "GPT-B", kind: "social", content: "told them the cache is behind the red barn", importance: 0.5, createdAt: "2026-10-30T00:00:00.000Z" });
    store.addMemory({ id: "m2", citizenId: "GPT-B", kind: "social", content: "likes oak", importance: 0.5, createdAt: "2026-10-30T00:00:00.000Z" });
    store.removeCommunityMember("gpt", "GPT-B", AUDIT);
    expect(count(store.db, "memories")).toBe(2);
    expect(store.getMemories("GPT-B").map((m) => m.id)).toEqual(["m2"]);
  });

  it("COMMUNITIES_JSON: dropping a member revokes membership through the audited removal path and flags their community facts", () => {
    const store = open(dbPath());
    for (const id of READERS) store.upsertCitizen(record(id));
    applyCommunityConfig(store, config);
    store.upsertPersistentFact({ id: "f", citizenId: "GPT-B", factKey: "event:e1", content: "gpt-only knowledge", audience: { scope: "community", communityId: "gpt" }, sourceEventId: "e1" });
    const smaller = { COMMUNITIES_JSON: JSON.stringify([{ id: "gpt", memberIds: ["GPT-A"] }, { id: "claude", memberIds: ["Claude-A", "Claude-B"] }]) };
    const result = applyCommunityConfig(store, smaller);
    expect(result.membersRemoved).toBe(1);
    expect(store.getCommunityDirectory().communityOf("GPT-B")).toBeUndefined();
    const removal = store.listCommunityAudit().filter((a) => a.action === "remove_member");
    expect(removal).toEqual([expect.objectContaining({ communityId: "gpt", citizenId: "GPT-B", actor: "orchestrator-config", reason: "member removed from COMMUNITIES_JSON" })]);
    expect(store.listPersistentFacts("GPT-B")).toEqual([]);
    expect(count(store.db, "citizen_persistent_facts")).toBe(1);
    // idempotent, and re-listing the removed member does not silently re-admit them (tombstone)
    expect(applyCommunityConfig(store, smaller).membersRemoved).toBe(0);
    applyCommunityConfig(store, { COMMUNITIES_JSON });
    expect(store.getCommunityDirectory().communityOf("GPT-B")).toBeUndefined();
  });

  it("buildCitizenBulletin: directory is required by type, and an untyped caller that omits it never gets a community broadcast", async () => {
    const { buildCitizenBulletin, createCommunityDirectory } = await import("@civ/shared");
    const events = [evt("w", withAudience({ message: "hello" }, "world_public", { scope: "world" })), evt("s", withAudience({ message: "gpt only" }, "settlement_public", { scope: "community", communityId: "gpt" }))];
    const base = { readerCitizenId: "GPT-A", events, alreadyDeliveredIds: new Set<string>() };
    // @ts-expect-error directory is required
    const withoutDirectory = buildCitizenBulletin({ ...base });
    expect(withoutDirectory.deliveredEventIds).not.toContain("s"); // untyped-caller fallback: settlement_public fails closed
    const withDirectory = buildCitizenBulletin({ ...base, directory: createCommunityDirectory([{ id: "gpt", memberIds: ["GPT-A"] }]) });
    expect(withDirectory.deliveredEventIds.sort()).toEqual(["s", "w"]);
  });
});
