import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeJournalRowHash,
  verifyOfflineScenario,
  checkJournalCliIntegration,
  formatMarkdownSummary,
  type OverallAcceptanceReport,
} from "./offline-acceptance-verifier.js";

const VALID_SHA = "2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed";

interface BuildFixtureOptions {
  count?: 2 | 4;
  sourceSha?: string;
  runId?: string;
  alterManifest?: (manifest: Record<string, unknown>) => void;
  alterJournalRows?: (rows: Record<string, unknown>[]) => void;
  alterVerdict?: (verdict: Record<string, unknown>) => void;
  alterReport?: (report: Record<string, unknown>) => void;
}

function createJournalRow(
  base: Record<string, unknown>,
  priorHash: string,
): { row: Record<string, unknown>; hash: string } {
  const rowWithoutHash = {
    ...base,
    previousHash: priorHash,
  };
  const hash = createHash("sha256").update(JSON.stringify(rowWithoutHash)).digest("hex");
  return {
    row: { ...rowWithoutHash, hash },
    hash,
  };
}

function buildOfflineArtifactFixture(dir: string, options: BuildFixtureOptions = {}): void {
  const count = options.count ?? 2;
  const sha = options.sourceSha ?? VALID_SHA;
  const runId = options.runId ?? `fixture-${count}-${sha.slice(0, 12)}`;
  const citizens = count === 2 ? ["gpt-a", "claude-a"] : ["gpt-a", "gpt-b", "claude-a", "claude-b"];
  const receiptsDir = join(dir, "receipts");
  mkdirSync(receiptsDir, { recursive: true });

  // 1. Build actions and receipts
  const actions: Record<string, unknown>[] = [];
  const actionDetails: Array<{
    attemptId: string;
    citizenId: string;
    decisionSource: string;
    gatherSeq: number;
    step: number;
  }> = [];

  let seqNum = 1;
  for (let step = 0; step < 3; step++) {
    for (const citizenId of citizens) {
      const attemptId = `attempt-${citizenId}-${step + 1}`;
      const receiptId = `receipt-${attemptId}`;
      const decisionSource = step === 0 ? "planner" : "scripted";

      actionDetails.push({
        attemptId,
        citizenId,
        decisionSource,
        gatherSeq: step + 1,
        step,
      });

      actions.push({
        sequence: seqNum++,
        citizenId,
        reportedSuccess: true,
        observedSuccess: true,
        inventoryDelta: { oak_log: 1 },
        actionType: "gather",
        expectedDelta: { oak_log: 1 },
        attemptId,
        runId,
        sourceSha: sha,
        receiptId,
      });

      // Write receipt file
      writeFileSync(
        join(receiptsDir, `${receiptId}.json`),
        JSON.stringify(
          {
            id: receiptId,
            attemptId,
            citizenId,
            action: "gather",
            sourceSha: sha,
            verified: true,
          },
          null,
          2,
        ),
      );
    }
  }

  // 2. Build journal rows
  const rawRows: Record<string, unknown>[] = [];

  // Start row
  rawRows.push({
    experimentId: `off${count}`,
    seq: 1,
    at: "2026-11-06T00:00:00.000Z",
    kind: "start",
    recordingAudience: "operator_only",
    mode: "offline",
    decisionTransport: "scripted-in-process",
    sourceSha: sha,
    runId,
    citizens,
  });

  let currentSeq = 2;
  const citizenLogCounts: Record<string, number> = {};
  for (const c of citizens) citizenLogCounts[c] = 0;

  for (let step = 0; step < 3; step++) {
    // Tick row
    rawRows.push({
      experimentId: `off${count}`,
      seq: currentSeq++,
      at: new Date(Date.now() + currentSeq * 100).toISOString(),
      kind: "tick",
      durationMs: 10,
      serverGameTick: null,
      simulatedStep: step,
      tickProvenance: "unavailable",
    });

    const stepActions = actionDetails.filter((a) => a.step === step);

    // Attempts
    for (const act of stepActions) {
      rawRows.push({
        experimentId: `off${count}`,
        seq: currentSeq++,
        at: new Date(Date.now() + currentSeq * 100).toISOString(),
        kind: "action_attempt",
        citizenId: act.citizenId,
        attemptId: act.attemptId,
        action: "gather",
        decisionSource: act.decisionSource,
        expectedItem: "oak_log",
      });
    }

    // Observations
    for (const act of stepActions) {
      const beforeCount = citizenLogCounts[act.citizenId] ?? 0;
      const afterCount = beforeCount + 1;
      citizenLogCounts[act.citizenId] = afterCount;

      rawRows.push({
        experimentId: `off${count}`,
        seq: currentSeq++,
        at: new Date(Date.now() + currentSeq * 100).toISOString(),
        kind: "action_observation",
        citizenId: act.citizenId,
        attemptId: act.attemptId,
        verified: true,
        successReported: true,
        beforeInventory: beforeCount > 0 ? { oak_log: beforeCount } : {},
        afterInventory: { oak_log: afterCount },
        worldChanges: [{ position: { x: 6, y: 64, z: 3 }, before: "oak_log", after: "air" }],
      });
    }
  }

  // Allow custom alterations to journal rows before hashing
  if (options.alterJournalRows) {
    options.alterJournalRows(rawRows);
  }

  // Hash-chain rows
  let priorHash = "";
  const chainedLines: string[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]!;
    row.seq = i + 1;
    const { row: finalizedRow, hash } = createJournalRow(row, priorHash);
    priorHash = hash;
    chainedLines.push(JSON.stringify(finalizedRow));
  }

  const journalContent = chainedLines.join("\n") + "\n";
  const journalPath = join(dir, "operator.jsonl");
  writeFileSync(journalPath, journalContent);
  const journalSha256 = createHash("sha256").update(Buffer.from(journalContent)).digest("hex");

  // 3. Manifest
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    runId,
    repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup",
    sourceSha: sha,
    mode: "offline-fixture",
    citizens: citizens.map((id) => ({
      id,
      family: id.startsWith("gpt") ? "gpt" : "claude",
      model: null,
      sessionId: `session-${id}`,
      authentication: "synthetic",
      initialInventory: {},
    })),
    actions,
    validator: {
      name: "offline-bundle-structure",
      verdict: "NOT PROVEN",
      artifact: "verdict.json",
    },
  };

  if (options.alterManifest) {
    options.alterManifest(manifest);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // 4. Verdict
  const verdict: Record<string, unknown> = {
    verdict: "NOT PROVEN",
    failures: [],
    unproven: ["Paper ticks unavailable"],
    evidenceJournalSha256: journalSha256,
  };
  if (options.alterVerdict) {
    options.alterVerdict(verdict);
  }
  writeFileSync(join(dir, "verdict.json"), JSON.stringify(verdict, null, 2));

  // 5. Gemini Validator Report
  const totalActions = count * 3;
  const report: Record<string, unknown> = {
    overallStatus: "NOT_PROVEN",
    environment: "Offline Simulated Fixture (Not a live Minecraft demo claim)",
    sourceSha: sha,
    runId,
    citizens,
    summary: {
      totalAttemptedActions: totalActions,
      physicallyVerifiedActions: totalActions,
      unverifiedActionClaims: 0,
      inventoryDiscrepancies: 0,
      hashChainIntegrity: "VALID",
      durationProven: false,
    },
    notProven: [
      { code: "RECORDER_GAP_TOOL_DURABILITY", description: "toolDurability absent" },
      { code: "RECORDER_GAP_SERVER_GAME_TICK", description: "serverGameTick absent" },
      { code: "UNPROVEN_PAPER_AUTHENTICITY", description: "Offline fixture only" },
    ],
    violations: [],
  };
  if (options.alterReport) {
    options.alterReport(report);
  }
  writeFileSync(join(dir, "gemini-validator-report.json"), JSON.stringify(report, null, 2));

  // 6. Acceptance
  writeFileSync(
    join(dir, "acceptance.json"),
    JSON.stringify({ outcome: "NOT PROVEN", candidateSha: sha }, null, 2),
  );
}

describe("Offline Acceptance Artifact Verifier", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "civ-ci-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("accepts a valid 1v1 (2-citizen) offline artifact bundle", () => {
    buildOfflineArtifactFixture(tempDir, { count: 2 });
    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.actionAttemptsCount).toBe(6);
    expect(result.actionObservationsCount).toBe(6);
    expect(result.physicallyVerifiedCount).toBe(6);
    expect(result.validatorVerdict).toBe("NOT PROVEN");
    expect(result.details.hashChainValid).toBe(true);
    expect(result.details.decisionSourcesHonest).toBe(true);
    expect(result.details.authenticityHonest).toBe(true);
  });

  it("accepts a valid 2v2 (4-citizen) offline artifact bundle", () => {
    buildOfflineArtifactFixture(tempDir, { count: 4 });
    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 4,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.actionAttemptsCount).toBe(12);
    expect(result.actionObservationsCount).toBe(12);
    expect(result.physicallyVerifiedCount).toBe(12);
    expect(result.citizens).toEqual(["gpt-a", "gpt-b", "claude-a", "claude-b"]);
  });

  it("rejects wrong source SHA", () => {
    buildOfflineArtifactFixture(tempDir, { count: 2 });
    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: "1111111111111111111111111111111111111111",
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Wrong source SHA"))).toBe(true);
  });

  it("rejects incorrect citizen count", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterManifest: (manifest) => {
        // remove one citizen from manifest
        const citizens = manifest.citizens as unknown[];
        manifest.citizens = [citizens[0]];
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Incorrect citizen count"))).toBe(true);
  });

  it("rejects duplicate attempts", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterJournalRows: (rows) => {
        // Find first action_attempt and duplicate its attemptId on second attempt
        const attempts = rows.filter((r) => r.kind === "action_attempt");
        if (attempts.length >= 2) {
          attempts[1]!.attemptId = attempts[0]!.attemptId;
        }
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate attempt"))).toBe(true);
  });

  it("rejects missing observations", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterJournalRows: (rows) => {
        // Remove the last action_observation row
        const lastObsIndex = rows.map((r) => r.kind).lastIndexOf("action_observation");
        if (lastObsIndex !== -1) {
          rows.splice(lastObsIndex, 1);
        }
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing observation") || e.includes("Incorrect observation count"))).toBe(true);
  });

  it("rejects artificially increased inventory", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterJournalRows: (rows) => {
        // Inflate the afterInventory on an observation from 1 to 4 logs
        const firstObs = rows.find((r) => r.kind === "action_observation");
        if (firstObs) {
          firstObs.afterInventory = { oak_log: 4 };
        }
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Artificially increased inventory"))).toBe(true);
  });

  it("rejects scripted decisions disguised as genuine model decisions", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterJournalRows: (rows) => {
        // Disguise scripted attempt as model
        const scriptedAttempt = rows.find((r) => r.kind === "action_attempt" && r.decisionSource === "scripted");
        if (scriptedAttempt) {
          scriptedAttempt.decisionSource = "model";
        }
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Scripted decisions disguised as genuine model decisions"))).toBe(true);
  });

  it("rejects a simulated report promoted to authenticated Paper evidence (verdict PASS)", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterVerdict: (verdict) => {
        verdict.verdict = "PASS";
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Simulated report promoted to authenticated Paper evidence"))).toBe(true);
  });

  it("rejects a simulated report promoted to authenticated Paper evidence (validator report VERIFIED)", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterReport: (report) => {
        report.overallStatus = "VERIFIED";
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Simulated report promoted to authenticated Paper evidence"))).toBe(true);
  });

  it("rejects journal hash tampering", () => {
    buildOfflineArtifactFixture(tempDir, { count: 2 });
    // Manually tamper with operator.jsonl without updating hash
    const journalPath = join(tempDir, "operator.jsonl");
    const lines = readFileSync(journalPath, "utf8").split("\n");
    // Tamper with the start row content without updating its hash
    lines[0] = lines[0]!.replace('"offline"', '"tampered_mode"');
    writeFileSync(journalPath, lines.join("\n"));

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("hash tampering detected"))).toBe(true);
  });

  it("rejects cross-citizen identity confusion in observations", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterJournalRows: (rows) => {
        // Swap citizenId on an observation
        const obs = rows.find((r) => r.kind === "action_observation" && r.citizenId === "gpt-a");
        if (obs) {
          obs.citizenId = "claude-a";
        }
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Cross-citizen identity confusion"))).toBe(true);
  });

  it("rejects out-of-order execution (observation seq precedes attempt seq)", () => {
    buildOfflineArtifactFixture(tempDir, {
      count: 2,
      alterJournalRows: (rows) => {
        // Move an observation row before its attempt row
        const attemptIdx = rows.findIndex((r) => r.kind === "action_attempt");
        const obsIdx = rows.findIndex((r) => r.kind === "action_observation");
        if (attemptIdx !== -1 && obsIdx !== -1 && obsIdx > attemptIdx) {
          const obsRow = rows.splice(obsIdx, 1)[0]!;
          rows.splice(attemptIdx, 0, obsRow);
        }
      },
    });

    const result = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("Out-of-order execution"))).toBe(true);
  });

  it("reports Codex journal CLI check as NOT_RUN when command is absent on this branch", () => {
    const journalCheck = checkJournalCliIntegration(process.cwd());
    expect(journalCheck.status).toBe("NOT_RUN");
    expect(journalCheck.details).toContain("PR #58");
    expect(journalCheck.details).toContain("not available on this branch");
  });

  it("formats Markdown summary with all required sections and fail-closed notice", () => {
    buildOfflineArtifactFixture(tempDir, { count: 2 });
    const scenarioRes = verifyOfflineScenario({
      artifactDir: tempDir,
      expectedCount: 2,
      expectedSha: VALID_SHA,
    });

    const report: OverallAcceptanceReport = {
      passed: true,
      testedSha: VALID_SHA,
      system: {
        platform: "darwin",
        arch: "arm64",
        nodeVersion: "v22.12.0",
        pnpmVersion: "10.16.0",
      },
      scenarios: {
        "scenario-2": scenarioRes,
      },
      journalCliCheck: {
        status: "NOT_RUN",
        command: "pnpm v1:journal",
        details: "PR #58 integration pending",
      },
      allErrors: [],
    };

    const md = formatMarkdownSummary(report);
    expect(md).toContain("# ✅ Offline Acceptance Verification Report: PASSED");
    expect(md).toContain(VALID_SHA);
    expect(md).toContain("1v1 (2 Citizens)");
    expect(md).toContain("Codex Journal CLI Integration");
    expect(md).toContain("NOT RUN / NOT READY");
    expect(md).toContain("Fail-Closed Policy");
  });
});
