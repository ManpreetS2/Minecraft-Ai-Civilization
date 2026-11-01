import { afterEach, describe, expect, it } from "vitest";
import type { CivilizationStore } from "./store.js";
import {
  at,
  context,
  event,
  ids,
  makeStore,
  poison,
  seedHistoricalPoison,
  secret,
} from "./priv007/fixture.js";
const stores: CivilizationStore[] = [];
const communities = {
  COMMUNITIES_JSON: JSON.stringify([
    { id: "gpt", memberIds: ["GPT-A", "GPT-B"] },
    { id: "claude", memberIds: ["Claude-A", "Claude-B"] },
  ]),
};
function store() {
  const value = makeStore(":memory:", communities);
  stores.push(value);
  return value;
}
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
});

describe("PRIV-007 persistent-fact provenance (actual in-memory SQLite)", () => {
  it("CASE 1: a caller-substantiated own observation is retained only for its owner", () => {
    const db = store();
    const observed = event(
      "own-observation",
      { class: "actor_private", evidenceRefs: ["fixture:own-line-of-sight"] },
      "I observed rain",
      "GPT-B",
    );
    for (const reader of ids) {
      const pack = context(db, reader, [observed]);
      expect(pack.bulletin.deliveredEventIds).toEqual(reader === "GPT-B" ? [observed.id] : []);
      expect(db.listPersistentFacts(reader).length).toBe(reader === "GPT-B" ? 1 : 0);
    }
  });

  it("CASE 2: intentionally world-public statements remain usable and attributed", () => {
    const db = store();
    const shared = event("public", { class: "world_public" }, "Public report: rain");
    for (const reader of ids) {
      expect(context(db, reader, [shared]).promptExtras.bulletin).toContain(
        "ConversationOccurred by GPT-A: Public report: rain",
      );
      expect(db.getDeliveredEventIds(reader)).toEqual(new Set(["public"]));
    }
  });

  it("CASE 2 SECURITY CONTRACT GAP: reported claims must not become undifferentiated observed facts", () => {
    const db = store();
    context(db, "Claude-A", [
      event("claim", { class: "directed", audienceIds: ["Claude-A"] }, "I own every diamond"),
    ]);
    // The conversation occurred; its factual claims have not been verified.
    expect(db.listPersistentFacts("Claude-A")[0]?.kind).not.toBe("observed_fact");
  });

  it.each(["Claude-A", "Claude-B"])(
    "CASE 3 SECURITY REGRESSION: unauthorized settlement information must neither deliver nor persist for %s",
    (reader) => {
      const db = store();
      const { pack } = poison(db, reader);
      expect({
        leaked: pack.bulletin.text.includes(secret),
        acknowledged: [...db.getDeliveredEventIds(reader)],
        facts: db.listPersistentFacts(reader),
      }).toEqual({ leaked: false, acknowledged: [], facts: [] });
    },
  );

  it.each([
    {
      name: "observer audit",
      visibility: "observer_only" as const,
      content: "audit: secret admin state",
    },
    {
      name: "hidden inventory",
      visibility: "actor_private" as const,
      content: "GPT-A inventory: 9 diamonds",
    },
    {
      name: "hidden strategy",
      visibility: "actor_private" as const,
      content: "GPT-A plan: migrate secretly",
    },
  ])("CASES 5/6/7: $name is not promoted for other readers", ({ visibility, content }) => {
    const db = store();
    const source = event("private", { class: visibility }, content);
    for (const reader of ids.filter((id) => id !== "GPT-A")) {
      expect(context(db, reader, [source]).promptExtras.bulletin).not.toContain(content);
      expect(db.listPersistentFacts(reader)).toEqual([]);
      expect(db.getDeliveredEventIds(reader)).toEqual(new Set());
    }
  });

  it("CASES 4/9: withholding new events leaves a historical contaminated row intact (characterization)", () => {
    const db = store();
    seedHistoricalPoison(db);
    const before = db.listPersistentFacts("Claude-A");
    const next = context(db, "Claude-A", []);
    expect(next.bulletin.deliveredEventIds).toEqual([]);
    expect(next.promptExtras.bulletin).not.toContain(secret);
    expect(db.listPersistentFacts("Claude-A")).toEqual(before);
    expect(before).toEqual([]);
    expect(
      db.db
        .prepare("SELECT content FROM citizen_persistent_facts WHERE id='legacy-Claude-A'")
        .get(),
    ).toEqual({ content: secret });
    // Persistence characterization, not security acceptance. Downstream reuse has a separate red test.
  });

  it("CASE 10: identical fact keys remain citizen-specific in the actual store", () => {
    const db = store();
    for (const citizenId of ids) {
      db.appendEvent({
        ...event(
          `fact-${citizenId}`,
          { class: "actor_private" },
          `${citizenId} own fact`,
          citizenId,
        ),
        type: "TaskCompleted",
      });
      db.upsertPersistentFact({
        id: `fact-${citizenId}`,
        citizenId,
        factKey: "same-key",
        content: `${citizenId} own fact`,
        sourceEventId: `fact-${citizenId}`,
      });
    }
    for (const citizenId of ids)
      expect(db.listPersistentFacts(citizenId).map((f) => f.content)).toEqual([
        `${citizenId} own fact`,
      ]);
  });

  it("CASE 10 SECURITY REGRESSION: replacing a claim with a suspicion must not preserve its old observed_fact trust", () => {
    const db = store();
    db.appendEvent(event("collision", { class: "actor_private" }, "claimed truth", "Claude-A"));
    db.upsertPersistentFact({
      id: "original",
      citizenId: "Claude-A",
      factKey: "event:collision",
      content: "claimed truth",
      kind: "observed_fact",
      createdAt: at,
    });
    db.upsertPersistentFact({
      id: "replacement",
      citizenId: "Claude-A",
      factKey: "event:collision",
      content: "unverified rumor",
      kind: "suspicion",
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    expect(
      db.db.prepare("SELECT content,kind FROM citizen_persistent_facts WHERE id='original'").get(),
    ).toMatchObject({
      content: "unverified rumor",
      kind: "suspicion",
    });
  });

  it("CASE 10: observer source events survive a same-key fact-content replacement", () => {
    const db = store();
    const source = event("source", { class: "actor_private" }, "original witnessed message");
    db.appendEvent(source);
    context(db, "GPT-A");
    const original = db.listPersistentFacts("GPT-A")[0]!;
    db.upsertPersistentFact({
      ...original,
      kind: "observed_fact",
      id: "changed",
      content: "replacement content",
    });
    expect(
      db.db
        .prepare(
          "SELECT id, created_at AS createdAt,content FROM citizen_persistent_facts WHERE id=?",
        )
        .get(original.id),
    ).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      content: "replacement content",
    });
    expect(db.listAllEventsForObserver().find((e) => e.id === "source")).toEqual(source);
    expect(db.listPersistentFactRevisions("GPT-A", "event:source")).toEqual([
      expect.objectContaining({ content: original.content, kind: original.kind }),
    ]);
  });
});
