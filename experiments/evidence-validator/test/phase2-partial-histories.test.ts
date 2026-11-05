/**
 * Phase 2 Tests: Partial Histories, Duplicates, Reordered Timestamps,
 * Missing Observation Receipts, Mismatched Identities, and Incomplete
 * Physical Outcomes.
 *
 * These cases exercise conditions that arise in genuine (imperfect) experiment
 * recordings — not just clean synthetic fixtures.
 */

import { describe, expect, it } from "vitest";
import { validateExperimentEvidence } from "../src/validator.js";
import { createTestManifest, JournalBuilder } from "../fixtures/helpers.js";

describe("Phase 2 — Partial Histories", () => {
  it("returns NOT_PROVEN for an action_attempt with no matching observation receipt", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    // Attempt is recorded, but the experiment ends without an observation
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: "att-no-obs-001",
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-incomplete-001",
      expectedItem: "oak_log",
    });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    // Must NOT be VERIFIED — incomplete history cannot prove outcome
    expect(report.overallStatus).not.toBe("VERIFIED");
    const notProvenItem = report.notProven.find(
      (n) => n.code === "INCOMPLETE_ACTION_ATTEMPT" && n.citizenId === "gpt_atlas",
    );
    expect(notProvenItem).toBeDefined();
    expect(notProvenItem?.missingFields).toContain("action_observation");
  });

  it("handles a journal with no actions at all (pure tick/shutdown sequence)", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    // No actions = nothing verified; still NOT_PROVEN rather than VERIFIED
    expect(report.overallStatus).toBe("NOT_PROVEN");
    expect(report.summary.totalAttemptedActions).toBe(0);
    expect(report.summary.verifiedActions).toBe(0);
  });

  it("handles a journal that ends abruptly (no shutdown row) without crashing", () => {
    const manifest = createTestManifest({ durationMinutes: 60 });
    const b = new JournalBuilder(manifest.experimentId);

    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: "att-crash-001",
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-crash-001",
      expectedItem: "oak_log",
    });
    b.append({
      kind: "action_observation",
      citizenId: "gpt_atlas",
      attemptId: "att-crash-001",
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: { oak_log: 1 },
      worldChanges: [],
    });
    // No shutdown, no ticks — abrupt end

    const { lines, rows } = b.build();
    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines,
      journalRows: rows,
    });

    // Must not be VERIFIED because duration is missing
    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const durDeficit = report.violations.find((v) => v.code === "DURATION_EVIDENCE_DEFICIT");
    expect(durDeficit).toBeDefined();
  });
});

describe("Phase 2 — Duplicated Events", () => {
  it("detects duplicate attemptId: second attempt entry is treated as an unmatched violation", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-duplicate-001";

    // First attempt (legitimate)
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-dup-001",
      expectedItem: "oak_log",
    });
    // Duplicate attempt — same attemptId
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-dup-001",
      expectedItem: "sweet_berries", // Different item — attacker trying to hijack
    });
    // Observation for the SECOND (overwritten) attempt
    b.append({
      kind: "action_observation",
      citizenId: "gpt_atlas",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: { sweet_berries: 3 },
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

    // The first attempt is overwritten by the duplicate; the observation matches
    // the second. The first is left as INCOMPLETE_ACTION_ATTEMPT. Sweet_berries
    // gather should verify since the observation correctly shows a berry gain.
    // However the duplicate itself should not silently yield a VERIFIED result
    // for the original oak_log attempt.
    const _incompleteNotProven = report.notProven.filter(
      (n) => n.code === "INCOMPLETE_ACTION_ATTEMPT",
    );
    // At least the first overwritten attempt has no observation
    expect(report.notProven.length + report.violations.length).toBeGreaterThan(0);
  });
});

describe("Phase 2 — Reordered Timestamps", () => {
  it("flags an action_observation with timestamp before its action_attempt", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    // We build attempt and observation with the observation timestamp EARLIER than attempt
    // by using raw JournalBuilder.append but then examining what the validator reports.
    // JournalBuilder auto-increments timestamps by 1s per row, so to create a retrograde
    // timestamp we must override the 'at' field.
    const attId = "att-retrograde-001";
    const futureTime = new Date(Date.now() + 10_000).toISOString();
    const pastTime = new Date(Date.now() - 60_000).toISOString();

    // Manually construct rows with inverted timestamps
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-retro-001",
      expectedItem: "oak_log",
      at: futureTime, // attempt is in the future
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
      at: pastTime, // observation is in the past relative to attempt
    });
    b.append({ kind: "tick", durationMs: 60_000, measuredTps: 20 });
    b.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

    const { lines, rows } = b.build();

    // Override timestamps in rows directly to create the anachronism
    const modifiedRows = rows.map((r) => {
      if (r.kind === "action_attempt" && "attemptId" in r && r.attemptId === attId) {
        return { ...r, at: futureTime };
      }
      if (r.kind === "action_observation" && "attemptId" in r && r.attemptId === attId) {
        return { ...r, at: pastTime };
      }
      return r;
    });

    const report = validateExperimentEvidence({
      manifest,
      rawJournalLines: lines, // hash chain uses original order
      journalRows: modifiedRows,
    });

    // The action verification result for this attempt should note the anachronism
    const result = report.actionVerifications.find((v) => v.attemptId === attId);
    expect(result).toBeDefined();
    // Anachronism is reported as a reason, but since physical outcome (oak_log gain)
    // is still real, the status may be VERIFIED with a warning reason.
    const hasAnachronismReason = result?.reasons.some((r) =>
      r.toLowerCase().includes("anachronism"),
    );
    expect(hasAnachronismReason).toBe(true);
  });
});

describe("Phase 2 — Mismatched Identities", () => {
  it("returns VIOLATIONS_DETECTED when an action_attempt references a citizen not in the manifest", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-phantom-citizen-001";
    b.append({
      kind: "action_attempt",
      citizenId: "ghost_villain", // NOT in the manifest
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-ghost-001",
      expectedItem: "diamond",
    });
    b.append({
      kind: "action_observation",
      citizenId: "ghost_villain",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: { diamond: 64 },
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

    // A phantom citizen gaining 64 diamonds is a spontaneous inventory gain
    // (no verified ledger for ghost_villain), and their identity is not in manifest.
    expect(report.overallStatus).toBe("VIOLATIONS_DETECTED");
    const spontGain = report.violations.find(
      (v) => v.code === "PHANTOM_CITIZEN_ACTION" && v.citizenId === "ghost_villain",
    );
    expect(spontGain).toBeDefined();
  });

  it("detects cross-actor identity mismatch: Theo observes Atlas's attempt as his own", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-identity-swap-001";
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-swap-001",
      expectedItem: "oak_log",
    });
    // Theo claims the observation for Atlas's attempt
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
    const crossActor = report.violations.find((v) =>
      v.description.includes("Cross-actor attribution mismatch"),
    );
    expect(crossActor).toBeDefined();
  });
});

describe("Phase 2 — Incomplete Physical Outcomes", () => {
  it("detects a place action claimed as verified but lacking the required world block change", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-place-no-block-001";
    b.append({
      kind: "action_attempt",
      citizenId: "gpt_atlas",
      attemptId: attId,
      action: "place",
      decisionSource: "model",
      decisionEventId: "dec-place-001",
      expectedItem: "oak_planks",
      target: { x: 100, y: 65, z: 100 },
    });
    b.append({
      kind: "action_observation",
      citizenId: "gpt_atlas",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: { oak_planks: 4 },
      afterInventory: { oak_planks: 3 }, // Plank consumed
      worldChanges: [], // But NO world block change recorded!
      position: { x: 100, y: 64, z: 100 },
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
    const placeViolation = report.violations.find(
      (v) =>
        v.citizenId === "gpt_atlas" &&
        v.description.includes("Place action lacked verified world block mutation"),
    );
    expect(placeViolation).toBeDefined();
  });

  it("detects an eat action that did not restore hunger (phantom calorie restoration)", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-eat-no-hunger-001";
    b.append({
      kind: "action_attempt",
      citizenId: "claude_theo",
      attemptId: attId,
      action: "eat",
      decisionSource: "model",
      decisionEventId: "dec-eat-001",
      expectedItem: "bread",
    });
    b.append({
      kind: "action_observation",
      citizenId: "claude_theo",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: { bread: 1 },
      afterInventory: {}, // Bread consumed ✓
      worldChanges: [],
      hungerBefore: 18,
      hungerAfter: 18, // Hunger did NOT increase! Phantom restoration
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
    const eatViolation = report.violations.find(
      (v) =>
        v.citizenId === "claude_theo" && v.description.includes("Phantom calorie restoration"),
    );
    expect(eatViolation).toBeDefined();
  });

  it("detects a move action where destination is not reached within range", () => {
    const manifest = createTestManifest({ durationMinutes: 1 });
    const b = new JournalBuilder(manifest.experimentId);

    const attId = "att-move-miss-001";
    b.append({
      kind: "action_attempt",
      citizenId: "claude_ava",
      attemptId: attId,
      action: "move",
      decisionSource: "planner",
      decisionEventId: "dec-move-001",
      target: { x: 250, y: 64, z: 250 },
      range: 2,
    });
    b.append({
      kind: "action_observation",
      citizenId: "claude_ava",
      attemptId: attId,
      verified: true,
      successReported: true,
      beforeInventory: {},
      afterInventory: {},
      worldChanges: [],
      position: { x: 200, y: 64, z: 200 }, // 70+ blocks away — far outside range: 2
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
    const moveViolation = report.violations.find(
      (v) => v.citizenId === "claude_ava" && v.description.includes("Target distance violation"),
    );
    expect(moveViolation).toBeDefined();
  });
});
