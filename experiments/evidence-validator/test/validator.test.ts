import { describe, expect, it } from "vitest";
import { validateExperimentEvidence } from "../src/validator.js";
import { formatHumanReport, formatJsonReport } from "../src/report.js";
import { createTestManifest, createValid2v2Journal, JournalBuilder } from "../fixtures/helpers.js";

describe("Validator End-to-End Acceptance Tests", () => {
  it("fully verifies a valid 2v2 60-minute offline simulated experiment", () => {
    const manifest = createTestManifest({ stage: "2v2", durationMinutes: 60 });
    const { lines, rows } = createValid2v2Journal();

    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      finalInventories: {
        gpt_atlas: { oak_log: 1 },
        gpt_maya: { sweet_berries: 2 },
        claude_theo: { oak_planks: 4 },
        claude_ava: {},
      },
    });

    expect(report.overallStatus).toBe("VERIFIED");
    expect(report.mode).toBe("offline_simulated");
    expect(report.violations.length).toBe(0);
    expect(report.notProven.length).toBe(0);
    expect(report.summary.verifiedActions).toBe(4);
    expect(report.summary.durationVerified).toBe(true);
    expect(report.hashChainAudit.valid).toBe(true);
    expect(report.attribution.citizens.length).toBe(4);
    expect(report.attribution.communities.length).toBe(2);

    // Verify report formatting
    const jsonOutput = formatJsonReport(report);
    expect(JSON.parse(jsonOutput)).toMatchObject({
      overallStatus: "VERIFIED",
      mode: "offline_simulated",
      redacted: true,
    });

    const markdownOutput = formatHumanReport(report);
    expect(markdownOutput).toContain("# Experiment Evidence Validation Report");
    expect(markdownOutput).toContain("🟢 VERIFIED");
    expect(markdownOutput).toContain("Offline Simulated Fixture");
    expect(markdownOutput).toContain("Physical Action Verifications");
  });

  it("fully verifies a valid 1v1 30-minute offline simulated experiment", () => {
    const manifest = createTestManifest({
      stage: "1v1",
      durationMinutes: 30,
      citizens: [
        {
          id: "gpt_atlas",
          communityId: "north_cove",
          personalitySeed: "seed_atlas",
          family: "gpt",
          model: "gpt-4o",
          sessionId: "session_atlas_001",
          inventoryVerified: true,
          inventory: [],
          shelterVerifiedAbsent: true,
        },
        {
          id: "claude_theo",
          communityId: "south_vale",
          personalitySeed: "seed_theo",
          family: "claude",
          model: "claude-3-5-sonnet",
          sessionId: "session_theo_001",
          inventoryVerified: true,
          inventory: [],
          shelterVerifiedAbsent: true,
        },
      ],
    });

    const b = new JournalBuilder(manifest.experimentId);
    const attId = "att-1v1-wood";
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-1v1-1",
      expectedItem: "oak_log",
    });
    b.append({
      kind: "action_observation",
      citizenId: "gpt_atlas",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: { oak_log: 1 },
      worldChanges: [],
    });

    // 30 minutes of tick evidence
    for (let i = 0; i < 30; i++) {
      b.append({
        kind: "tick",
        durationMs: 60_000,
        measuredTps: 20.0,
      });
    }

    b.append({
      kind: "shutdown",
      completedDuration: true,
      mode: "offline",
      attempted: 1,
      verified: 1,
      unverified: 0,
      interrupted: 0,
      failed: 0,
    });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      finalInventories: {
        gpt_atlas: { oak_log: 1 },
        claude_theo: {},
      },
    });

    expect(report.overallStatus).toBe("VERIFIED");
    expect(report.summary.verifiedActions).toBe(1);
    expect(report.durationAudit.provenDurationMinutes).toBe(30);
  });
});
