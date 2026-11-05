/**
 * Tests for Mission 004:
 * 1. Deterministic offline tests for full validator functionality
 * 2. V1 schema bridge integration
 * 3. Authenticity vs. simulated clock rejection
 * 4. Refusal to fabricate or synthesize events from aggregate data
 */

import { describe, expect, it } from "vitest";
import { bridgeV1RunBundle, type V1RunBundle } from "../src/v1-bridge.js";
// import { validateExperimentEvidence } from "../src/validator.js";
import { auditDurationAndTicks } from "../src/duration-verifier.js";
// import { createTestManifest, JournalBuilder } from "../fixtures/helpers.js";

describe("Mission 004 — V1 Evidence Schema Integration Bridge", () => {
  function createSampleRunBundle(overrides?: Partial<V1RunBundle>): V1RunBundle {
    return {
      schemaVersion: 1,
      runId: "run-v1-001",
      repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup",
      sourceSha: "ea4ada9ba3baa750cc3c1dec330e4918bb47ef49",
      mode: "offline-fixture",
      citizens: [
        {
          id: "gpt-a",
          family: "gpt",
          model: "gpt-4o",
          sessionId: "sess-gpt-1",
          authentication: "synthetic",
          initialInventory: {},
        },
        {
          id: "claude-a",
          family: "claude",
          model: "claude-3-5-sonnet",
          sessionId: "sess-claude-1",
          authentication: "synthetic",
          initialInventory: {},
        },
      ],
      fixtureSeed: "seed-12345",
      startingPositions: {
        "gpt-a": { x: 100, y: 64, z: 100 },
        "claude-a": { x: 250, y: 64, z: 250 },
      },
      configuration: {
        difficulty: "normal",
        serverVersion: "1.21.6",
        paperBuild: 48,
        shelterVerifiedAbsent: true,
        budgetCeilingUsd: 10.0,
        ticksPerMinute: 1200,
        keepInventory: false,
        hardcore: false,
        doDaylightCycle: true,
        doMobSpawning: true,
        doMobLoot: true,
        "communityId_gpt-a": "comm-a",
        "communityId_claude-a": "comm-b",
        "personalitySeed_gpt-a": "seed-gpt-a",
        "personalitySeed_claude-a": "seed-claude-a",
        "biome_gpt-a": "plains",
        "biome_claude-a": "forest",
        runRoot: "/test/runRoot",
        worldPath: "/test/runRoot/world",
        databasePath: "/test/runRoot/db.sqlite",
        evidencePath: "/test/runRoot/evidence.jsonl",
        recordingEnabled: true,
        recordingAudience: "operator_only",
        privacyReplayPassed: 10,
        privacyReplayFailed: 0,
        privacyReplaySkipped: 0,
      },
      startedAt: "2026-11-05T12:00:00.000Z",
      endedAt: "2026-11-05T13:00:00.000Z",
      tickSource: "simulated",
      ticks: [60000, 60000, 60000],
      command: "pnpm v1:offline 2",
      exitCode: 0,
      providerUsage: {
        requests: 12,
        costUsd: 0.05,
        artifact: "provider-usage.json",
      },
      actions: [
        {
          sequence: 1,
          citizenId: "gpt-a",
          reportedSuccess: true,
          observedSuccess: true,
          inventoryDelta: { "minecraft:oak_log": 1 },
          authorizedKnowledge: true,
        },
        {
          sequence: 2,
          citizenId: "claude-a",
          reportedSuccess: true,
          observedSuccess: null, // Unobserved!
          inventoryDelta: { "minecraft:bread": 1 },
          authorizedKnowledge: true,
        },
      ],
      expectedActionCount: 2,
      persistenceArtifact: "db.sqlite",
      restarted: false,
      validator: null,
      interventions: ["operator directive: conserve food"],
      ...overrides,
    };
  }

  it("bridges a V1 RunBundle and extracts manifest and gap reports", () => {
    const bundle = createSampleRunBundle();
    const bridged = bridgeV1RunBundle(bundle);

    expect(bridged.manifest).toBeDefined();
    expect(bridged.manifest?.experimentId).toBe("run-v1-001");
    expect(bridged.manifest?.sourceSha).toBe("ea4ada9ba3baa750cc3c1dec330e4918bb47ef49");
    expect(bridged.manifest?.stage).toBe("1v1");
    expect(bridged.manifest?.citizens).toHaveLength(2);

    // Operator intervention is captured as an event
    expect(bridged.events.some((e) => e.type === "OperatorIntervention")).toBe(true);

    // Unobserved action is flagged as NOT_PROVEN
    const unobserved = bridged.notProven.find((n) => n.code === "UNOBSERVED_ACTION_CLAIM");
    expect(unobserved).toBeDefined();
    expect(unobserved?.citizenId).toBe("claude-a");
  });

  it("fails closed with NOT_PROVEN when sourceSha is missing or invalid", () => {
    const bundle = createSampleRunBundle({ sourceSha: "invalid-short-sha" });
    const bridged = bridgeV1RunBundle(bundle);

    const shaError = bridged.notProven.find((n) => n.code === "INVALID_SOURCE_SHA");
    expect(shaError).toBeDefined();
  });

  it("never synthesizes missing underlying actions from aggregate inventory deltas", () => {
    // When action has inventoryDelta but observedSuccess is null, validator refuses to fabricate a pass
    const bundle = createSampleRunBundle({
      actions: [
        {
          sequence: 1,
          citizenId: "gpt-a",
          reportedSuccess: true,
          observedSuccess: null, // No witness receipt!
          inventoryDelta: { "minecraft:diamond": 64 },
          authorizedKnowledge: false,
        },
      ],
    });

    const bridged = bridgeV1RunBundle(bundle);
    const unverifiedDelta = bridged.notProven.find((n) => n.code === "UNVERIFIED_INVENTORY_DELTA");
    expect(unverifiedDelta).toBeDefined();
    expect(unverifiedDelta?.citizenId).toBe("gpt-a");
  });
});

describe("Mission 004 — Paper Authenticity vs. Simulated Clock Rejection", () => {
  it("rejects simulated 60,000ms tick fixtures as genuine Paper server evidence", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: Array.from({ length: 60 }, (_, i) => ({
        kind: "tick" as const,
        experimentId: "sim-exp",
        seq: i + 1,
        at: new Date(Date.now() + i * 60000).toISOString(),
        previousHash: "",
        hash: "",
        durationMs: 60000,
        measuredTps: 20.0,
      })),
    });

    // Duration is mathematically complete for offline simulated claims
    expect(audit.durationComplete).toBe(true);
    // But serverTickProven must remain strictly FALSE without real Paper serverGameTick
    expect(audit.serverTickProven).toBe(false);
    expect(audit.serverTickCount).toBe(0);
  });

  it("rejects accelerated fixtures (e.g. 60 claimed minutes in 1 minute of wall time without ticks)", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: [
        {
          kind: "tick" as const,
          experimentId: "acc-exp",
          seq: 1,
          at: new Date(Date.now()).toISOString(),
          previousHash: "",
          hash: "",
          durationMs: 60000, // Only 1 minute of tick duration!
          measuredTps: 20.0,
        },
      ],
    });

    expect(audit.durationComplete).toBe(false);
    expect(audit.reasons.some((r) => r.includes("duration deficit"))).toBe(true);
  });

  it("rejects non-monotonic or regressed Paper game ticks", () => {
    const rows = [
      {
        kind: "tick" as const,
        experimentId: "reg-exp",
        seq: 1,
        at: new Date(Date.now()).toISOString(),
        previousHash: "",
        hash: "",
        durationMs: 5000,
        measuredTps: 20.0,
        serverGameTick: 1000,
      },
      {
        kind: "tick" as const,
        experimentId: "reg-exp",
        seq: 2,
        at: new Date(Date.now() + 5000).toISOString(),
        previousHash: "",
        hash: "",
        durationMs: 5000,
        measuredTps: 20.0,
        serverGameTick: 500, // Regression! Server rollback or spliced evidence
      },
    ];

    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 0,
      journalRows: rows,
    });

    expect(audit.serverTickProven).toBe(false);
    expect(audit.reasons.some((r) => r.includes("regression"))).toBe(true);
  });
});
