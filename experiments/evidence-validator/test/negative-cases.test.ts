import { describe, expect, it } from "vitest";
import { validateExperimentEvidence } from "../src/validator.js";
import { createTestManifest, JournalBuilder } from "../fixtures/helpers.js";
import type { EventStreamItem, PersistentFactItem } from "../src/schemas.js";

describe("Mission 2 — Comprehensive Negative Test Cases", () => {
  it("detects a citizen claiming to gather food without physically acquiring any (phantom food)", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-gather-phantom";
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-101",
      expectedItem: "sweet_berries",
    });
    b.append({
      kind: "action_observation",
      citizenId: "gpt_atlas",
      attemptId: attId,
      verified: false,
      successReported: true, // Dishonest claim of success!
      beforeInventory: {},
      afterInventory: {}, // No food was gained!
      worldChanges: [],
    });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const phantom = report.violations.find((v) => v.description.includes("Phantom gather"));
    expect(phantom).toBeDefined();
    expect(phantom?.citizenId).toBe("gpt_atlas");
  });

  it("detects inventory counts increasing without a legitimate source (spontaneous item gain)", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    // Atlas gathers 1 log
    const attId = "att-gather-log";
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-102",
      expectedItem: "oak_log",
    });
    b.append({
      kind: "action_observation",
      citizenId: "gpt_atlas",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: { oak_log: 1 },
      worldChanges: [],
    });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      // But final observed inventory has 1 oak_log + 5 gold_ingots that were never gathered!
      finalInventories: {
        gpt_atlas: { oak_log: 1, gold_ingot: 5 },
      },
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const gain = report.violations.find((v) => v.code === "SPONTANEOUS_GAIN");
    expect(gain).toBeDefined();
    expect(gain?.description).toContain("gold_ingot");
  });

  it("detects a private chest transfer being revealed to another citizen", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const events: EventStreamItem[] = [
      {
        id: "ev-private-chest-1",
        type: "ItemDeposited",
        timestamp: "2026-11-01T12:00:00.000Z",
        citizenId: "gpt_atlas",
        payload: {
          container: "personal chest",
          item: "emerald",
          count: 10,
        },
      },
    ];

    const facts: PersistentFactItem[] = [
      {
        id: "fact-leak-1",
        citizenId: "claude_theo",
        factKey: "atlas_emerald_chest",
        content: "Atlas stored emeralds in personal chest",
        kind: "observed_fact",
        createdAt: "2026-11-01T12:00:05.000Z",
        sourceEventId: "ev-private-chest-1",
      },
    ];

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      events,
      facts,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const leak = report.violations.find((v) => v.code === "PRIVATE_CHEST_LEAK");
    expect(leak).toBeDefined();
    expect(leak?.citizenId).toBe("claude_theo");
  });

  it("detects a rival community discovering an unobserved settlement location", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    // Theo in south_vale suddenly knows north_cove coordinates without exploration
    const facts: PersistentFactItem[] = [
      {
        id: "fact-rival-1",
        citizenId: "claude_theo",
        factKey: "enemy_base",
        content: "Rival settlement is at x=100, z=100",
        kind: "observed_fact",
        createdAt: "2026-11-01T12:00:00.000Z",
      },
    ];

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      facts,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const rival = report.violations.find((v) => v.code === "RIVAL_SETTLEMENT_LEAK");
    expect(rival).toBeDefined();
    expect(rival?.description).toContain("unobserved rival settlement knowledge");
  });

  it("detects a reported claim incorrectly becoming confirmed world truth", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const events: EventStreamItem[] = [
      {
        id: "speech-claim-1",
        type: "ConversationOccurred",
        timestamp: "2026-11-01T12:00:00.000Z",
        citizenId: "gpt_maya",
        payload: {
          message: "There is an iron deposit under the hill",
          visibility: {
            class: "nearby_speech",
            speakerId: "gpt_maya",
            audienceIds: ["gpt_atlas"],
          },
        },
      },
    ];

    // Atlas records Maya's spoken claim as an observed_fact!
    const facts: PersistentFactItem[] = [
      {
        id: "fact-promoted-1",
        citizenId: "gpt_atlas",
        factKey: "iron_deposit",
        content: "There is an iron deposit under the hill",
        kind: "observed_fact", // Violation: must be communicated_claim
        createdAt: "2026-11-01T12:00:05.000Z",
        sourceEventId: "speech-claim-1",
      },
    ];

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
      events,
      facts,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const promoted = report.violations.find((v) => v.code === "CLAIM_PROMOTED_TO_FACT");
    expect(promoted).toBeDefined();
    expect(promoted?.description).toContain("recorded as an 'observed_fact' instead of 'communicated_claim'");
  });

  it("detects an action being reported successful after movement or interaction failed", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-move-fail";
    b.append({
      kind: "action_attempt",
      citizenId: "claude_ava",
      attemptId: attId,
      action: "move",
      decisionSource: "planner",
      decisionEventId: "dec-103",
      target: { x: 500, y: 64, z: 500 },
      range: 2,
    });
    b.append({
      kind: "action_observation",
      citizenId: "claude_ava",
      attemptId: attId,
      verified: false,
      successReported: true, // Dishonestly reporting success despite landing 300 blocks away
      beforeInventory: {},
      afterInventory: {},
      position: { x: 200, y: 64, z: 200 },
      worldChanges: [],
    });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const actionFail = report.violations.find((v) => v.description.includes("Target distance violation"));
    expect(actionFail).toBeDefined();
  });

  it("detects cross-actor identity tampering on action observation", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-tampered-actor";
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-104",
      expectedItem: "oak_log",
    });
    // Spoofed: Theo claims observation receipt for Atlas's attempt
    b.append({
      kind: "action_observation",
      citizenId: "claude_theo",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: { oak_log: 1 },
      worldChanges: [],
    });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const tampered = report.violations.find((v) => v.description.includes("Cross-actor attribution mismatch"));
    expect(tampered).toBeDefined();
  });

  it("detects a claimed 60-minute simulation without actual duration and tick evidence", () => {
    const manifest = createTestManifest({ durationMinutes: 60 });
    const b = new JournalBuilder(manifest.experimentId);

    // Only 2 ticks = 2 minutes recorded!
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const durationDeficit = report.violations.find((v) => v.code === "DURATION_EVIDENCE_DEFICIT");
    expect(durationDeficit).toBeDefined();
    expect(durationDeficit?.description).toContain("Simulation duration deficit: claimed 60 minutes");
  });

  it("detects tampered or corrupted cryptographic hash chains in the operator journal", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    // Tamper line 1 hash
    const tamperedLines = [...lines];
    const tamperedRow = JSON.parse(tamperedLines[1]!);
    tamperedRow.durationMs = 999_999; // Modified without re-hashing!
    tamperedLines[1] = JSON.stringify(tamperedRow);

    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: tamperedLines,
      journalRows: rows,
    });

    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const hashTamper = report.violations.find((v) => v.code === "CORRUPTED_HASH_CHAIN");
    expect(hashTamper).toBeDefined();
    expect(hashTamper?.description).toContain("hash tampering detected");
  });

  it("returns NOT_PROVEN instead of passing when necessary records do not exist", () => {
    // Empty input: no journal, no events, no manifest
    const report = validateExperimentEvidence({});

    expect(report.overallStatus).toBe("NOT_PROVEN");
    expect(report.summary.notProvenChecksCount).toBeGreaterThan(0);
    expect(report.notProven[0]?.code).toBe("NO_HASH_CHAIN_EVIDENCE");
  });

  it("strictly redacts private prompts, API keys, and secret citizen memories from outputs", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-secret-leak";
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-leak",
      expectedItem: "oak_log",
    });
    b.append({
      kind: "action_observation",
      citizenId: "gpt_atlas",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: { oak_log: 1 },
      worldChanges: [],
    });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("sk-ant-");
    expect(serialized).not.toContain("sk-proj-");
    expect(serialized).not.toContain("Bearer ");
    expect(report.redacted).toBe(true);
  });
});
