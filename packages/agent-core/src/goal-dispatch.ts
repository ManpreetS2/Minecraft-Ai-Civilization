import { GOALS, normalizeGoal, type Goal } from "@civ/cognition";

export type GoalDispatch = {
  goal: Goal;
  task: string;
  action: string;
  occupation?: string;
  /**
   * When true, the mapped action must not claim the goal was accomplished.
   * Executor returns an explicit deferred/unsupported failure.
   */
  deferred?: boolean;
};

/**
 * Explicit map from cognition snake_case goals to executor camelCase actions.
 * Every entry in GOALS must appear here — tests enforce completeness.
 *
 * Mapping to a function is not proof of goal completion. Deferred goals use
 * `deferCapability`, which fails closed without fabricating help/rest evidence.
 */
export const GOAL_ACTION_MAP: Record<Goal, Omit<GoalDispatch, "goal">> = {
  gather_food: { task: "gather_food", action: "gatherFood", occupation: "gatherer" },
  gather_wood: { task: "gather_wood", action: "mineBlock", occupation: "lumberjack" },
  mine_stone: { task: "mine_stone", action: "mineBlock", occupation: "miner" },
  craft_tools: { task: "craft_tools", action: "craftItem", occupation: "crafter" },
  build_shelter: { task: "build_shelter", action: "buildShelter", occupation: "builder" },
  help_citizen: { task: "help_citizen", action: "deferCapability", deferred: true },
  deposit: { task: "deposit", action: "depositItems" },
  rest: { task: "rest", action: "deferCapability", deferred: true },
  explore: { task: "explore", action: "wander" },
  defend: { task: "defend", action: "attack", occupation: "guard" },
};

/** Goals that must not report success until a real verified capability exists. */
export const DEFERRED_GOALS = new Set<Goal>(
  (Object.keys(GOAL_ACTION_MAP) as Goal[]).filter((goal) => GOAL_ACTION_MAP[goal].deferred),
);

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
  "deferCapability",
]);

export function isDeferredGoal(goal: string): boolean {
  return DEFERRED_GOALS.has(goal as Goal);
}

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

export function deferredCapabilityResult(task: string): {
  success: false;
  code: "UNSUPPORTED_ACTION";
  error: string;
  durationMs: number;
  retryable: boolean;
} {
  const detail =
    task === "help_citizen"
      ? "help_citizen is deferred: observing or chatting is not verified help"
      : task === "rest"
        ? "rest is deferred: observing is not verified sleep or rest"
        : task === "unsupported_goal"
          ? "cognition goal is not supported by this build"
          : `capability '${task}' is deferred or unsupported in this build`;
  return {
    success: false,
    code: "UNSUPPORTED_ACTION",
    error: detail,
    durationMs: 0,
    retryable: false,
  };
}
