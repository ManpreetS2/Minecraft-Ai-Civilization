import { movementOperationOutcome, waitForMovementTicks } from "./movement-wait.js";
import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { canOccupyFeet, canStandOn, isVerifiedStanding } from "./interaction.js";
import { DISPOSABLE_SCAFFOLD, isProtectedFromPathfinder } from "./path-recovery.js";
import { releaseMovementControls } from "./step-jump.js";
import { installModernMovement } from "./movement-sync.js";

const CARDINALS = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;

export type HazardKind = "lava" | "magma" | "fire" | "water" | "fall";

export type HazardSighting = {
  kind: HazardKind;
  cell: Vec3;
  name: string;
};

function sample(bot: Bot, x: number, y: number, z: number) {
  return bot.blockAt(new Vec3Class(Math.floor(x), Math.floor(y), Math.floor(z)));
}

export function classifyHazardName(name: string | undefined): HazardKind | undefined {
  if (!name) return undefined;
  if (name === "lava" || name === "flowing_lava") return "lava";
  if (name === "magma_block") return "magma";
  if (name === "fire" || name === "soul_fire" || name.includes("campfire")) return "fire";
  if (name === "water" || name === "bubble_column" || name.endsWith("_water")) return "water";
  return undefined;
}

export function headingToward(from: Vec3, goal: Vec3): { dx: number; dz: number } {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return { dx: Math.sign(dx) || 1, dz: 0 };
  return { dx: 0, dz: Math.sign(dz) || 1 };
}

function isAirName(name: string | undefined): boolean {
  return !name || name === "air" || name === "cave_air" || name === "void_air";
}

/** Unloaded, lava/magma/fire at feet or below, or a drop of more than one unverified air cell. */
export function cellIsUnsafeToEnter(bot: Bot, pos: Vec3): boolean {
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);
  const feet = sample(bot, x, y, z);
  const below = sample(bot, x, y - 1, z);
  if (!feet || !below) return true;
  const feetKind = classifyHazardName(feet.name);
  const belowKind = classifyHazardName(below.name);
  if (feetKind === "lava" || feetKind === "magma" || feetKind === "fire") return true;
  if (belowKind === "lava" || belowKind === "magma" || belowKind === "fire") return true;
  if (isAirName(below.name)) {
    const deeper = sample(bot, x, y - 2, z);
    if (!deeper || isAirName(deeper.name) || classifyHazardName(deeper.name)) return true;
  }
  return false;
}

export function isSafeDetour(bot: Bot, from: Vec3, to: Vec3): boolean {
  const fx = Math.floor(from.x);
  const fy = Math.floor(from.y);
  const fz = Math.floor(from.z);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  const tz = Math.floor(to.z);
  if (ty !== fy) return false;
  if (Math.abs(tx - fx) > 2 || Math.abs(tz - fz) > 2) return false;
  if (!isVerifiedStanding(bot, { x: tx, y: ty, z: tz }, { fromY: fy, maxDrop: 0 })) return false;
  if (cellIsUnsafeToEnter(bot, { x: tx, y: ty, z: tz })) return false;
  for (let x = Math.min(fx, tx); x <= Math.max(fx, tx); x += 1) {
    for (let z = Math.min(fz, tz); z <= Math.max(fz, tz); z += 1) {
      if (x === fx && z === fz) continue;
      if (cellIsUnsafeToEnter(bot, { x, y: fy, z })) return false;
    }
  }
  return true;
}

export function pathContainsUnsafeCell(
  bot: Bot,
  path: unknown,
  fromY?: number,
): boolean {
  if (!Array.isArray(path)) return false;
  const originY = fromY ?? bot.entity?.position.y;
  for (const node of path) {
    if (!node || typeof node !== "object") continue;
    const x = Number((node as { x?: number }).x);
    const y = Number((node as { y?: number }).y);
    const z = Number((node as { z?: number }).z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (cellIsUnsafeToEnter(bot, { x, y, z })) return true;
    if (
      originY !== undefined &&
      !isVerifiedStanding(bot, { x, y, z }, { fromY: originY, maxDrop: 1 }) &&
      cellIsUnsafeToEnter(bot, { x, y, z })
    ) {
      return true;
    }
  }
  return false;
}

export function hazardAhead(bot: Bot, goal?: Vec3): HazardSighting | undefined {
  const origin = bot.entity?.position;
  if (!origin) return undefined;
  const heading = goal ? headingToward(origin, goal) : { dx: 1, dz: 0 };
  const x = Math.floor(origin.x);
  const y = Math.floor(origin.y);
  const z = Math.floor(origin.z);
  const side = heading.dx !== 0 ? { dx: 0, dz: 1 } : { dx: 1, dz: 0 };
  const columns: Array<{ x: number; z: number }> = [];
  for (const dist of [1, 2]) {
    for (const offset of [0, 1, -1]) {
      columns.push({
        x: x + heading.dx * dist + side.dx * offset,
        z: z + heading.dz * dist + side.dz * offset,
      });
    }
  }
  for (const column of columns) {
    for (const dy of [0, -1, -2, 1]) {
      const cell = { x: column.x, y: y + dy, z: column.z };
      const block = sample(bot, cell.x, cell.y, cell.z);
      const kind = classifyHazardName(block?.name);
      if (kind && kind !== "water") return { kind, cell, name: block!.name };
    }
    const step = { x: column.x, y, z: column.z };
    if (cellIsUnsafeToEnter(bot, step)) {
      const below = sample(bot, step.x, step.y - 1, step.z);
      const kind = classifyHazardName(below?.name) ?? classifyHazardName(sample(bot, step.x, step.y, step.z)?.name) ?? "fall";
      const named = kind === "water" ? "fall" : kind;
      const cell =
        below && classifyHazardName(below.name)
          ? { x: step.x, y: step.y - 1, z: step.z }
          : step;
      return { kind: named, cell, name: below?.name ?? "air" };
    }
  }
  const landing = { x: x + heading.dx, y: y + 1, z: z + heading.dz };
  const belowLanding = sample(bot, landing.x, landing.y - 1, landing.z);
  const landingKind = classifyHazardName(belowLanding?.name);
  if (landingKind === "lava" || landingKind === "magma" || landingKind === "fire") {
    return { kind: landingKind, cell: { x: landing.x, y: landing.y - 1, z: landing.z }, name: belowLanding!.name };
  }
  if (!canStandOn(bot, landing) && !canOccupyFeet(bot, { x: landing.x, y: landing.y - 1, z: landing.z })) {
    const down = sample(bot, landing.x, landing.y - 2, landing.z);
    if (!down || isAirName(down.name) || classifyHazardName(down.name)) {
      return { kind: classifyHazardName(down?.name) ?? "fall", cell: landing, name: down?.name ?? "air" };
    }
  }
  return undefined;
}

export function retreatCell(from: Vec3, heading: { dx: number; dz: number }): Vec3 {
  return { x: Math.floor(from.x) - heading.dx, y: Math.floor(from.y), z: Math.floor(from.z) - heading.dz };
}

export function retreatCellIfVerified(bot: Bot, from: Vec3, heading: { dx: number; dz: number }): Vec3 | undefined {
  const dest = retreatCell(from, heading);
  if (!isVerifiedStanding(bot, dest, { fromY: from.y, maxDrop: 0 })) return undefined;
  if (cellIsUnsafeToEnter(bot, dest)) return undefined;
  return dest;
}

export function bypassCells(bot: Bot, origin: Vec3, heading: { dx: number; dz: number }): Vec3[] {
  const x = Math.floor(origin.x);
  const y = Math.floor(origin.y);
  const z = Math.floor(origin.z);
  const sideA = heading.dx !== 0 ? { dx: 0, dz: 1 } : { dx: 1, dz: 0 };
  const sideB = { dx: -sideA.dx, dz: -sideA.dz };
  const candidates: Vec3[] = [];
  for (const side of [sideA, sideB]) {
    for (const spot of [
      { x: x + side.dx, y, z: z + side.dz },
      { x: x + side.dx + heading.dx, y, z: z + side.dz + heading.dz },
      { x: x + heading.dx * 2 + side.dx, y, z: z + heading.dz * 2 + side.dz },
    ]) {
      if (spot.x === x && spot.z === z) continue;
      const block = sample(bot, spot.x, spot.y, spot.z);
      if (classifyHazardName(block?.name)) continue;
      if (!isSafeDetour(bot, origin, spot)) continue;
      candidates.push(spot);
    }
  }
  return candidates;
}

/** Bounded fall recovery: at most a 3-block drop onto a verified solid, never lava. */
export const SAFE_FALL_MAX_DROP = 3;
/** Separate from jump recoveries. Village roofs can need more than two local reroutes. */
export const MAX_HAZARD_REROUTES = 4;
/** Adjacent same-level first-steps tried in one recovery event before a truthful block. */
export const MAX_HAZARD_BYPASS_TRIES = 3;
/** Cardinal same-Y search: long enough to walk around a village roof hole, short enough to bound. */
export const SAME_LEVEL_MAX_STEPS = 8;
export const SAME_LEVEL_MAX_CELLS = 32;

export type HazardRecoveryPlan =
  | { action: "bypass"; cell: Vec3; drop: number; hazard: HazardSighting; reason: string; alternatives: Vec3[] }
  | { action: "blocked"; reason: string; hazard: HazardSighting };

function cellEq(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

function cellKey(cell: Vec3): string {
  return `${Math.floor(cell.x)},${Math.floor(cell.y)},${Math.floor(cell.z)}`;
}

function xzRemain(cell: Vec3, target: Vec3): number {
  return Math.hypot(cell.x + 0.5 - target.x, cell.z + 0.5 - target.z);
}

function chebyshev(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(Math.floor(a.x) - Math.floor(b.x)), Math.abs(Math.floor(a.z) - Math.floor(b.z)));
}

function sameLevelOk(bot: Bot, cell: Vec3, fromY: number): boolean {
  if (cellIsUnsafeToEnter(bot, cell)) return false;
  return isVerifiedStanding(bot, cell, { fromY, maxDrop: 0 });
}

/** Heading-axis column between origin and the hazard. Walking this on a roof is the drop edge. */
export function towardHazardColumn(origin: Vec3, cell: Vec3, hazard: HazardSighting): boolean {
  const heading = headingToward(origin, hazard.cell);
  const hx = Math.floor(origin.x);
  const hz = Math.floor(origin.z);
  const cx = Math.floor(cell.x);
  const cz = Math.floor(cell.z);
  if (heading.dx !== 0) return cz === hz && (cx - hx) * heading.dx > 0;
  return cx === hx && (cz - hz) * heading.dz > 0;
}

export type SameLevelWalkNode = { cell: Vec3; parent?: string; steps: number };

/**
 * Cardinal same-Y walkable graph. Does not cut diagonals over holes, dig, or change elevation.
 */
export function sameLevelWalkGraph(
  bot: Bot,
  origin: Vec3,
  options: { avoid?: Vec3[]; maxSteps?: number; maxCells?: number } = {},
): Map<string, SameLevelWalkNode> {
  const maxSteps = options.maxSteps ?? SAME_LEVEL_MAX_STEPS;
  const maxCells = options.maxCells ?? SAME_LEVEL_MAX_CELLS;
  const y = Math.floor(origin.y);
  const start = { x: Math.floor(origin.x), y, z: Math.floor(origin.z) };
  const avoid = new Set((options.avoid ?? []).map(cellKey));
  const seen = new Map<string, SameLevelWalkNode>();
  const queue: SameLevelWalkNode[] = [{ cell: start, steps: 0 }];
  seen.set(cellKey(start), { cell: start, steps: 0 });
  while (queue.length > 0 && seen.size < maxCells) {
    const cur = queue.shift()!;
    if (cur.steps >= maxSteps) continue;
    for (const dir of CARDINALS) {
      const next = { x: cur.cell.x + dir.dx, y, z: cur.cell.z + dir.dz };
      const key = cellKey(next);
      if (seen.has(key) || avoid.has(key)) continue;
      if (!sameLevelOk(bot, next, origin.y)) continue;
      const node = { cell: next, parent: cellKey(cur.cell), steps: cur.steps + 1 };
      seen.set(key, node);
      queue.push(node);
    }
  }
  return seen;
}

function adjacentSameLevel(bot: Bot, origin: Vec3, avoid: Vec3[]): Vec3[] {
  const y = Math.floor(origin.y);
  const cells: Vec3[] = [];
  const blocked = new Set(avoid.map(cellKey));
  for (const dir of CARDINALS) {
    const cell = { x: Math.floor(origin.x) + dir.dx, y, z: Math.floor(origin.z) + dir.dz };
    if (blocked.has(cellKey(cell))) continue;
    if (!sameLevelOk(bot, cell, origin.y)) continue;
    cells.push(cell);
  }
  return cells;
}

function sameLevelContinuesAround(
  bot: Bot,
  start: Vec3,
  origin: Vec3,
  target: Vec3,
  hazard: HazardSighting,
): boolean {
  const graph = sameLevelWalkGraph(bot, start, { avoid: [hazard.cell], maxSteps: SAME_LEVEL_MAX_STEPS });
  const originRemain = xzRemain(
    { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) },
    target,
  );
  const heading = headingToward(origin, hazard.cell);
  for (const node of graph.values()) {
    if (node.steps === 0) continue;
    if (cellEq(node.cell, hazard.cell)) continue;
    if (towardHazardColumn(origin, node.cell, hazard) && chebyshev(node.cell, hazard.cell) <= 1) continue;
    if (xzRemain(node.cell, target) + 0.2 < originRemain) return true;
    if (heading.dx !== 0 && (node.cell.x - Math.floor(hazard.cell.x)) * heading.dx > 0 && Math.abs(node.cell.z - Math.floor(hazard.cell.z)) >= 1) {
      return true;
    }
    if (heading.dz !== 0 && (node.cell.z - Math.floor(hazard.cell.z)) * heading.dz > 0 && Math.abs(node.cell.x - Math.floor(hazard.cell.x)) >= 1) {
      return true;
    }
  }
  return graph.size > 2;
}

function stepsPastHazard(bot: Bot, start: Vec3, origin: Vec3, hazard: HazardSighting): number {
  const originCell = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
  const graph = sameLevelWalkGraph(bot, start, { avoid: [hazard.cell, originCell], maxSteps: SAME_LEVEL_MAX_STEPS });
  const heading = headingToward(origin, hazard.cell);
  let best = SAME_LEVEL_MAX_STEPS + 1;
  for (const node of graph.values()) {
    if (node.steps === 0) continue;
    const pastX = heading.dx !== 0 && (node.cell.x - Math.floor(hazard.cell.x)) * heading.dx > 0 && Math.abs(node.cell.z - Math.floor(hazard.cell.z)) >= 1;
    const pastZ = heading.dz !== 0 && (node.cell.z - Math.floor(hazard.cell.z)) * heading.dz > 0 && Math.abs(node.cell.x - Math.floor(hazard.cell.x)) >= 1;
    if (pastX || pastZ) best = Math.min(best, node.steps);
  }
  return best;
}

function rankSameLevelSteps(bot: Bot, origin: Vec3, target: Vec3, hazard: HazardSighting, steps: Vec3[]): Vec3[] {
  const heading = headingToward(origin, hazard.cell);
  return [...steps].sort((a, b) => {
    const towardA = towardHazardColumn(origin, a, hazard) ? 1 : 0;
    const towardB = towardHazardColumn(origin, b, hazard) ? 1 : 0;
    if (towardA !== towardB) return towardA - towardB;
    const pastA = stepsPastHazard(bot, a, origin, hazard);
    const pastB = stepsPastHazard(bot, b, origin, hazard);
    if (pastA !== pastB) return pastA - pastB;
    const aroundA = sameLevelContinuesAround(bot, a, origin, target, hazard) ? 0 : 1;
    const aroundB = sameLevelContinuesAround(bot, b, origin, target, hazard) ? 0 : 1;
    if (aroundA !== aroundB) return aroundA - aroundB;
    const latA = heading.dx !== 0 ? Math.abs(a.z - Math.floor(origin.z)) : Math.abs(a.x - Math.floor(origin.x));
    const latB = heading.dx !== 0 ? Math.abs(b.z - Math.floor(origin.z)) : Math.abs(b.x - Math.floor(origin.x));
    if (latA !== latB) return latB - latA;
    return xzRemain(a, target) - xzRemain(b, target);
  });
}

function verifiedFallLandings(bot: Bot, origin: Vec3, hazard: HazardSighting): Array<{ cell: Vec3; drop: number }> {
  if (hazard.kind !== "fall") return [];
  const here = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
  const landings: Array<{ cell: Vec3; drop: number }> = [];
  const seen = new Set<string>();
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      for (let drop = 1; drop <= SAFE_FALL_MAX_DROP; drop += 1) {
        const cell = { x: here.x + dx, y: here.y - drop, z: here.z + dz };
        const key = cellKey(cell);
        if (seen.has(key) || cellEq(cell, hazard.cell)) continue;
        if (cellIsUnsafeToEnter(bot, cell)) continue;
        if (!isVerifiedStanding(bot, cell, { fromY: origin.y, maxDrop: SAFE_FALL_MAX_DROP })) continue;
        const below = sample(bot, cell.x, cell.y - 1, cell.z);
        const belowKind = classifyHazardName(below?.name);
        if (belowKind === "lava" || belowKind === "magma" || belowKind === "fire") continue;
        seen.add(key);
        landings.push({ cell, drop });
      }
    }
  }
  landings.sort((a, b) => a.drop - b.drop || chebyshev(a.cell, origin) - chebyshev(b.cell, origin));
  return landings;
}

/**
 * Physically valid local replan around a hazard. Adjacent same-Y first-steps first
 * (walk around a roof hole, never the drop edge), then a verified short drop.
 * Never teleports, never mines, never steps into lava/magma/fire.
 */
export function planHazardRecovery(bot: Bot, origin: Vec3, target: Vec3, hazard: HazardSighting): HazardRecoveryPlan {
  const blockedReason = `${hazard.kind} at ${hazard.cell.x},${hazard.cell.y},${hazard.cell.z}; no verified standing bypass; will not teleport or break structures`;

  const adjacent = adjacentSameLevel(bot, origin, [hazard.cell]);
  const laterals = adjacent.filter((cell) => !towardHazardColumn(origin, cell, hazard));
  const rankedLaterals = rankSameLevelSteps(bot, origin, target, hazard, laterals).slice(0, MAX_HAZARD_BYPASS_TRIES);
  if (rankedLaterals[0]) {
    return {
      action: "bypass",
      cell: rankedLaterals[0],
      drop: 0,
      hazard,
      alternatives: rankedLaterals.slice(1),
      reason: `same-Y first step ${rankedLaterals[0].x},${rankedLaterals[0].y},${rankedLaterals[0].z}`,
    };
  }

  const landings = verifiedFallLandings(bot, origin, hazard);
  if (landings[0]) {
    return {
      action: "bypass",
      cell: landings[0].cell,
      drop: landings[0].drop,
      hazard,
      alternatives: landings.slice(1, MAX_HAZARD_BYPASS_TRIES).map((entry) => entry.cell),
      reason: `verified ${landings[0].drop}-block drop to ${landings[0].cell.x},${landings[0].cell.y},${landings[0].cell.z}`,
    };
  }

  const forwardEdge = adjacent.filter((cell) => towardHazardColumn(origin, cell, hazard) && chebyshev(cell, hazard.cell) > 1);
  const rankedForward = rankSameLevelSteps(bot, origin, target, hazard, forwardEdge);
  const forward = rankedForward[0];
  if (forward) {
    return {
      action: "bypass",
      cell: forward,
      drop: 0,
      hazard,
      alternatives: rankedForward.slice(1, MAX_HAZARD_BYPASS_TRIES),
      reason: `same-Y forward ${forward.x},${forward.y},${forward.z}; not the hazard cell`,
    };
  }

  return { action: "blocked", hazard, reason: blockedReason };
}

export type BridgePlan =
  | { ok: true; placeAt: Vec3; item: string; against: Vec3 }
  | { ok: false; reason: string };

export function evaluateHazardBridge(
  bot: Bot,
  lava: Vec3,
  options: { allowConstruction?: boolean; inventory?: Array<{ name: string; count: number }> } = {},
): BridgePlan {
  if (!options.allowConstruction) {
    return { ok: false, reason: "construction not permitted for this movement" };
  }
  const items = options.inventory ?? bot.inventory?.items?.().map((item) => ({ name: item.name, count: item.count })) ?? [];
  const item = items.find((entry) => entry.count > 0 && DISPOSABLE_SCAFFOLD.includes(entry.name))?.name;
  if (!item) return { ok: false, reason: "no disposable scaffold in inventory" };

  const origin = bot.entity?.position;
  if (!origin) return { ok: false, reason: "not spawned" };
  const lx = Math.floor(lava.x);
  const ly = Math.floor(lava.y);
  const lz = Math.floor(lava.z);
  const lavaBlock = sample(bot, lx, ly, lz);
  if (classifyHazardName(lavaBlock?.name) !== "lava") {
    return { ok: false, reason: "no lava at the named cell" };
  }

  const cover = { x: lx, y: ly + 1, z: lz };
  const coverBlock = sample(bot, cover.x, cover.y, cover.z);
  if (coverBlock && (coverBlock.name === "air" || coverBlock.name === "cave_air")) {
    if (!(Math.floor(origin.x) === cover.x && Math.floor(origin.y) === cover.y && Math.floor(origin.z) === cover.z)) {
      for (const dir of CARDINALS) {
        const against = { x: cover.x + dir.dx, y: cover.y, z: cover.z + dir.dz };
        const support = sample(bot, against.x, against.y, against.z);
        if (!support || support.boundingBox !== "block") continue;
        if (classifyHazardName(support.name) === "lava" || isProtectedFromPathfinder(support.name)) continue;
        const dist = Math.hypot(cover.x + 0.5 - origin.x, cover.y - origin.y, cover.z + 0.5 - origin.z);
        if (dist > 4.5 || dist < 0.6) continue;
        return { ok: true, placeAt: cover, item, against };
      }
    }
  }

  const candidates: Array<{ placeAt: Vec3; against: Vec3 }> = [];
  for (const dir of CARDINALS) {
    const placeAt = { x: lx + dir.dx, y: ly, z: lz + dir.dz };
    const feet = sample(bot, placeAt.x, placeAt.y, placeAt.z);
    const below = sample(bot, placeAt.x, placeAt.y - 1, placeAt.z);
    if (!feet || (feet.name !== "air" && feet.name !== "cave_air")) continue;
    if (classifyHazardName(feet.name) || classifyHazardName(below?.name) === "lava") continue;
    if (isProtectedFromPathfinder(feet.name) || (below && isProtectedFromPathfinder(below.name))) continue;
    if (!below || below.boundingBox !== "block") continue;
    const against = { x: placeAt.x - dir.dx, y: placeAt.y, z: placeAt.z - dir.dz };
    const support = sample(bot, against.x, against.y, against.z);
    if (!support || support.boundingBox !== "block") continue;
    if (Math.floor(origin.x) === placeAt.x && Math.floor(origin.z) === placeAt.z && Math.floor(origin.y) === placeAt.y) {
      continue;
    }
    candidates.push({ placeAt, against });
  }
  const reachable = candidates.find((entry) => {
    const dist = Math.hypot(entry.placeAt.x + 0.5 - origin.x, entry.placeAt.z + 0.5 - origin.z);
    return dist <= 4.5 && dist >= 0.6;
  });
  if (!reachable) return { ok: false, reason: "no safe adjacent cell to place without stepping into lava" };
  return { ok: true, placeAt: reachable.placeAt, item, against: reachable.against };
}

export async function attemptHazardBridge(
  bot: Bot,
  lava: Vec3,
  options: { allowConstruction?: boolean; signal?: AbortSignal } = {},
): Promise<ActionResult<{ placed: Vec3; item: string }>> {
  if (options.signal?.aborted) {
    releaseMovementControls(bot);
    return fail("CANCELLED", "hazard bridge cancelled", 0, true);
  }
  const plan = evaluateHazardBridge(bot, lava, { allowConstruction: options.allowConstruction });
  if (!plan.ok) {
    return fail("HAZARD_BLOCKED", plan.reason, 0, false);
  }
  const origin = bot.entity?.position;
  if (!origin) return fail("NOT_CONNECTED", "Cannot place a bridge without a body", 0);
  if (Math.floor(origin.x) === plan.placeAt.x && Math.floor(origin.y) === plan.placeAt.y && Math.floor(origin.z) === plan.placeAt.z) {
    return fail("HAZARD_BLOCKED", "refusing to place a block in the bot's cell", 0, false);
  }
  const existing = sample(bot, plan.placeAt.x, plan.placeAt.y, plan.placeAt.z);
  if (existing && isProtectedFromPathfinder(existing.name)) {
    return fail("HAZARD_BLOCKED", `refusing to overwrite protected ${existing.name}`, 0);
  }
  if (existing && existing.name !== "air" && existing.name !== "cave_air") {
    if (existing.name === plan.item) return ok({ placed: plan.placeAt, item: existing.name }, 0);
    return fail("PLACE_FAILED", `${existing.name} already occupies the bridge cell`, 0, true);
  }
  const item = bot.inventory?.items?.().find((entry) => entry.name === plan.item);
  if (!item) return fail("ITEM_NOT_FOUND", `no ${plan.item} in inventory`, 0, true);
  try {
    await bot.equip(item, "hand");
  } catch (error) {
    if (options.signal?.aborted) return fail("CANCELLED", "hazard bridge cancelled", 0, true);
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), 0, true);
  }
  if (options.signal?.aborted) {
    releaseMovementControls(bot);
    return fail("CANCELLED", "hazard bridge cancelled", 0, true);
  }
  const against = bot.blockAt(new Vec3Class(plan.against.x, plan.against.y, plan.against.z));
  if (!against || against.boundingBox !== "block") {
    return fail("PLACE_FAILED", "support block missing or not solid", 0, true);
  }
  const face = new Vec3Class(
    plan.placeAt.x - plan.against.x,
    plan.placeAt.y - plan.against.y,
    plan.placeAt.z - plan.against.z,
  );
  try {
    const facing = await movementOperationOutcome(
      bot,
      () => bot.lookAt(against.position.offset(0.5, 0.5, 0.5), true),
      options.signal,
    );
    if (facing !== "complete" || options.signal?.aborted) {
      releaseMovementControls(bot);
      const code = options.signal?.aborted || facing === "cancelled" ? "CANCELLED" : facing === "unavailable" ? "NOT_CONNECTED" : "TIMEOUT";
      return fail(code, "hazard bridge interrupted before placement", 0, code !== "NOT_CONNECTED");
    }
    await bot.placeBlock(against, face);
  } catch (error) {
    const afterAttempt = sample(bot, plan.placeAt.x, plan.placeAt.y, plan.placeAt.z);
    if (
      afterAttempt &&
      afterAttempt.name !== "air" &&
      afterAttempt.name !== "cave_air" &&
      classifyHazardName(afterAttempt.name) !== "lava"
    ) {
      return ok({ placed: plan.placeAt, item: afterAttempt.name }, 0);
    }
    if (options.signal?.aborted) return fail("CANCELLED", "hazard bridge cancelled", 0, true);
    return fail("PLACE_FAILED", error instanceof Error ? error.message : String(error), 0, true);
  }
  const after = sample(bot, plan.placeAt.x, plan.placeAt.y, plan.placeAt.z);
  if (!after || after.name === "air" || after.name === "cave_air" || classifyHazardName(after.name) === "lava") {
    return fail("PLACE_FAILED", "placed bridge block was not verified in the world", 0, true);
  }
  return ok({ placed: plan.placeAt, item: after.name }, 0);
}

export async function retreatFromHazard(
  bot: Bot,
  heading: { dx: number; dz: number },
  signal?: AbortSignal,
): Promise<ActionResult<{ position: Vec3 }>> {
  installModernMovement(bot);
  const start = bot.entity?.position;
  if (!start) return fail("NOT_CONNECTED", "Cannot retreat without a body", 0);
  if (signal?.aborted) {
    releaseMovementControls(bot);
    return fail("CANCELLED", "hazard retreat cancelled", 0, true);
  }
  releaseMovementControls(bot);
  const dest = retreatCellIfVerified(bot, start, heading);
  if (!dest) {
    const here = { x: start.x, y: start.y, z: start.z };
    return fail("HAZARD_BLOCKED", `retreat cell unverified from ${Math.floor(here.x)} ${Math.floor(here.y)} ${Math.floor(here.z)}`, 0, false);
  }
  if (bot.entity) {
    const faceX = start.x + heading.dx;
    const faceZ = start.z + heading.dz;
    bot.entity.yaw = Math.atan2(-(faceX - start.x), -(faceZ - start.z));
    bot.entity.pitch = 0;
  }
  if (signal?.aborted) {
    releaseMovementControls(bot);
    return fail("CANCELLED", "hazard retreat cancelled", 0, true);
  }
  bot.setControlState("back", true);
  const completed = await waitForMovementTicks(bot, 8, signal);
  bot.setControlState("back", false);
  releaseMovementControls(bot);
  if (!completed) return fail(signal?.aborted ? "CANCELLED" : "TIMEOUT", "hazard retreat interrupted", 0, true);
  const end = bot.entity?.position ?? start;
  const here = { x: end.x, y: end.y, z: end.z };
  if (cellIsUnsafeToEnter(bot, here) || !isVerifiedStanding(bot, here, { fromY: start.y, maxDrop: 0 })) {
    return fail(
      "HAZARD_BLOCKED",
      `retreat landed unverified at ${Math.floor(here.x)} ${Math.floor(here.y)} ${Math.floor(here.z)}`,
      0,
      false,
    );
  }
  const feet = sample(bot, here.x, here.y, here.z);
  if (classifyHazardName(feet?.name) === "lava" || classifyHazardName(feet?.name) === "magma") {
    return fail("HAZARD_BLOCKED", `retreat still in ${feet?.name} at ${Math.floor(here.x)} ${Math.floor(here.y)} ${Math.floor(here.z)}`, 0, false);
  }
  return ok({ position: here }, 0);
}
