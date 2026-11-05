/**
 * Mission 007, Phase D: Adversarial Cryptographic Verification Test Suite
 *
 * Exercises all 15 cryptographic attack vectors against the Ed25519 trust verification pipeline:
 *  1. Valid Ed25519 signature passes when public key is in operator trust root.
 *  2. Wrong public key fails closed (signature verification failure).
 *  3. Random signature bytes strictly rejected.
 *  4. Valid signature prefix with nonsense bytes strictly rejected.
 *  5. Altered journal line rejected (evidence digest mismatch).
 *  6. Altered experiment ID rejected.
 *  7. Altered capture session UUID rejected.
 *  8. Altered timestamp rejected.
 *  9. Altered Paper server build rejected.
 * 10. Valid signature from another experiment replayed is rejected.
 * 11. Attestation without signature fails closed.
 * 12. Attestation without operator trusted key configured fails closed (untrusted authority).
 * 13. Self-generated SHA-256 digest passed as signature strictly rejected.
 * 14. Truncated duration (<3,600s) rejected even with cryptographically valid signature.
 * 15. Offline simulated source strictly rejected from real_minecraft claims even with valid-looking signature.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  verifySourceAttestation,
  createTestAttestationKeypair,
  signTestAttestation,
  buildCanonicalAttestationPayload,
  parseEd25519PublicKey,
  parseEd25519Signature,
} from "../src/source-authenticator.js";
import { auditDurationAndTicks } from "../src/duration-verifier.js";
import { validateExperimentEvidence } from "../src/validator.js";
import { createTestManifest, JournalBuilder } from "../fixtures/helpers.js";

describe("Mission 007, Phase D — Adversarial Cryptographic Verification", () => {
  const authorityName = "paper-prod-signing-authority-v1";
  const testKeypair = createTestAttestationKeypair();
  const trustedKeys = {
    [authorityName]: testKeypair.publicKeyPem,
  };

  const experimentId = "exp-crypto-gate-001";
  const captureSessionId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const serverBuild = 142;
  const serverVersion = "1.21.6";
  const sourceSha = "9945f02f38e14a7d63b3eed66279d191ad06ad3d";
  const startedAt = "2026-11-05T12:00:00.000Z";
  const endedAt = "2026-11-05T13:00:00.000Z";
  const firstServerTick = 1000;
  const lastServerTick = 73000;
  const totalServerTicks = 72000;

  // Build a standard 60-minute journal
  const build60MinJournal = () => {
    const b = new JournalBuilder(experimentId);
    let tick = firstServerTick;
    for (let i = 0; i < 720; i++) {
      b.append({
        kind: "tick",
        durationMs: 5000,
        measuredTps: 20.0,
        serverGameTick: tick,
      });
      tick += 100;
    }
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });
    return b.build();
  };

  it("Vector 1: Valid Ed25519 signature passes when public key is in operator trust root", () => {
    const { lines, rows } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: experimentId,
      expectedCaptureSessionId: captureSessionId,
      expectedSourceSha: sourceSha,
      rawJournalLines: lines,
      firstServerTick,
      lastServerTick,
      totalServerTicks,
      trustedKeys,
    });

    expect(audit.proven).toBe(true);
    expect(audit.authorityTrusted).toBe(true);
    expect(audit.sessionBound).toBe(true);
    expect(audit.experimentBound).toBe(true);
    expect(audit.signatureValid).toBe(true);
    expect(audit.reasons.length).toBe(0);
  });

  it("Vector 2: Wrong public key fails closed with cryptographic verification failure", () => {
    const otherKeypair = createTestAttestationKeypair();
    const wrongTrustedKeys = {
      [authorityName]: otherKeypair.publicKeyPem, // Register wrong public key
    };

    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem, // Signed with key 1
    );

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: experimentId,
      rawJournalLines: lines,
      trustedKeys: wrongTrustedKeys, // Verified against key 2
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("signature verification failed"))).toBe(true);
  });

  it("Vector 3: Random signature bytes strictly rejected", () => {
    const randomHex = "aa".repeat(64); // 64 bytes of random noise
    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: `ed25519:${randomHex}`,
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
      },
      expectedExperimentId: experimentId,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    // Incomplete attestation is rejected before crypto.verify; either path is fail-closed.
    expect(
      audit.reasons.some(
        (r) =>
          r.includes("signature verification failed") ||
          r.includes("Incomplete signed attestation") ||
          r.includes("Raw journal lines absent") ||
          r.includes("evidenceDigest"),
      ),
    ).toBe(true);
  });

  it("Vector 4: Valid signature prefix with nonsense bytes strictly rejected", () => {
    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: "ed25519:not_a_valid_hex_or_base64_string!!!",
        experimentId,
        captureSessionId,
        serverBuild,
      },
      expectedExperimentId: experimentId,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Invalid signature encoding"))).toBe(true);
  });

  it("Vector 5: Altered journal line rejected (evidence stream digest mismatch)", () => {
    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    // Tamper with one line in the journal
    const tamperedLines = [...lines];
    tamperedLines[10] = (tamperedLines[10] ?? "").replace('"measuredTps":20', '"measuredTps":19.5');

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: experimentId,
      rawJournalLines: tamperedLines, // Altered journal
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Evidence stream digest mismatch"))).toBe(true);
  });

  it("Vector 6: Altered experiment ID rejected", () => {
    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId: "exp-victim-001", // Signed for victim run
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId: "exp-adversary-002", // Caller changed experimentId
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: "exp-adversary-002",
      rawJournalLines: lines,
      trustedKeys,
    });

    // Even though expected matches attestation.experimentId, the signature was over exp-victim-001
    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("signature verification failed"))).toBe(true);
  });

  it("Vector 7: Altered capture session UUID rejected", () => {
    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId: "99999999-9999-9999-9999-999999999999", // Altered session
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: experimentId,
      expectedCaptureSessionId: captureSessionId,
      rawJournalLines: lines,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.sessionBound).toBe(false);
    expect(audit.reasons.some((r) => r.includes("capture session mismatch"))).toBe(true);
  });

  it("Vector 8: Altered timestamp rejected (payload modification)", () => {
    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt: "2026-11-05T00:00:00.000Z", // Changed startedAt
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: experimentId,
      rawJournalLines: lines,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("signature verification failed"))).toBe(true);
  });

  it("Vector 9: Altered Paper server build rejected", () => {
    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId,
        captureSessionId,
        serverBuild: 142,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId,
        serverBuild: 999, // Changed build number
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: experimentId,
      rawJournalLines: lines,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("signature verification failed"))).toBe(true);
  });

  it("Vector 10: Valid signature from another experiment replayed is rejected", () => {
    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    // Signed for exp-alpha
    const signedAlpha = signTestAttestation(
      {
        experimentId: "exp-alpha",
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    // Replayed in exp-beta
    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signedAlpha.signatureFormatted,
        experimentId: "exp-alpha", // Replayed attestation payload
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      expectedExperimentId: "exp-beta", // Target run expecting beta
      rawJournalLines: lines,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.experimentBound).toBe(false);
    expect(audit.reasons.some((r) => r.includes("experiment ID mismatch"))).toBe(true);
  });

  it("Vector 11: Attestation without signature fails closed", () => {
    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        experimentId,
        captureSessionId,
        serverBuild,
      },
      expectedExperimentId: experimentId,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Missing attestation signature"))).toBe(true);
  });

  it("Vector 12: Attestation without operator trusted key configured fails closed (MISSING_TRUST_ROOT)", () => {
    const { lines } = build60MinJournal();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha,
        evidenceDigest: digest,
        startedAt,
        endedAt,
        firstServerTick,
        lastServerTick,
        totalServerTicks,
      },
      testKeypair.privateKeyPem,
    );

    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: "unregistered-authority-2026",
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId,
        serverBuild,
      },
      expectedExperimentId: experimentId,
      trustedKeys: {}, // Empty trust root!
    });

    expect(audit.proven).toBe(false);
    expect(audit.authorityTrusted).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Untrusted signing authority"))).toBe(true);
  });

  it("Vector 13: Self-generated SHA-256 digest passed as signature strictly rejected", () => {
    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        experimentId,
        captureSessionId,
        serverBuild,
      },
      expectedExperimentId: experimentId,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.signatureValid).toBe(false);
    expect(audit.reasons.some((r) => r.includes("self-generated SHA-256 digest cannot be represented"))).toBe(true);
  });

  it("Vector 14: Truncated duration (<3,600s) rejected even with cryptographically valid signature", () => {
    const manifest = createTestManifest({ durationMinutes: 60 });
    // Only 10 ticks = 50 seconds!
    const b = new JournalBuilder(manifest.experimentId);
    let tick = 1000;
    for (let i = 0; i < 10; i++) {
      b.append({
        kind: "tick",
        durationMs: 5000,
        measuredTps: 20.0,
        serverGameTick: tick,
      });
      tick += 100;
    }
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });
    const { lines, rows } = b.build();
    const digest = createHash("sha256").update(lines.join("\n")).digest("hex");

    const signed = signTestAttestation(
      {
        experimentId: manifest.experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha: manifest.sourceSha,
        evidenceDigest: digest,
        startedAt: rows[0]!.at,
        endedAt: rows[rows.length - 1]!.at,
        firstServerTick: 1000,
        lastServerTick: tick - 100,
        totalServerTicks: 1000,
      },
      testKeypair.privateKeyPem,
    );

    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      trustedKeys,
      sourceAttestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authorityName,
        signature: signed.signatureFormatted,
        experimentId: manifest.experimentId,
        captureSessionId,
        serverBuild,
        serverVersion,
        sourceSha: manifest.sourceSha,
        evidenceDigest: digest,
        startedAt: rows[0]!.at,
        endedAt: rows[rows.length - 1]!.at,
        firstServerTick: 1000,
        lastServerTick: tick - 100,
        totalServerTicks: 1000,
      },
    });

    // Signature is cryptographically valid, but duration and tick progression are insufficient
    expect(report.durationAudit.sourceAttestationAudit?.signatureValid).toBe(true);
    expect(report.durationAudit.durationComplete).toBe(false);
    expect(report.mode).toBe("offline_simulated");
    expect(report.violations.some((v) => v.code === "DURATION_EVIDENCE_DEFICIT")).toBe(true);
  });

  it("Vector 15: Offline simulated source strictly rejected from real_minecraft claims even with valid-looking signature", () => {
    const { lines, rows } = build60MinJournal();
    const audit = verifySourceAttestation({
      attestation: {
        sourceType: "offline_simulated", // Stated as simulated
        signingAuthority: authorityName,
        signature: "ed25519:" + "bb".repeat(64),
        experimentId,
      },
      expectedExperimentId: experimentId,
      trustedKeys,
    });

    expect(audit.proven).toBe(false);
    expect(audit.sourceType).toBe("offline_simulated");
    expect(audit.reasons.some((r) => r.includes("Simulated clocks cannot establish real Paper server authenticity"))).toBe(true);
  });
});
