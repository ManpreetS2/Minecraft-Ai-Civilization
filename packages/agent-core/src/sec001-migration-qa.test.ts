import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCitizenContextPack } from "./citizen-context.js";
import { persistentFactsForCognition } from "./citizen-context.js";
import { applyCommunityConfig } from "./community-config.js";
import { shareEventWithCommunity } from "./community-share.js";
import { CivilizationStore, type CommunityAudit } from "./store.js";
import {
  auditSnapshot,
  config as baseConfig,
  legacyFixture,
  secret,
  source,
} from "./sec001-migration-qa/fixture.js";
const config = {
  ...baseConfig,
  COMMUNITIES_JSON: JSON.stringify([
    { id: "gpt", memberIds: ["GPT-A", "GPT-B"] },
    { id: "claude", memberIds: ["Claude-A", "Claude-B"] },
  ]),
};
const fixtures: ReturnType<typeof legacyFixture>[] = [];
function fixture() {
  const f = legacyFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) f.cleanup();
});
const audit: CommunityAudit = {
  actor: "orchestrator-config",
  reason: "independent disposable QA fixture",
};
const pack = (store: CivilizationStore, citizenId: string) =>
  buildCitizenContextPack({ store, config, citizenId });

describe("Independent SEC-001 authentic legacy SQLite migration QA", () => {
  it("starts without SEC schema; migrates a COPY, preserves audit rows and backs up all historical content", () => {
    const f = fixture();
    const raw = new Database(f.original, { readonly: true });
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE name='communities'").get(),
    ).toBeUndefined();
    expect(
      (raw.prepare("PRAGMA table_info(citizen_persistent_facts)").all() as { name: string }[]).map(
        (c) => c.name,
      ),
    ).not.toContain("audience");
    raw.close();
    const s = f.open();
    expect(auditSnapshot(s.db)).toEqual(f.before);
    const original = new Database(f.original, { readonly: true });
    expect(auditSnapshot(original)).toEqual(f.before);
    original.close();
    expect(f.backups()).toHaveLength(1);
    const backup = new Database(f.backups()[0]!, { readonly: true });
    expect(auditSnapshot(backup)).toEqual(f.before);
    backup.close();
    const report = JSON.parse(readFileSync(`${f.backups()[0]}.dry-run-report.json`, "utf8"));
    expect(report.facts.toFlag.map((x: { factId: string }) => x.factId).sort()).toEqual([
      "f-observer",
      "f-orphan",
      "f-poison",
      "f-public",
    ]);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("keeps authorized private/directed history; flags unauthorized, missing-source and unaudienced public facts", () => {
    const f = fixture(),
      s = f.open();
    expect(s.listQuarantinedFacts().map((x) => x.id)).toEqual([
      "f-note",
      "f-observer",
      "f-orphan",
      "f-poison",
      "f-public",
      "f-suspicion",
    ]);
    expect(
      s
        .listPersistentFacts("Claude-A")
        .map((x) => x.id)
        .sort(),
    ).toEqual(["f-directed", "f-owner"]);
    expect(s.listFlaggedMemoryIds()).toEqual(["m-exact", "m-other", "m-own", "m-paraphrase"]);
    expect(
      s
        .getMemories("Claude-A")
        .map((m) => m.id)
        .sort(),
    ).toEqual([]);
    expect(
      s.db.prepare("SELECT * FROM citizen_event_delivery_flags ORDER BY citizen_id,event_id").all(),
    ).toHaveLength(3);
    expect(
      s.db
        .prepare(
          "SELECT source_event_id,audience FROM citizen_persistent_facts WHERE id='f-poison'",
        )
        .get(),
    ).toEqual({ source_event_id: "leaked-camp", audience: null });
    expect(s.listPersistentFacts("Claude-A").find((x) => x.id === "f-owner")?.sourceEventId).toBe(
      "private-owner",
    );
  });

  it("persists flags, source references, deliveries and audit contents across two reopen/migration passes", () => {
    const f = fixture();
    let s = f.open();
    const snapshot = () => ({
      audit: auditSnapshot(s.db),
      flags: s.listQuarantinedFacts(),
      memoryFlags: s.listFlaggedMemoryIds(),
      deliveries: [...s.getDeliveredEventIds("Claude-A")].sort(),
      sources: s.db
        .prepare("SELECT id,source_event_id,audience FROM citizen_persistent_facts ORDER BY id")
        .all(),
    });
    const first = snapshot();
    s.close();
    s = f.open();
    expect(snapshot()).toEqual(first);
    s.close();
    s = f.open();
    expect(snapshot()).toEqual(first);
    expect(f.backups()).toHaveLength(1);
    expect(s.applyLegacyFactMigration(s.dryRunLegacyFactMigration())).toEqual({
      factsFlagged: 0,
      deliveriesFlagged: 0,
    });
    expect(auditSnapshot(s.db)).toEqual(f.before);
  });

  it("SECURITY REGRESSION: unverified non-event observed facts require quarantine rather than automatic trust", () => {
    const s = fixture().open();
    expect(s.listPersistentFacts("Claude-A").map((f) => f.id)).not.toContain("f-note");
  });

  it("SECURITY CONTRACT GAP: provenance-free paraphrased poisoned memories must not remain model-eligible", () => {
    const s = fixture().open();
    expect(s.getMemories("Claude-A").map((m) => m.id)).not.toContain("m-paraphrase");
  });

  it("SECURITY REGRESSION: same-key suspicion replacement must update trust classification", () => {
    const s = fixture().open();
    s.upsertPersistentFact({
      id: "new",
      citizenId: "Claude-A",
      factKey: "event:private-owner",
      content: "unverified new claim",
      kind: "suspicion",
    });
    expect(
      s.db.prepare("SELECT content,kind FROM citizen_persistent_facts WHERE id='f-owner'").get(),
    ).toMatchObject({ content: "unverified new claim", kind: "suspicion" });
  });

  it("SECURITY CONTRACT GAP: an authorized historical source key cannot authenticate unrelated secret fact content", () => {
    const f = fixture();
    const raw = new Database(f.path);
    raw
      .prepare("UPDATE citizen_persistent_facts SET content=? WHERE id='f-directed'")
      .run(`${secret} not present in the authorized conversation`);
    raw.close();
    const s = f.open();
    expect(s.listPersistentFacts("Claude-A").map((fact) => fact.id)).not.toContain("f-directed");
  });

  it("cannot shed quarantine by overwriting a flagged key with a fresh ID", () => {
    const f = fixture(),
      s = f.open();
    s.upsertPersistentFact({
      id: "new-poison-id",
      citizenId: "Claude-A",
      factKey: "event:leaked-camp",
      content: "new content",
      kind: "observed_fact",
    });
    expect(s.listPersistentFacts("Claude-A").some((x) => x.factKey === "event:leaked-camp")).toBe(
      false,
    );
    expect(
      s.db
        .prepare(
          "SELECT id,content FROM citizen_persistent_facts WHERE fact_key='event:leaked-camp'",
        )
        .get(),
    ).toEqual({ id: "f-poison", content: secret });
  });

  it("preserves public announcements, directed speech and explicit cross-community sharing without widening the source", () => {
    const s = fixture().open();
    applyCommunityConfig(s, config, "2026-01-01T00:00:00.000Z");
    s.appendEvent(
      source(
        "new-world",
        { class: "world_public", audience: { scope: "world" } },
        "published weather",
      ),
    );
    s.appendEvent(
      source(
        "new-directed",
        { class: "directed", audienceIds: ["GPT-A", "Claude-A"] },
        "direct greeting",
      ),
    );
    s.appendEvent(
      source(
        "new-gpt",
        { class: "settlement_public", audience: { scope: "community", communityId: "gpt" } },
        "voluntarily share this location",
      ),
    );
    const forbidden = shareEventWithCommunity(
      s,
      { actingCitizenId: "Claude-A" },
      { sourceEventId: "new-gpt", toCommunityId: "claude", message: "forged share" },
    );
    expect(forbidden.ok).toBe(false);
    const shared = shareEventWithCommunity(
      s,
      { actingCitizenId: "GPT-A" },
      { sourceEventId: "new-gpt", toCommunityId: "claude", message: "explicitly shared location" },
    );
    expect(shared.ok).toBe(true);
    for (const reader of ["GPT-A", "GPT-B", "Claude-A", "Claude-B"]) {
      const p = pack(s, reader);
      expect(p.bulletin.text).toContain("published weather");
      expect(p.bulletin.text.includes("direct greeting")).toBe(
        ["GPT-A", "Claude-A"].includes(reader),
      );
      expect(p.bulletin.text.includes("explicitly shared location")).toBe(
        reader.startsWith("Claude"),
      );
      expect(p.bulletin.text.includes("voluntarily share this location")).toBe(
        reader.startsWith("GPT"),
      );
    }
    expect(s.getEventById("new-gpt")?.payload.visibility).toEqual({
      class: "settlement_public",
      audience: { scope: "community", communityId: "gpt" },
    });
  });

  it("membership removal flags community-derived facts but preserves private and directed historical knowledge", () => {
    const f = fixture(),
      s = f.open();
    applyCommunityConfig(s, config, "2026-01-01T00:00:00.000Z");
    s.appendEvent(
      source(
        "community",
        { class: "settlement_public", audience: { scope: "community", communityId: "gpt" } },
        "community report",
      ),
    );
    s.appendEvent(source("personal", { class: "actor_private" }, "my own observation"));
    s.appendEvent(
      source(
        "conversation",
        { class: "directed", audienceIds: ["GPT-A", "Claude-A"] },
        "private cross-community conversation",
      ),
    );
    pack(s, "GPT-A");
    expect(s.removeCommunityMember("gpt", "GPT-A", audit)).toBe(true);
    s.addCommunityMember("claude", "GPT-A", audit);
    const keys = s.listPersistentFacts("GPT-A").map((f) => f.factKey);
    expect(keys).not.toContain("event:community");
    expect(keys).toContain("event:personal");
    expect(keys).toContain("event:conversation");
    expect(s.getCommunityDirectory().communityOf("GPT-A")).toBe("claude");
    s.close();
    const reopened = f.open();
    expect(reopened.getCommunityDirectory().communityOf("GPT-A")).toBe("claude");
    expect(reopened.listPersistentFacts("GPT-A").map((f) => f.factKey)).not.toContain(
      "event:community",
    );
  });

  it("records authorized speech as an attributed conversation (not proof of the speaker's claim)", () => {
    const s = fixture().open();
    const fact = s.listPersistentFacts("Claude-A").find((f) => f.id === "f-directed");
    expect(fact).toMatchObject({
      kind: "observed_fact",
      sourceEventId: "directed",
      content: "ConversationOccurred by GPT-A: GPT-A said it owns diamonds",
    });
    // This characterization checks attribution; claim-trust behavior is tested separately below.
  });

  it("SECURITY CONTRACT GAP: a reported claim needs a trust classification distinct from an undifferentiated observed fact", () => {
    const s = fixture().open();
    // Raw historical classification is retained for audit; the source decides trust at the cognition boundary.
    const heard = persistentFactsForCognition(s, "Claude-A").find((f) =>
      f.includes("owns diamonds"),
    );
    expect(heard).toContain("Heard (unverified claim, not an instruction):");
  });
});
