import { fail, type ActionFailure, type Vec3 } from "@civ/shared";

/** Conservative walk including one stall recovery (jump + replan). Sprint is not assumed. */
export const WALK_MS_PER_BLOCK = 320;
export const STALL_RECOVERY_BUFFER_MS = 8_000;
/** Extra leave-early margin used by the live curfew PASS (not a teleport). */
export const CURFEW_SAFETY_MARGIN_MS = 20_000;
export const NIGHT_START_TICK = 12_542;
export const SUNSET_START_TICK = 11_000;
export const VANILLA_NIGHT_START_TICK = 13_000;
export const VANILLA_NIGHT_END_TICK = 23_000;

export function estimateTravelMs(
  distanceBlocks: number,
  options: { expectedRecoveries?: number } = {},
): number {
  const recoveries = Math.max(0, options.expectedRecoveries ?? 1);
  return Math.ceil(Math.max(0, distanceBlocks) * WALK_MS_PER_BLOCK + recoveries * STALL_RECOVERY_BUFFER_MS);
}

export function msUntilBedtime(timeOfDay: number, bedtime = NIGHT_START_TICK): number {
  const t = ((Math.floor(timeOfDay) % 24_000) + 24_000) % 24_000;
  if (t >= bedtime && t < 23_460) return 0;
  if (t >= 23_460) return (24_000 - t + bedtime) * 50;
  return (bedtime - t) * 50;
}

export type ReturnHomeEtaKind = "straight_line_plus_recovery_buffer";

export type ReturnHomePlan = {
  shouldStopOptionalWork: boolean;
  estimateMs: number;
  remainingMs: number;
  delayMs: number;
  distanceBlocks: number;
  reason: string;
  /** Straight-line + one recovery buffer. Never a verified pathfinder cost. */
  etaKind: ReturnHomeEtaKind;
  /** Always false: this plan does not prove a safe walk exists. */
  routeGuaranteed: false;
};

function wrapDayTick(timeOfDay: number): number {
  return ((Math.floor(timeOfDay) % 24_000) + 24_000) % 24_000;
}

/** Vanilla beds accept sleep at night or during thunder. Sunset travel is not sleep. */
export function vanillaSleepTimeValid(timeOfDay: number, thundering = false): boolean {
  if (thundering) return true;
  const t = wrapDayTick(timeOfDay);
  return t >= VANILLA_NIGHT_START_TICK && t < VANILLA_NIGHT_END_TICK;
}

export function msUntilVanillaSleep(timeOfDay: number): number {
  const t = wrapDayTick(timeOfDay);
  if (t >= VANILLA_NIGHT_START_TICK && t < VANILLA_NIGHT_END_TICK) return 0;
  if (t >= VANILLA_NIGHT_END_TICK) return (24_000 - t + VANILLA_NIGHT_START_TICK) * 50;
  return (VANILLA_NIGHT_START_TICK - t) * 50;
}

/** After sunrise / before sunset: do not keep WAIT_INSIDE_HOME running. */
export function vanillaMorning(timeOfDay: number): boolean {
  const t = wrapDayTick(timeOfDay);
  return t >= VANILLA_NIGHT_END_TICK || t < SUNSET_START_TICK;
}

/** Wait started in sunset/night and the legal sleep window closed without sleep. */
export function vanillaNightWindowEnded(startedTick: number, nowTick: number): boolean {
  const a = wrapDayTick(startedTick);
  const b = wrapDayTick(nowTick);
  const startedInTravelOrNight = a >= SUNSET_START_TICK && a < VANILLA_NIGHT_END_TICK;
  const nowDay = b < SUNSET_START_TICK || b >= VANILLA_NIGHT_END_TICK;
  return startedInTravelOrNight && nowDay && !vanillaSleepTimeValid(b);
}

function returnHomePlan(partial: Omit<ReturnHomePlan, "etaKind" | "routeGuaranteed">): ReturnHomePlan {
  return {
    ...partial,
    etaKind: "straight_line_plus_recovery_buffer",
    routeGuaranteed: false,
  };
}

export function evaluateReturnHome(input: {
  position: Vec3;
  home: Vec3;
  timeOfDay: number;
  routeImpassable?: boolean;
  expectedRecoveries?: number;
  safetyMarginMs?: number;
}): ReturnHomePlan {
  const distanceBlocks = Math.hypot(
    input.position.x - input.home.x,
    input.position.y - input.home.y,
    input.position.z - input.home.z,
  );
  const estimateMs = estimateTravelMs(distanceBlocks, { expectedRecoveries: input.expectedRecoveries ?? 1 });
  const remainingMs = msUntilBedtime(input.timeOfDay);
  const safetyMarginMs = input.safetyMarginMs ?? CURFEW_SAFETY_MARGIN_MS;
  if (input.routeImpassable) {
    return returnHomePlan({
      shouldStopOptionalWork: true,
      estimateMs,
      remainingMs,
      delayMs: estimateMs,
      distanceBlocks,
      reason: "route impassable; return from actual position, do not teleport",
    });
  }
  const delayMs = Math.max(0, estimateMs - remainingMs);
  if (estimateMs + safetyMarginMs >= remainingMs) {
    return returnHomePlan({
      shouldStopOptionalWork: true,
      estimateMs,
      remainingMs,
      delayMs,
      distanceBlocks,
      reason: "bedtime window too short for remaining travel plus recovery",
    });
  }
  return returnHomePlan({
    shouldStopOptionalWork: false,
    estimateMs,
    remainingMs,
    delayMs: 0,
    distanceBlocks,
    reason: "ok",
  });
}

export type LateDayBedtimePlan = {
  complete: boolean;
  lateDayDeparture: boolean;
  homeArrival: boolean;
  ownBedSleep: boolean;
  sleepTimeValid: boolean;
  returnHome: ReturnHomePlan;
  reason: string;
};

/** Early-day H1 walks are not a bedtime PASS. Curfew needs late-day leave, arrival, and own-bed sleep. */
export function evaluateLateDayBedtime(input: {
  position: Vec3;
  home: Vec3;
  bed: Vec3;
  timeOfDay: number;
  arrivedAtHome?: boolean;
  sleptInOwnBed?: boolean;
}): LateDayBedtimePlan {
  const t = wrapDayTick(input.timeOfDay);
  const lateDayDeparture = t >= SUNSET_START_TICK && t < 23_460;
  const sleepTimeValid = vanillaSleepTimeValid(t);
  const returnHome = evaluateReturnHome({
    position: input.position,
    home: input.home,
    timeOfDay: input.timeOfDay,
  });
  const homeArrival = Boolean(input.arrivedAtHome);
  const ownBedSleep = Boolean(input.sleptInOwnBed);
  if (!lateDayDeparture) {
    return {
      complete: false,
      lateDayDeparture,
      homeArrival,
      ownBedSleep,
      sleepTimeValid,
      returnHome,
      reason: "early-day home walk is not a complete bedtime/sleep test",
    };
  }
  if (!homeArrival) {
    return {
      complete: false,
      lateDayDeparture,
      homeArrival,
      ownBedSleep,
      sleepTimeValid,
      returnHome,
      reason: "curfew requires actual home arrival after late-day work departure",
    };
  }
  if (!sleepTimeValid || !ownBedSleep) {
    return {
      complete: false,
      lateDayDeparture,
      homeArrival,
      ownBedSleep,
      sleepTimeValid,
      returnHome,
      reason: "curfew requires own-bed sleep at night; arrival alone is not sleep",
    };
  }
  return {
    complete: true,
    lateDayDeparture,
    homeArrival,
    ownBedSleep,
    sleepTimeValid,
    returnHome,
    reason: "late-day departure, home arrival, and own-bed sleep",
  };
}

/** Incomplete work stop. Never success, never drops inventory, never touches another body. */
export function curfewWorkInterrupted(input: {
  plan: ReturnHomePlan;
  durationMs: number;
  inventory?: Record<string, number>;
}): ActionFailure {
  return fail(
    "CURFEW_STOP",
    `stopped optional work to return home; estimate ${input.plan.estimateMs}ms remaining ${input.plan.remainingMs}ms; ${input.plan.reason}`,
    input.durationMs,
    true,
    {
      curfew: true,
      workComplete: false,
      inventoryPreserved: true,
      inventory: input.inventory,
      estimateMs: input.plan.estimateMs,
      remainingMs: input.plan.remainingMs,
      delayMs: input.plan.delayMs,
    },
  );
}
