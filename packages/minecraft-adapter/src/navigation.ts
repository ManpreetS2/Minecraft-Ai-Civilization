import type { Bot } from "mineflayer";
import { fail, type ActionResult, type Vec3 } from "@civ/shared";
import { followPlayer, moveToGetToBlock, moveToLookAtBlock, moveToPosition } from "./pathing.js";
import { probeReachability } from "./path-probe.js";
import { findReachablePlacementPosition, rankedInteractionPositions } from "./interaction.js";

export type NavigationBackend = {
  readonly name: string;
  navigateToPosition(bot: Bot, target: Vec3, options?: { range?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  navigateNear(bot: Bot, target: Vec3, range?: number, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  navigateToInteractWithBlock(bot: Bot, block: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  navigateToPlaceBlock(bot: Bot, target: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  followEntity(bot: Bot, username: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ username: string; position: Vec3 }>>;
  escapeFrom(bot: Bot, from: Vec3, distance?: number, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ActionResult<{ position: Vec3; distance: number }>>;
  probeReachability(bot: Bot, target: Vec3): { reachable: boolean; cost: number; reason?: string };
  stop(bot: Bot): void;
};

export class MineflayerPathfinderBackend implements NavigationBackend {
  readonly name: string = "mineflayer-pathfinder";
  navigateToPosition(bot: Bot, target: Vec3, options?: { range?: number; timeoutMs?: number; signal?: AbortSignal }) {
    return moveToPosition(bot, target, options);
  }
  navigateNear(bot: Bot, target: Vec3, range = 3, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    return moveToPosition(bot, target, { ...options, range });
  }
  async navigateToInteractWithBlock(bot: Bot, block: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    const budget = options?.timeoutMs ?? 16_000;
    const started = Date.now();
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
        recover: false,
      });
      if (last.success) return last;
      if (last.code === "CANCELLED" || last.code === "NOT_CONNECTED") return last;
    }
    const remaining = budget - (Date.now() - started);
    if (remaining >= 800) {
      last = await moveToLookAtBlock(bot, block, { timeoutMs: Math.min(8_000, remaining), signal: options?.signal });
      if (last.success) return last;
    }
    const leftover = budget - (Date.now() - started);
    if (leftover >= 800) {
      last = await moveToGetToBlock(bot, block, { timeoutMs: Math.min(6_000, leftover), signal: options?.signal });
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
