/**
 * Mission 006, Phase 4: V1RunBundle Bridge Integration Scenario Tests
 *
 * Verifies the end-to-end flow:
 * V1RunBundle -> bridgeV1RunBundle -> validateExperimentEvidence -> structured report
 */

import { describe, expect, it } from "vitest";
import { bridgeV1RunBundle, type V1RunBundle } from "../src/v1-bridge.js";
import { validateExperimentEvidence } from "../src/validator.js";

describe("Mission 006, Phase 4 — V1RunBundle Bridge Integration Pipeline", () => {
  function createFullV1RunBundle(overrides?: Partial<V1RunBundle>): V1RunBundle {
    return {
      schemaVersion: 1,
      runId: "run-pipeline-001",
      repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup",
      sourceSha: "ea4ada9ba3baa750cc3c1dec330e4918bb47ef49",
      mode: "offline-fixture",
      citizens: [
        {
          id: "gpt_atlas",
          family: "gpt",
          model: "gpt-4o",
          sessionId: "sess-atlas-1",
          authentication: "synthetic",
          initialInventory: {},
          communityId: "north_cove",
          personalitySeed: "seed_atlas_01",
        },
        {
          id: "claude_theo",
          family: "claude",
          model: "claude-3-5-sonnet",
          sessionId: "sess-theo-1",
          authentication: "synthetic",
          initialInventory: {},
          communityId: "south_vale",
          personalitySeed: "seed_theo_01",
        },
      ],
      fixtureSeed: "seed-bridge-scenario-999",
      startingPositions: {
        gpt_atlas: { x: 100, y: 64, z: 100 },
        claude_theo: { x: 250, y: 64, z: 250 },
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
        "biome_gpt_atlas": "plains",
        "biome_claude_theo": "forest",
        runRoot: "/civ/runs/offline-001",
        worldPath: "/civ/runs/offline-001/world",
        databasePath: "/civ/runs/offline-001/db.sqlite",
        evidencePath: "/civ/runs/offline-001/evidence.jsonl",
        recordingEnabled: true,
        recordingAudience: "operator_only",
        privacyReplayPassed: 10,
        privacyReplayFailed: 0,
        privacyReplaySkipped: 0,
      },
      startedAt: "2026-11-05T12:00:00.000Z",
      endedAt: "2026-11-05T13:00:00.000Z",
      tickSource: "simulated",
      ticks: [60000, 60000],
      command: "pnpm v1:offline 2",
      exitCode: 0,
      providerUsage: {
        requests: 24,
        costUsd: 0.12,
        artifact: "provider-usage.json",
      },
      actions: [
        {
          sequence: 1,
          citizenId: "gpt_atlas",
          reportedSuccess: true,
          observedSuccess: true, // Physical observation present
          inventoryDelta: { "minecraft:oak_log": 1 },
          authorizedKnowledge: true,
        },
        {
          sequence: 2,
          citizenId: "claude_theo",
          reportedSuccess: true,
          observedSuccess: null, // Unobserved! Missing physical witness
          inventoryDelta: { "minecraft:bread": 1 },
          authorizedKnowledge: true,
        },
      ],
      expectedActionCount: 2,
      persistenceArtifact: "db.sqlite",
      restarted: false,
      validator: null,
      interventions: ["operator directive: hold boundary"],
      ...overrides,
    };
  }

  it("bridges a valid V1RunBundle and validates structured report without data fabrication", () => {
    const bundle = createFullV1RunBundle();
    const bridged = bridgeV1RunBundle(bundle);

    // 1. Exact attribution
    expect(bridged.manifest).toBeDefined();
    expect(bridged.manifest?.sourceSha).toBe("ea4ada9ba3baa750cc3c1dec330e4918bb47ef49");
    expect(bridged.manifest?.experimentId).toBe("run-pipeline-001");
    expect(bridged.manifest?.stage).toBe("1v1");

    // 2. Citizens & community provenance
    expect(bridged.manifest?.citizens).toHaveLength(2);
    expect(bridged.manifest?.citizens[0]?.communityId).toBe("north_cove");
    expect(bridged.manifest?.citizens[1]?.communityId).toBe("south_vale");
    expect(bridged.manifest?.citizens[0]?.model).toBe("gpt-4o");
    expect(bridged.manifest?.citizens[1]?.model).toBe("claude-3-5-sonnet");

    // 3. Physical witness gap detected
    const unobserved = bridged.notProven.find((n) => n.code === "UNOBSERVED_ACTION_CLAIM");
    expect(unobserved).toBeDefined();
    expect(unobserved?.citizenId).toBe("claude_theo");

    // 4. Operator intervention converted to event
    const interventionEv = bridged.events.find((e) => e.type === "OperatorIntervention");
    expect(interventionEv).toBeDefined();

    // 5. Feed into validator
    const report = validateExperimentEvidence({
      manifest: bridged.manifest,
      rawJournalLines: bridged.rawJournalLines,
      journalRows: bridged.journalRows,
      events: bridged.events,
      facts: bridged.facts,
      deliveries: bridged.deliveries,
      sourceAttestation: bridged.sourceAttestation,
    });

    // 6. Explicit simulation classification
    expect(report.mode).toBe("offline_simulated");
    expect(report.durationAudit.serverTickProven).toBe(false);
  });

  it("fails closed when V1RunBundle claims public-live-demonstration without sourceAttestation", () => {
    const bundle = createFullV1RunBundle({
      mode: "public-live-demonstration",
    });
    const bridged = bridgeV1RunBundle(bundle);

    const unproven = bridged.notProven.find((n) => n.code === "UNPROVEN_PAPER_AUTHENTICITY");
    expect(unproven).toBeDefined();
  });

  it("rejects V1RunBundle when provider usage has negative requests or costs", () => {
    const bundle = createFullV1RunBundle({
      providerUsage: {
        requests: -1,
        costUsd: -0.5,
        artifact: "bad-usage.json",
      },
    });
    const bridged = bridgeV1RunBundle(bundle);
    const accountingError = bridged.notProven.find(
      (n) => n.code === "INVALID_PROVIDER_USAGE" || n.missingFields?.includes("providerUsage"),
    );
    expect(accountingError).toBeDefined();
  });
});
