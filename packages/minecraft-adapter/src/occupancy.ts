import type { Vec3 } from "@civ/shared";
import { cellKey } from "./path-recovery.js";

export type OccupiedCell = { username: string; position: Vec3; until: number };

const occupied = new Map<string, OccupiedCell>();
let yieldCount = 0;

export function occupancyYieldCount(): number {
  return yieldCount;
}
export function noteYield(): void {
  yieldCount += 1;
}
export function registerOccupancy(username: string, position: Vec3, ttlMs = 2500, now = Date.now()): void {
  occupied.set(username.toLowerCase(), { username, position, until: now + ttlMs });
}
export function clearOccupancy(username: string): void {
  occupied.delete(username.toLowerCase());
}
export function occupantNear(position: Vec3, exceptUsername?: string, radius = 1.15, now = Date.now()): OccupiedCell | undefined {
  const except = exceptUsername?.toLowerCase();
  for (const entry of occupied.values()) {
    if (entry.until <= now) continue;
    if (except && entry.username.toLowerCase() === except) continue;
    const dx = entry.position.x - position.x;
    const dz = entry.position.z - position.z;
    if (dx * dx + dz * dz <= radius * radius) return entry;
  }
  return undefined;
}
void cellKey;
