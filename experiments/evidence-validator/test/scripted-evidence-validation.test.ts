import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  adaptRecorderJournal,
  validateExperimentEvidence,
  verifySourceAttestation,
  parseEd25519PublicKey,
  createTestAttestationKeypair,
} from "../src/index.js";
import { journalAttemptSchema, journalStartSchema, type JournalRow } from "../src/schemas.js";

describe("Scripted Action Validation and Evidence Attribution", () => {
  describe("1. Decision Source Contract", () => {
    it("recognizes scripted, model, planner, and reflex in journalAttemptSchema", () => {
      const base = {
        kind: "action_attempt" as const,
        experimentId: "exp-1",
        seq: 1,
        at: "2026-11-06T00:00:00.000Z",
        previousHash: "",
        hash: "h1",
        citizenId: "c1",
        attemptId: "att-1",
        action: "gather" as const,
        decisionEventId: "d1",
      };

      for (const src of ["scripted", "model", "planner", "reflex"] as const) {
        const result = journalAttemptSchema.safeParse({ ...base, decisionSource: src });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.decisionSource).toBe(src);
        }
      }
    });

    it("rejects unknown decision sources", () => {
      const base = {
        kind: "action_attempt" as const,
        experimentId: "exp-1",
        seq: 1,
        at: "2026-11-06T00:00:00.000Z",
        previousHash: "",
        hash: "h1",
        citizenId: "c1",
        attemptId: "att-1",
        action: "gather" as const,
        decisionEventId: "d1",
        decisionSource: "magic",
      };

      const result = journalAttemptSchema.safeParse(base);
      expect(result.success).toBe(false);
    });

    it("preserves decisionSource 'scripted' without translating to 'model' through adapter and validator", () => {
      const attemptLine = JSON.stringify({
        kind: "action_attempt",
        experimentId: "off2",
        seq: 2,
        at: "2026-11-06T00:00:01.000Z",
        previousHash: "h1",
        hash: "h2",
        citizenId: "gpt-a",
        attemptId: "att-scripted-1",
        action: "gather",
        decisionSource: "scripted",
        decisionEventId: "dev-1",
        expectedItem: "oak_log",
      });

      const obsLine = JSON.stringify({
        kind: "action_observation",
        experimentId: "off2",
        seq: 3,
        at: "2026-11-06T00:00:02.000Z",
        previousHash: "h2",
        hash: "h3",
        citizenId: "gpt-a",
        attemptId: "att-scripted-1",
        verified: true,
        successReported: true,
        beforeInventory: {},
        afterInventory: { oak_log: 1 },
        worldChanges: [],
      });

      const adapted = adaptRecorderJournal([attemptLine, obsLine]);
      expect(adapted.notProven.some((i) => i.code === "RECORDER_SCHEMA_MISMATCH_ATTEMPT")).toBe(
        false,
      );
      expect(adapted.journalRows).toHaveLength(2);
      const attemptRow = adapted.journalRows[0] as Extract<JournalRow, { kind: "action_attempt" }>;
      expect(attemptRow.decisionSource).toBe("scripted");

      const report = validateExperimentEvidence({
        journalRows: adapted.journalRows,
      });

      expect(report.actionVerifications).toHaveLength(1);
      const action = report.actionVerifications[0]!;
      expect(action.decisionSource).toBe("scripted");
      expect(action.status).toBe("VERIFIED");
    });
  });

  describe("2. Runtime Journal Compatibility (PR #61)", () => {
    it("handles start row with decisionTransport, sourceSha, runId, and citizens", () => {
      const startLine = JSON.stringify({
        experimentId: "off2",
        seq: 1,
        at: "2026-11-06T06:40:52.390Z",
        previousHash: "",
        kind: "start",
        recordingAudience: "operator_only",
        mode: "offline",
        decisionTransport: "scripted-in-process",
        sourceSha: "1d7170741bdebe04e1c7c59eb210c0a357d5b0ea",
        runId: "fixture-2-1d7170741bde",
        citizens: ["gpt-a", "claude-a"],
        hash: "h_start",
      });

      const adapted = adaptRecorderJournal([startLine]);
      expect(
        adapted.notProven.some((i) => i.code.includes("START") || i.code.includes("UNKNOWN")),
      ).toBe(false);
      expect(adapted.journalRows).toHaveLength(1);
      const startRow = adapted.journalRows[0] as Extract<JournalRow, { kind: "start" }>;
      expect(startRow.kind).toBe("start");
      expect(startRow.decisionTransport).toBe("scripted-in-process");
      expect(startRow.sourceSha).toBe("1d7170741bdebe04e1c7c59eb210c0a357d5b0ea");
      expect(startRow.runId).toBe("fixture-2-1d7170741bde");
      expect(startRow.citizens).toEqual(["gpt-a", "claude-a"]);
    });

    it("handles simulated-tick records with explicit null serverGameTick without dropping evidence", () => {
      const tickLine = JSON.stringify({
        experimentId: "off2",
        seq: 2,
        at: "2026-11-06T06:40:55.408Z",
        previousHash: "h_prev",
        kind: "tick",
        durationMs: 10,
        serverGameTick: null,
        simulatedStep: 0,
        tickProvenance: "unavailable",
        hash: "h_tick",
      });

      const adapted = adaptRecorderJournal([tickLine]);
      expect(adapted.notProven.some((i) => i.code === "RECORDER_SCHEMA_MISMATCH_TICK")).toBe(false);
      expect(adapted.journalRows).toHaveLength(1);
      expect(adapted.journalRows[0]!.kind).toBe("tick");
      // Gaps correctly note missing genuine Paper server ticks without rejecting the row
      expect(adapted.notProven.some((i) => i.code === "RECORDER_GAP_SERVER_GAME_TICK")).toBe(true);
    });

    it("rejects invalid/corrupted tick serverGameTick values", () => {
      const badTickLine = JSON.stringify({
        experimentId: "off2",
        seq: 2,
        at: "2026-11-06T06:40:55.408Z",
        previousHash: "h_prev",
        kind: "tick",
        durationMs: 10,
        serverGameTick: "fabricated-string",
        hash: "h_bad",
      });

      const adapted = adaptRecorderJournal([badTickLine]);
      expect(adapted.notProven.some((i) => i.code === "RECORDER_SCHEMA_MISMATCH_TICK")).toBe(true);
      expect(adapted.journalRows).toHaveLength(0);
    });
  });

  describe("3. Report Identity and Signed Fields", () => {
    it("uses caller-supplied runId and sourceSha, eliminating zero-SHA and unknown placeholders", () => {
      const report = validateExperimentEvidence({
        runId: "fixture-2-1d7170741bde",
        sourceSha: "1d7170741bdebe04e1c7c59eb210c0a357d5b0ea",
        citizens: ["gpt-a", "claude-a"],
      });

      expect(report.sourceSha).toBe("1d7170741bdebe04e1c7c59eb210c0a357d5b0ea");
      expect(report.sourceSha).not.toBe("0000000000000000000000000000000000000000");
      expect(report.attribution.runId).toBe("fixture-2-1d7170741bde");
      expect(report.attribution.runId).not.toBe("unknown");
      expect(report.attribution.citizens).toEqual(["gpt-a", "claude-a"]);
    });

    it("infers runId and sourceSha from journal start row when not explicitly passed", () => {
      const startRow = journalStartSchema.parse({
        kind: "start",
        experimentId: "off2",
        seq: 1,
        at: "2026-11-06T06:40:52.390Z",
        previousHash: "",
        hash: "h_start",
        recordingAudience: "operator_only",
        mode: "offline",
        decisionTransport: "scripted-in-process",
        sourceSha: "1d7170741bdebe04e1c7c59eb210c0a357d5b0ea",
        runId: "fixture-2-1d7170741bde",
        citizens: ["gpt-a", "claude-a"],
      });

      const report = validateExperimentEvidence({
        journalRows: [startRow],
      });

      expect(report.sourceSha).toBe("1d7170741bdebe04e1c7c59eb210c0a357d5b0ea");
      expect(report.attribution.runId).toBe("fixture-2-1d7170741bde");
      expect(report.attribution.citizens).toEqual(["gpt-a", "claude-a"]);
    });

    it("rejects private keys used as trust roots", () => {
      const testKeypair = createTestAttestationKeypair();

      // PEM private key string
      expect(() => parseEd25519PublicKey(testKeypair.privateKeyPem)).toThrow(
        /Private key cannot be used as trust root/i,
      );

      // KeyObject private key
      const { privateKey } = generateKeyPairSync("ed25519");
      expect(() => parseEd25519PublicKey(privateKey)).toThrow(
        /Private key cannot be used as trust root/i,
      );
    });

    it("rejects unsupported key types (RSA, ECDSA) used as trust roots", () => {
      const { publicKey: rsaKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      expect(() => parseEd25519PublicKey(rsaKey)).toThrow(/Unsupported key type 'rsa'/i);

      const { publicKey: ecKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      expect(() => parseEd25519PublicKey(ecKey)).toThrow(/Unsupported key type 'ec'/i);
    });

    it("rejects signed live-attestation claims with contradictory totalServerTicks", () => {
      const testKeypair = createTestAttestationKeypair();
      const trustedKeys = { "paper-authority": testKeypair.publicKeyPem };

      // Attestation claiming 72000 total server ticks, but observed ticks in journal were only 1000
      const audit = verifySourceAttestation({
        attestation: {
          sourceType: "paper_server_attested",
          signingAuthority: "paper-authority",
          experimentId: "exp-1",
          captureSessionId: "11111111-2222-3333-4444-555555555555",
          serverBuild: 100,
          serverVersion: "1.21.6",
          sourceSha: "1d7170741bdebe04e1c7c59eb210c0a357d5b0ea",
          evidenceDigest: "a".repeat(64),
          startedAt: "2026-11-06T00:00:00.000Z",
          endedAt: "2026-11-06T01:00:00.000Z",
          firstServerTick: 1000,
          lastServerTick: 73000,
          totalServerTicks: 72000,
        },
        expectedExperimentId: "exp-1",
        expectedSourceSha: "1d7170741bdebe04e1c7c59eb210c0a357d5b0ea",
        totalServerTicks: 1000, // Contradiction with journal!
        trustedKeys,
      });

      expect(audit.proven).toBe(false);
      expect(audit.reasons.some((r) => r.includes("total server ticks mismatch"))).toBe(true);
    });

    it("rejects signed live-attestation claims with contradictory timestamps (endedAt <= startedAt)", () => {
      const testKeypair = createTestAttestationKeypair();
      const trustedKeys = { "paper-authority": testKeypair.publicKeyPem };

      const audit = verifySourceAttestation({
        attestation: {
          sourceType: "paper_server_attested",
          signingAuthority: "paper-authority",
          experimentId: "exp-1",
          captureSessionId: "11111111-2222-3333-4444-555555555555",
          serverBuild: 100,
          serverVersion: "1.21.6",
          sourceSha: "1d7170741bdebe04e1c7c59eb210c0a357d5b0ea",
          evidenceDigest: "a".repeat(64),
          startedAt: "2026-11-06T01:00:00.000Z",
          endedAt: "2026-11-06T00:00:00.000Z", // Contradiction: ended before started
          firstServerTick: 1000,
          lastServerTick: 73000,
          totalServerTicks: 72000,
        },
        expectedExperimentId: "exp-1",
        expectedSourceSha: "1d7170741bdebe04e1c7c59eb210c0a357d5b0ea",
        trustedKeys,
      });

      expect(audit.proven).toBe(false);
      expect(audit.reasons.some((r) => r.includes("timestamp contradiction"))).toBe(true);
    });
  });
});
