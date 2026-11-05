/**
 * Phase 2 Tests: Simulated Fixture vs. Genuine Paper Tick Evidence
 *
 * Task 7 of the Phase 2 mission:
 * "Confirm the validator distinguishes a simulated 60-minute fixture
 * from genuine uninterrupted Paper tick/TPS evidence."
 *
 * Key distinction:
 * - Simulated: uniform durationMs (multiples of 60,000), no serverGameTick
 * - Real Paper: per-tick serverGameTick values showing monotone progression
 *   proving ~72,000 game ticks for 60 minutes (20 TPS × 3600s)
 */

import { describe, expect, it } from "vitest";
import { validateExperimentEvidence } from "../src/validator.js";
import { auditDurationAndTicks } from "../src/duration-verifier.js";
import { adaptRecorderJournal, rehashJournalLines } from "../src/recorder-adapter.js";
import { createTestManifest, JournalBuilder } from "../fixtures/helpers.js";

describe("Phase 2 — Simulated vs. Real Paper Tick Distinction", () => {
  it("flags uniform 60,000ms ticks without serverGameTick as simulated-only evidence", () => {
    const manifest = createTestManifest({ durationMinutes: 60 });
    const b = new JournalBuilder(manifest.experimentId);

    // Exactly 60 ticks of 60,000ms each with no serverGameTick — textbook simulated fixture
    for (let i = 0; i < 60; i++) {
      b.append({ kind: "tick", durationMs: 60_000, measuredTps: 19.8 });
    }
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: manifest.experimentId,
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:genuine-paper-attestation-signature",
      },
    });

    // Mode is correctly identified as offline_simulated
    expect(report.mode).toBe("offline_simulated");
    // Duration says complete but serverTickProven is false
    expect(report.durationAudit.serverTickProven).toBe(false);
    expect(report.durationAudit.serverTickCount).toBe(0);
    // The simulated-tick warning should appear in reasons
    const hasSimulatedWarning = report.durationAudit.reasons.some(
      (r) =>
        r.includes("simulated") &&
        r.includes("serverGameTick") &&
        r.includes("uninterrupted"),
    );
    expect(hasSimulatedWarning).toBe(true);
    // Overall status: NOT_PROVEN (simulated ticks do not prove real paper run)
    // But this fixture IS complete for simulated purposes, so violations from duration
    // should not appear — only the tick-evidence warning is in reasons but durationComplete
    // may still be true for the simulated claim.
    expect(report.durationAudit.tickCount).toBe(60);
    expect(report.durationAudit.tpsEvidencePresent).toBe(true);
  });

  it("accepts genuine Paper tick evidence with monotone serverGameTick progression", () => {
    const manifest = createTestManifest({ durationMinutes: 60 });
    const b = new JournalBuilder(manifest.experimentId);

    // Real Paper: 720 tick records, each covering 5 seconds (100 game ticks at 20 TPS)
    // Total: 720 × 5s = 3600s = 60 minutes; 720 × 100 = 72,000 server ticks
    let serverTick = 1000; // Starting game tick (some arbitrary starting world time)
    for (let i = 0; i < 720; i++) {
      b.append({
        kind: "tick",
        durationMs: 5_000,
        measuredTps: 19.9 + Math.random() * 0.1, // Realistic TPS variation
        serverGameTick: serverTick,
      });
      serverTick += 100; // 5 seconds × 20 TPS = 100 ticks per record
    }
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: manifest.experimentId,
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:genuine-paper-attestation-signature",
      },
    });

    // serverGameTick evidence is present and monotone → serverTickProven = true
    expect(report.durationAudit.serverTickProven).toBe(true);
    expect(report.durationAudit.serverTickCount).toBe(720);
    // No regression/gap warnings about serverGameTick
    const hasTickError = report.durationAudit.reasons.some(
      (r) => r.includes("regression") || r.includes("tick gap"),
    );
    expect(hasTickError).toBe(false);
    expect(report.durationAudit.tickCount).toBe(720);
  });

  it("detects a regressed serverGameTick (server restart or fabricated evidence)", () => {
    const manifest = createTestManifest({ durationMinutes: 5 });
    const b = new JournalBuilder(manifest.experimentId);

    // First 30 ticks: normal progression
    let serverTick = 5000;
    for (let i = 0; i < 30; i++) {
      b.append({
        kind: "tick",
        durationMs: 10_000,
        measuredTps: 20,
        serverGameTick: serverTick,
      });
      serverTick += 200;
    }
    // REGRESSION: tick jumps back (server restarted or log was spliced)
    b.append({ kind: "tick", durationMs: 10_000, measuredTps: 20, serverGameTick: 100 });
    // Then continues from the lower point
    b.append({ kind: "tick", durationMs: 10_000, measuredTps: 20, serverGameTick: 300 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: manifest.experimentId,
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:genuine-paper-attestation-signature",
      },
    });

    expect(report.durationAudit.serverTickProven).toBe(false);
    const regressionReason = report.durationAudit.reasons.find((r) =>
      r.includes("regression"),
    );
    expect(regressionReason).toBeDefined();
  });

  it("detects a large serverGameTick gap indicating server pause or spliced log", () => {
    const manifest = createTestManifest({ durationMinutes: 5 });
    const b = new JournalBuilder(manifest.experimentId);

    // 10 normal ticks
    let serverTick = 0;
    for (let i = 0; i < 10; i++) {
      b.append({
        kind: "tick",
        durationMs: 10_000,
        measuredTps: 20,
        serverGameTick: serverTick,
      });
      serverTick += 200;
    }
    // Massive gap: 50,000 ticks = ~41 minutes at 20 TPS — cannot be from a continuous run
    b.append({
      kind: "tick",
      durationMs: 10_000,
      measuredTps: 20,
      serverGameTick: serverTick + 50_000,
    });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: manifest.experimentId,
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:genuine-paper-attestation-signature",
      },
    });

    expect(report.durationAudit.serverTickProven).toBe(false);
    const gapReason = report.durationAudit.reasons.find((r) => r.includes("gap"));
    expect(gapReason).toBeDefined();
  });
});

describe("Phase 2 — Recorder Adapter: Missing serverGameTick", () => {
  it("adapter reports RECORDER_GAP_SERVER_GAME_TICK when recorder lacks serverGameTick", () => {
    // Simulate raw recorder JSONL with ticks but no serverGameTick (current recorder behavior)
    const recorderLines = rehashJournalLines(
      [
        { kind: "start", recordingAudience: "operator_only", mode: "offline" },
        { kind: "tick", durationMs: 60_000, measuredTps: 20.0 },
        { kind: "tick", durationMs: 60_000, measuredTps: 19.9 },
        { kind: "shutdown", completedDuration: false, mode: "offline" },
      ],
      "exp-recorder-test-001",
    );

    const result = adaptRecorderJournal(recorderLines);

    const serverTickGap = result.notProven.find(
      (n) => n.code === "RECORDER_GAP_SERVER_GAME_TICK",
    );
    expect(serverTickGap).toBeDefined();
    expect(serverTickGap?.missingFields).toContain("serverGameTick");
    expect(result.recorderGaps.some((g) => g.includes("serverGameTick"))).toBe(true);
  });

  it("adapter accepts recorder ticks WITH serverGameTick without generating gap report", () => {
    const recorderLines = rehashJournalLines(
      [
        { kind: "start", recordingAudience: "operator_only", mode: "offline" },
        { kind: "tick", durationMs: 5_000, measuredTps: 20.0, serverGameTick: 1000 },
        { kind: "tick", durationMs: 5_000, measuredTps: 20.0, serverGameTick: 1100 },
        { kind: "shutdown", completedDuration: false, mode: "offline" },
      ],
      "exp-recorder-server-tick-001",
    );

    const result = adaptRecorderJournal(recorderLines);

    const serverTickGap = result.notProven.find(
      (n) => n.code === "RECORDER_GAP_SERVER_GAME_TICK",
    );
    expect(serverTickGap).toBeUndefined();
    expect(result.recorderGaps.some((g) => g.includes("serverGameTick"))).toBe(false);
  });
});

describe("Phase 2 — Duration Verifier Direct Unit Tests", () => {
  it("returns serverTickProven=false with no tick rows at all", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 5,
      journalRows: [],
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.serverTickCount).toBe(0);
  });

  it("returns serverTickProven=true with consistent serverGameTick values", () => {
    // Build minimal tick rows with serverGameTick using the schema discriminated union
    // We need to create journalRow objects that match JournalRow type
    const rows = Array.from({ length: 5 }, (_, i) => ({
      kind: "tick" as const,
      experimentId: "test-exp",
      seq: i + 1,
      at: new Date(Date.now() + i * 5000).toISOString(),
      previousHash: `hash-${i}`,
      hash: `hash-${i + 1}`,
      durationMs: 5_000,
      measuredTps: 20 as number,
      serverGameTick: i * 100,
    }));

    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: rows,
      experimentId: "test-exp",
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: "test-exp",
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:genuine-paper-attestation-signature",
      },
    });

    expect(audit.serverTickProven).toBe(true);
    expect(audit.serverTickCount).toBe(5);
    const hasRegressionError = audit.reasons.some((r) => r.includes("regression"));
    expect(hasRegressionError).toBe(false);
  });
});
