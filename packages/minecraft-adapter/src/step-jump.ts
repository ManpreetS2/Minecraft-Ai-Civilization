import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import type { Vec3 } from "@civ/shared";
import {
  canOccupyFeet,
  canStandOn,
  hasJumpHeadroom,
  isVerifiedStanding,
  isWalkableStanding,
} from "./interaction.js";
import { installModernMovement, writePlayerInput } from "./movement-sync.js";

const CARDINALS = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;

const STALL_AFTER_PROGRESS_MS = 1_000;
const STALL_NO_PROGRESS_MS = 1_500;
const MAX_STALL_RECOVERIES = 2;

export const STEP_JUMP_LIMITS = {
  stallAfterProgressMs: STALL_AFTER_PROGRESS_MS,
  stallNoProgressMs: STALL_NO_PROGRESS_MS,
  maxRecoveries: MAX_STALL_RECOVERIES,
  maxJumpAttempts: 2,
  jumpTicks: 2,
  forwardHoldTicks: 10,
  backupTicks: 3,
} as const;

export type MovementActivity = "pathing" | "idle" | "sleeping" | "container" | "loading" | "busy";

export type StepJumpDecision =
  | { ok: true; landing: Vec3; obstacle: string; heading: { dx: number; dz: number } }
  | { ok: false; reason: string; obstacle?: string };

function sample(bot: Bot, x: number, y: number, z: number) {
  return bot.blockAt(new Vec3Class(Math.floor(x), Math.floor(y), Math.floor(z)));
}

function isFenceLike(name: string | undefined): boolean {
  if (!name) return false;
  return name.includes("fence") || name.endsWith("_wall") || name.includes("gate");
}

function isDoorLike(name: string | undefined): boolean {
  return Boolean(name && name.endsWith("_door"));
}

function isWaterLike(name: string | undefined): boolean {
  return Boolean(name && (name === "water" || name === "bubble_column" || name.endsWith("_water")));
}

function isHazard(name: string | undefined): boolean {
  return Boolean(
    name &&
      (name === "lava" ||
        name === "flowing_lava" ||
        name === "fire" ||
        name === "soul_fire" ||
        name === "magma_block" ||
        name === "cactus" ||
        name === "campfire" ||
        name === "soul_campfire"),
  );
}

export function movementActivity(bot: Bot): MovementActivity {
  if (bot.isSleeping) return "sleeping";
  if (bot.currentWindow) return "container";
  if ((bot as Bot & { targetDigBlock?: unknown }).targetDigBlock) return "busy";
  const pos = bot.entity?.position;
  if (!pos) return "idle";
  const feet = sample(bot, pos.x, pos.y, pos.z);
  if (!feet) return "loading";
  const pf = bot as unknown as {
    pathfinder?: { goal?: unknown; isMining?: () => boolean; isBuilding?: () => boolean };
  };
  if (pf.pathfinder?.isMining?.() || pf.pathfinder?.isBuilding?.()) return "busy";
  if (!pf.pathfinder?.goal) return "idle";
  return "pathing";
}

export function isMovementStall(input: {
  activity: MovementActivity;
  pathStarted: boolean;
  progressed: boolean;
  msSinceMove: number;
  stallAfterProgressMs?: number;
  stallNoProgressMs?: number;
}): boolean {
  if (input.activity !== "pathing") return false;
  if (!input.pathStarted) return false;
  const after = input.stallAfterProgressMs ?? STALL_AFTER_PROGRESS_MS;
  const none = input.stallNoProgressMs ?? STALL_NO_PROGRESS_MS;
  if (input.progressed) return input.msSinceMove >= after;
  return input.msSinceMove >= none;
}

/** Do not treat a same-Y bump into a one-block rise as arriving at y+1. */
export function arrivalAccepted(
  current: Vec3,
  target: Vec3,
  range = 2,
): boolean {
  const dist = Math.hypot(current.x - target.x, current.y - target.y, current.z - target.z);
  if (Math.abs(current.y - target.y) >= 0.6) return false;
  if (dist <= range) return true;
  return dist <= range + 0.4;
}

export function releaseMovementControls(bot: Bot): void {
  try {
    bot.clearControlStates();
  } catch {
    // older mineflayer
  }
  for (const key of ["jump", "forward", "back", "left", "right", "sprint", "sneak"] as const) {
    try {
      bot.setControlState(key, false);
    } catch {
      // control not supported
    }
  }
  writePlayerInput(bot, {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    shift: false,
    sprint: false,
  });
}

function headingToward(from: Vec3, goal: Vec3): { dx: number; dz: number } {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return { dx: Math.sign(dx) || 1, dz: 0 };
  return { dx: 0, dz: Math.sign(dz) || 1 };
}

export function evaluateStepJump(bot: Bot, goal?: Vec3): StepJumpDecision {
  const origin = bot.entity?.position;
  if (!origin) return { ok: false, reason: "not spawned" };
  const x = Math.floor(origin.x);
  const y = Math.floor(origin.y);
  const z = Math.floor(origin.z);
  const feet = sample(bot, x, y, z);
  if (isWaterLike(feet?.name) || isHazard(feet?.name)) {
    return { ok: false, reason: "water or hazard at feet", obstacle: feet?.name };
  }
  if (!hasJumpHeadroom(bot, { x, y, z })) {
    return { ok: false, reason: "no two-block headroom at takeoff" };
  }

  const preferred = goal ? headingToward(origin, goal) : undefined;
  const order = preferred
    ? [preferred, ...CARDINALS.filter((dir) => dir.dx !== preferred.dx || dir.dz !== preferred.dz)]
    : [...CARDINALS];

  let lastRefuse: StepJumpDecision = { ok: false, reason: "no one-block step in range" };
  for (const heading of order) {
    const decision = evaluateHeading(bot, x, y, z, heading);
    if (decision.ok) return decision;
    if (goal && decision.reason !== "no one-block obstacle in heading") return decision;
    lastRefuse = decision;
  }
  return lastRefuse;
}

/** Two-block trunks, fences and walls are not auto-jump. Doors and hazards use other handlers. */
export function isTwoBlockObstruction(decision: StepJumpDecision): boolean {
  if (decision.ok) return false;
  return /taller than one block/.test(decision.reason);
}

function evaluateHeading(
  bot: Bot,
  x: number,
  y: number,
  z: number,
  heading: { dx: number; dz: number },
): StepJumpDecision {
  const ox = x + heading.dx;
  const oz = z + heading.dz;
  const obstacle = sample(bot, ox, y, oz);
  const aboveObstacle = sample(bot, ox, y + 1, oz);
  const landing = { x: ox, y: y + 1, z: oz };

  if (!obstacle) return { ok: false, reason: "destination chunk unloaded", obstacle: "unloaded" };
  if (isWaterLike(obstacle.name) || isHazard(obstacle.name)) {
    return { ok: false, reason: "water or hazard landing", obstacle: obstacle.name };
  }
  if (isFenceLike(obstacle.name)) {
    return { ok: false, reason: "fence or wall is taller than one block", obstacle: obstacle.name };
  }
  if (isDoorLike(obstacle.name)) {
    const open = (obstacle as { getProperties?: () => { open?: boolean } }).getProperties?.()?.open;
    if (open) return { ok: false, reason: "no one-block obstacle in heading", obstacle: obstacle.name };
    return { ok: false, reason: "closed door is not a jump", obstacle: obstacle.name };
  }
  if (canOccupyFeet(bot, { x: ox, y, z: oz })) {
    return { ok: false, reason: "no one-block obstacle in heading", obstacle: obstacle.name };
  }
  if (aboveObstacle && !canOccupyFeet(bot, { x: ox, y: y + 1, z: oz })) {
    return { ok: false, reason: "obstacle is taller than one block", obstacle: aboveObstacle.name };
  }
  if (!hasJumpHeadroom(bot, landing)) {
    return { ok: false, reason: "no two-block headroom at landing", obstacle: obstacle.name };
  }
  if (!canStandOn(bot, landing) || !isWalkableStanding(bot, landing)) {
    return { ok: false, reason: "unsafe landing (cliff or non-solid)", obstacle: obstacle.name };
  }
  if (!isVerifiedStanding(bot, landing, { fromY: y, maxDrop: 0 })) {
    return { ok: false, reason: "unverified landing cell", obstacle: obstacle.name };
  }
  return { ok: true, landing, obstacle: obstacle.name, heading };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTicks(bot: Bot, n: number): Promise<void> {
  const fn = (bot as Bot & { waitForTicks?: (ticks: number) => Promise<void> }).waitForTicks;
  if (typeof fn === "function") {
    try {
      await fn.call(bot, n);
      return;
    } catch {
      // physics may be paused
    }
  }
  await wait(Math.max(40, n * 50));
}

export async function waitUntilOnGround(bot: Bot, ticks = 10): Promise<boolean> {
  for (let i = 0; i < ticks; i += 1) {
    if (bot.entity?.onGround) return true;
    await waitTicks(bot, 1);
  }
  return Boolean(bot.entity?.onGround);
}

function faceXZ(bot: Bot, x: number, z: number): void {
  const start = bot.entity?.position;
  if (!start || !bot.entity) return;
  bot.entity.yaw = Math.atan2(-(x - start.x), -(z - start.z));
  bot.entity.pitch = 0;
}

function distanceToBlockFace(pos: Vec3, landing: Vec3, heading: { dx: number; dz: number }): number {
  if (heading.dx > 0) return Math.floor(landing.x) - pos.x;
  if (heading.dx < 0) return pos.x - (Math.floor(landing.x) + 1);
  if (heading.dz > 0) return Math.floor(landing.z) - pos.z;
  if (heading.dz < 0) return pos.z - (Math.floor(landing.z) + 1);
  return 1;
}

export function needsJumpRunUp(pos: Vec3, landing: Vec3, heading: { dx: number; dz: number }): boolean {
  return distanceToBlockFace(pos, landing, heading) < 0.55;
}

/** Walking into the step face before jump turns a 1-block hop into an in-place bump. */
export function jumpApproachTicks(faceDist: number): number {
  if (faceDist <= 0.55) return 0;
  if (faceDist <= 0.9) return 1;
  return 2;
}

export function landingVerified(end: Vec3, landing: Vec3): boolean {
  return (
    Math.floor(end.x) === Math.floor(landing.x) &&
    Math.floor(end.z) === Math.floor(landing.z) &&
    end.y >= landing.y - 0.2
  );
}

export async function walkForward(
  bot: Bot,
  ticks = 8,
  signal?: AbortSignal,
): Promise<Vec3 | undefined> {
  installModernMovement(bot);
  const start = bot.entity?.position;
  if (!start) return undefined;
  if (signal?.aborted) {
    releaseMovementControls(bot);
    return { x: start.x, y: start.y, z: start.z };
  }
  bot.setControlState("forward", true);
  await waitTicks(bot, ticks);
  releaseMovementControls(bot);
  const end = bot.entity?.position;
  return end ? { x: end.x, y: end.y, z: end.z } : undefined;
}

export async function tryOpenAdjacentDoor(bot: Bot, signal?: AbortSignal): Promise<DoorResolution> {
  if (signal?.aborted) return { handled: false, toggled: false };
  const door = inspectAdjacentDoor(bot);
  if (!door) return { handled: false, toggled: false };
  if (door.open) return { handled: true, toggled: false, name: door.name, open: true };
  if (!door.wooden) return { handled: false, toggled: false, name: door.name, open: false };
  try {
    const block = sample(bot, door.cell.x, door.cell.y, door.cell.z);
    if (!block) return { handled: false, toggled: false, name: door.name, open: false };
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await bot.activateBlock(block);
    await waitTicks(bot, 4);
    const after = inspectAdjacentDoor(bot);
    return { handled: true, toggled: true, name: door.name, open: Boolean(after?.open) };
  } catch {
    return { handled: false, toggled: false, name: door.name, open: false };
  }
}

export async function attemptStepJump(
  bot: Bot,
  landing: Vec3,
  signal?: AbortSignal,
): Promise<{ hopped: boolean; landed: boolean; position: Vec3 | undefined }> {
  installModernMovement(bot);
  const start = bot.entity?.position;
  if (!start) return { hopped: false, landed: false, position: undefined };
  const done = (hopped: boolean, landed: boolean): { hopped: boolean; landed: boolean; position: Vec3 | undefined } => {
    releaseMovementControls(bot);
    const now = bot.entity?.position;
    return { hopped, landed, position: now ? { x: now.x, y: now.y, z: now.z } : undefined };
  };
  if (signal?.aborted) return done(false, false);
  const tx = Math.floor(landing.x) + 0.5;
  const tz = Math.floor(landing.z) + 0.5;
  const heading = headingToward(start, { x: tx, y: landing.y, z: tz });
  faceXZ(bot, tx, tz);
  try {
    await bot.lookAt(new Vec3Class(tx, start.y + 1, tz), true);
  } catch {
    // yaw already set
  }
  releaseMovementControls(bot);
  await waitUntilOnGround(bot, 8);
  if (signal?.aborted) return done(false, false);

  let here = bot.entity?.position ?? start;
  if (needsJumpRunUp(here, landing, heading)) {
    const backCell = {
      x: Math.floor(here.x) - heading.dx,
      y: Math.floor(here.y),
      z: Math.floor(here.z) - heading.dz,
    };
    if (isVerifiedStanding(bot, backCell, { fromY: here.y, maxDrop: 0 })) {
      bot.setControlState("back", true);
      await waitTicks(bot, STEP_JUMP_LIMITS.backupTicks);
      bot.setControlState("back", false);
      await waitUntilOnGround(bot, 6);
      faceXZ(bot, tx, tz);
      try {
        await bot.lookAt(new Vec3Class(tx, (bot.entity?.position.y ?? here.y) + 1, tz), true);
      } catch {
        // yaw already set
      }
    }
  }
  if (signal?.aborted) return done(false, false);

  here = bot.entity?.position ?? here;
  const approach = jumpApproachTicks(distanceToBlockFace(here, landing, heading));
  bot.setControlState("sprint", false);
  bot.setControlState("forward", true);
  if (approach > 0) {
    await waitTicks(bot, approach);
  }
  if (signal?.aborted) return done(false, false);
  bot.setControlState("jump", true);
  bot.setControlState("forward", true);
  await waitTicks(bot, STEP_JUMP_LIMITS.jumpTicks);
  bot.setControlState("jump", false);
  bot.setControlState("forward", true);
  for (let i = 0; i < STEP_JUMP_LIMITS.forwardHoldTicks; i += 1) {
    if (signal?.aborted) return done(false, false);
    const now = bot.entity?.position;
    if (now && landingVerified({ x: now.x, y: now.y, z: now.z }, landing) && bot.entity?.onGround) break;
    await waitTicks(bot, 1);
  }
  releaseMovementControls(bot);
  const end = bot.entity?.position;
  if (!end) return { hopped: false, landed: false, position: undefined };
  const pos = { x: end.x, y: end.y, z: end.z };
  return {
    hopped: jumpProgressed(start, pos, landing),
    landed: landingVerified(pos, landing),
    position: pos,
  };
}

export function jumpProgressed(start: Vec3, end: Vec3, landing: Vec3): boolean {
  return Math.floor(end.y) > Math.floor(start.y) || landingVerified(end, landing);
}

export function stallRecoveryBudget(used: number): boolean {
  return used < MAX_STALL_RECOVERIES;
}

export type DoorResolution = {
  handled: boolean;
  toggled: boolean;
  name?: string;
  open?: boolean;
};

export function inspectAdjacentDoor(bot: Bot): {
  name: string;
  cell: Vec3;
  open: boolean;
  wooden: boolean;
  block: { name: string; position: { x: number; y: number; z: number }; getProperties?: () => { open?: boolean } };
} | undefined {
  const origin = bot.entity?.position;
  if (!origin) return undefined;
  const x = Math.floor(origin.x);
  const y = Math.floor(origin.y);
  const z = Math.floor(origin.z);
  for (const heading of CARDINALS) {
    const block = sample(bot, x + heading.dx, y, z + heading.dz);
    if (!block || !isDoorLike(block.name)) continue;
    const open = Boolean((block as { getProperties?: () => { open?: boolean } }).getProperties?.()?.open);
    return {
      name: block.name,
      cell: { x: x + heading.dx, y, z: z + heading.dz },
      open,
      wooden: !block.name.startsWith("iron_"),
      block: block as { name: string; position: { x: number; y: number; z: number }; getProperties?: () => { open?: boolean } },
    };
  }
  return undefined;
}
