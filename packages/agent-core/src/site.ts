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
  const ys: number[] = [];

  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      const column = { x: origin.x + dx, y: origin.y, z: origin.z + dz };
      const here = getBlock(column);
      const below = getBlock({ ...column, y: origin.y - 1 });
      if (here === "water" || below === "water" || here === "lava" || below === "lava") waterHits += 1;
      if (isProtectedBlock(here) || isProtectedBlock(below)) protectedHits += 1;
      if (here && VILLAGE_HINT_BLOCKS.has(here)) villageHits += 1;
      if (below && below !== "air" && below !== "cave_air" && below !== "water") {
        solidFloor += 1;
        ys.push(origin.y);
      }
    }
  }

  const cells = width * depth;
  if (waterHits > 0) return { ok: false, score: 0, reason: "site is wet or lava" };
  if (protectedHits > 0) return { ok: false, score: 0, reason: "site overlaps protected blocks" };
  if (villageHits >= 3) return { ok: false, score: 0, reason: "site looks like a village house" };
  if (solidFloor < cells * 0.7) return { ok: false, score: 0, reason: "site is not solid enough" };

  const spread = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const score = 100 - villageHits * 10 - spread * 15 + solidFloor;
  return { ok: true, score };
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
