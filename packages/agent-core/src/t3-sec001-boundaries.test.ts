import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, type SimEvent } from "@civ/shared";
import { buildCitizenContextPack, persistentFactsForCognition } from "./citizen-context.js";
import { applyCommunityConfig } from "./community-config.js";
import { CivilizationStore } from "./store.js";

const config = loadConfig({
  LLM_PROVIDER: "none",
  LLM_ENABLED: "false",
  CLOUD_LLM_ENABLED: "false",
});
const stores: CivilizationStore[] = [];
function fixture() {
  const store = new CivilizationStore(":memory:");
  stores.push(store);
  applyCommunityConfig(store, {
    COMMUNITIES_JSON: JSON.stringify([
      { id: "north", memberIds: ["alice", "bob"] },
      { id: "south", memberIds: ["carol", "dan"] },
    ]),
  });
  return store;
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const event = (id: string, message: string, actor = "alice"): SimEvent => ({
  id,
  type: "ConversationOccurred",
  timestamp: "2026-11-01T00:00:00.000Z",
  citizenId: actor,
  payload: { message, visibility: { class: "directed", audienceIds: ["alice", "bob"] } },
});

describe("T3 SEC-001 trusted source and continuing quarantine boundaries", () => {
  it.each(["message", "actor", "type"])(
    "uses stored event content when a caller forges its %s",
    (field) => {
      const store = fixture();
      const original = event("greeting", "hello bob");
      store.appendEvent(original);
      const supplied = structuredClone(original);
      if (field === "message") supplied.payload.message = "PRIVATE-CAMP-COORDINATES";
      if (field === "actor") supplied.citizenId = "PRIVATE-CAMP-COORDINATES";
      if (field === "type") {
        supplied.type = "SystemIncident";
        supplied.payload.message = "PRIVATE-CAMP-COORDINATES";
      }
      const pack = buildCitizenContextPack({ store, config, citizenId: "bob", events: [supplied] });
      expect(pack.bulletin.text).toContain("ConversationOccurred by alice: hello bob");
      expect(pack.bulletin.text).not.toContain("PRIVATE-CAMP-COORDINATES");
      expect(store.listPersistentFacts("bob")[0]?.content).not.toContain(
        "PRIVATE-CAMP-COORDINATES",
      );
    },
  );

  it("a fact's authorized source does not authenticate substituted content in cognition", () => {
    const store = fixture();
    store.appendEvent(event("greeting", "hello bob"));
    store.upsertPersistentFact({
      id: "f",
      citizenId: "bob",
      factKey: "event:greeting",
      content: "PRIVATE-CAMP-COORDINATES",
      kind: "observed_fact",
    });
    expect(persistentFactsForCognition(store, "bob").join()).not.toContain(
      "PRIVATE-CAMP-COORDINATES",
    );
    expect(persistentFactsForCognition(store, "bob")).toEqual([]); // stricter owner policy: quarantine mismatched derivations
    expect(
      store.db.prepare("SELECT content FROM citizen_persistent_facts WHERE id='f'").get(),
    ).toEqual({ content: "PRIVATE-CAMP-COORDINATES" }); // original evidence retained
  });

  it("a caller cannot widen the stored audience or acknowledge a forged grant", () => {
    const store = fixture();
    const original = event("private", "north-only coordinates");
    store.appendEvent(original);
    const supplied = structuredClone(original);
    supplied.payload.visibility = { class: "directed", audienceIds: ["carol"] };
    const pack = buildCitizenContextPack({ store, config, citizenId: "carol", events: [supplied] });
    expect(pack.bulletin.deliveredEventIds).toEqual([]);
    expect(pack.bulletin.text).not.toContain("north-only coordinates");
    expect(store.getDeliveredEventIds("carol")).toEqual(new Set());
    expect(store.listPersistentFacts("carol")).toEqual([]);
  });

  it("a suspicion replacing an authorized speech fact stays out of cognition", () => {
    const store = fixture();
    store.appendEvent(event("greeting", "hello bob"));
    store.upsertPersistentFact({
      id: "f",
      citizenId: "bob",
      factKey: "event:greeting",
      content: "hello bob",
      kind: "observed_fact",
    });
    store.upsertPersistentFact({
      id: "replacement",
      citizenId: "bob",
      factKey: "event:greeting",
      content: "rumor",
      kind: "suspicion",
    });
    expect(
      store.db.prepare("SELECT kind FROM citizen_persistent_facts WHERE id='f'").get(),
    ).toEqual({ kind: "suspicion" });
    expect(persistentFactsForCognition(store, "bob")).toEqual([]);
  });

  it("unauthorized late imports cannot crowd out authorized facts at the retrieval limit", () => {
    const store = fixture();
    store.appendEvent(event("private", "north-only report"));
    store.appendEvent({
      ...event("own", "own observation", "carol"),
      type: "TaskCompleted",
      timestamp: "2019-01-01T00:00:00Z",
      payload: { message: "own observation", visibility: { class: "actor_private" } },
    });
    store.upsertPersistentFact({
      id: "own",
      citizenId: "carol",
      factKey: "note:own",
      content: "own observation",
      createdAt: "2020-01-01T00:00:00Z",
      sourceEventId: "own",
    });
    for (let i = 0; i < 25; i++)
      store.upsertPersistentFact({
        id: `poison-${i}`,
        citizenId: "carol",
        factKey: `import:${i}`,
        sourceEventId: "private",
        content: "north-only report",
        createdAt: "2099",
      });
    expect(store.listPersistentFacts("carol", 1).map((fact) => fact.id)).toEqual(["own"]);
    expect(store.listPersistentFacts("carol", 0)).toEqual([]);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM citizen_persistent_facts").get()).toEqual({
      n: 26,
    });
  });

  it("a late copied memory is quarantined at write time without a rescan", () => {
    const store = fixture();
    store.appendEvent(event("private", "north-only private coordinates"));
    store.upsertPersistentFact({
      id: "f",
      citizenId: "carol",
      factKey: "event:private",
      content: "north-only private coordinates",
    });
    store.applyLegacyFactMigration(store.dryRunLegacyFactMigration());
    store.addMemory({
      id: "late",
      citizenId: "carol",
      kind: "episodic",
      content: "Remember: north-only private coordinates",
      importance: 1,
      createdAt: "2026-11-01",
    });
    expect(store.getMemories("carol")).toEqual([]);
    expect(store.listFlaggedMemoryIds("carol")).toEqual(["late"]);
    expect(store.db.prepare("SELECT content FROM memories WHERE id='late'").get()).toEqual({
      content: "Remember: north-only private coordinates",
    });
    store.addMemory({
      id: "other",
      citizenId: "dan",
      kind: "episodic",
      content: "Remember: north-only private coordinates",
      importance: 1,
      createdAt: "2026-11-01",
    });
    expect(store.getMemories("dan")).toEqual([]); // no invented provenance for the other reader either
    expect(store.db.prepare("SELECT content FROM memories WHERE id='other'").get()).toBeDefined();
  });

  it("rescans a raw late copy against existing flags without rewriting historical rows", () => {
    const store = fixture();
    store.appendEvent(event("private", "north-only private coordinates"));
    store.upsertPersistentFact({
      id: "f",
      citizenId: "carol",
      factKey: "event:private",
      content: "north-only private coordinates",
    });
    store.applyLegacyFactMigration(store.dryRunLegacyFactMigration());
    store.db
      .prepare(
        "INSERT INTO memories(id,citizen_id,kind,content,importance,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run("raw", "carol", "episodic", "Remember: north-only private coordinates", 1, "2026-11-01");
    const report = store.dryRunLegacyFactMigration();
    expect(report.facts.alreadyFlagged).toBe(1);
    expect(report.memories.toFlag.map((memory) => memory.memoryId)).toEqual(["raw"]);
    store.applyLegacyFactMigration(report);
    expect(store.getMemories("carol")).toEqual([]);
  });

  it("rolls the memory insertion back if its quarantine flag cannot be persisted", () => {
    const store = fixture();
    store.appendEvent(event("private", "north-only private coordinates"));
    store.upsertPersistentFact({
      id: "f",
      citizenId: "carol",
      factKey: "event:private",
      content: "north-only private coordinates",
    });
    store.applyLegacyFactMigration(store.dryRunLegacyFactMigration());
    store.db.exec(
      "CREATE TEMP TRIGGER flag_abort BEFORE INSERT ON citizen_memory_flags BEGIN SELECT RAISE(ABORT,'test flag failure'); END",
    );
    expect(() =>
      store.addMemory({
        id: "late",
        citizenId: "carol",
        kind: "episodic",
        content: "Remember: north-only private coordinates",
        importance: 1,
        createdAt: "2026-11-01",
      }),
    ).toThrow("test flag failure");
    expect(store.db.prepare("SELECT id FROM memories WHERE id='late'").get()).toBeUndefined();
    expect(store.listFlaggedMemoryIds()).toEqual([]);
  });
});
