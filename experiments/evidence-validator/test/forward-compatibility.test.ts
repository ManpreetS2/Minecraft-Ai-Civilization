import { describe, expect, it } from "vitest";
import { projectKnownFields } from "../src/schemas.js";
import { adaptRecorderJournal, rehashJournalLines } from "../src/recorder-adapter.js";
import { validateExperimentEvidence } from "../src/validator.js";

const tick = { kind: "tick", durationMs: 0 };
function check(rows: Record<string, unknown>[]) {
  const lines = rehashJournalLines(rows, "compat");
  return validateExperimentEvidence({ rawJournalLines: lines, journalRows: adaptRecorderJournal(lines).journalRows });
}
describe("authenticated forward compatibility", () => {
  it("shares an own-property projection and binds every known value", () => {
    expect(projectKnownFields("tick", { ...tick, metadata: 1 })).not.toHaveProperty("metadata");
    const lines = rehashJournalLines([tick], "compat");
    const rows = adaptRecorderJournal(lines).journalRows;
    (rows[0] as unknown as Record<string, unknown>).durationMs = 5;
    expect(validateExperimentEvidence({ rawJournalLines: lines, journalRows: rows }).violations.map(v => v.code)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("reports bounded extras without changing semantic verification", () => {
    const report = check([{ ...tick, recorderBuild: { version: 2 } }]);
    expect(report.violations).toEqual([]);
    expect(report.notProven.some(v => v.description.includes("recorderBuild"))).toBe(true);
  });
  it("limits metadata depth, bytes and key count", () => {
    for (const metadata of [{ text: "x".repeat(4097) }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`key${i}`, i])), { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } }]) {
      expect(check([{ ...tick, ...metadata }]).violations.map(v => v.code)).toContain("RAW_JOURNAL_RESOURCE_LIMIT");
    }
  });
  it("applies the exact serialized 4096-byte metadata boundary", () => {
    expect(check([{ ...tick, a: "x".repeat(4088) }]).violations).toEqual([]);
    expect(check([{ ...tick, a: "x".repeat(4089) }]).violations.map(v => v.code)).toContain("RAW_JOURNAL_RESOURCE_LIMIT");
  });
  it("quarantines invalid known structures and preserves unknown kinds in the chain", () => {
    expect(check([{ ...tick, durationMs: [] }]).violations.map(v => v.code)).toContain("RAW_JOURNAL_SCHEMA_VIOLATION");
    const unknown = check([{ kind: "future_heartbeat" }, tick]);
    expect(unknown.hashChainAudit.valid).toBe(true);
    expect(unknown.violations).toEqual([]);
    expect(unknown.notProven.some(v => v.code === "UNKNOWN_ROW_KIND")).toBe(true);
  });
  it("never lets malformed signed values escape", () => {
    for (const durationMs of [null, {}, [], "bad"]) expect(() => check([{ ...tick, durationMs }])).not.toThrow();
  });
});
