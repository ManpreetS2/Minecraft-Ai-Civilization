import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import { distance, fail, ok, abortedResult, type ActionResult, type Vec3 } from "@civ/shared";
import {
  DISPOSABLE_SCAFFOLD,
  PROTECTED_BLOCK_NAMES,
  isProtectedFromPathfinder,
  movedEnough,
  recoveryAttempts,
} from "./path-recovery.js";
import { noteYield, occupantNear, occupancyYieldCount, registerOccupancy } from "./occupancy.js";
import {
  chooseStandingDestination,
  inspectLocalTerrain,
  localEscape,
  localEscapeCells,
  type TerrainKind,
} from "./local-escape.js";

const require = createRequire(import.meta.url);
const pathfinderModule = require("mineflayer-pathfinder") as {
  pathfinder: (bot: Bot) => void;
  Movements: new (bot: Bot) => MovementSettings;
  goals: {
    GoalNear: new (x: number, y: number, z: number, range: number) => unknown;
    GoalFollow: new (entity: unknown, range: number) => unknown;
    GoalGetToBlock: new (x: number, y: number, z: number) => unknown;
    GoalLookAtBlock: new (pos: { x: number; y: number; z: number }, world: unknown, options?: { reach?: number }) => unknown;
  };
};
const { pathfinder, Movements, goals } = pathfinderModule;

type MovementSettings = {
  canDig: boolean;
  scafoldingBlocks: number[];
  allowParkour: boolean;
  allow1by1towers: boolean;
  maxDropDown: number;
  infiniteLiquidDropdownDistance: boolean;
  dontMineUnderFallingBlock: boolean;
  blocksCantBreak: Set<number>;
  blocksToAvoid?: Set<number>;
  canOpenDoors?: boolean;
  entityCost?: number;
  liquidCost?: number;
  digCost?: number;
  placeCost?: number;
  allowSprinting?: boolean;
};

/** Normal walking never mines. Explicit mining skills dig the chosen block themselves. */
export const NORMAL_NAVIGATION_CAN_DIG = false;

export type MovementProfile = "SAFE_NAVIGATION" | "RESOURCE_APPROACH" | "CONTROLLED_EXCAVATION";

export function movementAllowsDig(profile: MovementProfile): boolean {
  return profile === "CONTROLLED_EXCAVATION";
}

export type PathfinderApi = {
  setMovements: (movements: MovementSettings) => void;
  setGoal: (goal: unknown, dynamic?: boolean) => void;
  stop: () => void;
  goto: (goal: unknown) => Promise<void>;
  getPathTo?: (movements: MovementSettings, goal: unknown, timeout?: number) => { status?: string; cost?: number };
};

const configured = new WeakMap<Bot, { api: PathfinderApi; key: string }>();
let activePaths = 0;
let lastPathMs = 0;
let pathAttempts = 0;
let pathSuccess = 0;
let pathTimeout = 0;
let pathStuck = 0;

export function activePathCount(): number {
  return activePaths;
}

export function lastPathDurationMs(): number {
  return lastPathMs;
}

export function pathMetrics(): {
  attempts: number;
  success: number;
  timeout: number;
  stuck: number;
  yields: number;
  active: number;
} {
  return {
    attempts: pathAttempts,
    success: pathSuccess,
    timeout: pathTimeout,
    stuck: pathStuck,
    yields: occupancyYieldCount(),
    active: activePaths,
  };
}

function botPathfinder(bot: Bot): PathfinderApi {
  return (bot as unknown as { pathfinder: PathfinderApi }).pathfinder;
}

function scaffoldingIds(bot: Bot): number[] {
  const held = new Set((bot.inventory?.items() ?? []).map((item) => item.name));
  const ids: number[] = [];
  for (const name of DISPOSABLE_SCAFFOLD) {
    if (!held.has(name)) continue;
    const id = bot.registry.itemsByName[name]?.id;
    if (typeof id === "number") ids.push(id);
  }
  return ids;
}

export function invalidateMovementCache(bot: Bot): void {
  configured.delete(bot);
}

export function configureMovements(bot: Bot, profile: MovementProfile = "SAFE_NAVIGATION"): PathfinderApi {
  bot.loadPlugin(pathfinder);
  const scaffold = scaffoldingIds(bot);
  const key = `${profile}:${scaffold.join(",")}`;
  const existing = configured.get(bot);
  if (existing && existing.key === key) {
    return existing.api;
  }
  const movements = new Movements(bot);
  movements.canDig = movementAllowsDig(profile);
  movements.allowParkour = true;
  movements.allowSprinting = true;
  movements.allow1by1towers = false;
  movements.maxDropDown = 3;
  movements.infiniteLiquidDropdownDistance = false;
  movements.dontMineUnderFallingBlock = true;
  movements.scafoldingBlocks = profile === "CONTROLLED_EXCAVATION" ? scaffold : [];
  movements.entityCost = 8;
  movements.liquidCost = 8;
  movements.digCost = 10;
  movements.placeCost = 8;
  if (typeof movements.canOpenDoors === "boolean") movements.canOpenDoors = true;
  const hazards = ["lava", "fire", "soul_fire", "magma_block", "cactus", "campfire", "soul_campfire"];
  for (const name of hazards) {
    const id = bot.registry.blocksByName[name]?.id;
    if (typeof id === "number") movements.blocksToAvoid?.add(id);
  }
  protectFromPathfinder(bot, movements);
  const api = botPathfinder(bot);
  api.setMovements(movements);
  configured.set(bot, { api, key });
  return api;
}

function protectFromPathfinder(bot: Bot, movements: MovementSettings): void {
  const names = new Set(PROTECTED_BLOCK_NAMES);
  const byName = bot.registry.blocksByName as Record<string, { id: number; name: string }>;
  for (const block of Object.values(byName)) {
    if (!block?.name) continue;
    if (isProtectedFromPathfinder(block.name) || names.has(block.name)) {
      movements.blocksCantBreak.add(block.id);
    }
  }
}

export function loadPathfinder(bot: Bot): PathfinderApi {
  return configureMovements(bot);
}

type MoveOptions = {
  range?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  recover?: boolean;
};

export async function moveToPosition(
  bot: Bot,
  target: Vec3,
  options: MoveOptions = {},
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  const budget = options.timeoutMs ?? 22_000;
  const recover = options.recover !== false;
  const waitStart = Date.now();
  while (activePaths >= 3 && Date.now() - waitStart < 4_000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (recover) {
    const report = inspectLocalTerrain(bot);
    if (report && report.kind !== "open" && report.kind !== "deep_pit") {
      const remaining = budget - (Date.now() - started);
      if (remaining > 900) {
        const escaped = await tryLocalReposition(bot, Math.min(6_000, remaining), options.signal);
        if (escaped.success === false && (escaped.code === "CANCELLED" || escaped.code === "NOT_CONNECTED")) {
          return escaped;
        }
      }
    }
  }

  const standing = chooseStandingDestination(bot, target) ?? target;
  const attempts = recover
    ? recoveryAttempts(standing, options.range ?? 2, 3)
    : [{ x: standing.x, y: standing.y, z: standing.z, range: options.range ?? 2 }];

  let last: ActionResult<{ position: Vec3; distance: number }> | undefined;
  let triedEscape = false;
  for (const attempt of attempts) {
    const remaining = budget - (Date.now() - started);
    if (remaining < 800) break;
    last = await attemptGoto(bot, attempt, {
      timeoutMs: Math.min(10_000, remaining),
      signal: options.signal,
    });
    lastPathMs = last.durationMs;
    if (last.success) return last;
    if (last.code === "CANCELLED" || last.code === "NOT_CONNECTED") return last;
    if (!last.retryable) return last;
    if (!triedEscape && recover && (last.code === "NAV_NO_INITIAL_PROGRESS" || last.code === "PATH_FAILED")) {
      triedEscape = true;
      const leftover = budget - (Date.now() - started);
      if (leftover > 900) {
        await tryLocalReposition(bot, Math.min(5_000, leftover), options.signal);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const failed =
    last ?? fail("PATH_FAILED", `goal unreachable near ${fmt(target)}`, Date.now() - started, true);
  lastPathMs = failed.durationMs;
  return failed;
}

async function tryLocalReposition(
  bot: Bot,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ActionResult<{ position: Vec3; distance: number; kind?: TerrainKind }>> {
  const report = inspectLocalTerrain(bot);
  if (!report) return fail("NOT_CONNECTED", "Cannot reposition without a body", 0);
  if (report.kind === "open") {
    return ok({ position: report.position, distance: 0, kind: report.kind }, 0);
  }
  if (report.kind === "deep_pit") {
    return fail("PATH_BLOCKED", `no walkable rim out of pit without mining (${report.reason})`, 0, true);
  }
  const jumped = await localEscape(bot, { timeoutMs: Math.min(timeoutMs, 5_000), signal });
  if (jumped.success || jumped.code === "CANCELLED" || jumped.code === "NOT_CONNECTED") return jumped;
  const rim = localEscapeCells(bot)[0];
  if (!rim) return jumped;
  const remaining = timeoutMs - jumped.durationMs;
  if (remaining < 800) return jumped;
  const moved = await attemptGoto(bot, { x: rim.x, y: rim.y, z: rim.z, range: 1 }, { timeoutMs: Math.min(3_500, remaining), signal });
  if (moved.success) return ok({ ...moved.data, kind: report.kind }, moved.durationMs);
  return jumped;
}

async function attemptGoto(
  bot: Bot,
  target: { x: number; y: number; z: number; range: number },
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  if (options.signal?.aborted) return abortedResult(0);
  if (!bot.entity?.position) {
    return fail("NOT_CONNECTED", "Bot is not spawned", 0);
  }
  const occupied = occupantNear({ x: target.x, y: target.y, z: target.z }, bot.username, 1.2);
  if (occupied) {
    noteYield();
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  const goal = new goals.GoalNear(
    Math.floor(target.x),
    Math.floor(target.y),
    Math.floor(target.z),
    Math.max(1, Math.floor(target.range)),
  );
  return runGoto(bot, goal, target, options);
}

export async function moveToLookAtBlock(
  bot: Bot,
  block: Vec3,
  options: { timeoutMs?: number; signal?: AbortSignal; reach?: number } = {},
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  if (!bot.entity?.position) {
    return fail("NOT_CONNECTED", "Bot is not spawned", Date.now() - started);
  }
  const goal = new goals.GoalLookAtBlock(
    new Vec3Class(Math.floor(block.x), Math.floor(block.y), Math.floor(block.z)),
    bot.world,
    { reach: options.reach ?? 4.5 },
  );
  return runGoto(bot, goal, { ...block, range: options.reach ?? 4.5 }, { timeoutMs: options.timeoutMs ?? 12_000, signal: options.signal });
}

export async function moveToGetToBlock(
  bot: Bot,
  block: Vec3,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const goal = new goals.GoalGetToBlock(Math.floor(block.x), Math.floor(block.y), Math.floor(block.z));
  return runGoto(bot, goal, { ...block, range: 2 }, { timeoutMs: options.timeoutMs ?? 12_000, signal: options.signal });
}

async function runGoto(
  bot: Bot,
  goal: unknown,
  target: { x: number; y: number; z: number; range?: number },
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  pathAttempts += 1;
  if (options.signal?.aborted) return abortedResult(0);
  if (!bot.entity?.position) {
    return fail("NOT_CONNECTED", "Bot is not spawned", Date.now() - started);
  }
  const pf = configureMovements(bot);
  let pathStatus = "running";
  const originPos = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
  const stall = startStallWatch(bot, options.timeoutMs, options.signal);
  const onUpdate = (result: { status?: string; path?: unknown[] }) => {
    if (result.status) pathStatus = result.status;
    if (result.path && result.path.length > 0) stall.markPathStarted();
  };
  const pathBot = bot as Bot & {
    on(event: "path_update", listener: (result: { status?: string }) => void): Bot;
    removeListener(event: "path_update", listener: (result: { status?: string }) => void): Bot;
  };
  pathBot.on("path_update", onUpdate);

  const abort = () => {
    try {
      pf.stop();
    } catch {
      // ignore
    }
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  activePaths += 1;
  const gotoPromise = pf.goto(goal);

  try {
    await Promise.race([gotoPromise, stall.promise]);
  } catch (error) {
    abort();
    await gotoPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const duration = Date.now() - started;
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      return abortedResult(duration);
    }
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const end = bot.entity?.position;
    const traveled = end ? Math.hypot(end.x - originPos.x, end.y - originPos.y, end.z - originPos.z) : 0;
    if (traveled < 0.25 && message === "STUCK") {
      return fail(
        "NAV_NO_INITIAL_PROGRESS",
        `no initial progress heading to ${fmt(target)}`,
        duration,
        true,
      );
    }
    if (message === "NAV_NO_INITIAL_PROGRESS") {
      return fail(
        "NAV_NO_INITIAL_PROGRESS",
        `no initial progress heading to ${fmt(target)}`,
        duration,
        true,
      );
    }
    if (pathStatus === "noPath" || lower.includes("no path")) {
      return fail(
        "PATH_BLOCKED",
        `no walkable path to ${fmt(target)} without mining terrain`,
        duration,
        true,
      );
    }
    if (message === "STUCK") {
      pathStuck += 1;
      return fail("PATH_FAILED", `stuck heading to ${fmt(target)}`, duration, true);
    }
    if (lower.includes("timeout") || pathStatus === "timeout") {
      pathTimeout += 1;
      return fail("TIMEOUT", `moveTo timed out heading to ${fmt(target)}`, duration, true);
    }
    if (lower.includes("place") || lower.includes("scaffold")) {
      return fail("PLACE_FAILED", `placement failure heading to ${fmt(target)}: ${message}`, duration, true);
    }
    if (lower.includes("dig") || lower.includes("break")) {
      return fail("DIG_FAILED", `dig failure heading to ${fmt(target)}: ${message}`, duration, true);
    }
    if (lower.includes("stopped before")) {
      return fail("PATH_FAILED", `path interrupted heading to ${fmt(target)}`, duration, true);
    }
    return fail("PATH_FAILED", message, duration, true);
  } finally {
    stall.cancel();
    activePaths = Math.max(0, activePaths - 1);
    pathBot.removeListener("path_update", onUpdate);
    options.signal?.removeEventListener("abort", abort);
  }

  const pos = bot.entity?.position;
  if (!pos) {
    return fail("NOT_CONNECTED", "Lost body during moveTo", Date.now() - started, true);
  }
  const current = { x: pos.x, y: pos.y, z: pos.z };
  const dist = distance(current, { x: target.x, y: target.y, z: target.z });
  const allowed = (target.range ?? 4.5) + 2;
  if (dist > allowed) {
    return fail("VERIFY_FAILED", `goal unreachable; finished ${dist.toFixed(1)} from ${fmt(target)}`, Date.now() - started, true);
  }
  registerOccupancy(bot.username, current);
  pathSuccess += 1;
  return ok({ position: current, distance: dist }, Date.now() - started);
}

function startStallWatch(
  bot: Bot,
  timeoutMs: number,
  signal?: AbortSignal,
): { promise: Promise<never>; cancel: () => void; markPathStarted: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stall: ReturnType<typeof setInterval> | undefined;
  let pathStarted = false;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    if (stall) clearInterval(stall);
  };
  const promise = new Promise<never>((_, reject) => {
    let last = bot.entity?.position
      ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
      : undefined;
    let lastMove = Date.now();
    let progressed = false;
    timer = setTimeout(() => {
      cancel();
      reject(new Error("PATH_TIMEOUT"));
    }, timeoutMs);
    stall = setInterval(() => {
      const pos = bot.entity?.position;
      if (!pos || !last) return;
      const now = { x: pos.x, y: pos.y, z: pos.z };
      if (movedEnough(last, now, 0.4)) {
        last = now;
        lastMove = Date.now();
        progressed = true;
      } else if (progressed && Date.now() - lastMove > 4_000) {
        cancel();
        reject(new Error("STUCK"));
      } else if (!progressed && pathStarted && Date.now() - lastMove > 4_000) {
        cancel();
        reject(new Error("NAV_NO_INITIAL_PROGRESS"));
      }
    }, 400);
    signal?.addEventListener(
      "abort",
      () => {
        cancel();
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
  return { promise, cancel, markPathStarted: () => { pathStarted = true; } };
}

function fmt(target: { x: number; y: number; z: number }): string {
  return `${target.x.toFixed(0)} ${target.y.toFixed(0)} ${target.z.toFixed(0)}`;
}

export async function followPlayer(
  bot: Bot,
  username: string,
  options: { range?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult<{ username: string; position: Vec3 }>> {
  const started = Date.now();
  const range = options.range ?? 3;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const entity = bot.players[username]?.entity;
  if (!entity) {
    return fail("PLAYER_NOT_FOUND", `Player ${username} is not loaded nearby`, Date.now() - started, true);
  }
  const pf = configureMovements(bot);
  const goal = new goals.GoalFollow(entity, range);
  const abort = () => {
    try {
      pf.stop();
    } catch {
      // ignore
    }
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await Promise.race([
      pf.goto(goal),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("FOLLOW_TIMEOUT")), timeoutMs);
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      }),
    ]);
  } catch (error) {
    const duration = Date.now() - started;
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      abort();
      return abortedResult(duration);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("FOLLOW_TIMEOUT")) {
      return fail("TIMEOUT", `follow ${username} timed out`, duration, true);
    }
    if (message.toLowerCase().includes("no path")) {
      return fail("PATH_BLOCKED", message, duration, true);
    }
    return fail("PATH_FAILED", message, duration, true);
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  const pos = bot.entity?.position;
  if (!pos) {
    return fail("NOT_CONNECTED", "Lost body while following", Date.now() - started, true);
  }
  return ok({ username, position: { x: pos.x, y: pos.y, z: pos.z } }, Date.now() - started);
}

export function startFollowing(bot: Bot, username: string, range = 3): ActionResult<{ username: string }> {
  const started = Date.now();
  const entity = bot.players[username]?.entity;
  if (!entity) {
    return fail("PLAYER_NOT_FOUND", `Player ${username} is not loaded nearby`, Date.now() - started, true);
  }
  const pf = configureMovements(bot);
  pf.setGoal(new goals.GoalFollow(entity, range), true);
  return ok({ username }, Date.now() - started);
}

export function vec3Like(x: number, y: number, z: number): Vec3Class {
  return new Vec3Class(x, y, z);
}
