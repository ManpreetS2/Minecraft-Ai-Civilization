/**
 * Mission 004B — Adversarial Regression Test Suite
 *
 * Verifies the 14 required fail-closed evidence integrity scenarios:
 * 1. Missing model ID fails closed
 * 2. Missing session ID fails closed
 * 3. Missing world seed fails closed
 * 4. Missing starting positions fails closed
 * 5. Unknown server version/settings fails closed
 * 6. Missing shelter evidence fails closed
 * 7. Missing real budget evidence fails closed
 * 8. Missing timestamps fails closed
 * 9. A 58.8-minute run claiming 60 minutes is rejected (zero tolerance)
 * 10. A simulated run containing forged increasing Paper ticks is rejected
 * 11. One isolated tick sample cannot prove continuous server progression
 * 12. An interrupted event stream with unrecorded time gaps is detected
 * 13. Missing or invalid provenance (sourceSha) fails closed
 * 14. Legitimate known fields are preserved without alteration
 */

import { describe, expect, it } from "vitest";
import { bridgeV1RunBundle, type V1RunBundle } from "../src/v1-bridge.js";
import { auditDurationAndTicks } from "../src/duration-verifier.js";
// import { validateExperimentEvidence } from "../src/validator.js";
// import { JournalBuilder } from "../fixtures/helpers.js";

function createValidBaseBundle(overrides?: Partial<V1RunBundle>): V1RunBundle {
  return {
    schemaVersion: 1,
    runId: "run-m004b-verified",
    repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup",
    sourceSha: "ea4ada9ba3baa750cc3c1dec330e4918bb47ef49",
    mode: "offline-fixture",
    citizens: [
      {
        id: "gpt-atlas",
        family: "gpt",
        model: "gpt-4o-2024-08-06",
        sessionId: "sess-atlas-9912",
        authentication: "synthetic",
        initialInventory: {},
      },
      {
        id: "claude-theo",
        family: "claude",
        model: "claude-3-5-sonnet-20241022",
        sessionId: "sess-theo-7731",
        authentication: "synthetic",
        initialInventory: {},
      },
    ],
    fixtureSeed: "civilization-exact-seed-4091",
    startingPositions: {
      "gpt-atlas": { x: 120, y: 64, z: -80 },
      "claude-theo": { x: 260, y: 70, z: 150 },
    },
    configuration: {
      serverVersion: "1.21.6",
      paperBuild: 48,
      difficulty: "normal",
      shelterVerifiedAbsent: true,
      budgetCeilingUsd: 15.5,
      keepInventory: false,
      hardcore: false,
      doDaylightCycle: true,
      doMobSpawning: true,
      doMobLoot: true,
      "communityId_gpt-atlas": "north_cove",
      "communityId_claude-theo": "south_vale",
      "personalitySeed_gpt-atlas": "seed-atlas-001",
      "personalitySeed_claude-theo": "seed-theo-002",
      "biome_gpt-atlas": "plains",
      "biome_claude-theo": "forest",
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
    tickSource: "paper",
    ticks: [60000, 60000],
    command: "pnpm v1:offline 2",
    exitCode: 0,
    providerUsage: {
      requests: 20,
      costUsd: 0.85,
      artifact: "usage.json",
    },
    actions: [],
    expectedActionCount: 0,
    persistenceArtifact: "db.sqlite",
    restarted: false,
    validator: null,
    interventions: [],
    ...overrides,
  };
}

describe("Mission 004B — Adversarial Integrity Regressions (14 Scenarios)", () => {
  // Scenario 1: Missing model ID
  it("Scenario 1: fails closed with NOT_PROVEN when citizen model ID is null", () => {
    const bundle = createValidBaseBundle({
      citizens: [
        {
          id: "gpt-atlas",
          family: "gpt",
          model: null, // Missing model!
          sessionId: "sess-atlas-1",
          authentication: "synthetic",
          initialInventory: {},
        },
        {
          id: "claude-theo",
          family: "claude",
          model: "claude-3-5-sonnet",
          sessionId: "sess-theo-1",
          authentication: "synthetic",
          initialInventory: {},
        },
      ],
    });

    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "MISSING_CITIZEN_MODEL");
    expect(missing).toBeDefined();
    expect(missing?.citizenId).toBe("gpt-atlas");
  });

  // Scenario 2: Missing session ID
  it("Scenario 2: fails closed with NOT_PROVEN when citizen session ID is null", () => {
    const bundle = createValidBaseBundle({
      citizens: [
        {
          id: "gpt-atlas",
          family: "gpt",
          model: "gpt-4o",
          sessionId: null, // Missing session ID!
          authentication: "synthetic",
          initialInventory: {},
        },
        {
          id: "claude-theo",
          family: "claude",
          model: "claude-3-5-sonnet",
          sessionId: "sess-theo-1",
          authentication: "synthetic",
          initialInventory: {},
        },
      ],
    });

    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "MISSING_CITIZEN_SESSION");
    expect(missing).toBeDefined();
  });

  // Scenario 3: Missing world seed
  it("Scenario 3: fails closed with NOT_PROVEN when fixtureSeed is null", () => {
    const bundle = createValidBaseBundle({ fixtureSeed: null });
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "MISSING_WORLD_SEED");
    expect(missing).toBeDefined();
  });

  // Scenario 4: Missing starting positions
  it("Scenario 4: fails closed with NOT_PROVEN when startingPositions is null", () => {
    const bundle = createValidBaseBundle({ startingPositions: null });
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "MISSING_STARTING_POSITIONS");
    expect(missing).toBeDefined();
  });

  // Scenario 5: Unknown server version/settings
  it("Scenario 5: fails closed with NOT_PROVEN when server configuration is missing", () => {
    const bundle = createValidBaseBundle({
      configuration: {
        shelterVerifiedAbsent: true,
        budgetCeilingUsd: 10.0,
        // serverVersion and paperBuild are missing!
      },
    });
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "MISSING_SERVER_CONFIG");
    expect(missing).toBeDefined();
  });

  // Scenario 6: Missing shelter evidence
  it("Scenario 6: fails closed with NOT_PROVEN when shelter absence is unverified", () => {
    const bundle = createValidBaseBundle({
      configuration: {
        serverVersion: "1.21.6",
        paperBuild: 48,
        difficulty: "normal",
        shelterVerifiedAbsent: false, // Not proven absent!
        budgetCeilingUsd: 10.0,
      },
    });
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "UNVERIFIED_SHELTER_ABSENCE");
    expect(missing).toBeDefined();
  });

  // Scenario 7: Missing real budget evidence
  it("Scenario 7: fails closed with NOT_PROVEN when budgetCeilingUsd is missing", () => {
    const bundle = createValidBaseBundle({
      configuration: {
        serverVersion: "1.21.6",
        paperBuild: 48,
        difficulty: "normal",
        shelterVerifiedAbsent: true,
        // budgetCeilingUsd is missing!
      },
    });
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "MISSING_BUDGET_CEILING");
    expect(missing).toBeDefined();
  });

  // Scenario 8: Missing timestamps
  it("Scenario 8: fails closed with NOT_PROVEN when startedAt or endedAt is null", () => {
    const bundle = createValidBaseBundle({ startedAt: null, endedAt: null });
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    const missing = bridged.notProven.find((n) => n.code === "MISSING_RUN_TIMESTAMPS");
    expect(missing).toBeDefined();
  });

  // Scenario 9: 58.8-minute run claiming 60 minutes
  it("Scenario 9: strictly rejects a 58.8-minute run claiming 60 minutes (zero tolerance)", () => {
    // 58.8 minutes = 3,528,000 ms (exactly 98% of 60m)
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: [
        {
          kind: "tick",
          experimentId: "exp-58min",
          seq: 1,
          at: "2026-11-05T12:00:00.000Z",
          previousHash: "",
          hash: "",
          durationMs: 3_528_000,
          measuredTps: 20.0,
        },
        {
          kind: "tick",
          experimentId: "exp-58min",
          seq: 2,
          at: "2026-11-05T12:58:48.000Z", // 58 minutes 48 seconds
          previousHash: "",
          hash: "",
          durationMs: 0,
          measuredTps: 20.0,
        },
      ],
    });

    expect(audit.durationComplete).toBe(false);
    expect(audit.reasons.some((r) => r.includes("58.8-minute run cannot be accepted"))).toBe(true);
  });

  // Scenario 10: Simulated run containing forged increasing Paper ticks
  it("Scenario 10: rejects a 60-minute claim when elapsed server ticks is far below ~72,000", () => {
    // Attacker supplies 15 ticks with increasing serverGameTick, but only covering 500 total game ticks!
    const rows = Array.from({ length: 15 }, (_, i) => ({
      kind: "tick" as const,
      experimentId: "exp-forged-ticks",
      seq: i + 1,
      at: new Date(Date.now() + i * 240_000).toISOString(),
      previousHash: "",
      hash: "",
      durationMs: 240_000, // 15 * 240,000 = 3,600,000 ms
      measuredTps: 20.0,
      serverGameTick: 1000 + i * 20, // Only 280 ticks advanced over 60 claimed minutes!
    }));

    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: rows,
    });

    // Tick progression must fail due to deficit (< 68,400 ticks)
    expect(audit.serverTickProven).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Insufficient Paper tick progression"))).toBe(true);
  });

  // Scenario 11: One isolated tick sample cannot prove continuity
  it("Scenario 11: rejects an isolated single tick sample as proof of server continuity", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: [
        {
          kind: "tick",
          experimentId: "exp-single-tick",
          seq: 1,
          at: "2026-11-05T12:00:00.000Z",
          previousHash: "",
          hash: "",
          durationMs: 3_600_000,
          measuredTps: 20.0,
          serverGameTick: 72000, // Just one isolated tick sample!
        },
      ],
    });

    expect(audit.serverTickProven).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Insufficient server tick samples"))).toBe(true);
  });

  // Scenario 12: Interrupted event stream with unrecorded time gaps
  it("Scenario 12: detects an interrupted event stream with unrecorded time gaps > 65s", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 5,
      journalRows: [
        {
          kind: "tick",
          experimentId: "exp-gap",
          seq: 1,
          at: "2026-11-05T12:00:00.000Z",
          previousHash: "",
          hash: "",
          durationMs: 60_000,
          measuredTps: 20.0,
        },
        {
          kind: "tick",
          experimentId: "exp-gap",
          seq: 2,
          at: "2026-11-05T12:05:00.000Z", // 5 minute wall-clock jump!
          previousHash: "",
          hash: "",
          durationMs: 60_000,
          measuredTps: 20.0,
        },
      ],
    });

    expect(audit.gapsDetected.length).toBeGreaterThan(0);
    expect(audit.reasons.some((r) => r.includes("unrecorded time gap"))).toBe(true);
  });

  // Scenario 13: Missing or invalid provenance (sourceSha)
  it("Scenario 13: fails closed when sourceSha is not a valid 40-character hex string", () => {
    const bundle = createValidBaseBundle({ sourceSha: "not-a-valid-sha-at-all" });
    const bridged = bridgeV1RunBundle(bundle);
    const shaErr = bridged.notProven.find((n) => n.code === "INVALID_SOURCE_SHA");
    expect(shaErr).toBeDefined();
  });

  // Scenario 14: Legitimate known fields preserved without alteration
  it("Scenario 14: perfectly preserves genuine source-backed fields without altering them", () => {
    const bundle = createValidBaseBundle();
    const bridged = bridgeV1RunBundle(bundle);

    expect(bridged.manifest).toBeDefined();
    const m = bridged.manifest!;

    // Exactly matches the source bundle
    expect(m.experimentId).toBe("run-m004b-verified");
    expect(m.sourceSha).toBe("ea4ada9ba3baa750cc3c1dec330e4918bb47ef49");
    expect(m.worldSeed).toBe("civilization-exact-seed-4091");
    expect(m.citizens[0]?.model).toBe("gpt-4o-2024-08-06");
    expect(m.citizens[0]?.sessionId).toBe("sess-atlas-9912");
    expect(m.citizens[1]?.model).toBe("claude-3-5-sonnet-20241022");
    expect(m.citizens[1]?.sessionId).toBe("sess-theo-7731");
    expect(m.sites[0]?.x).toBe(120);
    expect(m.sites[0]?.z).toBe(-80);
    expect(m.sites[1]?.x).toBe(260);
    expect(m.sites[1]?.z).toBe(150);
    expect(m.server.version).toBe("1.21.6");
    expect(m.server.paperBuild).toBe(48);
    expect(m.budget.ceilingUsd).toBe(15.5);
  });
});
