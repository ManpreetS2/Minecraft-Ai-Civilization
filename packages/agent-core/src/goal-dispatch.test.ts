import { GOALS } from "@civ/cognition";
import { describe, expect, it } from "vitest";
import {
  GOAL_ACTION_MAP,
  assertGoalMapComplete,
  deferredCapabilityResult,
  dispatchCognitionGoal,
  isDeferredGoal,
} from "./goal-dispatch.js";

describe("goal-dispatch", () => {
  it("covers every cognition goal with a known executor action", () => {
    expect(() => assertGoalMapComplete()).not.toThrow();
    expect(Object.keys(GOAL_ACTION_MAP).sort()).toEqual([...GOALS].sort());
  });

  it("maps gather_food and build_shelter to verified actions", () => {
    expect(dispatchCognitionGoal("gather_food")).toEqual({
      goal: "gather_food",
      task: "gather_food",
      action: "gatherFood",
      occupation: "gatherer",
    });
    expect(dispatchCognitionGoal("build_shelter")).toMatchObject({
      goal: "build_shelter",
      action: "buildShelter",
    });
  });

  it("defers help/rest/socialize without fabricating success", () => {
    expect(isDeferredGoal("help_citizen")).toBe(true);
    expect(isDeferredGoal("rest")).toBe(true);
    expect(isDeferredGoal("socialize")).toBe(true);
    const help = deferredCapabilityResult("help_citizen");
    expect(help.success).toBe(false);
    expect(help.code).toBe("UNSUPPORTED_ACTION");
    expect(help.retryable).toBe(false);
  });

  it("rejects unknown goals instead of falling through to wood mining", () => {
    expect(dispatchCognitionGoal("totally_unknown_goal")).toEqual({
      unsupported: true,
      goal: "totally_unknown_goal",
    });
  });
});
