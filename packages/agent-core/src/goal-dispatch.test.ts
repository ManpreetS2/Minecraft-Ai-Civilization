import { GOALS, GOAL_ALIASES, normalizeGoal } from "@civ/cognition";
import { describe, expect, it } from "vitest";
import {
  GOAL_ACTION_MAP,
  INTERNAL_PLANNER_ACTIONS,
  assertGoalMapComplete,
  deferredCapabilityResult,
  dispatchCognitionGoal,
  isAllowlistedExecutorAction,
  isDeferredGoal,
  isInternalPlannerActionName,
  resolveModelGoalForPlanner,
} from "./goal-dispatch.js";

describe("goal-dispatch (unified cognition contract)", () => {
  it("covers every cognition goal with a known executor action", () => {
    expect(() => assertGoalMapComplete()).not.toThrow();
    expect(Object.keys(GOAL_ACTION_MAP).sort()).toEqual([...GOALS].sort());
  });

  it("maps every declared cognition goal through dispatchCognitionGoal", () => {
    for (const goal of GOALS) {
      const dispatched = dispatchCognitionGoal(goal);
      expect(dispatched).not.toMatchObject({ unsupported: true });
      if ("unsupported" in dispatched) throw new Error("unreachable");
      expect(dispatched.goal).toBe(goal);
      expect(isAllowlistedExecutorAction(dispatched.action)).toBe(true);
      expect(dispatched.action).toBe(GOAL_ACTION_MAP[goal].action);
    }
  });

  it("resolves every supported alias to an allowlisted action", () => {
    for (const [alias, goal] of Object.entries(GOAL_ALIASES)) {
      expect(normalizeGoal(alias)).toBe(goal);
      const dispatched = resolveModelGoalForPlanner(alias);
      expect(dispatched.unsupported).toBeFalsy();
      if (dispatched.unsupported) throw new Error("unreachable");
      expect(dispatched.goal).toBe(goal);
      expect(isAllowlistedExecutorAction(dispatched.action)).toBe(true);
    }
  });

  it("maps gather_food, build_shelter, and contribute_to_project to verified actions", () => {
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
    expect(dispatchCognitionGoal("contribute_to_project")).toMatchObject({
      goal: "contribute_to_project",
      task: "build_structure",
      action: "buildStructure",
    });
  });

  it("resolves the help_citizen contradiction: defer, never shareItem", () => {
    const help = resolveModelGoalForPlanner("help_citizen");
    const assist = resolveModelGoalForPlanner("assist_citizen");
    expect(help).toMatchObject({
      goal: "help_citizen",
      action: "deferCapability",
      deferred: true,
    });
    expect(assist).toMatchObject({
      goal: "assist_citizen",
      action: "deferCapability",
      deferred: true,
    });
    expect(help).not.toMatchObject({ action: "shareItem" });
    expect(assist).not.toMatchObject({ action: "shareItem" });
  });

  it("defers help/rest/socialize/reconsider without fabricating success", () => {
    expect(isDeferredGoal("help_citizen")).toBe(true);
    expect(isDeferredGoal("rest")).toBe(true);
    expect(isDeferredGoal("socialize")).toBe(true);
    expect(isDeferredGoal("reconsider")).toBe(true);
    for (const task of ["help_citizen", "rest", "socialize", "reconsider", "unsupported_goal"] as const) {
      const result = deferredCapabilityResult(task);
      expect(result.success).toBe(false);
      expect(result.code).toBe("UNSUPPORTED_ACTION");
      expect(result.retryable).toBe(false);
    }
  });

  it("rejects unknown and malformed goals instead of falling through to arbitrary actions", () => {
    expect(dispatchCognitionGoal("totally_unknown_goal")).toEqual({
      unsupported: true,
      goal: "totally_unknown_goal",
    });
    expect(resolveModelGoalForPlanner("totally_unknown_goal")).toEqual({
      unsupported: true,
      goal: "totally_unknown_goal",
      task: "unsupported_goal",
      action: "deferCapability",
      deferred: true,
    });
    expect(resolveModelGoalForPlanner("")).toMatchObject({
      unsupported: true,
      action: "deferCapability",
    });
    expect(resolveModelGoalForPlanner("rm -rf /")).toMatchObject({
      unsupported: true,
      action: "deferCapability",
    });
    // Dangerous legacy fallback: action === raw goal string
    const bad = resolveModelGoalForPlanner("mineBlock");
    expect(bad.unsupported).toBe(true);
    if (bad.unsupported) {
      expect(bad.action).toBe("deferCapability");
      expect(bad.action).not.toBe("mineBlock");
    }
  });

  it("classifies former LLM_MAP-only names as internal planner actions, not cognition goals", () => {
    for (const name of Object.keys(INTERNAL_PLANNER_ACTIONS)) {
      expect(isInternalPlannerActionName(name)).toBe(true);
      expect(GOALS.includes(name as (typeof GOALS)[number])).toBe(false);
      const resolved = resolveModelGoalForPlanner(name);
      expect(resolved.unsupported).toBe(true);
      if (resolved.unsupported) {
        expect(resolved.action).toBe("deferCapability");
        expect(resolved.action).not.toBe(INTERNAL_PLANNER_ACTIONS[name as keyof typeof INTERNAL_PLANNER_ACTIONS].action);
      }
    }
  });

  it("keeps shareItem allowlisted for deterministic paths but unreachable from cognition goals", () => {
    expect(isAllowlistedExecutorAction("shareItem")).toBe(true);
    for (const goal of GOALS) {
      expect(GOAL_ACTION_MAP[goal].action).not.toBe("shareItem");
    }
  });
});
