import type { Bot } from "mineflayer";
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { followPlayer, moveToGetToBlock, moveToLookAtBlock, moveToPosition } from "./pathing.js";
import { probeReachability } from "./path-probe.js";
import { blockInteractDistance, findReachablePlacementPosition, isWithinBlockReach, rankedInteractionPositions } from "./interaction.js";

export type NavigationBackend = {
  readonly name: string;
  navigateToPosition(bot: Bot, target: Vec3, options?: { range?: number; timeoutMs?: number; signal?: AbortSignal; recover?: boolean }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  navigateNear(bot: Bot, target: Vec3, range?: number, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  navigateToInteractWithBlock(bot: Bot, block: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  navigateToPlaceBlock(bot: Bot, target: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  followEntity(bot: Bot, username: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ username: string; position: Vec3 }>>;
  escapeFrom(bot: Bot, from: Vec3, distance?: number, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  probeReachability(bot: Bot, target: Vec3): { reachable: boolean; cost: number; reason?: string };
  stop(bot: Bot): void;
};

function currentReachResult(bot: Bot, block: Vec3) {
  if (!isWithinBlockReach(bot, block)) return undefined;
  const pos = bot.entity!.position;
  return ok({ position: { x: pos.x, y: pos.y, z: pos.z }, distance: blockInteractDistance(bot, block) ?? 0 });
}

function closeInteractResult(bot: Bot, block: Vec3) {
  const already = currentReachResult(bot, block);
  const pos = bot.entity?.position;
  if (!already || !pos) return already;
  const xz = Math.hypot(pos.x - (block.x + 0.5), pos.z - (block.z + 0.5));
  if (xz <= 3.0) return already;
  return undefined;
}

export class MineflayerPathfinderBackend implements NavigationBackend {
  readonly name: string = "mineflayer-pathfinder";
  navigateToPosition(bot: Bot, target: Vec3, options?: { range?: number; timeoutMs?: number; signal?: AbortSignal; recover?: boolean }) {
    return moveToPosition(bot, target, options);
  }
  navigateNear(bot: Bot, target: Vec3, range = 3, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    return moveToPosition(bot, target, { ...options, range });
  }
  async navigateToInteractWithBlock(bot: Bot, block: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    const budget = options?.timeoutMs ?? 16_000;
    const started = Date.now();
    const already = closeInteractResult(bot, block);
    if (already) return already;
    const here = bot.entity?.position;
    if (here && Math.hypot(here.x - block.x, here.z - block.z) > 6) {
      const remaining = budget - (Date.now() - started);
      if (remaining > 2_000) {
        const approach = await moveToPosition(bot, { x: block.x, y: block.y, z: block.z }, {
          range: 3,
          timeoutMs: Math.max(1_000, remaining - 16_000),
          signal: options?.signal,
          recover: true,
        });
        const reached = closeInteractResult(bot, block);
        if (reached) return reached;
        if (approach.code === "CANCELLED" || approach.code === "NOT_CONNECTED") return approach;
      }
    }
    const cells = rankedInteractionPositions(bot, block, 2).slice(0, 6);
    let last = fail("NO_INTERACTION_POSITION", "No standing cell for that block", 0, true) as ActionResult<{
      position: Vec3;
      distance: number;
    }>;
    for (const standing of cells) {
      const remaining = budget - (Date.now() - started);
      if (remaining < 600) break;
      last = await moveToPosition(bot, standing, {
        range: 1.5,
        timeoutMs: Math.min(6_000, remaining),
        signal: options?.signal,
        recover: true,
      });
      if (last.success) return last;
      const reached = closeInteractResult(bot, block);
      if (reached) return reached;
      if (last.code === "CANCELLED" || last.code === "NOT_CONNECTED") return last;
    }
    const remaining = budget - (Date.now() - started);
    if (remaining >= 800) {
      last = await moveToLookAtBlock(bot, block, { timeoutMs: Math.min(8_000, remaining), signal: options?.signal });
      if (last.success) {
        const reached = closeInteractResult(bot, block);
        if (reached) return reached;
      }
    }
    const leftover = budget - (Date.now() - started);
    if (leftover >= 800) {
      last = await moveToGetToBlock(bot, block, { timeoutMs: Math.min(6_000, leftover), signal: options?.signal });
    }
    const close = closeInteractResult(bot, block);
    if (close) return close;
    const pos = bot.entity?.position;
    const xz = pos ? Math.hypot(pos.x - (block.x + 0.5), pos.z - (block.z + 0.5)) : 99;
    if (xz > 3.0) {
      return fail(
        "VERIFY_FAILED",
        `eye-reach is not enough; finished ${xz.toFixed(1)} from ${block.x.toFixed(0)} ${block.y.toFixed(0)} ${block.z.toFixed(0)}`,
        Date.now() - started,
        true,
      );
    }
    return last;
  }
  navigateToPlaceBlock(bot: Bot, target: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    const standing = findReachablePlacementPosition(bot, target) ?? target;
    return moveToPosition(bot, standing, { range: 2, ...options });
  }
  followEntity(bot: Bot, username: string, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    return followPlayer(bot, username, options);
  }
  escapeFrom(bot: Bot, from: Vec3, distanceBlocks = 16, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    const pos = bot.entity?.position;
    if (!pos) return Promise.resolve(fail("NOT_CONNECTED", "Cannot flee without a body", 0));
    const dx = pos.x - from.x;
    const dz = pos.z - from.z;
    const mag = Math.hypot(dx, dz) || 1;
    return moveToPosition(
      bot,
      { x: pos.x + (dx / mag) * distanceBlocks, y: pos.y, z: pos.z + (dz / mag) * distanceBlocks },
      { range: 2, ...options },
    );
  }
  probeReachability(bot: Bot, target: Vec3) {
    return probeReachability(bot, target);
  }
  stop(bot: Bot): void {
    try {
      (bot as unknown as { pathfinder?: { stop?: () => void } }).pathfinder?.stop?.();
    } catch {
      // ignore
    }
  }
}

export class MineflayerBaritoneBackend extends MineflayerPathfinderBackend {
  override readonly name = "mineflayer-baritone";
}

let active: NavigationBackend = new MineflayerPathfinderBackend();
export function navigationBackend(): NavigationBackend {
  return active;
}
export function setNavigationBackend(backend: NavigationBackend): void {
  active = backend;
}
export function createNavigationBackend(kind: string | undefined): NavigationBackend {
  return kind === "baritone" ? new MineflayerBaritoneBackend() : new MineflayerPathfinderBackend();
}
