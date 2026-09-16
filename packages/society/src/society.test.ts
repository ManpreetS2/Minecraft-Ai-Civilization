import { describe, expect, it } from "vitest";
import { applySocialEvent, maybeConversation, sameWorkFamily, SocialDirector } from "./index.js";

function blankRel() {
  return {
    citizenId: "citizen_atlas",
    otherId: "citizen_maya",
    trust: 0,
    affection: 0,
    respect: 0,
    resentment: 0,
    familiarity: 0,
  };
}

describe("fake social claims", () => {
  it("does not treat gather_food as shared_food without an item transfer", () => {
    const director = new SocialDirector();
    const result = director.considerConversation({
      cause: "joint_work",
      trigger: "shared_food",
      speaker: "Atlas",
      other: "Maya",
      topic: "gather_food",
      speakChance: 1,
      now: 1_000,
    });
    expect(result.shouldSpeak).toBe(false);
    expect(result.applyRelationship).toBe(false);
    expect(result.suppressedReason).toBe("no_actual_transfer");
  });

  it("does not auto-speak after a routine task with no meaningful cause", () => {
    const result = maybeConversation({
      trigger: "cooperated",
      speaker: "Atlas",
      other: "Theo",
      topic: "gather_wood",
      cause: "llm_decision",
    });
    expect(result.shouldSpeak).toBe(false);
  });

  it("allows cooperation only for joint work", () => {
    const director = new SocialDirector();
    const denied = director.considerConversation({
      cause: "discovery",
      trigger: "cooperated",
      speaker: "Atlas",
      other: "Kai",
      topic: "gather_wood",
      speakChance: 1,
      now: 1,
    });
    expect(denied.shouldSpeak).toBe(false);
    const allowed = director.considerConversation({
      cause: "joint_work",
      trigger: "cooperated",
      speaker: "Atlas",
      other: "Kai",
      topic: "build_shelter",
      speakChance: 1,
      now: 1,
    });
    expect(allowed.shouldSpeak).toBe(true);
    expect(allowed.message).toBeTruthy();
  });
});

describe("cooldowns", () => {
  it("suppresses repeated events and pair spam", () => {
    const director = new SocialDirector();
    const first = director.considerConversation({
      cause: "rescue",
      trigger: "rescued",
      speaker: "Maya",
      other: "Ava",
      topic: "zombie",
      speakChance: 1,
      now: 10_000,
    });
    expect(first.shouldSpeak).toBe(true);
    const second = director.considerConversation({
      cause: "rescue",
      trigger: "rescued",
      speaker: "Maya",
      other: "Ava",
      topic: "zombie",
      speakChance: 1,
      now: 20_000,
    });
    expect(second.shouldSpeak).toBe(false);
    expect(["speaker_cooldown", "pair_cooldown", "repeated_event"]).toContain(second.suppressedReason);
  });
});

describe("relationships", () => {
  it("updates trust after real help, not proximity chatter templates", () => {
    const helped = applySocialEvent(blankRel(), "helped");
    expect(helped.trust).toBeGreaterThan(0);
    const near = applySocialEvent(blankRel(), "proximity");
    expect(near.trust).toBe(0);
    expect(near.familiarity).toBeGreaterThan(0);
    expect(near.affection).toBe(0);
  });

  it("does not apply relationship updates from a canned line when the event is invalid", () => {
    const director = new SocialDirector();
    const denied = director.considerConversation({
      cause: "joint_work",
      trigger: "shared_food",
      speaker: "Kai",
      other: "Theo",
      topic: "gather_food",
      speakChance: 1,
      now: 5,
    });
    expect(denied.shouldSpeak).toBe(false);
    expect(denied.applyRelationship).toBe(false);
  });
});

describe("work families", () => {
  it("treats gather_wood as related only to wood work", () => {
    expect(sameWorkFamily("gather_wood", "mineBlock")).toBe(false);
    expect(sameWorkFamily("gather_wood", "gather_wood")).toBe(true);
    expect(sameWorkFamily("build_shelter", "seek_shelter")).toBe(true);
  });
});
