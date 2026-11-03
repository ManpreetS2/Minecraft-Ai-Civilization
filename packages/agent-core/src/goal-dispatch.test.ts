import { describe, expect, it } from "vitest";
import { GOALS } from "@civ/cognition";
import {
  assertGoalMapComplete,
  dispatchCognitionGoal,
  EXECUTOR_ACTIONS,
  GOAL_ACTION_MAP,
} from "./goal-dispatch.js";
import { planCitizen } from "./planner.js";
import type { BodyObservation, SettlementState } from "@civ/shared";

const settlement = (): SettlementState => ({
  id: "settlement_first",
  name: "First Settlement",
  food: 99,
  wood: 99,
  stone: 99,
  beds: 0,
  housingCapacity: 0,
  tools: 99,
  shelterComplete: true,
  needs: [],
});

const obs = (): BodyObservation => ({
  username: "Atlas",
  connected: true,
  spawned: true,
  health: 20,
  food: 20,
  inventory: [{ name: "wooden_pickaxe", count: 1 }],
  players: [],
  nearby: [],
});

describe("goal dispatch", () => {
  it("maps every declared cognition goal to a known executor action", () => {
    expect(() => assertGoalMapComplete()).not.toThrow();
    expect(Object.keys(GOAL_ACTION_MAP).sort()).toEqual([...GOALS].sort());
    for (const goal of GOALS) {
      const dispatched = dispatchCognitionGoal(goal);
      expect("unsupported" in dispatched).toBe(false);
      if ("unsupported" in dispatched) continue;
      expect(EXECUTOR_ACTIONS.has(dispatched.action)).toBe(true);
      expect(dispatched.task).toBeTruthy();
      expect(dispatched.action).not.toBe(goal);
    }
  });

  it("rejects unknown goals instead of inventing work", () => {
    expect(dispatchCognitionGoal("do_a_backflip")).toEqual({
      unsupported: true,
      goal: "do_a_backflip",
    });
  });

  it.each([...GOALS])("plans llm goal %s to its mapped executor action", (goal) => {
    const mapped = GOAL_ACTION_MAP[goal];
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: goal,
      llmReason: `test ${goal}`,
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe(mapped.action);
    expect(planned.task).toBe(mapped.task);
    expect(planned.action).not.toBe(goal);
  });

  it("does not silently turn gather_food into wood mining via unknown action", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "gather_food",
      llmReason: "Need calories",
    });
    expect(planned.action).toBe("gatherFood");
    expect(planned.task).toBe("gather_food");
  });

  it("surfaces unsupported llm goals as deferCapability rather than mineBlock", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "summon_dragon",
      llmReason: "chaos",
    });
    expect(planned.task).toBe("unsupported_goal");
    expect(planned.action).toBe("deferCapability");
    expect(planned.action).not.toBe("mineBlock");
  });
});
