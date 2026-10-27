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

export type ModelGoalDispatchResult =
  | (GoalDispatch & { unsupported?: false })
  | { unsupported: true; goal: string; task: "unsupported_goal"; action: "deferCapability"; deferred: true };

/**
 * Explicit map from cognition snake_case goals to executor camelCase actions.
 * This is the **only** authoritative model-goal → action table used in production.
 * Mapping to a function is not proof of goal completion.
 */
export const GOAL_ACTION_MAP: Record<Goal, Omit<GoalDispatch, "goal">> = {
  gather_food: { task: "gather_food", action: "gatherFood", occupation: "gatherer" },
  gather_wood: { task: "gather_wood", action: "mineBlock", occupation: "lumberjack" },
  mine_stone: { task: "mine_stone", action: "mineBlock", occupation: "miner" },
  craft_tools: { task: "craft_tools", action: "craftItem", occupation: "crafter" },
  build_shelter: { task: "build_shelter", action: "buildShelter", occupation: "builder" },
  /** Settlement contribute uses structure intention path (workshop/cabin), not only starter hut. */
  contribute_to_project: { task: "build_structure", action: "buildStructure", occupation: "builder" },
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

/**
 * Former planner `LLM_MAP` entries that are **not** cognition GOALS.
 * They remain valid deterministic / activity-choice actions, but model output
 * naming them must fail closed (not execute via a second allowlist).
 */
export const INTERNAL_PLANNER_ACTIONS = {
  fish_shore: { classification: "internal_planner" as const, action: "fishShore", note: "Activity-choice / reflex fishing; not a cognition goal" },
  mine_ore: { classification: "internal_planner" as const, action: "mineOre", note: "Discovered-site mining; not a cognition goal" },
  work_farm: { classification: "internal_planner" as const, action: "workFarmPlot", note: "Farm plot work; not a cognition goal" },
  claim_home: { classification: "internal_planner" as const, action: "claimHome", note: "Housing claim path; not a cognition goal" },
  build_structure: {
    classification: "internal_planner" as const,
    action: "buildStructure",
    note: "Internal construction task; model uses contribute_to_project",
  },
  obtain_item: {
    classification: "internal_planner" as const,
    action: "obtainItem",
    note: "Bootstrap / recipe chain; model uses craft_tools",
  },
} as const;

export type InternalPlannerActionName = keyof typeof INTERNAL_PLANNER_ACTIONS;

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
  "buildStructure",
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

export function isInternalPlannerActionName(raw: string): raw is InternalPlannerActionName {
  return Object.prototype.hasOwnProperty.call(INTERNAL_PLANNER_ACTIONS, raw);
}

export function isAllowlistedExecutorAction(action: string): boolean {
  return EXECUTOR_ACTIONS.has(action);
}

/** Executor actions reachable from cognition `GOAL_ACTION_MAP` (derived — not a second table). */
export function cognitionReachableActions(): Set<string> {
  return new Set(Object.values(GOAL_ACTION_MAP).map((entry) => entry.action));
}

export function isCognitionReachableAction(action: string): boolean {
  return cognitionReachableActions().has(action);
}

/**
 * Planner may enrich an already-dispatched model plan (e.g. explore → housing travel).
 * These are not raw model verbs; they must remain a closed set derived from known executor actions.
 */
export const MODEL_PLAN_ENRICHMENT_ACTIONS = new Set(["blocked", "travelTowardHousing", "claimHome"]);

export type ModelPlanValidation =
  | { ok: true }
  | { ok: false; reason: string };

export type ModelOriginPlan = {
  source: string;
  action: string;
  goal: string;
  task: string;
  reason?: string;
};

/**
 * Runtime integrity for model-originated plans (`source === "llm"`).
 * Deterministic reflex/planner/directive plans are not restricted here.
 */
export function validateModelOriginatedPlan(plan: ModelOriginPlan): ModelPlanValidation {
  if (plan.source !== "llm") {
    return { ok: true };
  }
  if (!plan.action || typeof plan.action !== "string") {
    return { ok: false, reason: "model plan missing action" };
  }
  // Reject the legacy fail-open pattern: action === raw goal / arbitrary string.
  if (plan.action === plan.goal && !isCognitionReachableAction(plan.action)) {
    return { ok: false, reason: `model plan action equals unrecognized goal '${plan.goal}'` };
  }
  if (isCognitionReachableAction(plan.action)) {
    return { ok: true };
  }
  if (MODEL_PLAN_ENRICHMENT_ACTIONS.has(plan.action) && isAllowlistedExecutorAction(plan.action)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `model-originated action '${plan.action}' is not cognition-reachable or an approved enrichment`,
  };
}

/**
 * Rewrite unsafe model plans to deferCapability. Preserves goal/reason provenance.
 * Does not invent gather/build substitutes.
 */
export function enforceModelOriginatedPlan<T extends ModelOriginPlan>(plan: T): T {
  const check = validateModelOriginatedPlan(plan);
  if (check.ok) return plan;
  return {
    ...plan,
    task: "unsupported_goal",
    action: "deferCapability",
    reason: `${plan.reason ?? "model plan"} | dispatch integrity: ${check.reason}`,
  };
}

/**
 * Authoritative cognition goal dispatch. Normalizes aliases via `@civ/cognition`.
 * Unknown / non-allowlisted goals return `{ unsupported: true }` — never an arbitrary action name.
 */
export function dispatchCognitionGoal(rawGoal: string): GoalDispatch | { unsupported: true; goal: string } {
  const goal = normalizeGoal(rawGoal);
  if (!goal) {
    return { unsupported: true, goal: rawGoal };
  }
  const mapped = GOAL_ACTION_MAP[goal];
  return { goal, ...mapped };
}

/**
 * Planner-facing model-goal resolution. Fail closed for unsupported goals.
 * Never maps an unrecognized string to an executor action of the same name.
 */
export function resolveModelGoalForPlanner(rawGoal: string): ModelGoalDispatchResult {
  const goal = normalizeGoal(rawGoal);
  if (!goal) {
    return {
      unsupported: true,
      goal: rawGoal,
      task: "unsupported_goal",
      action: "deferCapability",
      deferred: true,
    };
  }
  const mapped = GOAL_ACTION_MAP[goal];
  return {
    goal,
    task: mapped.task,
    action: mapped.action,
    occupation: mapped.occupation,
    deferred: mapped.deferred,
    unsupported: false,
  };
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
