import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import type { Vec3 } from "@civ/shared";
import { isVerifiedStanding } from "./interaction.js";
import { headingToward, isSafeDetour } from "./hazard-nav.js";
import { evaluateStepJump, isTwoBlockObstruction, walkForward } from "./step-jump.js";
import { isTreePart, LocalTerrainMemory, terrainMemory } from "./terrain-memory.js";

function isFenceName(name: string | undefined): boolean {
  if (!name) return false;
  return name.includes("fence") || name.endsWith("_wall") || name.includes("gate");
}

export function obstacleCellFrom(origin: Vec3, heading: { dx: number; dz: number }): Vec3 {
  return {
    x: Math.floor(origin.x) + heading.dx,
    y: Math.floor(origin.y),
    z: Math.floor(origin.z) + heading.dz,
  };
}

export function segmentHitsColumn(from: Vec3, to: Vec3, obstacle: Vec3): boolean {
  const ox = Math.floor(obstacle.x);
  const oz = Math.floor(obstacle.z);
  const fx = Math.floor(from.x);
  const fz = Math.floor(from.z);
  const tx = Math.floor(to.x);
  const tz = Math.floor(to.z);
  for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x += 1) {
    for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z += 1) {
      if (x === ox && z === oz) return true;
    }
  }
  return false;
}

export function isObservedTwoBlockObstacle(memory: LocalTerrainMemory, pos: Vec3): boolean {
  const cell = memory.get(pos);
  if (!cell || cell.boundingBox !== "block") return false;
  if (isFenceName(cell.name)) return true;
  const above = memory.get({ x: cell.x, y: cell.y + 1, z: cell.z });
  const below = memory.get({ x: cell.x, y: cell.y - 1, z: cell.z });
  const solidTree = (block: { name: string; boundingBox: string } | undefined) =>
    Boolean(block && isTreePart(block.name) && block.boundingBox === "block");
  return solidTree(cell) && (solidTree(above) || solidTree(below));
}

/** Pathfinder exclusion: 100 means do not step onto a cell whose movement edge already failed. */
export function observedStepExclusion(bot: Bot, block: { position?: Vec3; name?: string } | null | undefined): number {
  const position = block?.position;
  if (!position) return 0;
  const memory = terrainMemory(bot);
  const pos = { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
  if (memory.isDestinationBlocked(pos)) return 100;
  return 0;
}

export function planTwoBlockDetour(
  bot: Bot,
  origin: Vec3,
  heading: { dx: number; dz: number },
  memory?: LocalTerrainMemory,
): Vec3[] {
  const fy = Math.floor(origin.y);
  const fx = Math.floor(origin.x);
  const fz = Math.floor(origin.z);
  const obstacle = obstacleCellFrom(origin, heading);
  const perpendicular =
    heading.dx !== 0
      ? [
          { dx: 0, dz: 1 },
          { dx: 0, dz: -1 },
        ]
      : [
          { dx: 1, dz: 0 },
          { dx: -1, dz: 0 },
        ];
  const sides: Vec3[] = [];
  for (const dir of perpendicular) {
    const cell = { x: fx + dir.dx, y: fy, z: fz + dir.dz };
    if (segmentHitsColumn(origin, cell, obstacle)) continue;
    if (!isSafeDetour(bot, origin, cell)) continue;
    if (memory?.isEdgeBlocked(origin, cell)) continue;
    if (memory?.isDestinationBlocked(cell)) continue;
    sides.push(cell);
  }
  sides.sort((a, b) => {
    const aheadA = { x: a.x + heading.dx, y: a.y, z: a.z + heading.dz };
    const aheadB = { x: b.x + heading.dx, y: b.y, z: b.z + heading.dz };
    const openA = isVerifiedStanding(bot, aheadA, { fromY: fy, maxDrop: 0 }) ? 0 : 1;
    const openB = isVerifiedStanding(bot, aheadB, { fromY: fy, maxDrop: 0 }) ? 0 : 1;
    return openA - openB;
  });
  return sides;
}

export type TwoBlockRecovery =
  | { action: "none" }
  | { action: "detour"; side: Vec3; obstacle: string; obstacleCell: Vec3 }
  | { action: "blocked"; reason: string; obstacle: string; obstacleCell: Vec3 };

export function twoBlockRecovery(bot: Bot, target: Vec3, memory?: LocalTerrainMemory): TwoBlockRecovery {
  const here = bot.entity?.position;
  if (!here) return { action: "none" };
  const jump = evaluateStepJump(bot, target);
  if (jump.ok) return { action: "none" };
  if (jump.reason.includes("door")) return { action: "none" };
  if (!isTwoBlockObstruction(jump)) return { action: "none" };
  const heading = headingToward(here, target);
  const obstacleCell = obstacleCellFrom(here, heading);
  const store = memory ?? terrainMemory(bot);
  store.markEdgeBlocked(here, obstacleCell, jump.reason, jump.obstacle ?? "solid");
  const sides = planTwoBlockDetour(bot, here, heading, store);
  if (sides[0]) {
    return { action: "detour", side: sides[0], obstacle: jump.obstacle ?? "solid", obstacleCell };
  }
  return {
    action: "blocked",
    reason: `two-block ${jump.obstacle ?? "obstacle"} at ${obstacleCell.x},${obstacleCell.y},${obstacleCell.z}; no verified around`,
    obstacle: jump.obstacle ?? "solid",
    obstacleCell,
  };
}

export async function stepToStandingCell(
  bot: Bot,
  dest: Vec3,
  signal?: AbortSignal,
  options: { maxDrop?: number } = {},
): Promise<{ moved: boolean; position: Vec3 | undefined }> {
  const start = bot.entity?.position;
  if (!start) return { moved: false, position: undefined };
  if (signal?.aborted) {
    return { moved: false, position: { x: start.x, y: start.y, z: start.z } };
  }
  const maxDrop = options.maxDrop ?? 0;
  if (!isVerifiedStanding(bot, dest, { fromY: start.y, maxDrop })) {
    return { moved: false, position: { x: start.x, y: start.y, z: start.z } };
  }
  const tx = Math.floor(dest.x) + 0.5;
  const tz = Math.floor(dest.z) + 0.5;
  try {
    await bot.lookAt(new Vec3Class(tx, start.y + 1, tz), true);
  } catch {
    // yaw already set
  }
  const end = await walkForward(bot, 8, signal);
  const pos = end ?? (bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : undefined);
  if (!pos) return { moved: false, position: undefined };
  const closer = Math.hypot(pos.x - tx, pos.z - tz) + 0.15 < Math.hypot(start.x - tx, start.z - tz);
  const changedCell = Math.floor(pos.x) !== Math.floor(start.x) || Math.floor(pos.z) !== Math.floor(start.z);
  return { moved: closer || changedCell, position: pos };
}
