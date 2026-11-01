import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadConfig, withAudience, type CitizenRecord, type SimEvent } from "@civ/shared";
import { buildCitizenContextPack } from "./citizen-context.js";
import { applyCommunityConfig, seedCommunitiesOnce } from "./community-config.js";
import { shareEventWithCommunity } from "./community-share.js";
import { CivilizationStore, type CommunityAudit } from "./store.js";

/** SEC-001 round 2: share-by-id, write-time re-check, fact provenance, newest-N, orchestrator-only membership. */
const READERS = ["GPT-A", "GPT-B", "Claude-A", "Claude-B"] as const;
const COMMUNITIES_JSON = JSON.stringify([
  { id: "gpt", memberIds: ["GPT-A", "GPT-B"] },
  { id: "claude", memberIds: ["Claude-A", "Claude-B"] },
]);
const baseEnv = {
  DEMO_PROFILE: "none",
  SIM_CITIZEN_COUNT: "4",
  DEMO_BULLETIN_TARGET_TOKENS: "400",
  LLM_PROVIDER: "none",
  LLM_ENABLED: "false",
  CLOUD_LLM_ENABLED: "false",
};
const config = loadConfig({ ...baseEnv, COMMUNITIES_JSON });
const AUDIT: CommunityAudit = { actor: "orchestrator-config", reason: "test" };

const tmpDirs: string[] = [];
const stores: CivilizationStore[] = [];
function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sec001r2-"));
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
      /* closed */
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
const evt = (id: string, payload: Record<string, unknown>, citizenId = "GPT-A", type: SimEvent["type"] = "ConversationOccurred"): SimEvent => ({
  id,
  type,
  timestamp: new Date(Date.UTC(2026, 9, 31, 1, 0, 0, tick++)).toISOString(),
  citizenId,
  payload,
});
function seed(path = dbPath()): CivilizationStore {
  const store = open(path);
  for (const id of READERS) store.upsertCitizen(record(id));
  applyCommunityConfig(store, config);
  return store;
}
const gptSecret = (id = "gpt-secret", msg = "gpt hidden cache at x=137") =>
  evt(id, withAudience({ message: msg }, "settlement_public", { scope: "community", communityId: "gpt" }));
const packOf = (store: CivilizationStore, citizenId: string, events?: SimEvent[]) =>
  buildCitizenContextPack({ store, config, citizenId, events });

describe("fix 1: share loads the source by id and trusts only the acting citizen from context", () => {
  it("a forged source id / forged source object / forged sharer cannot be used", () => {
    const store = seed();
    store.appendEvent(gptSecret());
    const input = { sourceEventId: "gpt-secret", toCommunityId: "claude", message: "hello" };
    // forged: an id that is not in the store
    expect(shareEventWithCommunity(store, { actingCitizenId: "Claude-A" }, { ...input, sourceEventId: "forged-world-announcement" })).toEqual({ ok: false, reason: "source event not found" });
    // forged: caller-supplied source object and claimed sharer are ignored; Claude-A (acting) cannot read the source
    const forged = { ...input, source: evt("gpt-secret", withAudience({ message: "x" }, "world_public", { scope: "world" })), sharerCitizenId: "GPT-A" };
    const res = shareEventWithCommunity(store, { actingCitizenId: "Claude-A" }, forged as never);
    expect(res.ok).toBe(false);
    expect(store.listEventsAscending(50).map((e) => e.id)).toEqual(["gpt-secret"]); // nothing was appended
  });
  it("an authorized share appends a NEW event visible to exactly the receiving community, and survives a restart", () => {
    const path = dbPath();
    const store = seed(path);
    store.appendEvent(gptSecret());
    const res = shareEventWithCommunity(store, { actingCitizenId: "GPT-B" }, { sourceEventId: "gpt-secret", toCommunityId: "claude", message: "trade wood?" });
    expect(res.ok).toBe(true);
    store.close();
    const again = open(path);
    const texts = Object.fromEntries(READERS.map((r) => [r, packOf(again, r).bulletin.text]));
    expect(texts["Claude-A"]).toContain("trade wood?");
    expect(texts["Claude-B"]).toContain("trade wood?");
    expect(texts["GPT-A"]).not.toContain("trade wood?");
    expect(texts["Claude-A"]).not.toContain("hidden cache");
  });
  it("sharing a source the sharer cannot read, or to an unknown community, is refused", () => {
    const store = seed();
    store.appendEvent(evt("unlabeled", { message: "old", visibility: { class: "world_public" } }));
    const ctx = { actingCitizenId: "GPT-A" };
    expect(shareEventWithCommunity(store, ctx, { sourceEventId: "unlabeled", toCommunityId: "claude", message: "m" }).ok).toBe(false);
    store.appendEvent(gptSecret());
    expect(shareEventWithCommunity(store, ctx, { sourceEventId: "gpt-secret", toCommunityId: "ghost", message: "m" }).ok).toBe(false);
    expect(shareEventWithCommunity(store, { actingCitizenId: "nobody" }, { sourceEventId: "gpt-secret", toCommunityId: "claude", message: "m" }).ok).toBe(false);
  });
});

describe("fix 2: write-time re-check, fact provenance columns and the idempotent migration", () => {
  it("a caller-supplied forged copy of an event cannot be delivered, shown or stored: the STORED event decides", () => {
    const store = seed();
    store.appendEvent(evt("e-unlabeled", { message: "STORED has no audience", visibility: { class: "world_public" } }));
    const forgedCopy = evt("e-unlabeled", withAudience({ message: "forged world announcement 7777" }, "world_public", { scope: "world" }), "GPT-A", "SettlementNeedDetected");
    const notStored = evt("e-never-stored", withAudience({ message: "never stored 8888" }, "world_public", { scope: "world" }), "GPT-A", "SettlementNeedDetected");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pack = packOf(store, "Claude-A", [forgedCopy, notStored]);
    warn.mockRestore();
    expect(pack.bulletin.text).not.toContain("7777");
    expect(pack.bulletin.text).not.toContain("8888");
    expect(pack.bulletin.deliveredEventIds).toEqual([]);
    expect([...store.getDeliveredEventIds("Claude-A")]).toEqual([]);
    expect(store.listPersistentFacts("Claude-A")).toEqual([]);
  });
  it("a member removed by the orchestrator gets no delivery and no fact (fresh directory on every pack)", () => {
    const store = seed();
    store.appendEvent(gptSecret("gpt-urgent", "gpt urgent plan"));
    // removal happens before the pack: directory is fresh, so the reader is already outside
    store.removeCommunityMember("gpt", "GPT-B", AUDIT);
    const pack = packOf(store, "GPT-B");
    expect(pack.bulletin.text).not.toContain("gpt urgent plan");
    expect([...store.getDeliveredEventIds("GPT-B")]).toEqual([]);
    expect(store.listPersistentFacts("GPT-B")).toEqual([]);
  });
  it("authorized urgent facts record their audience and source event", () => {
    const store = seed();
    store.appendEvent(gptSecret("gpt-fact", "gpt shared plan"));
    store.appendEvent(evt("private", { message: "my private note", visibility: { class: "actor_private", audienceIds: ["GPT-A"] } }, "GPT-A", "SettlementNeedDetected"));
    packOf(store, "GPT-A");
    const facts = store.listPersistentFacts("GPT-A");
    const shared = facts.find((f) => f.factKey === "event:gpt-fact");
    expect(shared?.audience).toEqual({ scope: "community", communityId: "gpt" });
    expect(shared?.sourceEventId).toBe("gpt-fact");
    const priv = facts.find((f) => f.factKey === "event:private");
    expect(priv?.audience).toBeUndefined(); // private fact: authorized by ownership, no broadcast audience
    expect(priv?.sourceEventId).toBe("private");
  });
  it("the migration adds the columns once, backfills provenance for old facts and is idempotent", () => {
    const path = dbPath();
    const a = seed(path);
    a.appendEvent(gptSecret("old-labeled", "old labeled fact"));
    a.upsertPersistentFact({ id: "f1", citizenId: "GPT-A", factKey: "event:old-labeled", content: "old labeled fact" });
    a.upsertPersistentFact({ id: "f2", citizenId: "GPT-A", factKey: "note:home", content: "home" });
    a.close();
    const raw = new Database(path);
    raw.exec(`ALTER TABLE citizen_persistent_facts DROP COLUMN audience; ALTER TABLE citizen_persistent_facts DROP COLUMN source_event_id;`);
    raw.close();
    for (let i = 0; i < 3; i += 1) {
      const s = open(path); // reopening 3 times must never throw (ALTER is guarded) or change the result
      const facts = Object.fromEntries(s.listPersistentFacts("GPT-A").map((f) => [f.factKey, f]));
      expect(facts["event:old-labeled"]?.audience).toEqual({ scope: "community", communityId: "gpt" });
      expect(facts["event:old-labeled"]?.sourceEventId).toBe("old-labeled");
      expect(facts["note:home"]?.audience).toBeUndefined();
      expect(facts["note:home"]?.sourceEventId).toBeUndefined();
      s.close();
    }
    const inspection = new Database(path, { readonly: true });
    try {
      const cols = inspection.prepare(`PRAGMA table_info(citizen_persistent_facts)`).all() as Array<{ name: string }>;
      expect(cols.filter((c) => c.name === "audience" || c.name === "source_event_id")).toHaveLength(2);
    } finally {
      inspection.close();
    }
  });
});

describe("fix 4: listEventsAscending returns the NEWEST N events, oldest-first", () => {
  it("450 events: default window 400 keeps events 51..450 in ascending order; the newest is never hidden", () => {
    const store = open(dbPath());
    for (let i = 1; i <= 450; i += 1) {
      store.appendEvent({
        id: `ev-${String(i).padStart(3, "0")}`,
        type: "ConversationOccurred",
        timestamp: new Date(Date.UTC(2026, 9, 31, 2, 0, i)).toISOString(),
        payload: { n: i },
      });
    }
    const last400 = store.listEventsAscending(400);
    expect(last400).toHaveLength(400);
    expect(last400[0]!.id).toBe("ev-051");
    expect(last400.at(-1)!.id).toBe("ev-450");
    expect(last400.map((e) => e.id)).toEqual([...last400.map((e) => e.id)].sort());
    expect(store.listEventsAscending(3).map((e) => e.id)).toEqual(["ev-448", "ev-449", "ev-450"]);
    expect(store.listEventsAscending(1000)).toHaveLength(450);
  });
  it("ties on timestamp are ordered by id and still newest-N", () => {
    const store = open(dbPath());
    for (const id of ["a", "b", "c", "d"]) store.appendEvent({ id, type: "ConversationOccurred", timestamp: "2026-10-31T03:00:00.000Z", payload: {} });
    expect(store.listEventsAscending(2).map((e) => e.id)).toEqual(["c", "d"]);
  });
  it("a context pack built after 450 events still delivers the newest authorized event", () => {
    const store = seed();
    for (let i = 1; i <= 449; i += 1) {
      store.appendEvent({ id: `noise-${i}`, type: "TaskCompleted", timestamp: new Date(Date.UTC(2026, 9, 31, 4, 0, i)).toISOString(), payload: {} });
    }
    store.appendEvent({
      id: "newest",
      type: "ConversationOccurred",
      timestamp: new Date(Date.UTC(2026, 9, 31, 4, 59, 0)).toISOString(),
      citizenId: "GPT-A",
      payload: withAudience({ message: "newest announcement" }, "world_public", { scope: "world" }),
    });
    expect(packOf(store, "Claude-A").bulletin.text).toContain("newest announcement");
  });
});

describe("fix 5: membership is writable only through the orchestrator-config path, and is audited", () => {
  it("every community write needs an orchestrator-config audit context", () => {
    const store = seed();
    const bad = { actor: "llm-tool", reason: "please" } as never;
    expect(() => store.addCommunityMember("gpt", "Newbie", bad)).toThrow(/audit/);
    expect(() => store.removeCommunityMember("gpt", "GPT-A", bad)).toThrow(/audit/);
    expect(() => store.upsertCommunity("evil", "evil", bad)).toThrow(/audit/);
    expect(() => store.addCommunityMember("gpt", "Newbie", undefined as never)).toThrow(/audit/);
    expect(() => store.addCommunityMember("gpt", "Newbie", { actor: "orchestrator-config", reason: " " })).toThrow(/audit/);
    expect(store.getCommunityDirectory().knowsCitizen("Newbie")).toBe(false);
    expect(store.getCommunityDirectory().hasCommunity("evil")).toBe(false);
  });
  it("the config seed is additive, idempotent and audited", () => {
    const store = open(dbPath());
    expect(applyCommunityConfig(store, config)).toEqual({ communitiesTouched: 2, membersAdded: 4, membersRemoved: 0 });
    expect(applyCommunityConfig(store, config)).toEqual({ communitiesTouched: 2, membersAdded: 0, membersRemoved: 0 });
    const audit = store.listCommunityAudit();
    expect(audit.filter((a) => a.action === "add_member")).toHaveLength(4);
    expect(audit.every((a) => a.actor === "orchestrator-config" && a.reason === "COMMUNITIES_JSON seed")).toBe(true);
    expect(audit.map((a) => a.seq)).toEqual([...audit.map((a) => a.seq)].sort((x, y) => x - y));
  });
  it("a conflicting config (moving a member) throws before anything is written; a bad config is ignored by the pack seed", () => {
    const store = seed();
    const before = store.listCommunityAudit().length;
    const move = { COMMUNITIES_JSON: JSON.stringify([{ id: "claude", memberIds: ["GPT-A"] }]) };
    expect(() => applyCommunityConfig(store, move)).toThrow(/conflict/);
    expect(store.listCommunityAudit()).toHaveLength(before);
    expect(store.getCommunityDirectory().communityOf("GPT-A")).toBe("gpt");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    seedCommunitiesOnce(store, move);
    seedCommunitiesOnce(store, { COMMUNITIES_JSON: "{not json" });
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
    expect(store.getCommunityDirectory().communityOf("GPT-A")).toBe("gpt");
  });
  it("buildCitizenContextPack seeds the directory from config on first use (no manager.ts change needed)", () => {
    const store = open(dbPath());
    for (const id of READERS) store.upsertCitizen(record(id));
    expect(store.getCommunityDirectory().knowsCitizen("GPT-A")).toBe(false);
    store.appendEvent(evt("w", withAudience({ message: "hello world" }, "world_public", { scope: "world" })));
    expect(packOf(store, "Claude-B").bulletin.text).toContain("hello world");
    expect(store.getCommunityDirectory().communityOf("Claude-B")).toBe("claude");
  });
  it("without COMMUNITIES_JSON nothing is seeded and nobody receives broadcasts (fail closed)", () => {
    const store = open(dbPath());
    for (const id of READERS) store.upsertCitizen(record(id));
    store.appendEvent(evt("w", withAudience({ message: "hello world" }, "world_public", { scope: "world" })));
    const pack = buildCitizenContextPack({ store, config: loadConfig(baseEnv), citizenId: "GPT-A" });
    expect(pack.bulletin.deliveredEventIds).toEqual([]);
  });
  it("removeCommunityMember is audited, persists across restart and quarantines the facts its community authorized", () => {
    const path = dbPath();
    const store = seed(path);
    store.appendEvent(gptSecret("gpt-plan", "gpt hidden plan at x=1"));
    packOf(store, "GPT-B");
    expect(store.listPersistentFacts("GPT-B").map((f) => f.factKey)).toContain("event:gpt-plan");
    store.appendEvent(evt("personal", { message: "my own note", visibility: { class: "actor_private" } }, "GPT-B"));
    store.upsertPersistentFact({ id: "keep", citizenId: "GPT-B", factKey: "note:mine", content: "my own note", sourceEventId: "personal" });
    expect(store.removeCommunityMember("claude", "GPT-B", AUDIT)).toBe(false); // not a member of claude
    expect(store.removeCommunityMember("gpt", "GPT-B", { actor: "orchestrator-config", reason: "left the colony" })).toBe(true);
    expect(store.removeCommunityMember("gpt", "GPT-B", AUDIT)).toBe(false);
    expect(store.listPersistentFacts("GPT-B").map((f) => f.factKey)).toEqual(["note:mine"]);
    expect(store.listQuarantinedFacts("GPT-B").map((q) => q.reason)).toEqual(["membership of gpt removed"]);
    const removal = store.listCommunityAudit().filter((a) => a.action === "remove_member");
    expect(removal).toEqual([expect.objectContaining({ communityId: "gpt", citizenId: "GPT-B", actor: "orchestrator-config", reason: "left the colony" })]);
    store.close();
    const again = open(path);
    expect(again.getCommunityDirectory().communityOf("GPT-B")).toBeUndefined();
    expect(again.listQuarantinedFacts("GPT-B")).toHaveLength(1);
    // removal is a tombstone: the config seed (which still lists GPT-B) does not silently undo it, even after restart
    applyCommunityConfig(again, config);
    expect(again.getCommunityDirectory().communityOf("GPT-B")).toBeUndefined();
    expect(packOf(again, "GPT-B").bulletin.text).not.toContain("gpt hidden plan");
    // a deliberate, audited re-admission still works
    expect(again.addCommunityMember("gpt", "GPT-B", { actor: "orchestrator-config", reason: "rejoined" })).toBe(true);
    expect(again.getCommunityDirectory().communityOf("GPT-B")).toBe("gpt");
  });
});

describe("(a) quarantined facts never reach a context pack or prompt, before or after a restart", () => {
  const needle = "QUARANTINED-FACT-SECRET-4242";
  function quarantineViaRemoval(path: string): CivilizationStore {
    const store = seed(path);
    store.appendEvent(evt("q-src", withAudience({ message: needle }, "settlement_public", { scope: "community", communityId: "gpt" })));
    packOf(store, "GPT-B"); // stores the urgent fact for GPT-B
    store.removeCommunityMember("gpt", "GPT-B", AUDIT); // -> quarantine
    return store;
  }
  const promptSurface = (store: CivilizationStore, id: string) => {
    const pack = packOf(store, id);
    return JSON.stringify({ pack, promptExtras: pack.promptExtras, facts: store.listPersistentFacts(id, 100) });
  };

  it("a fact moved to quarantine is not in listPersistentFacts, the pack or the prompt extras", () => {
    const store = quarantineViaRemoval(dbPath());
    expect(store.listQuarantinedFacts("GPT-B").map((q) => q.content).join(" ")).toContain(needle); // kept, not deleted
    expect(promptSurface(store, "GPT-B")).not.toContain(needle);
  });
  it("still excluded after a restart (and re-running the migration)", () => {
    const path = dbPath();
    quarantineViaRemoval(path).close();
    const again = open(path);
    expect(again.listQuarantinedFacts("GPT-B")).toHaveLength(1);
    expect(promptSurface(again, "GPT-B")).not.toContain(needle);
    again.close();
    const third = open(path);
    expect(promptSurface(third, "GPT-B")).not.toContain(needle);
    expect(third.listQuarantinedFacts("GPT-B")).toHaveLength(1);
  });
  it("a flag row alone is enough to hide a fact: the fact row stays in place and is excluded at read time", () => {
    const path = dbPath();
    const store = seed(path);
    store.appendEvent(evt("personal", { message: needle, visibility: { class: "actor_private" } }, "GPT-A"));
    store.upsertPersistentFact({ id: "dup", citizenId: "GPT-A", factKey: "note:dup", content: needle, sourceEventId: "personal" });
    store.markEventsDelivered("GPT-A", ["personal"]);
    store.close();
    const raw = new Database(path);
    raw.prepare(
      `INSERT INTO citizen_persistent_fact_flags (fact_id, citizen_id, fact_key, reason, source, flagged_at) VALUES ('dup','GPT-A','note:dup','test','test','t')`,
    ).run();
    expect((raw.prepare(`SELECT COUNT(*) AS n FROM citizen_persistent_facts WHERE id = 'dup'`).get() as { n: number }).n).toBe(1);
    raw.close();
    const again = open(path);
    expect(again.listPersistentFacts("GPT-A", 100)).toEqual([]);
    expect(promptSurface(again, "GPT-A")).not.toContain(needle);
    expect(again.listQuarantinedFacts("GPT-A")).toHaveLength(1);
  });
  it("legacy facts quarantined by the migration also never surface (restart included)", () => {
    const path = dbPath();
    const s = seed(path);
    s.appendEvent(evt("legacy-unlabeled", { message: needle, visibility: { class: "world_public" } }));
    s.upsertPersistentFact({ id: "lf", citizenId: "Claude-A", factKey: "event:legacy-unlabeled", content: needle });
    s.close();
    const raw = new Database(path);
    raw.prepare(`DELETE FROM sim_meta WHERE key = 'sec001_fact_flags_v1'`).run();
    raw.close();
    const migrated = open(path);
    expect(migrated.listQuarantinedFacts("Claude-A").map((q) => q.content)).toContain(needle);
    expect(promptSurface(migrated, "Claude-A")).not.toContain(needle);
    migrated.close();
    expect(promptSurface(open(path), "Claude-A")).not.toContain(needle);
  });
});
