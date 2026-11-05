/**
 * Mission 006, Phase 3: Runtime Recorder Integration Tests
 *
 * Verifies that the validator consumes raw records produced directly by the
 * genuine `ExperimentEvidenceJournal` application API, checks physical
 * action witnessing, inventory conservation, interventions, and shutdown.
 */

import { describe, expect, it } from "vitest";
import { executeActualRecorderPipeline } from "../src/runtime-recorder-replay.js";
import { adaptRecorderJournal } from "../src/recorder-adapter.js";
import { validateExperimentEvidence } from "../src/validator.js";

describe("Mission 006, Phase 3 — Actual Application Recorder Integration", () => {
  it("executes authentic ExperimentEvidenceJournal and validates resulting evidence stream", () => {
    const pipeline = executeActualRecorderPipeline({
      experimentId: "exp-act-rec-001",
      sourceSha: "ea4ada9ba3baa750cc3c1dec330e4918bb47ef49",
    });

    try {
      // 1. Raw journal was created and contains expected row kinds
      expect(pipeline.rawLines.length).toBeGreaterThan(6);
      const parsedKinds = pipeline.rawLines.map((l) => JSON.parse(l).kind);
      expect(parsedKinds).toContain("start");
      expect(parsedKinds).toContain("action_attempt");
      expect(parsedKinds).toContain("action_observation");
      expect(parsedKinds).toContain("tick");
      expect(parsedKinds).toContain("intervention");
      expect(parsedKinds).toContain("shutdown");

      // 2. Hash chain integrity of runtime recorder is cryptographically valid
      expect(pipeline.report.hashChainAudit.valid).toBe(true);
      expect(pipeline.report.summary.hashChainValid).toBe(true);

      // 3. Actions physically witnessed
      expect(pipeline.report.summary.totalAttemptedActions).toBe(3);
      expect(pipeline.report.summary.verifiedActions).toBe(3);
      expect(pipeline.report.summary.failedActions).toBe(0);
      expect(pipeline.report.summary.unverifiedActions).toBe(0);

      // 4. Inventory conservation satisfied (gather + craft)
      expect(pipeline.report.summary.inventoryViolationsCount).toBe(0);

      // 5. Mode remains strictly offline_simulated
      expect(pipeline.report.mode).toBe("offline_simulated");
      expect(pipeline.report.durationAudit.serverTickProven).toBe(false);

      // 6. Operator intervention was captured
      const interventionRow = pipeline.adapted.journalRows.find(
        (r) => r.kind === "intervention",
      );
      expect(interventionRow).toBeDefined();

      // 7. Recorder gap notifications present (originPosition, serverGameTick, toolDurability)
      expect(pipeline.adapted.recorderGaps.length).toBeGreaterThan(0);
    } finally {
      pipeline.cleanup();
    }
  });

  it("fails closed when runtime recorder output has corrupted hash chain", () => {
    const pipeline = executeActualRecorderPipeline({
      experimentId: "exp-corrupt-001",
    });

    try {
      // Corrupt line 1 (tamper with action attempt)
      const corruptedLines = [...pipeline.rawLines];
      corruptedLines[1] = corruptedLines[1]!.replace("gather", "craft");

      const report = validateExperimentEvidence({
        rawJournalLines: corruptedLines,
      });
      expect(report.hashChainAudit.valid).toBe(false);
      expect(report.violations.some((v) => v.code === "CORRUPTED_HASH_CHAIN")).toBe(true);
    } finally {
      pipeline.cleanup();
    }
  });
});
