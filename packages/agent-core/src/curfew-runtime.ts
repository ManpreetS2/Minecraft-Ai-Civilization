import {
  alreadyInsideClaimedHome,
  cellCenter,
  evaluateReturnHome,
  vanillaMorning,
  vanillaSleepTimeValid,
  type ReturnHomePlan,
} from "@civ/minecraft-adapter";
import type { Vec3 } from "@civ/shared";

export type ClaimedHomeView = {
  homeId: string;
  bed: Vec3;
  status: "active" | "displaced" | "left";
  origin?: Vec3;
  entrance?: Vec3;
};

export type CitizenCurfewDecision = {
  shouldLeaveWork: boolean;
  homeId?: string;
  bed?: Vec3;
  destination?: Vec3;
  entrance?: Vec3;
  plan?: ReturnHomePlan;
  alreadyInside: boolean;
  reason: string;
};

/** Interior stand of the citizen's own claim. Never defaults to H1. */
export function claimedHomeDestination(home: ClaimedHomeView): Vec3 {
  return cellCenter(home.origin ?? home.entrance ?? home.bed);
}

export function evaluateCitizenCurfew(input: {
  home?: ClaimedHomeView;
  position?: Vec3;
  timeOfDay?: number;
  isNight?: boolean;
}): CitizenCurfewDecision {
  if (!input.home || input.home.status !== "active" || !input.home.bed) {
    return { shouldLeaveWork: false, alreadyInside: false, reason: "no claimed home; do not invent H1" };
  }
  const destination = claimedHomeDestination(input.home);
  const entrance = input.home.entrance ? cellCenter(input.home.entrance) : undefined;
  const alreadyInside = Boolean(input.position && alreadyInsideClaimedHome(input.position, destination));
  if (input.position === undefined || input.timeOfDay === undefined) {
    if (input.isNight) {
      return {
        shouldLeaveWork: true,
        homeId: input.home.homeId,
        bed: input.home.bed,
        destination,
        entrance,
        alreadyInside,
        reason: "night; sleep in the claimed home bed, not the nearest bed",
      };
    }
    return { shouldLeaveWork: false, homeId: input.home.homeId, bed: input.home.bed, destination, entrance, alreadyInside, reason: "no clock or position for curfew ETA" };
  }
  const plan = evaluateReturnHome({
    position: input.position,
    home: destination,
    timeOfDay: input.timeOfDay,
  });
  if (plan.shouldStopOptionalWork || input.isNight) {
    return {
      shouldLeaveWork: true,
      homeId: input.home.homeId,
      bed: input.home.bed,
      destination,
      entrance,
      plan,
      alreadyInside,
      reason: input.isNight
        ? "night; sleep in the claimed home bed, not the nearest bed"
        : `stop work; travel ${plan.estimateMs}ms remaining ${plan.remainingMs}ms; ${plan.reason}`,
    };
  }
  return {
    shouldLeaveWork: false,
    homeId: input.home.homeId,
    bed: input.home.bed,
    destination,
    entrance,
    plan,
    alreadyInside,
    reason: plan.reason,
  };
}

const RESTING_ACTIONS = new Set(["sleep", "waitInsideHome", "returnHome", "flee", "eatFood"]);
const RESTING_TASKS = new Set(["sleep_at_home", "WAIT_INSIDE_HOME", "return_home", "flee_danger", "eat"]);

export type CurfewBedtimeAction = {
  task: "WAIT_INSIDE_HOME" | "sleep_at_home";
  action: "waitInsideHome" | "sleep";
  reason: string;
  target: Vec3;
};

/**
 * Planner contract: early interior arrival waits; legal night sleeps the claimed bed.
 * GREEN returnHome is walk-only and is not this path.
 */
export function planCurfewBedtimeAction(input: {
  curfew: CitizenCurfewDecision;
  timeOfDay?: number;
  thundering?: boolean;
}): CurfewBedtimeAction | undefined {
  if (!input.curfew.shouldLeaveWork || !input.curfew.bed) return undefined;
  const tick = input.timeOfDay;
  if (
    tick !== undefined &&
    vanillaMorning(tick) &&
    !vanillaSleepTimeValid(tick, input.thundering)
  ) {
    return undefined;
  }
  if (tick !== undefined && input.curfew.alreadyInside && !vanillaSleepTimeValid(tick, input.thundering)) {
    return {
      task: "WAIT_INSIDE_HOME",
      action: "waitInsideHome",
      reason: `arrived early; wait inside claimed home until vanilla sleep; ${input.curfew.reason}`,
      target: input.curfew.bed,
    };
  }
  return {
    task: "sleep_at_home",
    action: "sleep",
    reason: input.curfew.reason,
    target: input.curfew.bed,
  };
}

/** Abort this citizen's work only. Never another bot's controller. */
export function shouldAbortActiveWorkForCurfew(input: {
  busy: boolean;
  lastAction?: string;
  lastTask?: string;
  home?: ClaimedHomeView;
  position?: Vec3;
  timeOfDay?: number;
  isNight?: boolean;
}): boolean {
  if (!input.busy) return false;
  if (input.lastAction && RESTING_ACTIONS.has(input.lastAction)) return false;
  if (input.lastTask && RESTING_TASKS.has(input.lastTask)) return false;
  return evaluateCitizenCurfew(input).shouldLeaveWork;
}

export function curfewDidNotCompleteWork(code: string | undefined): boolean {
  return code === "CURFEW_STOP" || code === "CANCELLED" || code === "INTERRUPTED";
}

/** Failed/interrupted work codes the next planner tick should treat as a curfew handoff, not success. */
export function workHandoffToCurfew(code: string | undefined): boolean {
  return curfewDidNotCompleteWork(code);
}
