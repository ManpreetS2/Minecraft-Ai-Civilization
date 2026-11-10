import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createTestManifest, createValid2v2Journal } from "../fixtures/helpers.js";

describe("Evidence Validator CLI", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "validator-cli-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("prints help and exits with code 0 on --help", () => {
    const code = runCli(["--help"]);
    expect(code).toBe(0);
  });

  it("processes manifest and journal files and outputs JSON and Markdown reports", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "manifest.json");
    const journalPath = join(dir, "journal.jsonl");
    const outJsonPath = join(dir, "report.json");
    const outSummaryPath = join(dir, "summary.md");

    const manifest = createTestManifest({ stage: "2v2", durationMinutes: 60 });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const { lines } = createValid2v2Journal();
    writeFileSync(journalPath, lines.join("\n"), "utf8");

    const code = runCli([
      "--manifest",
      manifestPath,
      "--journal",
      journalPath,
      "--output",
      outJsonPath,
      "--summary",
      outSummaryPath,
    ]);

    expect(code).toBe(0);

    const jsonReport = JSON.parse(readFileSync(outJsonPath, "utf8"));
    expect(jsonReport.overallStatus).toBe("NOT_PROVEN");
    expect(jsonReport.summary.verifiedActions).toBe(4);

    const markdownReport = readFileSync(outSummaryPath, "utf8");
    expect(markdownReport).toContain("🟡 NOT PROVEN");
    expect(markdownReport).toContain("Offline Simulated Fixture");
  });

  it("exits with code 2 on --strict when violations exist", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "manifest.json");
    const journalPath = join(dir, "journal.jsonl");

    // Deficit: manifest claims 60 min, but journal has 0 ticks
    const manifest = createTestManifest({ durationMinutes: 60 });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    writeFileSync(journalPath, "", "utf8"); // empty journal

    const code = runCli([
      "--manifest",
      manifestPath,
      "--journal",
      journalPath,
      "--strict",
    ]);

    expect(code).toBe(2);
  });
});
