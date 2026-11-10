import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ExperimentEvidenceJournal } from "@civ/agent-core";
import { bundleFixture } from "./bundle-fixture.js";
import { writeOfflineValidatorReport } from "./offline-validator-report.js";
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
function report(runId = "recording-run", experimentId?: string) {
  const root = mkdtempSync(join(tmpdir(), "experiment-identity-")); roots.push(root);
  const bundle = { ...bundleFixture(), runId };
  const journalPath = join(root, "operator.jsonl");
  new ExperimentEvidenceJournal(journalPath, "experiment-a", new Set(bundle.citizens.map(c => c.id)), "offline", { sourceSha: bundle.sourceSha, runId: "recording-run", decisionTransport: "scripted-in-process" }).close(false);
  return writeOfflineValidatorReport({ outputDirectory: root, bundle, journalPath, experimentId }).report;
}
it("keeps an original experiment id distinct from its recording run id", () => {
  const r = report();
  expect(r.experimentId).toBe("experiment-a");
  expect(r.attribution.runId).toBe("recording-run");
  expect(r.violations.map(v => v.code)).not.toContain("EXPERIMENT_ID_CONFLICT");
  expect(r.mode).toBe("offline_simulated");
  expect(r.overallStatus).toBe("NOT_PROVEN");
});
it("still rejects a contradictory recording run identity", () => {
  expect(report("wrong-run").violations.map(v => v.code)).toContain("RUN_ID_CONFLICT");
});

it("accepts the explicitly selected original experiment identity", () => {
  expect(report("recording-run", "experiment-a").violations.map(v => v.code)).not.toContain("EXPERIMENT_ID_CONFLICT");
});
it("rejects a contradictory explicit experiment identity", () => {
  expect(report("recording-run", "wrong-experiment").violations.map(v => v.code)).toContain("EXPERIMENT_ID_CONFLICT");
});
