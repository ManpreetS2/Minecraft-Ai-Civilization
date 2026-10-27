/**
 * WORLD-LAB one-citizen day-sequence tracker and positioning gate.
 *
 * Pure logic: no Mineflayer, no RCON, no sqlite writes. The first claimed-bed
 * sleep does not complete a full-day observation.
 */
import type { Vec3 } from "@civ/shared";
import { HOME_CLAIM_REACH_BLOCKS } from "@civ/agent-core";
import {
  catalogClaimDistances,
  evaluateWorldLabOneCitizenLaunch,
  type WorldLabOneCitizenLaunch,
} from "./world-lab-one-citizen-guard.js";

export const DEFAULT_LIVE_MAX_MS = 25 * 60 * 1000;

/** Atlas player.dat last Pos at the fishing pond (not a house). */
export const ATLAS_POND_LAST_POS: Vec3 = { x: -1043.5, y: 63, z: 981.5 };

/** Inclusive AABB around the Site C fishing pond / fixture chests. */
export const FISHING_POND_BOUNDS = {
  minX: -1052,
  maxX: -1034,
  minY: 58,
  maxY: 70,
  minZ: 972,
  maxZ: 988,
} as const;

export const DAY_SEQUENCE_STAGES = [
  "initial_claim",
  "optional_first_night_sleep",
  "following_daytime_activity",
  "curfew",
  "own_home_return",
  "next_legal_sleep",
] as const;

export type DaySequenceStage = (typeof DAY_SEQUENCE_STAGES)[number];

export type DaySequenceVerdict = "PASS" | "PARTIAL" | "BLOCKED" | "FAIL";

export type StopReason = "sequence_complete" | "time_limit" | "interrupt" | "positioning_needed" | "guard_refused";

export type IntegrationTraceChannel =
  | "TEST_CONTROL"
  | "CITIZEN_OBSERVATION"
  | "PLANNER_CHOICE"
  | "PHYSICAL_ACTION"
  | "INVENTORY_DELTA"
  | "HOME_CLAIM"
  | "SLEEP_RESULT";

export type DaySequenceState = {
  claimedHomeId?: string;
  firstNightSleep: boolean;
  claimedBedSleepCount: number;
  daytimeActivity: boolean;
  daytimeTask?: string;
  curfew: boolean;
  returnedHome: boolean;
  legalSleepAfterDay: boolean;
};

export type SequenceNote = {
  channel: IntegrationTraceChannel;
  type?: string;
  task?: string;
  action?: string;
  success?: boolean;
  homeId?: string;
  item?: string;
  count?: number;
  decisionKind?: string;
};

export type PositioningGate = {
  allowed: true;
  atPond: boolean;
  inClaimReach: boolean;
  nearest?: { id: string; distance: number };
  teleportApproved: false;
  citizenWalkExpected: boolean;
  request: string;
};

export type LiveConnectPreflight =
  | {
      allowed: true;
      wouldConnectCitizen: true;
      wouldStartPlanner: true;
      launch: Extract<WorldLabOneCitizenLaunch, { allowed: true }>;
      positioning: PositioningGate;
    }
  | {
      allowed: false;
      wouldConnectCitizen: false;
      wouldStartPlanner: false;
      verdict: "BLOCKED";
      error: string;
    };

export function positioningRequestMessage(input: {
  atPond: boolean;
  position?: Vec3;
  nearest?: { id: string; distance: number };
}): string {
  const where = input.position
    ? `${input.position.x.toFixed(1)},${input.position.y.toFixed(1)},${input.position.z.toFixed(1)}`
    : "unknown";
  const nearest = input.nearest
    ? `Nearest catalog house ${input.nearest.id} is ${input.nearest.distance.toFixed(1)} blocks (claim reach ${HOME_CLAIM_REACH_BLOCKS}).`
    : `No catalog house is within HOME_CLAIM_REACH ${HOME_CLAIM_REACH_BLOCKS}.`;
  const pond = input.atPond ? "Atlas is at the fishing pond." : "Atlas is not within claim reach of a catalog house.";
  return [
    "TEST_CONTROL teleport is NOT approved (including /tp Atlas -1061 68 847).",
    pond,
    `Join/spawn ${where}. ${nearest}`,
    "Planner may start from this cell. Walking toward Site C is a citizen path via travelTowardHousing, not a TEST_CONTROL teleport and not a pre-chosen H9 claim.",
    "ClaimHome still requires the 48-block body check after arrival.",
  ].join(" ");
}

export function evaluatePositioningGate(position: Vec3 | undefined): PositioningGate {
  const atPond = position ? isFishingPondPosition(position) : false;
  const distances = position ? catalogClaimDistances(position) : [];
  const nearest = distances[0];
  const inClaimReach = distances.some((row) => row.inClaimReach);
  return {
    allowed: true,
    atPond,
    inClaimReach,
    nearest: nearest ? { id: nearest.id, distance: nearest.distance } : undefined,
    teleportApproved: false,
    citizenWalkExpected: !inClaimReach,
    request: positioningRequestMessage({
      atPond,
      position,
      nearest: nearest ? { id: nearest.id, distance: nearest.distance } : undefined,
    }),
  };
}

export function evaluateLiveConnectPreflight(input: {
  env: NodeJS.ProcessEnv;
  spawn?: Vec3;
}): LiveConnectPreflight {
  const launch = evaluateWorldLabOneCitizenLaunch(input.env);
  if (!launch.allowed) {
    return {
      allowed: false,
      wouldConnectCitizen: false,
      wouldStartPlanner: false,
      verdict: "BLOCKED",
      error: launch.error,
    };
  }
  return {
    allowed: true,
    wouldConnectCitizen: true,
    wouldStartPlanner: true,
    launch,
    positioning: evaluatePositioningGate(input.spawn),
  };
}

const CLAIM_ACTIONS = new Set(["claimHome", "claim_home"]);
const SLEEP_ACTIONS = new Set(["sleep", "waitInsideHome", "executeSleepAtHome"]);
const SLEEP_TASKS = new Set(["sleep_at_home", "WAIT_INSIDE_HOME", "wait_inside_home", "sleep"]);
const RETURN_ACTIONS = new Set(["returnHome", "return_home"]);
const RETURN_TASKS = new Set(["return_home", "returnHome"]);
const CURFEW_TASKS = new Set([...SLEEP_TASKS, ...RETURN_TASKS]);
const INVENTORY_EVENTS = new Set([
  "ResourceCollected",
  "ItemCrafted",
  "ItemDropped",
  "ItemPickedUp",
  "ItemTransferred",
  "ItemDeposited",
  "ItemWithdrawn",
  "ItemTransferCompleted",
  "ResourceTransferred",
  "CraftingCompleted",
]);
const OBSERVATION_EVENTS = new Set([
  "CitizenConnected",
  "CitizenDisconnected",
  "CitizenSpawned",
  "CitizenInjured",
  "CitizenDied",
  "CitizenBodyDied",
  "CitizenRespawned",
  "SimulationStarted",
  "SimulationStopped",
]);
const PLANNER_EVENTS = new Set(["TaskStarted", "LLMDecisionMade", "LLMSkipped"]);
const PHYSICAL_EVENTS = new Set([
  "ActionStarted",
  "ActionCompleted",
  "ActionFailed",
  "TaskCompleted",
  "TaskFailed",
  "ObstacleRemovalStarted",
  "ObstacleRemoved",
  "ConstructionStarted",
  "ConstructionProgress",
  "ConstructionBlockPlaced",
  "ConstructionBlockFailed",
  "ConstructionCompleted",
]);

const DAYTIME_WORK_ACTIONS = new Set([
  "mineBlock",
  "gatherWood",
  "fishShore",
  "mineOre",
  "gatherFood",
  "obtainItem",
  "collectItem",
  "workFarmPlot",
  "depositItems",
  "withdrawItems",
  "craftItem",
  "smeltItem",
  "huntAnimal",
  "placeBlock",
  "buildStructure",
  "travelTowardHousing",
]);
const DAYTIME_WORK_TASKS = new Set([
  "gather_wood",
  "mine_ore",
  "fish_shore",
  "gather_food",
  "obtain_item",
  "collect_item",
  "work_farm",
  "deposit_items",
  "withdraw_items",
  "craft_item",
  "smelt_item",
  "hunt",
  "bootstrap",
  "seek_housing",
]);

export function parseWorldLabOneCitizenArgs(argv: string[]): { live: boolean; dryRun: boolean; maxMs: number } {
  const liveRequested = argv.includes("--live");
  const dryRun = !liveRequested || argv.includes("--dry-run");
  const maxRaw = argv.find((arg) => arg.startsWith("--max-ms="))?.slice("--max-ms=".length);
  const maxMs = maxRaw ? Number(maxRaw) : DEFAULT_LIVE_MAX_MS;
  return {
    live: liveRequested && !argv.includes("--dry-run"),
    dryRun,
    maxMs: Number.isFinite(maxMs) && maxMs > 0 ? maxMs : DEFAULT_LIVE_MAX_MS,
  };
}

export function isFishingPondPosition(pos: Vec3): boolean {
  return (
    pos.x >= FISHING_POND_BOUNDS.minX &&
    pos.x <= FISHING_POND_BOUNDS.maxX &&
    pos.y >= FISHING_POND_BOUNDS.minY &&
    pos.y <= FISHING_POND_BOUNDS.maxY &&
    pos.z >= FISHING_POND_BOUNDS.minZ &&
    pos.z <= FISHING_POND_BOUNDS.maxZ
  );
}

export function emptyDaySequence(): DaySequenceState {
  return {
    firstNightSleep: false,
    claimedBedSleepCount: 0,
    daytimeActivity: false,
    curfew: false,
    returnedHome: false,
    legalSleepAfterDay: false,
  };
}

/**
 * Day 2 gap: Atlas already had home_h9 in sqlite from Day 1, so no claim event fired and the
 * harness never set claimedHomeId — curfew/sleep were NOT TESTED by the sequence even though
 * sleep_at_home ran. Seed from the store's active membership without inventing a new claim.
 */
export function seedDaySequenceFromExistingHome(
  state: DaySequenceState,
  homeId: string | null | undefined,
): DaySequenceState {
  if (!homeId) return state;
  if (state.claimedHomeId) return state;
  return { ...state, claimedHomeId: homeId };
}

export function isClaimName(value: string | undefined): boolean {
  return Boolean(value && CLAIM_ACTIONS.has(value));
}

export function isSleepName(task?: string, action?: string): boolean {
  return Boolean((task && SLEEP_TASKS.has(task)) || (action && SLEEP_ACTIONS.has(action)));
}

export function isReturnName(task?: string, action?: string): boolean {
  return Boolean((task && RETURN_TASKS.has(task)) || (action && RETURN_ACTIONS.has(action)));
}

export function isCurfewName(task?: string, action?: string): boolean {
  return isSleepName(task, action) || isReturnName(task, action) || Boolean(task && CURFEW_TASKS.has(task));
}

export function isDaytimeWork(task?: string, action?: string): boolean {
  if (isClaimName(task) || isClaimName(action) || isSleepName(task, action) || isReturnName(task, action)) {
    return false;
  }
  if (action === "observeNearby" || task === "observe") return false;
  return Boolean((action && DAYTIME_WORK_ACTIONS.has(action)) || (task && DAYTIME_WORK_TASKS.has(task)));
}

export function classifyIntegrationTrace(event: {
  type?: string;
  citizenId?: string;
  payload?: Record<string, unknown>;
}): IntegrationTraceChannel {
  const payload = event.payload ?? {};
  const decision = typeof payload.decisionKind === "string" ? payload.decisionKind : undefined;
  const task = typeof payload.task === "string" ? payload.task : undefined;
  const action = typeof payload.action === "string" ? payload.action : undefined;
  if (decision === "test_control") return "TEST_CONTROL";
  if (isClaimName(task) || isClaimName(action)) return "HOME_CLAIM";
  if (isSleepName(task, action)) return "SLEEP_RESULT";
  if (event.type && INVENTORY_EVENTS.has(event.type)) return "INVENTORY_DELTA";
  if (event.type && PLANNER_EVENTS.has(event.type)) return "PLANNER_CHOICE";
  if (event.type && PHYSICAL_EVENTS.has(event.type)) return "PHYSICAL_ACTION";
  if (event.type && OBSERVATION_EVENTS.has(event.type)) return "CITIZEN_OBSERVATION";
  return "CITIZEN_OBSERVATION";
}

export function formatIntegrationTrace(event: {
  type?: string;
  citizenId?: string;
  payload?: Record<string, unknown>;
}): string {
  const channel = classifyIntegrationTrace(event);
  const payload = event.payload ?? {};
  const bits = [
    event.citizenId,
    event.type,
    typeof payload.task === "string" ? payload.task : undefined,
    typeof payload.action === "string" ? payload.action : undefined,
    typeof payload.homeId === "string" ? payload.homeId : undefined,
    typeof payload.item === "string" ? payload.item : undefined,
    typeof payload.decisionKind === "string" ? payload.decisionKind : undefined,
  ].filter(Boolean);
  return `[${channel}] ${bits.join(" ")}`.trim();
}

export function applySequenceNote(state: DaySequenceState, note: SequenceNote): DaySequenceState {
  const next: DaySequenceState = { ...state };
  const task = note.task;
  const action = note.action;
  const homeId = note.homeId ?? (isClaimName(action) || isClaimName(task) ? note.item : undefined);
  const succeeded = note.success === true;

  if ((note.channel === "HOME_CLAIM" || isClaimName(action) || isClaimName(task)) && succeeded && homeId) {
    next.claimedHomeId = homeId;
  }

  if (next.claimedHomeId && isDaytimeWork(task, action) && (note.channel === "PLANNER_CHOICE" || note.channel === "PHYSICAL_ACTION" || succeeded)) {
    next.daytimeActivity = true;
    next.daytimeTask = task ?? action;
  }

  // Curfew is observable when bedtime/return work starts for a claimed home — not only on success.
  if (next.claimedHomeId && isCurfewName(task, action) && note.channel !== "TEST_CONTROL") {
    next.curfew = true;
  }

  if (next.claimedHomeId && isReturnName(task, action) && succeeded) {
    next.returnedHome = true;
    if (next.daytimeActivity) next.curfew = true;
  }

  if (next.claimedHomeId && isSleepName(task, action) && succeeded) {
    next.claimedBedSleepCount += 1;
    if (!next.daytimeActivity || !next.curfew) {
      next.firstNightSleep = true;
    } else {
      next.returnedHome = true;
      next.legalSleepAfterDay = true;
    }
  }

  return next;
}

export function applySimEventToDaySequence(
  state: DaySequenceState,
  event: { type?: string; citizenId?: string; payload?: Record<string, unknown> },
): DaySequenceState {
  const payload = event.payload ?? {};
  const channel = classifyIntegrationTrace(event);
  const success = event.type === "ActionCompleted" || event.type === "TaskCompleted";
  return applySequenceNote(state, {
    channel,
    type: event.type,
    task: typeof payload.task === "string" ? payload.task : undefined,
    action: typeof payload.action === "string" ? payload.action : undefined,
    success,
    homeId: typeof payload.homeId === "string" ? payload.homeId : undefined,
    item: typeof payload.item === "string" ? payload.item : undefined,
    decisionKind: typeof payload.decisionKind === "string" ? payload.decisionKind : undefined,
  });
}

export function missingDaySequenceStages(state: DaySequenceState): DaySequenceStage[] {
  const missing: DaySequenceStage[] = [];
  if (!state.claimedHomeId) missing.push("initial_claim");
  if (!state.daytimeActivity) missing.push("following_daytime_activity");
  if (!state.curfew) missing.push("curfew");
  if (!state.returnedHome) missing.push("own_home_return");
  if (!state.legalSleepAfterDay) missing.push("next_legal_sleep");
  return missing;
}

export function daySequenceComplete(state: DaySequenceState): boolean {
  return missingDaySequenceStages(state).length === 0;
}

/** First claimed-bed sleep never ends the observation run by itself. */
export function firstClaimedBedSleepEndsRun(state: DaySequenceState): boolean {
  void state;
  return false;
}

export type DaySequenceReport = {
  verdict: DaySequenceVerdict;
  complete: boolean;
  firstSleepEndedRun: false;
  stopReason: StopReason;
  missing: DaySequenceStage[];
  observed: DaySequenceState;
  summary: string;
};

export function reportOneCitizenDay(state: DaySequenceState, stopReason: StopReason): DaySequenceReport {
  const complete = daySequenceComplete(state);
  const missing = missingDaySequenceStages(state);
  let verdict: DaySequenceVerdict;
  if (stopReason === "positioning_needed" || stopReason === "guard_refused") {
    verdict = "BLOCKED";
  } else if (complete) {
    verdict = "PASS";
  } else if (stopReason === "time_limit" || stopReason === "interrupt") {
    verdict = "PARTIAL";
  } else if (stopReason === "sequence_complete") {
    verdict = complete ? "PASS" : "PARTIAL";
  } else {
    verdict = "FAIL";
  }
  const summary =
    verdict === "PASS"
      ? "Observed claim, daytime work, curfew, own-home return, and a later legal sleep."
      : verdict === "PARTIAL"
        ? `PARTIAL: bounded stop (${stopReason}); missing ${missing.join(", ") || "none"}. First claimed-bed sleep did not end the run.`
        : verdict === "BLOCKED"
          ? `BLOCKED: ${stopReason}. No citizen planner start.`
          : "FAIL";
  return {
    verdict,
    complete,
    firstSleepEndedRun: false,
    stopReason,
    missing,
    observed: state,
    summary,
  };
}

export function shouldStopForSleep(state: DaySequenceState): boolean {
  return daySequenceComplete(state) && state.legalSleepAfterDay;
}
