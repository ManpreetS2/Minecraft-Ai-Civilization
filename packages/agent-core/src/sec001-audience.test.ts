import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildCitizenBulletin,
  loadConfig,
  withAudience,
  type CitizenRecord,
  type SimEvent,
} from "@civ/shared";
import { buildCitizenContextPack } from "./citizen-context.js";
import { applyCommunityConfig } from "./community-config.js";
import { shareEventWithCommunity } from "./community-share.js";
import { CivilizationStore, type CommunityAudit } from "./store.js";

/**
 * SEC-001 part A, against a REAL store: four readers (two communities of two), restart, the migration,
 * write-time re-check, share-by-id, newest-N events and orchestrator-only membership writes.
 */
const READERS = ["GPT-A", "GPT-B", "Claude-A", "Claude-B"] as const;
const SECRET = "unshared settlement at x=137 z=-211";
const COMMUNITIES_JSON = JSON.stringify([
  { id: "gpt", name: "GPT community", memberIds: ["GPT-A", "GPT-B"] },
  { id: "claude", name: "Claude community", memberIds: ["Claude-A", "Claude-B"] },
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

const tmpDirs: string[] = [];
const stores: CivilizationStore[] = [];
function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sec001-"));
  tmpDirs.push(dir);
  return join(dir, "civ.db");
}
function open(path: string): CivilizationStore {
  const store = new CivilizationStore(path);
  stores.push(store);
  return store;
}
afterAll(() => {
  for (const s of stores) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

const record = (id: string): CitizenRecord => ({
  id,
  name: id,
  minecraftUsername: id.replace(/-/g, "_"),
  createdAt: "2026-10-31T00:00:00.000Z",
  status: "online",
});
let tick = 0;
const evt = (id: string, payload: Record<string, unknown>, citizenId = "GPT-A"): SimEvent => ({
  id,
  type: "ConversationOccurred",
  timestamp: new Date(Date.UTC(2026, 9, 31, 0, 0, 0, tick++)).toISOString(),
  citizenId,
  payload,
});

/** Citizens + the directory seeded through the orchestrator-config path (applyCommunityConfig). */
function seed(path: string): CivilizationStore {
  const store = open(path);
  for (const id of READERS) store.upsertCitizen(record(id));
  applyCommunityConfig(store, config, "2026-01-01T00:00:00.000Z");
  return store;
}

function deliveredFor(store: CivilizationStore, reader: string): string[] {
  return buildCitizenBulletin({
    readerCitizenId: reader,
    events: store.listEventsAscending(400),
    alreadyDeliveredIds: new Set(),
    directory: store.getCommunityDirectory(),
  }).deliveredEventIds.sort();
}

const gptOnly = () => evt("gpt-only", withAudience({ message: SECRET }, "settlement_public", { scope: "community", communityId: "gpt" }));
const claudeOnly = () => evt("claude-only", withAudience({ message: "claude orchard at x=9" }, "settlement_public", { scope: "community", communityId: "claude" }));
const everyone = () => evt("everyone", withAudience({ message: "rain is coming" }, "world_public", { scope: "world" }));
const unlabeledPublic = () => evt("unlabeled-public", { message: "no audience", visibility: { class: "world_public" } });
const noVisibility = () => evt("no-visibility", { message: "no visibility at all" });
const ghost = () => evt("ghost", withAudience({ message: "ghost" }, "settlement_public", { scope: "community", communityId: "ghost" }));
const settlementNoAudience = () => evt("settlement-no-audience", { message: SECRET, visibility: { class: "settlement_public" } });
const observer = () => evt("observer", { message: "observer", visibility: { class: "observer_only", audience: { scope: "world" } } });
const ALL = () => [gptOnly(), claudeOnly(), everyone(), unlabeledPublic(), noVisibility(), ghost(), settlementNoAudience(), observer()];

describe("SEC-001 real store: four readers", () => {
  it("each reader gets exactly their community's events plus explicit world announcements", () => {
    const store = seed(dbPath());
    for (const e of ALL()) store.appendEvent(e);
    expect(deliveredFor(store, "GPT-A")).toEqual(["everyone", "gpt-only"]);
    expect(deliveredFor(store, "GPT-B")).toEqual(["everyone", "gpt-only"]);
    expect(deliveredFor(store, "Claude-A")).toEqual(["claude-only", "everyone"]);
    expect(deliveredFor(store, "Claude-B")).toEqual(["claude-only", "everyone"]);
    expect(deliveredFor(store, "Stranger")).toEqual([]); // not in the directory
  });

  it("an empty directory (no communities yet) delivers nothing to anyone, world announcements included", () => {
    const store = open(dbPath());
    for (const id of READERS) store.upsertCitizen(record(id));
    for (const e of ALL()) store.appendEvent(e);
    for (const r of READERS) expect(deliveredFor(store, r)).toEqual([]);
  });

  it("a citizen can belong to only one community", () => {
    const store = seed(dbPath());
    expect(() => store.addCommunityMember("claude", "GPT-A", AUDIT)).toThrow(/already belongs/);
    expect(() => store.upsertCommunity(" bad ", "x", AUDIT)).toThrow();
    expect(store.addCommunityMember("gpt", "GPT-A", AUDIT)).toBe(false); // idempotent for the same community
    expect(store.getCommunityDirectory().communityOf("GPT-A")).toBe("gpt");
  });

  it("buildCitizenContextPack: text, delivered ids and persistent facts stay inside the audience", () => {
    const store = seed(dbPath());
    for (const e of ALL()) store.appendEvent(e);
    const packs = Object.fromEntries(READERS.map((r) => [r, buildCitizenContextPack({ store, config, citizenId: r })]));
    for (const r of READERS) {
      const gpt = r.startsWith("GPT");
      const pack = packs[r]!;
      expect(pack.bulletin.text.includes(SECRET)).toBe(gpt);
      expect(pack.promptExtras.bulletin?.includes("claude orchard")).toBe(!gpt);
      expect([...store.getDeliveredEventIds(r)].sort()).toEqual(gpt ? ["everyone", "gpt-only"] : ["claude-only", "everyone"]);
      const facts = store.listPersistentFacts(r).map((f) => f.content).join("\n");
      expect(facts.includes(SECRET)).toBe(gpt); // urgency>=70 lines become persistent facts, only authorized ones
      expect(facts.includes("claude orchard")).toBe(!gpt);
    }
  });
});

describe("SEC-001 real store: restart", () => {
  it("directory, decisions and per-reader delivery survive a restart; a later share reaches only the receiver", () => {
    const path = dbPath();
    const a = seed(path);
    for (const e of ALL()) a.appendEvent(e);
    buildCitizenContextPack({ store: a, config, citizenId: "GPT-A" });
    buildCitizenContextPack({ store: a, config, citizenId: "Claude-A" });
    a.close();

    const b = open(path);
    expect(b.getCommunityDirectory().membersOf("gpt")).toEqual(["GPT-A", "GPT-B"]);
    expect(b.getCommunityDirectory().membersOf("claude")).toEqual(["Claude-A", "Claude-B"]);
    // delivery checkpoints are per reader and persisted
    expect([...b.getDeliveredEventIds("GPT-A")].sort()).toEqual(["everyone", "gpt-only"]);
    expect([...b.getDeliveredEventIds("GPT-B")]).toEqual([]);
    const again = buildCitizenContextPack({ store: b, config, citizenId: "GPT-A" });
    expect(again.bulletin.deliveredEventIds).toEqual([]);
    // decisions identical after restart
    expect(deliveredFor(b, "Claude-B")).toEqual(["claude-only", "everyone"]);
    expect(deliveredFor(b, "GPT-B")).toEqual(["everyone", "gpt-only"]);

    // explicit cross-community sharing: GPT-A (who can read gpt-only) tells the claude community something
    const shared = shareEventWithCommunity(
      b,
      { actingCitizenId: "GPT-A" },
      { sourceEventId: "gpt-only", toCommunityId: "claude", message: "we would like to trade wood" },
    );
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    const sharedId = shared.event.id;
    expect(deliveredFor(b, "Claude-A")).toContain(sharedId);
    expect(deliveredFor(b, "Claude-B")).toContain(sharedId);
    expect(deliveredFor(b, "GPT-B")).not.toContain(sharedId);
    const claudeText = buildCitizenContextPack({ store: b, config, citizenId: "Claude-B" }).bulletin.text;
    expect(claudeText).toContain("trade wood");
    expect(claudeText).not.toContain(SECRET);
    b.close();

    const c = open(path);
    expect(deliveredFor(c, "Claude-B")).toContain(sharedId);
    expect(deliveredFor(c, "GPT-B")).not.toContain(sharedId);
    expect([...c.getDeliveredEventIds("Claude-B")]).toContain(sharedId);
  });
});

describe("SEC-001 real store: migration of a pre-SEC-001 database", () => {
  function legacyDb(): { path: string } {
    const path = dbPath();
    const store = seed(path);
    // events written before the migration: one unlabeled, one that happens to carry an audience already
    store.appendEvent(unlabeledPublic());
    store.appendEvent(everyone());
    store.appendEvent(settlementNoAudience());
    for (const [eventId, content] of [
      ["unlabeled-public", "unlabeled fact"],
      ["everyone", "labeled fact"],
      ["settlement-no-audience", SECRET],
      ["missing-event", "orphan fact"],
    ] as const) {
      store.upsertPersistentFact({ id: `fact-${eventId}`, citizenId: "Claude-A", factKey: `event:${eventId}`, content });
    }
    store.upsertPersistentFact({ id: "fact-plain", citizenId: "Claude-A", factKey: "note:home", content: "my home is here" });
    store.close();
    // make it look like a database from before the migration ever ran
    const raw = new Database(path);
    raw.exec(
      `DROP TABLE community_members; DROP TABLE communities; DROP TABLE citizen_persistent_fact_flags; DROP TABLE citizen_event_delivery_flags; DROP TABLE community_audit;
       ALTER TABLE citizen_persistent_facts DROP COLUMN audience; ALTER TABLE citizen_persistent_facts DROP COLUMN source_event_id;`,
    );
    raw.prepare(`DELETE FROM sim_meta WHERE key = 'sec001_fact_flags_v1'`).run();
    raw.close();
    return { path };
  }

  it("creates the tables, quarantines facts whose source event has no verified audience, keeps the rest", () => {
    const { path } = legacyDb();
    const store = open(path);
    const live = store.listPersistentFacts("Claude-A").map((f) => f.factKey).sort();
    // the fixture drops the persisted directory, so even the world-labelled fact cannot be verified for its reader: fail closed
    expect(live).toEqual([]); // source-free legacy notes are now quarantined too
    const quarantined = store.listQuarantinedFacts("Claude-A");
    expect(quarantined.map((q) => q.factKey).sort()).toEqual(["event:everyone", "event:missing-event", "event:settlement-no-audience", "event:unlabeled-public", "note:home"]);
    expect(quarantined.find((q) => q.factKey === "event:settlement-no-audience")?.content).toBe(SECRET); // kept for review, not live
    expect(quarantined.find((q) => q.factKey === "event:missing-event")?.reason).toMatch(/not found/);
    // old events fail closed for everyone, even with a fresh directory
    applyCommunityConfig(store, config, "2026-01-01T00:00:00.000Z");
    expect(deliveredFor(store, "Claude-A")).toEqual(["everyone"]); // only the already-labeled one; unlabeled/old ones stay dark
    expect(store.getCommunityDirectory().membersOf("claude")).toEqual(["Claude-A", "Claude-B"]);
  });

  it("runs once: reopening neither re-flags new facts nor loses flagged ones, and a flagged fact is never overwritten", () => {
    const { path } = legacyDb();
    open(path).close();
    const second = open(path);
    second.upsertPersistentFact({ id: "late", citizenId: "Claude-A", factKey: "event:unlabeled-public", content: "re-derived later" });
    second.appendEvent({ id: "brand-new", type: "TaskCompleted", timestamp: new Date().toISOString(), citizenId: "Claude-A",
      payload: { summary: "new fact", visibility: { class: "actor_private" } } });
    second.upsertPersistentFact({ id: "late2", citizenId: "Claude-A", factKey: "event:brand-new", content: "new fact" });
    second.close();
    const third = open(path);
    // fail closed: the flagged row stays hidden (and keeps its original content) until someone releases it manually
    expect(third.listPersistentFacts("Claude-A").map((f) => f.factKey)).not.toContain("event:unlabeled-public");
    expect(third.listPersistentFacts("Claude-A").map((f) => f.factKey)).toContain("event:brand-new");
    expect(third.listQuarantinedFacts("Claude-A")).toHaveLength(5);
    expect(third.listQuarantinedFacts("Claude-A").find((q) => q.factKey === "event:unlabeled-public")?.content).toBe("unlabeled fact");
  });

  it("a fresh database is migrated without quarantining anything", () => {
    const store = open(dbPath());
    expect(store.listQuarantinedFacts()).toEqual([]);
  });
});
