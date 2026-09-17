import type { Vec3 } from "@civ/shared";

export const PROTECTED_WORLD_BLOCKS = new Set([
  "chest",
  "trapped_chest",
  "barrel",
  "ender_chest",
  "crafting_table",
  "furnace",
  "blast_furnace",
  "smoker",
  "cartography_table",
  "fletching_table",
  "smithing_table",
  "loom",
  "composter",
  "bell",
  "farmland",
  "wheat",
  "carrots",
  "potatoes",
  "beetroots",
  "hay_block",
  "water",
  "lava",
  "oak_door",
  "spruce_door",
  "birch_door",
  "acacia_door",
  "white_bed",
  "red_bed",
  "yellow_bed",
  "blue_bed",
  "green_bed",
  "black_bed",
  "brown_bed",
  "orange_bed",
  "cyan_bed",
  "gray_bed",
  "lime_bed",
  "pink_bed",
  "purple_bed",
  "magenta_bed",
  "light_blue_bed",
  "light_gray_bed",
]);

export const VILLAGE_HINT_BLOCKS = new Set([
  "bell",
  "composter",
  "white_bed",
  "red_bed",
  "oak_stairs",
  "cobblestone_stairs",
  "glass_pane",
]);

export type SiteEvaluation = {
  ok: boolean;
  score: number;
  reason?: string;
  trees?: number;
  leaves?: number;
  obstructions?: number;
  waterHits?: number;
  villageHits?: number;
  approachFails?: number;
  approachOk?: number;
};

export function isProtectedBlock(name: string | undefined): boolean {
  if (!name) return false;
  if (PROTECTED_WORLD_BLOCKS.has(name)) return true;
  if (name.endsWith("_bed") || name.endsWith("_door")) return true;
  return false;
}

export function evaluateSite(
  origin: Vec3,
  width: number,
  depth: number,
  getBlock: (pos: Vec3) => string | undefined,
): SiteEvaluation {
  let protectedHits = 0;
  let villageHits = 0;
  let waterHits = 0;
  let solidFloor = 0;
  let trees = 0;
  let leaves = 0;
  let obstructions = 0;
  const ys: number[] = [];

  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      const column = { x: origin.x + dx, y: origin.y, z: origin.z + dz };
      const here = getBlock(column);
      const below = getBlock({ ...column, y: origin.y - 1 });
      if (here === "water" || below === "water" || here === "lava" || below === "lava") waterHits += 1;
      if (isProtectedBlock(here) || isProtectedBlock(below)) protectedHits += 1;
      if (here && VILLAGE_HINT_BLOCKS.has(here)) villageHits += 1;
      if (here?.endsWith("_log")) trees += 1;
      if (here?.endsWith("_leaves")) leaves += 1;
      if (here && here !== "air" && here !== "cave_air") obstructions += 1;
      if (below && below !== "air" && below !== "cave_air" && below !== "water") {
        solidFloor += 1;
        ys.push(origin.y);
      }
    }
  }

  const cells = width * depth;
  const empty = { ok: false, score: 0, trees, leaves, obstructions, waterHits, villageHits, approachFails: 4, approachOk: 0 };
  if (waterHits > 0) return { ...empty, reason: "site is wet or lava" };
  if (protectedHits > 0) return { ...empty, reason: "site overlaps protected blocks" };
  if (villageHits >= 3) return { ...empty, reason: "site looks like a village house" };
  if (solidFloor < cells * 0.7) return { ...empty, reason: "site is not solid enough" };

  const approaches = [
    { x: origin.x + Math.floor(width / 2), y: origin.y, z: origin.z - 2 },
    { x: origin.x + Math.floor(width / 2), y: origin.y, z: origin.z + depth + 1 },
    { x: origin.x - 2, y: origin.y, z: origin.z + Math.floor(depth / 2) },
    { x: origin.x + width + 1, y: origin.y, z: origin.z + Math.floor(depth / 2) },
  ];
  let approachOk = 0;
  for (const pos of approaches) {
    const feet = getBlock(pos);
    const head = getBlock({ ...pos, y: pos.y + 1 });
    const below = getBlock({ ...pos, y: pos.y - 1 });
    const open = !feet || feet === "air" || feet === "cave_air";
    const headOpen = !head || head === "air" || head === "cave_air";
    if (open && headOpen && below && below !== "air" && below !== "water") approachOk += 1;
  }
  if (approachOk < 2) return { ...empty, approachOk, approachFails: 4 - approachOk, reason: "poor approaches" };

  const spread = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const score = 80 + solidFloor - trees * 6 - leaves * 2 - obstructions * 3 + approachOk * 8 - villageHits * 10 - spread * 15;
  return { ok: true, score, trees, leaves, obstructions, waterHits, villageHits, approachOk, approachFails: 4 - approachOk };
}

export function candidateOrigins(from: Vec3, radius = 48): Vec3[] {
  const spots: Vec3[] = [];
  for (let ring = 16; ring <= radius; ring += 8) {
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      spots.push({
        x: Math.floor(from.x + Math.cos(angle) * ring),
        y: Math.floor(from.y),
        z: Math.floor(from.z + Math.sin(angle) * ring),
      });
    }
  }
  return spots;
}

export function pickBestSite(
  from: Vec3,
  width: number,
  depth: number,
  getBlock: (pos: Vec3) => string | undefined,
  radius = 48,
): { origin: Vec3; evaluation: SiteEvaluation } | undefined {
  const scored = candidateOrigins(from, radius)
    .map((origin) => ({ origin, evaluation: evaluateSite(origin, width, depth, getBlock) }))
    .filter((entry) => entry.evaluation.ok)
    .sort((a, b) => b.evaluation.score - a.evaluation.score);
  return scored[0];
}
