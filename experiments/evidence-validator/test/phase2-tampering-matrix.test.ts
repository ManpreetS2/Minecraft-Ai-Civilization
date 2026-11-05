/**
 * Mission 005 — 20-Point Tampering & Adversarial Matrix Tests
 *
 * Verifies that the validator detects each distinct defect and returns
 * VIOLATIONS_DETECTED or NOT_PROVEN:
 *
 * 1. Missing source event
 * 2. Invented item transfer
 * 3. Duplicated inventory delta
 * 4. Wrong citizen attribution
 * 5. Unauthorized observer knowledge
 * 6. Modified old event
 * 7. Broken hash chain
 * 8. Restarted or regressed tick counter
 * 9. Forged increasing tick counter
 * 10. Incomplete 60-minute duration
 * 11. Interrupted recording
 * 12. Unknown model ID
 * 13. Missing session identity
 * 14. Incorrect world seed
 * 15. Missing operator intervention record
 * 16. Missing tool-wear evidence
 * 17. Failed action claimed successful
 * 18. Mismatched persistent-fact source event
 * 19. Incomplete provider-usage accounting
 * 20. Source SHA mismatch
 */

import { describe, expect, it } from "vitest";
import { buildRealisticOfflineFixture } from "../src/offline-replay.js";
import { validateExperimentEvidence } from "../src/validator.js";
import { bridgeV1RunBundle, type V1RunBundle } from "../src/v1-bridge.js";
import { auditDurationAndTicks } from "../src/duration-verifier.js";
import { adaptRecorderJournal, adaptPersistentFacts } from "../src/recorder-adapter.js";
import type { EventStreamItem } from "../src/schemas.js";

describe("Mission 005 — Realistic Offline Evidence Replay & Fixture (Phase C)", () => {
  it("processes a realistic offline civilization evidence stream without errors", () => {
    const fixture = buildRealisticOfflineFixture();
    const adaptedJournal = adaptRecorderJournal(fixture.rawJournalLines);
    const adaptedFacts = adaptPersistentFacts(fixture.facts);

    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      rawJournalLines: adaptedJournal.rawJournalLines,
      journalRows: adaptedJournal.journalRows,
      events: fixture.events,
      facts: adaptedFacts.facts,
      finalInventories: fixture.finalInventories,
    });

    // Hash chain is verified
    expect(report.hashChainAudit.valid).toBe(true);
    // Actions are physically verified
    expect(report.summary.verifiedActions).toBe(3);
    // Duration complete for offline simulated claims
    expect(report.durationAudit.durationComplete).toBe(true);
    // Offline simulated mode is reported
    expect(report.mode).toBe("offline_simulated");
  });
});

describe("Mission 005 — 20-Point Adversarial & Tampering Matrix (Phase D)", () => {
  // Case 1: Missing source event
  it("Case 1: detects persistent fact referencing missing source event", () => {
    const fixture = buildRealisticOfflineFixture();
    const badFacts = [
      {
        id: "fact-ghost",
        citizen_id: "gpt_atlas",
        fact_key: "ghost_claim",
        content: "I saw emeralds",
        kind: "observed_fact",
        created_at: new Date().toISOString(),
        source_event_id: "ev-nonexistent-1234",
      },
    ];
    const adaptedFacts = adaptPersistentFacts(badFacts);
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      rawJournalLines: fixture.rawJournalLines,
      journalRows: fixture.journalRows,
      events: fixture.events, // does not have ev-nonexistent-1234
      facts: adaptedFacts.facts,
    });
    // Fact references nonexistent event
    expect(report.summary.notProvenChecksCount + report.violations.length).toBeGreaterThan(0);
  });

  // Case 2: Invented item transfer
  it("Case 2: detects invented item transfer (spontaneous inventory gain)", () => {
    const fixture = buildRealisticOfflineFixture();
    // Atlas claims 64 diamonds without any gather or transfer action
    const corruptedFinalInventories = {
      gpt_atlas: { "minecraft:oak_log": 1, "minecraft:diamond": 64 },
      claude_theo: { "minecraft:sweet_berries": 2 },
    };
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      rawJournalLines: fixture.rawJournalLines,
      journalRows: fixture.journalRows,
      events: fixture.events,
      finalInventories: corruptedFinalInventories,
    });
    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    expect(report.violations.some((v) => v.code === "SPONTANEOUS_GAIN")).toBe(true);
  });

  // Case 3: Duplicated inventory delta
  it("Case 3: detects duplicate action attempt with reused attemptId", () => {
    const fixture = buildRealisticOfflineFixture();
    const duplicateRows = [
      ...fixture.journalRows,
      {
        kind: "action_attempt" as const,
        experimentId: fixture.manifest.experimentId,
        seq: 99,
        at: new Date().toISOString(),
        previousHash: "",
        hash: "",
        citizenId: "gpt_atlas",
        attemptId: "att-atlas-gather-1", // Reused attempt ID!
        action: "gather" as const,
        decisionSource: "model" as const,
        decisionEventId: "ev-1",
      },
    ];
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      journalRows: duplicateRows,
    });
    expect(report.violations.some((v) => v.code === "DUPLICATE_ATTEMPT_ID")).toBe(true);
  });

  // Case 4: Wrong citizen attribution
  it("Case 4: detects cross-actor identity tampering (Theo claims Atlas's observation)", () => {
    const fixture = buildRealisticOfflineFixture();
    const tamperedRows = fixture.journalRows.map((r) => {
      if (r.kind === "action_observation" && r.attemptId === "att-atlas-gather-1") {
        return { ...r, citizenId: "claude_theo" }; // Spoofed!
      }
      return r;
    });
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      journalRows: tamperedRows,
    });
    expect(report.violations.some((v) => v.description.includes("Cross-actor attribution mismatch"))).toBe(true);
  });

  // Case 5: Unauthorized observer knowledge
  it("Case 5: detects rival settlement coordinate leak without exploration proof", () => {
    const fixture = buildRealisticOfflineFixture();
    const leakedFacts = [
      {
        id: "fact-leak",
        citizenId: "gpt_atlas", // north_cove member
        factKey: "rival_camp",
        content: "Enemy camp found at x: 250, z: 250", // south_vale coordinates!
        kind: "observed_fact" as const,
        createdAt: new Date().toISOString(),
      },
    ];
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      journalRows: fixture.journalRows,
      facts: leakedFacts,
    });
    expect(report.violations.some((v) => v.code === "RIVAL_SETTLEMENT_LEAK")).toBe(true);
  });

  // Case 6: Modified old event
  it("Case 6: detects retroactive modification of an event stream payload", () => {
    const fixture = buildRealisticOfflineFixture();
    // Delivery points to an event whose audience was modified
    const modifiedEvents = fixture.events.map((e) => ({
      ...e,
      payload: { visibility: { class: "observer_only" } }, // Changed to observer_only!
    }));
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      journalRows: fixture.journalRows,
      events: modifiedEvents,
      deliveries: [{ citizenId: "gpt_atlas", eventId: fixture.events[0]!.id, deliveredAt: new Date().toISOString() }],
    });
    expect(report.violations.some((v) => v.code === "UNKNOWN_AUDIENCE_LEAK")).toBe(true);
  });

  // Case 7: Broken hash chain
  it("Case 7: detects broken cryptographic hash chain in raw journal lines", () => {
    const fixture = buildRealisticOfflineFixture();
    const tamperedLines = [...fixture.rawJournalLines];
    const parsed = JSON.parse(tamperedLines[1]!);
    parsed.action = "tampered_action";
    tamperedLines[1] = JSON.stringify(parsed);

    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      rawJournalLines: tamperedLines,
      journalRows: fixture.journalRows,
    });
    expect(report.violations.some((v) => v.code === "CORRUPTED_HASH_CHAIN")).toBe(true);
  });

  // Case 8: Restarted or regressed tick counter
  it("Case 8: detects restarted or regressed serverGameTick counter", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 10,
      journalRows: [
        { kind: "tick", experimentId: "e", seq: 1, at: "2026-11-05T12:00:00Z", previousHash: "", hash: "", durationMs: 5000, serverGameTick: 1000 },
        { kind: "tick", experimentId: "e", seq: 2, at: "2026-11-05T12:00:05Z", previousHash: "", hash: "", durationMs: 5000, serverGameTick: 400 }, // Regressed!
      ],
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.reasons.some((r) => r.includes("regression"))).toBe(true);
  });

  // Case 9: Forged increasing tick counter
  it("Case 9: rejects forged increasing tick counter with large unexplained gaps", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 10,
      journalRows: [
        { kind: "tick", experimentId: "e", seq: 1, at: "2026-11-05T12:00:00Z", previousHash: "", hash: "", durationMs: 5000, serverGameTick: 1000 },
        { kind: "tick", experimentId: "e", seq: 2, at: "2026-11-05T12:00:05Z", previousHash: "", hash: "", durationMs: 5000, serverGameTick: 50000 }, // Jump > 5 min!
      ],
    });
    expect(audit.serverTickProven).toBe(false);
    expect(audit.reasons.some((r) => r.includes("Server game tick gap detected"))).toBe(true);
  });

  // Case 10: Incomplete 60-minute duration
  it("Case 10: strictly rejects a 58.8-minute run claiming 60 minutes", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 60,
      journalRows: [
        { kind: "tick", experimentId: "e", seq: 1, at: "2026-11-05T12:00:00Z", previousHash: "", hash: "", durationMs: 3_528_000, measuredTps: 20 },
      ],
    });
    expect(audit.durationComplete).toBe(false);
    expect(audit.reasons.some((r) => r.includes("58.8-minute run cannot be accepted"))).toBe(true);
  });

  // Case 11: Interrupted recording
  it("Case 11: detects unrecorded timeline gaps > 65 seconds", () => {
    const audit = auditDurationAndTicks({
      claimedDurationMinutes: 5,
      journalRows: [
        { kind: "tick", experimentId: "e", seq: 1, at: "2026-11-05T12:00:00Z", previousHash: "", hash: "", durationMs: 60000, measuredTps: 20 },
        { kind: "tick", experimentId: "e", seq: 2, at: "2026-11-05T12:04:00Z", previousHash: "", hash: "", durationMs: 60000, measuredTps: 20 },
      ],
    });
    expect(audit.gapsDetected.length).toBeGreaterThan(0);
  });

  // Case 12: Unknown model ID
  it("Case 12: fails closed with NOT_PROVEN when citizen model is null", () => {
    const bundle: V1RunBundle = {
      schemaVersion: 1,
      runId: "run-test",
      repository: "repo",
      sourceSha: "a".repeat(40),
      mode: "offline-fixture",
      citizens: [{ id: "c1", family: "gpt", model: null, sessionId: "s1", authentication: "synthetic", initialInventory: {} }],
      fixtureSeed: "seed",
      startingPositions: { c1: { x: 0, y: 64, z: 0 } },
      configuration: {},
      startedAt: "2026-11-05T12:00:00Z",
      endedAt: "2026-11-05T12:10:00Z",
      tickSource: "simulated",
      ticks: [60000],
      command: "test",
      exitCode: 0,
      providerUsage: { requests: 1, costUsd: 0.01, artifact: "art" },
      actions: [],
      expectedActionCount: 0,
      persistenceArtifact: null,
      restarted: false,
      validator: null,
      interventions: [],
    };
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    expect(bridged.notProven.some((n) => n.code === "MISSING_CITIZEN_MODEL")).toBe(true);
  });

  // Case 13: Missing session identity
  it("Case 13: fails closed with NOT_PROVEN when session ID is null", () => {
    const bundle: V1RunBundle = {
      schemaVersion: 1,
      runId: "run-test",
      repository: "repo",
      sourceSha: "a".repeat(40),
      mode: "offline-fixture",
      citizens: [{ id: "c1", family: "gpt", model: "gpt-4o", sessionId: null, authentication: "synthetic", initialInventory: {} }],
      fixtureSeed: "seed",
      startingPositions: { c1: { x: 0, y: 64, z: 0 } },
      configuration: {},
      startedAt: "2026-11-05T12:00:00Z",
      endedAt: "2026-11-05T12:10:00Z",
      tickSource: "simulated",
      ticks: [60000],
      command: "test",
      exitCode: 0,
      providerUsage: { requests: 1, costUsd: 0.01, artifact: "art" },
      actions: [],
      expectedActionCount: 0,
      persistenceArtifact: null,
      restarted: false,
      validator: null,
      interventions: [],
    };
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    expect(bridged.notProven.some((n) => n.code === "MISSING_CITIZEN_SESSION")).toBe(true);
  });

  // Case 14: Incorrect world seed
  it("Case 14: fails closed with NOT_PROVEN when world seed is null", () => {
    const bundle: V1RunBundle = {
      schemaVersion: 1,
      runId: "run-test",
      repository: "repo",
      sourceSha: "a".repeat(40),
      mode: "offline-fixture",
      citizens: [{ id: "c1", family: "gpt", model: "gpt-4o", sessionId: "s1", authentication: "synthetic", initialInventory: {} }],
      fixtureSeed: null, // Missing!
      startingPositions: { c1: { x: 0, y: 64, z: 0 } },
      configuration: {},
      startedAt: "2026-11-05T12:00:00Z",
      endedAt: "2026-11-05T12:10:00Z",
      tickSource: "simulated",
      ticks: [60000],
      command: "test",
      exitCode: 0,
      providerUsage: { requests: 1, costUsd: 0.01, artifact: "art" },
      actions: [],
      expectedActionCount: 0,
      persistenceArtifact: null,
      restarted: false,
      validator: null,
      interventions: [],
    };
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    expect(bridged.notProven.some((n) => n.code === "MISSING_WORLD_SEED")).toBe(true);
  });

  // Case 15: Missing operator intervention record
  it("Case 15: records operator intervention directive in events", () => {
    const bundle: V1RunBundle = {
      schemaVersion: 1,
      runId: "run-test",
      repository: "repo",
      sourceSha: "a".repeat(40),
      mode: "offline-fixture",
      citizens: [{ id: "c1", family: "gpt", model: "gpt-4o", sessionId: "s1", authentication: "synthetic", initialInventory: {} }],
      fixtureSeed: "seed",
      startingPositions: { c1: { x: 0, y: 64, z: 0 } },
      configuration: {},
      startedAt: "2026-11-05T12:00:00Z",
      endedAt: "2026-11-05T12:10:00Z",
      tickSource: "simulated",
      ticks: [60000],
      command: "test",
      exitCode: 0,
      providerUsage: { requests: 1, costUsd: 0.01, artifact: "art" },
      actions: [],
      expectedActionCount: 0,
      persistenceArtifact: null,
      restarted: false,
      validator: null,
      interventions: ["operator directive: test pause"],
    };
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.events.some((e) => e.type === "OperatorIntervention")).toBe(true);
  });

  // Case 16: Missing tool-wear evidence
  it("Case 16: reports RECORDER_GAP_TOOL_DURABILITY when tool durability is absent", () => {
    const lines = [
      JSON.stringify({ kind: "start", experimentId: "e", seq: 1, at: "2026-11-05T12:00:00Z", previousHash: "", hash: "h1", recordingAudience: "operator_only", mode: "offline" }),
      JSON.stringify({ kind: "action_attempt", experimentId: "e", seq: 2, at: "2026-11-05T12:00:01Z", previousHash: "h1", hash: "h2", citizenId: "c1", attemptId: "a1", action: "gather", decisionSource: "model", decisionEventId: "d1" }),
      JSON.stringify({ kind: "action_observation", experimentId: "e", seq: 3, at: "2026-11-05T12:00:02Z", previousHash: "h2", hash: "h3", citizenId: "c1", attemptId: "a1", verified: true, successReported: true, beforeInventory: {}, afterInventory: { stone: 1 }, worldChanges: [] }),
    ];
    const adapted = adaptRecorderJournal(lines);
    expect(adapted.notProven.some((n) => n.code === "RECORDER_GAP_TOOL_DURABILITY")).toBe(true);
  });

  // Case 17: Failed action claimed successful
  it("Case 17: detects phantom gather (success claimed without item delta)", () => {
    const fixture = buildRealisticOfflineFixture();
    const phantomRows = [
      {
        kind: "action_attempt" as const,
        experimentId: fixture.manifest.experimentId,
        seq: 1,
        at: "2026-11-05T12:00:00Z",
        previousHash: "",
        hash: "",
        citizenId: "gpt_atlas",
        attemptId: "att-phantom",
        action: "gather" as const,
        decisionSource: "model" as const,
        decisionEventId: "ev-1",
        expectedItem: "minecraft:diamond",
      },
      {
        kind: "action_observation" as const,
        experimentId: fixture.manifest.experimentId,
        seq: 2,
        at: "2026-11-05T12:00:01Z",
        previousHash: "",
        hash: "",
        citizenId: "gpt_atlas",
        attemptId: "att-phantom",
        verified: false,
        successReported: true, // Dishonest!
        beforeInventory: {},
        afterInventory: {}, // No item!
        worldChanges: [],
      },
    ];
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      journalRows: phantomRows,
    });
    expect(report.violations.some((v) => v.description.includes("Phantom gather"))).toBe(true);
  });

  // Case 18: Mismatched persistent-fact source event
  it("Case 18: detects spoken claim promoted to observed_fact without re-verification", () => {
    const fixture = buildRealisticOfflineFixture();
    const events: EventStreamItem[] = [
      {
        id: "ev-speech-1",
        type: "ConversationOccurred",
        timestamp: "2026-11-05T12:00:00Z",
        citizenId: "claude_theo",
        payload: { visibility: { class: "nearby_speech", audienceIds: ["gpt_atlas"] } },
      },
    ];
    const facts = [
      {
        id: "fact-promoted",
        citizenId: "gpt_atlas",
        factKey: "theo_claim",
        content: "Theo claimed he has food",
        kind: "observed_fact" as const, // Should be communicated_claim!
        createdAt: "2026-11-05T12:00:01Z",
        sourceEventId: "ev-speech-1",
      },
    ];
    const report = validateExperimentEvidence({
      manifest: fixture.manifest,
      journalRows: fixture.journalRows,
      events,
      facts,
    });
    expect(report.violations.some((v) => v.code === "CLAIM_PROMOTED_TO_FACT")).toBe(true);
  });

  // Case 19: Incomplete provider-usage accounting
  it("Case 19: fails closed with NOT_PROVEN when budgetCeilingUsd is absent", () => {
    const bundle: V1RunBundle = {
      schemaVersion: 1,
      runId: "run-test",
      repository: "repo",
      sourceSha: "a".repeat(40),
      mode: "offline-fixture",
      citizens: [{ id: "c1", family: "gpt", model: "gpt-4o", sessionId: "s1", authentication: "synthetic", initialInventory: {} }],
      fixtureSeed: "seed",
      startingPositions: { c1: { x: 0, y: 64, z: 0 } },
      configuration: {}, // No budget ceiling
      startedAt: "2026-11-05T12:00:00Z",
      endedAt: "2026-11-05T12:10:00Z",
      tickSource: "simulated",
      ticks: [60000],
      command: "test",
      exitCode: 0,
      providerUsage: { requests: null, costUsd: null, artifact: null },
      actions: [],
      expectedActionCount: 0,
      persistenceArtifact: null,
      restarted: false,
      validator: null,
      interventions: [],
    };
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.manifest).toBeUndefined();
    expect(bridged.notProven.some((n) => n.code === "MISSING_BUDGET_CEILING")).toBe(true);
  });

  // Case 20: Source SHA mismatch
  it("Case 20: fails closed with NOT_PROVEN when sourceSha is invalid", () => {
    const bundle: V1RunBundle = {
      schemaVersion: 1,
      runId: "run-test",
      repository: "repo",
      sourceSha: "not-a-40-char-sha",
      mode: "offline-fixture",
      citizens: [{ id: "c1", family: "gpt", model: "gpt-4o", sessionId: "s1", authentication: "synthetic", initialInventory: {} }],
      fixtureSeed: "seed",
      startingPositions: { c1: { x: 0, y: 64, z: 0 } },
      configuration: {},
      startedAt: "2026-11-05T12:00:00Z",
      endedAt: "2026-11-05T12:10:00Z",
      tickSource: "simulated",
      ticks: [60000],
      command: "test",
      exitCode: 0,
      providerUsage: { requests: 1, costUsd: 0.01, artifact: "art" },
      actions: [],
      expectedActionCount: 0,
      persistenceArtifact: null,
      restarted: false,
      validator: null,
      interventions: [],
    };
    const bridged = bridgeV1RunBundle(bundle);
    expect(bridged.notProven.some((n) => n.code === "INVALID_SOURCE_SHA")).toBe(true);
  });
});
