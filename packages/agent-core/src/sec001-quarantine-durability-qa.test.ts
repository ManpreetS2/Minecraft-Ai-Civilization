import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { at, legacyFixture, secret } from "./sec001-migration-qa/fixture.js";
const fixtures: ReturnType<typeof legacyFixture>[] = [];
function fixture() {
  const f = legacyFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("Independent SEC-001 quarantine durability and provenance QA", () => {
  it("filters quarantined facts before applying the reader retrieval limit", () => {
    const f = fixture();
    const raw = new Database(f.path);
    try {
      raw
        .prepare("UPDATE citizen_persistent_facts SET created_at='2099-01-01' WHERE id='f-poison'")
        .run();
    } finally {
      raw.close();
    }
    const s = f.open();
    const ids = s.listPersistentFacts("Claude-A", 2).map((fact) => fact.id);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("f-poison");
    expect(
      s.db.prepare("SELECT content FROM citizen_persistent_facts WHERE id='f-poison'").get(),
    ).toEqual({ content: secret });
  });

  it("a shared source key is quarantined per recipient without hiding its authorized owner's fact", () => {
    const f = fixture();
    const raw = new Database(f.path);
    try {
      raw
        .prepare(
          "INSERT INTO citizen_persistent_facts(id,citizen_id,fact_key,content,kind,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          "f-other-owner",
          "GPT-A",
          "event:private-owner",
          "another citizen's private observation",
          "observed_fact",
          at,
        );
    } finally {
      raw.close();
    }
    const s = f.open();
    expect(s.listPersistentFacts("GPT-A").map((fact) => fact.id)).not.toContain("f-other-owner");
    expect(s.listQuarantinedFacts("GPT-A").map((fact) => fact.id)).toContain("f-other-owner");
    expect(s.listPersistentFacts("Claude-A").map((fact) => fact.id)).toContain("f-owner");
  });

  it("source_event_id makes a non-event-key fact eligible for source authorization during migration", () => {
    const f = fixture();
    const raw = new Database(f.path);
    try {
      // Model an interrupted/partial provenance upgrade, without a completion marker.
      raw.exec("ALTER TABLE citizen_persistent_facts ADD COLUMN source_event_id TEXT");
      raw
        .prepare(
          "UPDATE citizen_persistent_facts SET source_event_id='leaked-camp' WHERE id='f-note'",
        )
        .run();
    } finally {
      raw.close();
    }
    const s = f.open();
    expect(s.listQuarantinedFacts("Claude-A").map((fact) => fact.id)).toContain("f-note");
    expect(s.listPersistentFacts("Claude-A").map((fact) => fact.id)).not.toContain("f-note");
  });

  it("explicit source identity overrides a misleading authorized-looking fact key", () => {
    const f = fixture();
    const raw = new Database(f.path);
    try {
      raw.exec("ALTER TABLE citizen_persistent_facts ADD COLUMN source_event_id TEXT");
      raw
        .prepare(
          "UPDATE citizen_persistent_facts SET source_event_id='leaked-camp' WHERE id='f-owner'",
        )
        .run();
    } finally {
      raw.close();
    }
    const s = f.open();
    expect(s.listQuarantinedFacts("Claude-A").map((fact) => fact.id)).toContain("f-owner");
    expect(s.listPersistentFacts("Claude-A").map((fact) => fact.id)).not.toContain("f-owner");
  });

  it("SECURITY REGRESSION: rerunning quarantine must exclude a later memory copied from already-flagged poison", () => {
    const s = fixture().open();
    expect(s.listQuarantinedFacts("Claude-A").map((fact) => fact.id)).toContain("f-poison");
    // Simulate an in-flight or imported legacy derivation arriving after the initial scan.
    s.addMemory({
      id: "m-late-copy",
      citizenId: "Claude-A",
      kind: "episodic",
      content: `Late copied report: ${secret}`,
      importance: 0.9,
      createdAt: at,
    });
    s.applyLegacyFactMigration(s.dryRunLegacyFactMigration());
    expect(s.getMemories("Claude-A").map((memory) => memory.id)).not.toContain("m-late-copy");
  });

  it("SECURITY REGRESSION: a completed migration marker must not authorize subsequently imported source-linked poison", () => {
    const f = fixture();
    let s = f.open();
    // This uses the actual store writer. It is a post-marker import/stale-writer boundary,
    // not proof the current authorized context builder produces this write.
    s.upsertPersistentFact({
      id: "f-late-import",
      citizenId: "Claude-B",
      factKey: "event:leaked-camp",
      sourceEventId: "leaked-camp",
      content: secret,
      kind: "observed_fact",
    });
    s.close();
    s = f.open();
    expect(s.listPersistentFacts("Claude-B").map((fact) => fact.id)).not.toContain("f-late-import");
  });

  it("dry-run reports are read-only even when they propose additional quarantine", () => {
    const s = fixture().open();
    s.upsertPersistentFact({
      id: "inspect-only",
      citizenId: "Claude-B",
      factKey: "event:leaked-camp",
      sourceEventId: "leaked-camp",
      content: "inspection candidate",
      kind: "observed_fact",
    });
    const changes = () => s.db.prepare("SELECT total_changes() AS n").get();
    const before = changes();
    const report = s.dryRunLegacyFactMigration(at);
    expect(s.listQuarantinedFacts("Claude-B").map((fact) => fact.id)).toContain("inspect-only");
    expect(changes()).toEqual(before);
    // Retrieval is now independently authorized, even before an explicit audit flag is applied.
    expect(s.listPersistentFacts("Claude-B").map((fact) => fact.id)).not.toContain("inspect-only");
    expect(
      s.db.prepare("SELECT content FROM citizen_persistent_facts WHERE id='inspect-only'").get(),
    ).toEqual({ content: "inspection candidate" });
    // Applying the explicit report, unlike merely inspecting it, excludes this row.
    expect(s.applyLegacyFactMigration(report).factsFlagged).toBe(0);
    expect(s.listPersistentFacts("Claude-B").map((fact) => fact.id)).not.toContain("inspect-only");
  });

  it("a newly inserted suspicion keeps its classification; the known kind defect requires replacement", () => {
    const s = fixture().open();
    s.upsertPersistentFact({
      id: "fresh-suspicion",
      citizenId: "GPT-B",
      factKey: "note:fresh-rumor",
      content: "unverified report",
      kind: "suspicion",
    });
    expect(
      s.db.prepare("SELECT kind FROM citizen_persistent_facts WHERE id='fresh-suspicion'").get(),
    ).toEqual({ kind: "suspicion" });
    expect(s.listPersistentFacts("GPT-B")).toEqual([]);
  });
});
