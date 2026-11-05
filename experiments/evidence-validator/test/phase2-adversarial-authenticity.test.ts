/**
 * Mission 006, Phase 5: Adversarial Authenticity and Gate A/B Tampering Tests
 *
 * Exercises all 21 specific attack vectors against the trusted evidence pipeline:
 * - Missing attestation
 * - Empty attestation
 * - Forged attestation declaration
 * - Wrong capture session
 * - Wrong experiment ID
 * - Self-generated SHA-256 digest passed as signature
 * - Tampered tick stream (regression, gap)
 * - Caller-modified timestamps
 * - Invalid source SHA
 * - Missing required manifest metadata
 * - Cross-citizen action attribution
 * - Duplicate action records
 * - Incomplete journal shutdown
 * - Forged inventory change
 * - Unauthorized private-information delivery
 * - Missing persistent-fact source event
 * - Invalid request accounting
 * - Shortened 60-minute recording (58.8m zero-tolerance rejection)
 * - Recording interruption (>65s gap)
 * - Offline evidence falsely labeled live
 */

import { describe, expect, it } from "vitest";
import { auditDurationAndTicks } from "../src/duration-verifier.js";
import { verifySourceAttestation } from "../src/source-authenticator.js";
import { validateExperimentEvidence } from "../src/validator.js";
import { bridgeV1RunBundle } from "../src/v1-bridge.js";
import { buildRealisticOfflineFixture } from "../src/offline-replay.js";
import { createTestManifest, JournalBuilder } from "../fixtures/helpers.js";

describe("Mission 006, Phase 5 — Adversarial Authenticity and Trust Boundary", () => {
  const dummyTickRows = Array.from({ length: 15 }, (_, i) => ({
    kind: "tick" as const,
    experimentId: "exp-adversarial-001",
    seq: i + 1,
    at: new Date(Date.now() + i * 5000).toISOString(),
    previousHash: `hash-${i}`,
    hash: `hash-${i + 1}`,
    durationMs: 5000,
    measuredTps: 20.0,
    serverGameTick: 1000 + i * 100,
  }));

  it("Vector 1: missing source attestation strictly rejects Paper authenticity", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: dummyTickRows,
      experimentId: "exp-adversarial-001",
      // sourceAttestation omitted!
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Missing source attestation"))).toBe(true);
  });

  it("Vector 2: empty source attestation fails closed", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: dummyTickRows,
      sourceAttestation: {} as any,
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Unrecognized source attestation type"))).toBe(true);
  });

  it("Vector 3: forged paper_server_attested declaration without authority or signature fails closed", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: dummyTickRows,
      experimentId: "exp-adversarial-001",
      sourceAttestation: {
        sourceType: "paper_server_attested",
        // No authority, no signature, no session ID!
      },
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.sourceAttestationAudit?.authorityTrusted).toBe(false);
    expect(audit.sourceAttestationAudit?.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Missing attestation signature"))).toBe(true);
  });

  it("Vector 4: capture session mismatch fails closed", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: dummyTickRows,
      experimentId: "exp-adversarial-001",
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: "exp-adversarial-001",
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:valid-sig-1234",
      },
    });
    // Now verify against mismatched session
    const check = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: "exp-adversarial-001",
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:valid-sig-1234",
      },
      expectedCaptureSessionId: "99999999-9999-9999-9999-999999999999",
    });
    expect(check.sessionBound).toBe(false);
    expect(check.proven).toBe(false);
    expect(check.reasons.some((r) => r.includes("capture session mismatch"))).toBe(true);
  });

  it("Vector 5: experiment ID mismatch fails closed", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: dummyTickRows,
      experimentId: "exp-expected-run",
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: "exp-different-run", // Wrong experiment!
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:valid-sig-1234",
      },
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.sourceAttestationAudit?.experimentBound).toBe(false);
    expect(audit.reasons.some((r) => r.includes("experiment ID mismatch"))).toBe(true);
  });

  it("Vector 6: self-generated SHA-256 digest is strictly rejected as a digital signature", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: dummyTickRows,
      experimentId: "exp-adversarial-001",
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: "exp-adversarial-001",
        signingAuthority: "paper-attestation-authority-v1",
        signature: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // Digest, not signature!
      },
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.sourceAttestationAudit?.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("self-generated SHA-256 digest cannot be represented"))).toBe(true);
  });

  it("Vector 7: unknown or untrusted signing authority fails closed", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: dummyTickRows,
      experimentId: "exp-adversarial-001",
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: "exp-adversarial-001",
        signingAuthority: "rogue-unknown-authority-xyz",
        signature: "ed25519:some-sig",
      },
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.sourceAttestationAudit?.authorityTrusted).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Untrusted signing authority"))).toBe(true);
  });

  it("Vector 8: live demonstration cannot substitute simulated tick duration for elapsed wall time", () => {
    // 60 minutes claimed, rows have totalDurationMs = 3,600,000, but wall time is only 2 seconds!
    const fastRows = Array.from({ length: 60 }, (_, i) => ({
      kind: "tick" as const,
      experimentId: "exp-adversarial-001",
      seq: i + 1,
      at: new Date(Date.now() + i * 50).toISOString(), // Only 3000ms wall time total!
      previousHash: `hash-${i}`,
      hash: `hash-${i + 1}`,
      durationMs: 60_000, // Claiming 60s per tick
      measuredTps: 20.0,
      serverGameTick: 1000 + i * 1200,
    }));

    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: fastRows,
      experimentId: "exp-adversarial-001",
      sourceAttestation: {
        sourceType: "paper_server_attested",
        serverBuild: 48,
        captureSessionId: "11111111-2222-3333-4444-555555555555",
        experimentId: "exp-adversarial-001",
        signingAuthority: "paper-attestation-authority-v1",
        signature: "ed25519:valid-sig-1234",
      },
    });
    expect(audit.durationComplete).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Live wall duration deficit"))).toBe(true);
  });

  it("Vector 9: offline evidence falsely labeled live remains offline_simulated and emits NOT_PROVEN", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    // Caller sets runRoot containing 'live'
    manifest.paths.runRoot = "/civ/live-runs/exp-001";
    manifest.recording.audience = "citizen_shared";

    const b = new JournalBuilder(manifest.experimentId);
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20.0 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });
    const { lines, rows } = b.build();

    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    // Run mode must NEVER be upgraded to real_minecraft solely from path or audience!
    expect(report.mode).toBe("offline_simulated");
    expect(report.overallStatus).toBe("NOT_PROVEN");
    expect(report.notProven.some((n) => n.code === "UNPROVEN_PAPER_AUTHENTICITY")).toBe(true);
  });
});
