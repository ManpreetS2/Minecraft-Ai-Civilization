import { describe, expect, it } from "vitest";
import { verifySingleAction } from "../src/action-verifier.js";
import type { ActionAttemptEvidence, ActionObservationEvidence } from "../src/types.js";

describe("Action Verifier — 6-point Provenance and Physical Witnessing", () => {
  it("verifies legitimate food gathering when item count increases", () => {
    const attempt: ActionAttemptEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-1",
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-1",
      expectedItem: "sweet_berries",
    };
    const observation: ActionObservationEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-1",
      successReported: true,
      beforeInventory: {},
      afterInventory: { sweet_berries: 3 },
      worldChanges: [],
    };

    const result = verifySingleAction(attempt, observation);
    expect(result.status).toBe("VERIFIED");
    expect(result.classification).toBe("successful_action");
    expect(result.chain.physicalOutcomeVerified).toBe(true);
    expect(result.physicalDeltas.inventoryDelta).toEqual({ sweet_berries: 3 });
  });

  it("detects phantom food gathering when item count does not increase", () => {
    const attempt: ActionAttemptEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-2",
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-2",
      expectedItem: "sweet_berries",
    };
    const observation: ActionObservationEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-2",
      successReported: true,
      beforeInventory: {},
      afterInventory: {}, // No food acquired!
      worldChanges: [],
    };

    const result = verifySingleAction(attempt, observation);
    expect(result.status).toBe("UNVERIFIED");
    expect(result.classification).toBe("unverified_assertion");
    expect(result.reasons[0]).toContain("Phantom gather detected");
  });

  it("requires consumed ingredients as well as gained output to verify crafting", () => {
    const attempt: ActionAttemptEvidence = {
      citizenId: "claude_theo",
      attemptId: "att-3",
      action: "craft",
      decisionSource: "planner",
      decisionEventId: "dec-3",
      expectedItem: "oak_planks",
    };

    // Case A: Free crafting (no ingredient consumed)
    const freeCraftObservation: ActionObservationEvidence = {
      citizenId: "claude_theo",
      attemptId: "att-3",
      successReported: true,
      beforeInventory: { oak_log: 1 },
      afterInventory: { oak_log: 1, oak_planks: 4 },
      worldChanges: [],
    };
    const resA = verifySingleAction(attempt, freeCraftObservation);
    expect(resA.status).toBe("UNVERIFIED");
    expect(resA.reasons.join(" ")).toContain("without consuming any required ingredients");

    // Case B: Legitimate crafting (ingredient consumed)
    const validCraftObservation: ActionObservationEvidence = {
      citizenId: "claude_theo",
      attemptId: "att-3",
      successReported: true,
      beforeInventory: { oak_log: 1 },
      afterInventory: { oak_planks: 4 },
      worldChanges: [],
    };
    const resB = verifySingleAction(attempt, validCraftObservation);
    expect(resB.status).toBe("VERIFIED");
    expect(resB.chain.physicalOutcomeVerified).toBe(true);
  });

  it("detects phantom calorie restoration when hunger is not increased", () => {
    const attempt: ActionAttemptEvidence = {
      citizenId: "gpt_maya",
      attemptId: "att-4",
      action: "eat",
      decisionSource: "reflex",
      decisionEventId: "dec-4",
      expectedItem: "bread",
    };

    // Case A: Food consumed but hunger remained same
    const phantomCalories: ActionObservationEvidence = {
      citizenId: "gpt_maya",
      attemptId: "att-4",
      successReported: true,
      beforeInventory: { bread: 2 },
      afterInventory: { bread: 1 },
      hungerBefore: 12,
      hungerAfter: 12,
      worldChanges: [],
    };
    const resA = verifySingleAction(attempt, phantomCalories);
    expect(resA.status).toBe("UNVERIFIED");
    expect(resA.reasons[0]).toContain("Phantom calorie restoration");

    // Case B: Food consumed and hunger increased
    const validEat: ActionObservationEvidence = {
      citizenId: "gpt_maya",
      attemptId: "att-4",
      successReported: true,
      beforeInventory: { bread: 2 },
      afterInventory: { bread: 1 },
      hungerBefore: 12,
      hungerAfter: 17,
      worldChanges: [],
    };
    const resB = verifySingleAction(attempt, validEat);
    expect(resB.status).toBe("VERIFIED");
    expect(resB.physicalDeltas.hungerDelta).toBe(5);
  });

  it("verifies block placement only with both inventory deduction and world block change", () => {
    const target = { x: 10, y: 64, z: 10 };
    const attempt: ActionAttemptEvidence = {
      citizenId: "claude_ava",
      attemptId: "att-5",
      action: "place",
      decisionSource: "model",
      decisionEventId: "dec-5",
      expectedItem: "oak_planks",
      target,
    };

    // Case A: Missing world change
    const missingWorld: ActionObservationEvidence = {
      citizenId: "claude_ava",
      attemptId: "att-5",
      successReported: true,
      beforeInventory: { oak_planks: 4 },
      afterInventory: { oak_planks: 3 },
      worldChanges: [],
    };
    expect(verifySingleAction(attempt, missingWorld).status).toBe("UNVERIFIED");

    // Case B: World changed but at wrong coordinates
    const wrongCoord: ActionObservationEvidence = {
      citizenId: "claude_ava",
      attemptId: "att-5",
      successReported: true,
      beforeInventory: { oak_planks: 4 },
      afterInventory: { oak_planks: 3 },
      worldChanges: [{ position: { x: 11, y: 64, z: 10 }, before: "air", after: "oak_planks" }],
    };
    expect(verifySingleAction(attempt, wrongCoord).status).toBe("UNVERIFIED");

    // Case C: Legitimate placement
    const legitimate: ActionObservationEvidence = {
      citizenId: "claude_ava",
      attemptId: "att-5",
      successReported: true,
      beforeInventory: { oak_planks: 4 },
      afterInventory: { oak_planks: 3 },
      worldChanges: [{ position: target, before: "air", after: "oak_planks" }],
    };
    const resC = verifySingleAction(attempt, legitimate);
    expect(resC.status).toBe("VERIFIED");
  });

  it("verifies movement only when ending position is within range", () => {
    const attempt: ActionAttemptEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-6",
      action: "move",
      decisionSource: "model",
      decisionEventId: "dec-6",
      target: { x: 100, y: 64, z: 100 },
      range: 2.0,
    };

    // Far away (distance 10 blocks)
    const tooFar: ActionObservationEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-6",
      successReported: true,
      beforeInventory: {},
      afterInventory: {},
      position: { x: 90, y: 64, z: 100 },
      worldChanges: [],
    };
    const resFar = verifySingleAction(attempt, tooFar);
    expect(resFar.status).toBe("UNVERIFIED");
    expect(resFar.reasons[0]).toContain("Target distance violation");

    // Within range
    const close: ActionObservationEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-6",
      successReported: true,
      beforeInventory: {},
      afterInventory: {},
      position: { x: 99, y: 64, z: 100.5 },
      worldChanges: [],
    };
    const resClose = verifySingleAction(attempt, close);
    expect(resClose.status).toBe("VERIFIED");
  });

  it("rejects cross-actor attribution where another citizen reports observation", () => {
    const attempt: ActionAttemptEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-7",
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-7",
      expectedItem: "oak_log",
    };
    const spoofedObservation: ActionObservationEvidence = {
      citizenId: "claude_theo", // Wrong citizen!
      attemptId: "att-7",
      successReported: true,
      beforeInventory: {},
      afterInventory: { oak_log: 1 },
      worldChanges: [],
    };

    const res = verifySingleAction(attempt, spoofedObservation);
    expect(res.status).toBe("CORRUPTED");
    expect(res.reasons[0]).toContain("Cross-actor attribution mismatch");
  });

  it("flags action as FAILED when failureCode or successReported=false", () => {
    const attempt: ActionAttemptEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-8",
      action: "gather",
      decisionSource: "model",
      decisionEventId: "dec-8",
      expectedItem: "sweet_berries",
    };
    const failedObservation: ActionObservationEvidence = {
      citizenId: "gpt_atlas",
      attemptId: "att-8",
      successReported: false,
      failureCode: "PATH_BLOCKED",
      beforeInventory: {},
      afterInventory: {},
      worldChanges: [],
    };

    const res = verifySingleAction(attempt, failedObservation);
    expect(res.status).toBe("FAILED");
    expect(res.classification).toBe("attempted_action");
    expect(res.failureCode).toBe("PATH_BLOCKED");
  });
});
