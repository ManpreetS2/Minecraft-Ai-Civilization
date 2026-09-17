import { describe, expect, it } from "vitest";
import { ObligationBoard, isCooperation } from "./obligations.js";
import { deriveBehaviorProfile } from "./behavior-profile.js";
import { recalibrateAssociation } from "./associations.js";

describe("obligations", () => {
  it("does not fulfill a physical promise from speech alone", () => {
    const board = new ObligationBoard();
    const promise = board.create({
      id: "ob1",
      promisorId: "citizen_atlas",
      promiseeId: "citizen_maya",
      description: "Give Maya food",
      physical: true,
      createdAt: "2026-09-17T00:00:00.000Z",
      speechActId: "say1",
    });
    expect(promise.status).toBe("ACTIVE");
    expect(board.noteSpeech("ob1", "say2")?.status).toBe("ACTIVE");
    expect(board.fulfill("ob1", "").ok).toBe(false);
    const done = board.fulfill("ob1", "evt_item_transferred_1");
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.obligation.status).toBe("FULFILLED");
  });

  it("does not call unrelated parallel gathering cooperation", () => {
    expect(isCooperation({ verifiedContributionA: true, verifiedContributionB: false })).toBe(false);
    expect(
      isCooperation({
        sharedProjectId: "shelter_1",
        verifiedContributionA: true,
        verifiedContributionB: true,
      }),
    ).toBe(true);
  });
});

describe("no preset personality sliders", () => {
  it("observer phrases come from history counts, not authored bravery", () => {
    const profile = deriveBehaviorProfile({
      citizenId: "citizen_kai",
      dangerousAttempts: 1,
      dangerousAvoided: 4,
      retriesAfterFailure: 5,
      taskFailures: 6,
      socialInteractions: 2,
      cooperativeActs: 4,
      conflictActs: 0,
      explorationActs: 1,
      familiarTaskChoices: 8,
      totalTaskChoices: 10,
      updatedAt: "t",
    });
    expect(JSON.stringify(profile)).not.toMatch(/bravery|kindness|ambition|obedience/);
    expect(profile.phrases.some((p) => /familiar/i.test(p))).toBe(true);
  });
});

describe("risk recalibration", () => {
  it("one safe event cannot wipe strong creeper avoidance", () => {
    const strong = {
      id: "a1",
      citizenId: "citizen_atlas",
      subjectType: "entity" as const,
      subjectKey: "creeper",
      associationType: "danger" as const,
      strength: 0.82,
      confidence: 0.8,
      supportingMemoryIds: ["m1", "m2", "m3"],
      lastReinforcedAt: "t0",
    };
    const once = recalibrateAssociation(strong, { safeRepeats: 1 }, "t1");
    expect(once.strength).toBeGreaterThan(0.6);
    const many = recalibrateAssociation(strong, { safeRepeats: 8 }, "t2");
    expect(many.strength).toBeLessThan(once.strength);
    const scare = recalibrateAssociation(strong, { dangerRepeats: 1 }, "t3");
    expect(scare.strength).toBeLessThanOrEqual(1);
    expect(scare.strength).toBeGreaterThan(strong.strength - 0.01);
  });
});
