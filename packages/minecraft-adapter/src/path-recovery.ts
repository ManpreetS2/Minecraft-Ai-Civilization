import type { Vec3 } from "@civ/shared";

export function cellKey(pos: Vec3, precision = 1): string {
  return `${Math.round(pos.x / precision) * precision},${Math.round(pos.y)},${Math.round(pos.z / precision) * precision}`;
}

export type RecoveryAttempt = { x: number; y: number; z: number; range: number };

export function recoveryAttempts(target: Vec3, range = 2, adjacent = 4): RecoveryAttempt[] {
  const attempts: RecoveryAttempt[] = [
    { x: target.x, y: target.y, z: target.z, range },
    { x: target.x, y: target.y, z: target.z, range: Math.max(range + 1, 3) },
  ];
  for (const offset of nearbyOffsets(2).slice(0, adjacent)) {
    attempts.push({
      x: target.x + offset.x,
      y: target.y,
      z: target.z + offset.z,
      range: 1.5,
    });
  }
  return attempts;
}

export function shouldBlacklistTarget(code: string): boolean {
  return code === "PATH_BLOCKED" || code === "PATH_FAILED" || code === "TIMEOUT" || code === "VERIFY_FAILED";
}

export function nearbyOffsets(radius = 2): Vec3[] {
  const spots: Vec3[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      spots.push({ x: dx, y: 0, z: dz });
    }
  }
  return spots.sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));
}

export function movedEnough(from: Vec3, to: Vec3, min = 0.35): boolean {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const dz = from.z - to.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) >= min;
}

export class TargetBlacklist {
  private readonly until = new Map<string, number>();

  mark(pos: Vec3, durationMs = 60_000, now = Date.now()): void {
    this.until.set(cellKey(pos), now + durationMs);
  }

  has(pos: Vec3, now = Date.now()): boolean {
    const expiry = this.until.get(cellKey(pos));
    if (!expiry) return false;
    if (expiry <= now) {
      this.until.delete(cellKey(pos));
      return false;
    }
    return true;
  }

  size(now = Date.now()): number {
    for (const [key, expiry] of this.until) {
      if (expiry <= now) this.until.delete(key);
    }
    return this.until.size;
  }
}

export const DISPOSABLE_SCAFFOLD = [
  "dirt",
  "coarse_dirt",
  "rooted_dirt",
  "cobblestone",
  "cobbled_deepslate",
  "andesite",
  "diorite",
  "granite",
  "tuff",
  "netherrack",
];

export const PROTECTED_BLOCK_NAMES = [
  "chest",
  "trapped_chest",
  "barrel",
  "ender_chest",
  "crafting_table",
  "furnace",
  "blast_furnace",
  "smoker",
  "oak_door",
  "spruce_door",
  "birch_door",
  "torch",
  "wall_torch",
];
