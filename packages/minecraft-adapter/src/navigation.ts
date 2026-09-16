import type { Bot } from "mineflayer";
import { fail, type ActionResult, type Vec3 } from "@civ/shared";
import { followPlayer, moveToPosition } from "./pathing.js";
import { probeReachability } from "./path-probe.js";
import { findReachableInteractionPosition } from "./interaction.js";

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
    const standing = findReachableInteractionPosition(bot, block);
    if (!standing) return fail("NO_INTERACTION_POSITION", "No standing cell for that block", 0, true);
    return moveToPosition(bot, standing, { range: 1.5, timeoutMs: options?.timeoutMs, signal: options?.signal });
  }
  navigateToPlaceBlock(bot: Bot, target: Vec3, options?: { timeoutMs?: number; signal?: AbortSignal }) {
    return moveToPosition(bot, target, { range: 3, ...options });
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
