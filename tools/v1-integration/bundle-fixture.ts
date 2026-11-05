import type { RunBundle } from "./manifest.js";
export function bundleFixture(): RunBundle {
  return { schemaVersion: 1, runId: "fixture-1", repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup", sourceSha: "a".repeat(40), mode: "offline-fixture",
    citizens: [{ id: "gpt-a", family: "gpt", model: null, sessionId: "gpt-session", authentication: "synthetic", initialInventory: {} }, { id: "claude-a", family: "claude", model: null, sessionId: "claude-session", authentication: "synthetic", initialInventory: {} }],
    fixtureSeed: "fixed", startingPositions: null, configuration: {}, startedAt: null, endedAt: null, tickSource: "simulated", ticks: [1, 2], command: "pnpm test:v1", exitCode: 0,
    providerUsage: { requests: 2, costUsd: null, artifact: null }, actions: [{ sequence: 1, citizenId: "gpt-a", reportedSuccess: true, observedSuccess: true, inventoryDelta: { oak_log: 1 }, authorizedKnowledge: true }], expectedActionCount: 1,
    persistenceArtifact: null, restarted: false, validator: null, interventions: [] };
}

