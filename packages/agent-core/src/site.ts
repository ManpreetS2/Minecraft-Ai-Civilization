import type { Vec3 } from "@civ/shared";

export function starterHutSize(): { width: number; depth: number; wallHeight: number } {
  return { width: 5, depth: 4, wallHeight: 2 };
}

export type SiteEvaluation = {
  ok: boolean;
  score: number;
  reason?: string;
  trees: number;
  leaves: number;
  obstructions: number;
  waterHits: number;
  villageHits: number;
  approachFails: number;
  approachOk: number;
};

const TREE = /_log$/;
const LEAF = /_leaves$/;
const PROTECTED = /chest|crafting_table|furnace|door|_bed$|farmland|wheat|bell|composter/;

export function evaluateSite(
  origin: Vec3,
  width: number,
  depth: number,
  getBlock: (pos: Vec3) => string | undefined,
): SiteEvaluation {
  let trees = 0;
  let leaves = 0;
  let waterHits = 0;
  let protectedHits = 0;
  let villageHits = 0;
  let solidFloor = 0;
  let obstructions = 0;
  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      const here = getBlock({ x: origin.x + dx, y: origin.y, z: origin.z + dz });
      const below = getBlock({ x: origin.x + dx, y: origin.y - 1, z: origin.z + dz });
      if (here === "water" || below === "water" || here === "lava") waterHits += 1;
      if (here && PROTECTED.test(here)) protectedHits += 1;
      if (here && TREE.test(here)) trees += 1;
      if (here && LEAF.test(here)) leaves += 1;
      if (here && here !== "air" && here !== "cave_air") obstructions += 1;
      if (below && below !== "air" && below !== "water") solidFloor += 1;
      if (here === "bell" || here === "composter") villageHits += 1;
    }
  }
  const empty = { ok: false, score: 0, trees, leaves, obstructions, waterHits, villageHits, approachFails: 4, approachOk: 0 };
  if (waterHits > 0) return { ...empty, reason: "wet" };
  if (protectedHits > 0) return { ...empty, reason: "protected" };
  if (villageHits >= 3) return { ...empty, reason: "village" };
  if (solidFloor < width * depth * 0.7) return { ...empty, reason: "not solid" };
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
    if (open && headOpen && below && below !== "air") approachOk += 1;
  }
  if (approachOk < 2) return { ...empty, approachOk, approachFails: 4 - approachOk, reason: "poor approaches" };
  const score = 80 + solidFloor - trees * 6 - leaves * 2 - obstructions * 3 + approachOk * 8;
  return { ok: true, score, trees, leaves, obstructions, waterHits, villageHits, approachOk, approachFails: 4 - approachOk };
}

export function pickBestSite(
  from: Vec3,
  width: number,
  depth: number,
  getBlock: (pos: Vec3) => string | undefined,
  radius = 48,
): { origin: Vec3; evaluation: SiteEvaluation } | undefined {
  const spots: Vec3[] = [];
  for (let ring = 20; ring <= radius; ring += 8) {
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      spots.push({
        x: Math.floor(from.x + Math.cos(angle) * ring),
        y: Math.floor(from.y),
        z: Math.floor(from.z + Math.sin(angle) * ring),
      });
    }
  }
  const scored = spots
    .map((origin) => ({ origin, evaluation: evaluateSite(origin, width, depth, getBlock) }))
    .filter((entry) => entry.evaluation.ok)
    .sort((a, b) => b.evaluation.score - a.evaluation.score);
  return scored[0];
}
