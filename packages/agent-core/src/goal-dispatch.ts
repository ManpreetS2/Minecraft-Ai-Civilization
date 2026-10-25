import { GOALS, normalizeGoal, type Goal } from "@civ/cognition";

export type GoalDispatch = {
  goal: Goal;
  task: string;
  action: string;
  occupation?: string;
};

/**
 * Explicit map from cognition snake_case goals to executor camelCase actions.
 * Every entry in GOALS must appear here — tests enforce completeness.
 */
export const GOAL_ACTION_MAP: Record<Goal, Omit<GoalDispatch, "goal">> = {
  gather_food: { task: "gather_food", action: "gatherFood", occupation: "gatherer" },
  gather_wood: { task: "gather_wood", action: "mineBlock", occupation: "lumberjack" },
  mine_stone: { task: "mine_stone", action: "mineBlock", occupation: "miner" },
  craft_tools: { task: "craft_tools", action: "craftItem", occupation: "crafter" },
  build_shelter: { task: "build_shelter", action: "buildShelter", occupation: "builder" },
  help_citizen: { task: "help_citizen", action: "observeNearby" },
  deposit: { task: "deposit", action: "depositItems" },
  rest: { task: "rest", action: "observeNearby" },
  explore: { task: "explore", action: "wander" },
  defend: { task: "defend", action: "attack", occupation: "guard" },
};

export const EXECUTOR_ACTIONS = new Set([
  "eatFood",
  "flee",
  "attack",
  "depositItems",
  "observeNearby",
  "gatherFood",
  "craftItem",
  "buildShelter",
  "mineBlock",
  "wander",
]);

export function dispatchCognitionGoal(rawGoal: string): GoalDispatch | { unsupported: true; goal: string } {
  const goal = normalizeGoal(rawGoal);
  if (!goal) {
    return { unsupported: true, goal: rawGoal };
  }
  const mapped = GOAL_ACTION_MAP[goal];
  return { goal, ...mapped };
}

export function assertGoalMapComplete(): void {
  for (const goal of GOALS) {
    if (!(goal in GOAL_ACTION_MAP)) {
      throw new Error(`GOAL_ACTION_MAP missing cognition goal: ${goal}`);
    }
    const action = GOAL_ACTION_MAP[goal].action;
    if (!EXECUTOR_ACTIONS.has(action)) {
      throw new Error(`GOAL_ACTION_MAP maps ${goal} to unknown executor action: ${action}`);
    }
  }
}
