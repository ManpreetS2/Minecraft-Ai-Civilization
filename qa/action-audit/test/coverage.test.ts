import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { COVERAGE, normalizeAuditPath, scanMutatingCallSites } from "../src/coverage.js";

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


it("normalizes Windows audit keys and excludes test helpers without excluding production", () => {
  expect(normalizeAuditPath("packages\\skills\\src\\testing\\helper.ts")).toBe("packages/skills/src/testing/helper.ts");
  const root = mkdtempSync(join(tmpdir(), "audit-paths-"));
  try {
    mkdirSync(join(root, "packages/skills/src/testing"), { recursive: true });
    mkdirSync(join(root, "apps"));
    for (const file of ["production.ts", "production.test.ts", "testing/helper.ts"]) {
      writeFileSync(join(root, "packages/skills/src", file), "bot.placeBlock(reference, face);\n");
    }
    expect(scanMutatingCallSites(root)).toEqual({ "packages/skills/src/production.ts": 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
