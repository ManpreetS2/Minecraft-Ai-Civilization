import { describe, expect, it } from "vitest";
import { applyBeliefEvent, blankBelief, resolvePromise } from "./relationship-belief.js";
import { SocialDirector } from "./index.js";

describe("asymmetric relationship beliefs", () => {
  it("Atlas helps Maya updates each side differently", () => {
    let atlasAboutMaya = blankBelief("citizen_atlas", "citizen_maya");
    let mayaAboutAtlas = blankBelief("citizen_maya", "citizen_atlas");

    atlasAboutMaya = applyBeliefEvent(atlasAboutMaya, {
      kind: "helped",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: true,
      detail: "carried wood",
    });
    mayaAboutAtlas = applyBeliefEvent(mayaAboutAtlas, {
      kind: "was_helped",
      observerId: "citizen_maya",
      subjectId: "citizen_atlas",
      firstPerson: true,
      detail: "received help",
    });

    expect(atlasAboutMaya.trust).not.toBe(mayaAboutAtlas.trust);
    expect(mayaAboutAtlas.trust).toBeGreaterThan(atlasAboutMaya.trust);
    expect(atlasAboutMaya.observerId).toBe("citizen_atlas");
    expect(mayaAboutAtlas.observerId).toBe("citizen_maya");
  });

  it("hearing about an event does not grant first-person certainty", () => {
    let theo = blankBelief("citizen_theo", "citizen_atlas");
    theo = applyBeliefEvent(theo, {
      kind: "heard_about",
      observerId: "citizen_theo",
      subjectId: "citizen_atlas",
      firstPerson: false,
      detail: "Atlas helped Maya",
    });
    expect(theo.trust).toBe(0.5);
    expect(theo.recentPositive).toBe(0);
    expect(theo.familiarity).toBeGreaterThan(0);
  });

  it("no interaction fabricates no friendship", () => {
    const blank = blankBelief("citizen_ava", "citizen_kai");
    expect(blank.evidenceCount).toBe(0);
    expect(blank.familiarity).toBe(0);
    expect(blank.cooperationCount).toBe(0);
  });

  it("promise broken lowers trust for the observer only", () => {
    let atlas = blankBelief("citizen_atlas", "citizen_maya");
    atlas = applyBeliefEvent(atlas, {
      kind: "promise_made",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: true,
      detail: "bring food",
    });
    atlas = resolvePromise(atlas, "bring food", false);
    expect(atlas.trust).toBeLessThan(0.5);
    expect(atlas.unresolvedPromises).toHaveLength(0);
  });
});

describe("speech gating required responses", () => {
  it("does not suppress required response even under speaker cooldown", () => {
    const director = new SocialDirector();
    director.considerConversation({
      cause: "help_request",
      trigger: "talked",
      speaker: "Maya",
      other: "Atlas",
      topic: "food",
      speakChance: 1,
      now: 1_000,
    });
    const required = director.considerConversation({
      cause: "help_request",
      trigger: "talked",
      speaker: "Maya",
      other: "Atlas",
      topic: "food_request",
      speakChance: 0,
      requiresResponse: true,
      now: 1_100,
    });
    expect(required.shouldSpeak).toBe(true);
  });
});
