import type { Vec3 } from "@civ/shared";
import {
  BASIC_SHELTER_ID,
  expandBlueprint,
  getBlueprint,
  resolveMaterials,
  type PlannedBlock,
} from "@civ/minecraft-knowledge";

export type BlueprintBlock = {
  dx: number;
  dy: number;
  dz: number;
  block: string;
  stage?: "floor" | "walls" | "door" | "roof" | "interior";
};

export type Blueprint = {
  id: string;
  name: string;
  blocks: BlueprintBlock[];
};

const LEGACY_STAGE: Record<string, BlueprintBlock["stage"]> = {
  FLOOR: "floor",
  WALLS: "walls",
  DOOR_ACCESS: "door",
  ROOF: "roof",
  INTERIOR: "interior",
  WORKSTATIONS: "interior",
};

function toLegacy(block: PlannedBlock, item: string): BlueprintBlock | undefined {
  if (block.stage === "FOUNDATION") return undefined;
  return {
    dx: block.dx,
    dy: block.dy,
    dz: block.dz,
    block: item,
    stage: LEGACY_STAGE[block.stage] ?? "walls",
  };
}

export function starterHutSize(): { width: number; depth: number; wallHeight: number } {
  const hut = getBlueprint(BASIC_SHELTER_ID)!;
  return { width: hut.footprint.width, depth: hut.footprint.depth, wallHeight: hut.footprint.wallHeight };
}

export function starterHut(): Blueprint {
  const spec = getBlueprint(BASIC_SHELTER_ID)!;
  const materials = resolveMaterials(spec, {
    oak_planks: 64,
    oak_door: 1,
    chest: 1,
    torch: 1,
    crafting_table: 1,
  });
  const expanded = expandBlueprint(spec, materials, "south", ["chest", "lighting"]);
  const blocks: BlueprintBlock[] = [];
  for (const block of expanded.blocks) {
    const mapped = toLegacy(block, block.role === "door" ? "oak_door" : block.role === "chest" ? "chest" : block.role === "lighting" ? "torch" : "oak_planks");
    if (mapped) blocks.push(mapped);
  }
  return { id: spec.id, name: spec.name, blocks };
}

export function materialList(blueprint: Blueprint): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const block of blueprint.blocks) {
    counts[block.block] = (counts[block.block] ?? 0) + 1;
  }
  return counts;
}

export function worldBlocks(blueprint: Blueprint, origin: Vec3): Array<{ position: Vec3; block: string }> {
  return blueprint.blocks.map((b) => ({
    block: b.block,
    position: { x: origin.x + b.dx, y: origin.y + b.dy, z: origin.z + b.dz },
  }));
}

export function nextUnplaced(
  blueprint: Blueprint,
  origin: Vec3,
  isPlaced: (position: Vec3, block: string) => boolean,
  skip?: (position: Vec3) => boolean,
): { position: Vec3; block: string } | undefined {
  for (const entry of worldBlocks(blueprint, origin)) {
    if (skip?.(entry.position)) continue;
    if (!isPlaced(entry.position, entry.block)) {
      return entry;
    }
  }
  return undefined;
}
