import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import { distance, fail, ok, abortedResult, type ActionResult, type Vec3 } from "@civ/shared";
import {
  DISPOSABLE_SCAFFOLD,
  PROTECTED_BLOCK_NAMES,
  movedEnough,
  recoveryAttempts,
} from "./path-recovery.js";

const require = createRequire(import.meta.url);
const pathfinderModule = require("mineflayer-pathfinder") as {
  pathfinder: (bot: Bot) => void;
  Movements: new (bot: Bot) => MovementSettings;
  goals: {
    GoalNear: new (x: number, y: number, z: number, range: number) => unknown;
    GoalFollow: new (entity: unknown, range: number) => unknown;
    GoalGetToBlock: new (x: number, y: number, z: number) => unknown;
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
};

export type PathfinderApi = {
  setMovements: (movements: MovementSettings) => void;
  setGoal: (goal: unknown, dynamic?: boolean) => void;
  stop: () => void;
  goto: (goal: unknown) => Promise<void>;
};

const configured = new WeakMap<Bot, { api: PathfinderApi; scaffoldKey: string }>();
let activePaths = 0;
let lastPathMs = 0;

export function activePathCount(): number {
  return activePaths;
}

export function lastPathDurationMs(): number {
  return lastPathMs;
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

export function configureMovements(bot: Bot): PathfinderApi {
  bot.loadPlugin(pathfinder);
  const scaffold = scaffoldingIds(bot);
  const key = scaffold.join(",");
  const existing = configured.get(bot);
  if (existing && existing.scaffoldKey === key) {
    return existing.api;
  }
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allowParkour = true;
  movements.allow1by1towers = scaffold.length > 0;
  movements.maxDropDown = 3;
  movements.infiniteLiquidDropdownDistance = false;
  movements.dontMineUnderFallingBlock = true;
  movements.scafoldingBlocks = scaffold;
  for (const name of PROTECTED_BLOCK_NAMES) {
    const id = bot.registry.blocksByName[name]?.id;
    if (typeof id === "number") movements.blocksCantBreak.add(id);
  }
  const api = botPathfinder(bot);
  api.setMovements(movements);
  configured.set(bot, { api, scaffoldKey: key });
  return api;
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
  const attempts = recover
    ? recoveryAttempts(target, options.range ?? 2, 3)
    : [{ x: target.x, y: target.y, z: target.z, range: options.range ?? 2 }];

  let last: ActionResult<{ position: Vec3; distance: number }> | undefined;
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const failed =
    last ?? fail("PATH_FAILED", `goal unreachable near ${fmt(target)}`, Date.now() - started, true);
  lastPathMs = failed.durationMs;
  return failed;
}

async function attemptGoto(
  bot: Bot,
  target: { x: number; y: number; z: number; range: number },
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  if (options.signal?.aborted) return abortedResult(0);
  if (!bot.entity?.position) {
    return fail("NOT_CONNECTED", "Bot is not spawned", Date.now() - started);
  }

  const pf = configureMovements(bot);
  const noScaffold = scaffoldingIds(bot).length === 0;
  const goal = new goals.GoalNear(
    Math.floor(target.x),
    Math.floor(target.y),
    Math.floor(target.z),
    Math.max(1, Math.floor(target.range)),
  );

  let pathStatus = noScaffold ? "noScaffold" : "running";
  const onUpdate = (result: { status?: string }) => {
    if (result.status) pathStatus = result.status;
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
  const stall = startStallWatch(bot, options.timeoutMs, options.signal);
  const gotoPromise = pf.goto(goal);

  try {
    await Promise.race([gotoPromise, stall.promise]);
  } catch (error) {
    abort();
    await gotoPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const duration = Date.now() - started;
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      return abortedResult(duration);
    }
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (pathStatus === "noPath" || lower.includes("no path")) {
      const extra = noScaffold ? " (no scaffolding blocks in inventory)" : "";
      return fail("PATH_BLOCKED", `no path to ${fmt(target)}${extra}`, duration, true);
    }
    if (message === "STUCK") {
      return fail("PATH_FAILED", `stuck heading to ${fmt(target)}`, duration, true);
    }
    if (lower.includes("timeout") || pathStatus === "timeout") {
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
  if (dist > target.range + 2) {
    return fail("VERIFY_FAILED", `goal unreachable; finished ${dist.toFixed(1)} from ${fmt(target)}`, Date.now() - started, true);
  }
  return ok({ position: current, distance: dist }, Date.now() - started);
}

function startStallWatch(
  bot: Bot,
  timeoutMs: number,
  signal?: AbortSignal,
): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stall: ReturnType<typeof setInterval> | undefined;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    if (stall) clearInterval(stall);
  };
  const promise = new Promise<never>((_, reject) => {
    let last = bot.entity?.position
      ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
      : undefined;
    let lastMove = Date.now();
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
      } else if (Date.now() - lastMove > 7_000) {
        cancel();
        reject(new Error("STUCK"));
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
  return { promise, cancel };
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
