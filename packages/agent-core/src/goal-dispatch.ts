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
 * Adapted for the Windows integration branch's richer goal set.
 * Mapping to a function is not proof of goal completion.
 */
export const GOAL_ACTION_MAP: Record<Goal, Omit<GoalDispatch, "goal">> = {
  gather_food: { task: "gather_food", action: "gatherFood", occupation: "gatherer" },
  gather_wood: { task: "gather_wood", action: "mineBlock", occupation: "lumberjack" },
  mine_stone: { task: "mine_stone", action: "mineBlock", occupation: "miner" },
  craft_tools: { task: "craft_tools", action: "craftItem", occupation: "crafter" },
  build_shelter: { task: "build_shelter", action: "buildShelter", occupation: "builder" },
  contribute_to_project: { task: "contribute_to_project", action: "buildShelter", occupation: "builder" },
  help_citizen: { task: "help_citizen", action: "deferCapability", deferred: true },
  assist_citizen: { task: "assist_citizen", action: "deferCapability", deferred: true },
  deposit: { task: "deposit", action: "depositItems" },
  use_storage: { task: "use_storage", action: "depositItems" },
  rest: { task: "rest", action: "deferCapability", deferred: true },
  explore: { task: "explore", action: "observeNearby" },
  defend: { task: "defend", action: "attack", occupation: "guard" },
  seek_safety: { task: "seek_safety", action: "seekSafety" },
  socialize: { task: "socialize", action: "deferCapability", deferred: true },
  reconsider: { task: "reconsider", action: "deferCapability", deferred: true },
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
  "withdrawItems",
  "observeNearby",
  "gatherFood",
  "craftItem",
  "buildShelter",
  "mineBlock",
  "seekSafety",
  "deferCapability",
  "waitInsideHome",
  "sleep",
  "returnHome",
  "claimHome",
  "travelTowardHousing",
  "workFarmPlot",
  "shareItem",
  "obtainItem",
  "mineOre",
  "fishShore",
  "blocked",
  "returnToSettlement",
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
    task === "help_citizen" || task === "assist_citizen"
      ? `${task} is deferred: observing or chatting is not verified help`
      : task === "rest"
        ? "rest is deferred: observing is not verified sleep or rest"
        : task === "socialize"
          ? "socialize is deferred: chat alone is not verified social success"
          : task === "reconsider"
            ? "reconsider is deferred: no durable plan change without a real decision"
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
