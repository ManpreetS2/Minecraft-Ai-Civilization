/**
 * Mission 007 Phase B — Incomplete attestation must never prove Paper authenticity.
 * Synthetic test keypairs are fixtures only; they are not genuine Paper evidence.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createTestAttestationKeypair,
  signTestAttestation,
  verifySourceAttestation,
} from "../src/source-authenticator.js";

describe("Mission 007 Phase B — incomplete Paper attestation fails closed", () => {
  const authority = "paper-prod-signing-authority-v1";
  const keys = createTestAttestationKeypair();
  const trustedKeys = { [authority]: keys.publicKeyPem };
  const experimentId = "exp-incomplete-001";
  const captureSessionId = "11111111-2222-3333-4444-555555555555";
  const sourceSha = "a".repeat(40);
  const lines = ['{"seq":1,"kind":"start"}', '{"seq":2,"kind":"shutdown"}'];
  const digest = createHash("sha256").update(lines.join("\n")).digest("hex");
  const baseParams = {
    experimentId,
    captureSessionId,
    serverBuild: 48,
    serverVersion: "1.21.6",
    sourceSha,
    evidenceDigest: digest,
    startedAt: "2026-11-05T12:00:00.000Z",
    endedAt: "2026-11-05T13:00:00.000Z",
    firstServerTick: 1000,
    lastServerTick: 73000,
    totalServerTicks: 72000,
  };

  function signAndAudit(attestationOver: Record<string, unknown>, verifyOver: Record<string, unknown> = {}) {
    const signed = signTestAttestation(baseParams, keys.privateKeyPem);
    return verifySourceAttestation({
      attestation: {
        sourceType: "paper_server_attested",
        signingAuthority: authority,
        signature: signed.signatureFormatted,
        experimentId,
        captureSessionId,
        serverBuild: 48,
        serverVersion: "1.21.6",
        sourceSha,
        evidenceDigest: digest,
        startedAt: baseParams.startedAt,
        endedAt: baseParams.endedAt,
        firstServerTick: 1000,
        lastServerTick: 73000,
        totalServerTicks: 72000,
        ...attestationOver,
      } as never,
      expectedSourceSha: sourceSha,
      rawJournalLines: lines,
      trustedKeys,
      ...verifyOver,
    });
  }

  it("proves only when attestation, journal, digest, SHA, ticks, and timestamps are complete", () => {
    expect(signAndAudit({}).proven).toBe(true);
  });

  it("refuses when raw journal lines are absent", () => {
    const audit = signAndAudit({}, { rawJournalLines: undefined });
    expect(audit.proven).toBe(false);
    expect(audit.reasons.join(" ")).toMatch(/Raw journal lines absent/i);
  });

  it("refuses when attested evidence digest is missing", () => {
    const audit = signAndAudit({ evidenceDigest: undefined });
    expect(audit.proven).toBe(false);
    expect(audit.reasons.join(" ")).toMatch(/evidenceDigest/i);
  });

  it("refuses when attested source SHA is missing", () => {
    const audit = signAndAudit({ sourceSha: undefined });
    expect(audit.proven).toBe(false);
    expect(audit.reasons.join(" ")).toMatch(/sourceSha/i);
  });

  it("refuses when signed start/end timestamps are missing", () => {
    const audit = signAndAudit({ startedAt: undefined, endedAt: undefined });
    expect(audit.proven).toBe(false);
    expect(audit.reasons.join(" ")).toMatch(/startedAt\/endedAt/i);
  });

  it("refuses when tick-range values are omitted even if the caller supplies them", () => {
    const audit = signAndAudit(
      { firstServerTick: undefined, lastServerTick: undefined, totalServerTicks: undefined },
      { firstServerTick: 1000, lastServerTick: 73000, totalServerTicks: 72000 },
    );
    expect(audit.proven).toBe(false);
    expect(audit.reasons.join(" ")).toMatch(/Caller-supplied tick ranges cannot substitute/i);
  });

  it("refuses when expected candidate source SHA is not supplied for verification", () => {
    const audit = signAndAudit({}, { expectedSourceSha: undefined });
    expect(audit.proven).toBe(false);
    expect(audit.reasons.join(" ")).toMatch(/Expected candidate sourceSha missing/i);
  });
});
