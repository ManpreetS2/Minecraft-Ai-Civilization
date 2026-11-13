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
  const repository = "ManpreetS2/Minecraft-Ai-Civilization-windows-backup";
  const citizens = count === 2 ? ["gpt-a", "claude-a"] : ["gpt-a", "gpt-b", "claude-a", "claude-b"];
  const receiptsDir = join(dir, "receipts");
  mkdirSync(receiptsDir, { recursive: true });

  // 1. Build the planned actions. The shape mirrors what `pnpm v1:offline` really records (event ids, journal coordinates, receipt pins).
  const actionDetails: Array<{
    attemptId: string;
    citizenId: string;
    decisionSource: string;
    eventId: string;
    receiptId: string;
    step: number;
  }> = [];
  for (let step = 0; step < 3; step++) {
    for (const citizenId of citizens) {
      const attemptId = `attempt-${citizenId}-${step + 1}`;
      actionDetails.push({
        attemptId,
        citizenId,
        decisionSource: step === 0 ? "planner" : "scripted",
        eventId: `event-${attemptId}`,
        receiptId: `receipt-${attemptId}`,
        step,
      });
    }
  }

  // 2. Build journal rows
  const rawRows: Record<string, unknown>[] = [];
  const target = { x: 6, y: 64, z: 3 };
  const position = { x: 6.05, y: 64, z: 3.44 };
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
        decisionEventId: act.eventId,
        expectedItem: "oak_log",
        target,
      });
    }
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
        position,
        hungerBefore: 20,
        hungerAfter: 20,
        worldChanges: [{ position: target, before: "oak_log", after: "air" }],
      });
    }
  }

  // Allow custom alterations to journal rows before hashing (hash chain is recomputed, as a forger would).
  if (options.alterJournalRows) {
    options.alterJournalRows(rawRows);
  }

  let priorHash = "";
  const chainedLines: string[] = [];
  const finalRows: Record<string, unknown>[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]!;
    row.seq = i + 1;
    const { row: finalizedRow, hash } = createJournalRow(row, priorHash);
    priorHash = hash;
    chainedLines.push(JSON.stringify(finalizedRow));
    finalRows.push(finalizedRow);
  }

  const journalContent = chainedLines.join("\n") + "\n";
  const journalPath = join(dir, "operator.jsonl");
  writeFileSync(journalPath, journalContent);
  const journalSha256 = createHash("sha256").update(Buffer.from(journalContent)).digest("hex");

  // 3. Receipts are derived from the journal rows that were actually written, then pinned by SHA-256 in the manifest.
  const manifestCitizens = citizens.map((id) => ({
    id,
    family: id.startsWith("gpt") ? "gpt" : "claude",
    model: null,
    sessionId: `session-${id}`,
    authentication: "synthetic",
    initialInventory: {},
  }));
  const actions: Record<string, unknown>[] = [];
  const sourceReceipts: Record<string, unknown>[] = [];
  let seqNum = 1;
  for (const act of actionDetails) {
    const attemptRow = finalRows.find((r) => r.kind === "action_attempt" && r.attemptId === act.attemptId) ?? {};
    const obsRow = finalRows.find((r) => r.kind === "action_observation" && r.attemptId === act.attemptId) ?? {};
    const citizen = manifestCitizens.find((c) => c.id === act.citizenId)!;
    actions.push({
      sequence: seqNum++,
      citizenId: act.citizenId,
      reportedSuccess: true,
      observedSuccess: true,
      inventoryDelta: { oak_log: 1 },
      actionType: "gather",
      expectedDelta: { oak_log: 1 },
      attemptId: act.attemptId,
      eventId: act.eventId,
      sourceEventId: act.eventId,
      decisionSource: act.decisionSource,
      runId,
      sourceSha: sha,
      receiptId: act.receiptId,
    });
    const receiptBytes = JSON.stringify(
      {
        id: act.receiptId,
        eventId: act.eventId,
        attemptId: act.attemptId,
        runId,
        sourceSha: sha,
        repository,
        citizenId: act.citizenId,
        family: citizen.family,
        model: citizen.model,
        sessionId: citizen.sessionId,
        actionType: "gather",
        inventoryScope: "citizen",
        observedSuccess: true,
        journal: { attemptSequence: attemptRow.seq, observationSequence: obsRow.seq },
        worldChanges: obsRow.worldChanges,
        hungerBefore: obsRow.hungerBefore,
        hungerAfter: obsRow.hungerAfter,
        targetPosition: attemptRow.target,
        inventoryBefore: obsRow.beforeInventory,
        inventoryAfter: obsRow.afterInventory,
        positionAfter: obsRow.position,
      },
      null,
      2,
    );
    writeFileSync(join(receiptsDir, `${act.receiptId}.json`), receiptBytes);
    sourceReceipts.push({
      id: act.receiptId,
      eventId: act.eventId,
      attemptId: act.attemptId,
      runId,
      sourceSha: sha,
      repository,
      citizenId: act.citizenId,
      reference: `receipts/${act.receiptId}.json`,
      sha256: createHash("sha256").update(Buffer.from(receiptBytes)).digest("hex"),
    });
  }

  // 4. Manifest
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    runId,
    repository,
    sourceSha: sha,
    mode: "offline-fixture",
    configuration: { count, experimentId: `off${count}` },
    citizens: manifestCitizens,
    actions,
    sourceReceipts,
    persistentFacts: [],
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

  // 5. Verdict
  const verdict: Record<string, unknown> = {
    verdict: "NOT PROVEN",
    failures: [],
    unproven: ["Paper ticks unavailable"],
    journalConsistent: true,
    evidenceJournalSha256: journalSha256,
  };
  if (options.alterVerdict) {
    options.alterVerdict(verdict);
  }
  writeFileSync(join(dir, "verdict.json"), JSON.stringify(verdict, null, 2));

  // 6. Validator report
  const totalActions = count * 3;
  const report: Record<string, unknown> = {
    overallStatus: "NOT_PROVEN",
    environment: "Offline Simulated Fixture (Not a live Minecraft demo claim)",
    mode: "offline_simulated",
    sourceSha: sha,
    runId,
    citizens,
    attribution: { runId, citizens },
    sourceAttestationAudit: { proven: false, sourceType: "missing" },
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

  // 7. Acceptance: the real shape. Offline fixtures can never measure live acceptance.
  writeFileSync(
    join(dir, "acceptance.json"),
    JSON.stringify(
      {
        repository,
        candidateSha: sha,
        catalogValid: true,
        offline: { passed: 0, total: 30, percentage: null, measurement: "NOT MEASURABLE" },
        live: { passed: 0, total: 37, percentage: null, measurement: "NOT MEASURABLE" },
        milestones: [{ gate: "Gate A", passed: 0, total: 13, accepted: false }],
        milestoneCount: { passed: 0, total: 2 },
        results: [
          { criterion: { id: "A-CONNECT" }, offline: { verdict: "NOT PROVEN" }, live: { verdict: "NOT PROVEN" } },
          { criterion: { id: "A-IDENTITY" }, offline: { verdict: "FAIL" }, live: { verdict: "FAIL" } },
        ],
      },
      null,
      2,
    ),
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

  it("computes journal row hash consistently without the hash property", () => {
    const baseRow = { seq: 1, kind: "start", previousHash: "", data: "test" };
    const hash1 = computeJournalRowHash(baseRow);
    const hash2 = computeJournalRowHash({ ...baseRow, hash: "dummy-hash" });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
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
    const journalCheck = checkJournalCliIntegration(tempDir);
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
    // Changed deliberately (hardening branch): the old unqualified "Offline Acceptance Verification Report: PASSED" headline read as live
    // acceptance for synthetic evidence. The headline must state it is structural and that Paper execution is NOT PROVEN.
    expect(md.split("\n")[0]).toBe("# ✅ Offline structural checks PASSED — genuine Paper execution NOT PROVEN");
    expect(md).not.toContain("Offline Acceptance Verification Report: PASSED");
    expect(md).toContain("**Genuine Paper execution:** NOT PROVEN");
    expect(md).toContain(VALID_SHA);
    expect(md).toContain("1v1 (2 Citizens)");
    expect(md).toContain("Codex Journal CLI Integration");
    expect(md).toContain("NOT RUN / NOT READY");
    expect(md).toContain("Fail-Closed Policy");
  });
});

 describe("Round 5 identity types", () => {
  for (const value of [null, 7, {}, [], "", " "]) {
    it(`rejects malformed runId ${JSON.stringify(value)}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "r5-ci-"));
      try {
        buildOfflineArtifactFixture(dir, { alterManifest: m => { m.runId = value; } });
        expect(verifyOfflineScenario({ artifactDir: dir, expectedCount: 2, expectedSha: VALID_SHA }).passed).toBe(false);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
  it("rejects contradictory report identities", () => {
    const dir = mkdtempSync(join(tmpdir(), "r5-ci-"));
    try {
      buildOfflineArtifactFixture(dir, { alterReport: r => { r.attribution = { runId: "foreign" }; } });
      expect(verifyOfflineScenario({ artifactDir: dir, expectedCount: 2, expectedSha: VALID_SHA }).passed).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
 });

it("rejects null manifest metadata without throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "r5-ci-null-"));
  try {
    buildOfflineArtifactFixture(dir);
    writeFileSync(join(dir, "manifest.json"), "null");
    expect(verifyOfflineScenario({ artifactDir: dir, expectedCount: 2, expectedSha: VALID_SHA }).passed).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
