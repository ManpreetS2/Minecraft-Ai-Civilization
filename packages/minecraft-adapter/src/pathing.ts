import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import { distance, fail, ok, abortedResult, type ActionResult, type Vec3 } from "@civ/shared";

const require = createRequire(import.meta.url);
const pathfinderModule = require("mineflayer-pathfinder") as {
  pathfinder: (bot: Bot) => void;
  Movements: new (bot: Bot) => { canDig: boolean; scafoldingBlocks: unknown[] };
  goals: {
    GoalNear: new (x: number, y: number, z: number, range: number) => unknown;
    GoalFollow: new (entity: unknown, range: number) => unknown;
  };
};
const { pathfinder, Movements, goals } = pathfinderModule;

type MovementSettings = { canDig: boolean; scafoldingBlocks: unknown[] };

export type PathfinderApi = {
  setMovements: (movements: MovementSettings) => void;
  setGoal: (goal: unknown, dynamic?: boolean) => void;
  stop: () => void;
  goto: (goal: unknown) => Promise<void>;
};

function botPathfinder(bot: Bot): PathfinderApi {
  return (bot as unknown as { pathfinder: PathfinderApi }).pathfinder;
}

export function loadPathfinder(bot: Bot): PathfinderApi {
  bot.loadPlugin(pathfinder);
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.scafoldingBlocks = [];
  const api = botPathfinder(bot);
  api.setMovements(movements);
  return api;
}

export async function moveToPosition(
  bot: Bot,
  target: Vec3,
  options: { range?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  const range = options.range ?? 1.5;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const signal = options.signal;

  if (signal?.aborted) {
    return abortedResult(0);
  }
  if (!bot.entity?.position) {
    return fail("NOT_CONNECTED", "Bot is not spawned", Date.now() - started);
  }

  const pf = loadPathfinder(bot);
  const goal = new goals.GoalNear(Math.floor(target.x), Math.floor(target.y), Math.floor(target.z), Math.max(1, range));

  const abort = () => {
    try {
      pf.stop();
    } catch {
      // ignore
    }
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    await Promise.race([
      pf.goto(goal),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("PATH_TIMEOUT")), timeoutMs);
        signal?.addEventListener(
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
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      abort();
      return abortedResult(duration);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("PATH_TIMEOUT") || message.toLowerCase().includes("timeout")) {
      return fail("TIMEOUT", `moveTo timed out heading to ${target.x} ${target.y} ${target.z}`, duration, true);
    }
    if (message.toLowerCase().includes("no path") || message.toLowerCase().includes("path")) {
      return fail("PATH_BLOCKED", message, duration, true);
    }
    return fail("PATH_FAILED", message, duration, true);
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  const pos = bot.entity?.position;
  if (!pos) {
    return fail("NOT_CONNECTED", "Lost body during moveTo", Date.now() - started, true);
  }
  const current = { x: pos.x, y: pos.y, z: pos.z };
  const dist = distance(current, target);
  if (dist > range + 1.5) {
    return fail(
      "VERIFY_FAILED",
      `moveTo finished ${dist.toFixed(1)} blocks from target ${target.x} ${target.y} ${target.z}`,
      Date.now() - started,
      true,
    );
  }
  return ok({ position: current, distance: dist }, Date.now() - started);
}

export async function followPlayer(
  bot: Bot,
  username: string,
  options: { range?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult<{ username: string; position: Vec3 }>> {
  const started = Date.now();
  const range = options.range ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const player = bot.players[username];
  const entity = player?.entity;
  if (!entity) {
    return fail("PLAYER_NOT_FOUND", `Player ${username} is not loaded nearby`, Date.now() - started, true);
  }
  const pf = loadPathfinder(bot);
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
  const pf = loadPathfinder(bot);
  pf.setGoal(new goals.GoalFollow(entity, range), true);
  return ok({ username }, Date.now() - started);
}

export function vec3Like(x: number, y: number, z: number): Vec3Class {
  return new Vec3Class(x, y, z);
}
