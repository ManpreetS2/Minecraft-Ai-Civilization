import { describe, expect, it } from "vitest";
import { COVERAGE, scanMutatingCallSites } from "../src/coverage.js";

describe("coverage table matches the source", () => {
  const scanned = scanMutatingCallSites();

  it("every mutating call site in production code is in the table, with the same count", () => {
    const table = Object.fromEntries(COVERAGE.map((row) => [row.file, row.calls]));
    expect(scanned).toEqual(table);
  });

  it("the table has no duplicate files and every defect row names a finding", () => {
    expect(new Set(COVERAGE.map((r) => r.file)).size).toBe(COVERAGE.length);
    for (const row of COVERAGE.filter(
      (r) => r.verdict === "defect" || r.verdict === "hypothetical",
    ))
      expect(row.finding, row.file).toBeTruthy();
  });

  it("summary (printed for the report)", () => {
    const byVerdict: Record<string, { files: number; calls: number }> = {};
    for (const row of COVERAGE) {
      const e = (byVerdict[row.verdict] ??= { files: 0, calls: 0 });
      e.files += 1;
      e.calls += row.calls;
    }
    console.info(
      `COVERAGE ${JSON.stringify(byVerdict)} total_calls=${COVERAGE.reduce((n, r) => n + r.calls, 0)}`,
    );
    expect(Object.keys(byVerdict).length).toBeGreaterThan(0);
  });
});
