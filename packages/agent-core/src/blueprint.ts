import type { Vec3 } from "@civ/shared";

export type BlueprintBlock = {
  dx: number;
  dy: number;
  dz: number;
  block: string;
};

export type Blueprint = {
  id: string;
  name: string;
  blocks: BlueprintBlock[];
};

export function starterHut(): Blueprint {
  const blocks: BlueprintBlock[] = [];
  const width = 5;
  const depth = 5;
  const height = 3;

  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      blocks.push({ dx: x, dy: 0, dz: z, block: "oak_planks" });
    }
  }

  for (let y = 1; y <= height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) {
        const wall = x === 0 || z === 0 || x === width - 1 || z === depth - 1;
        const door = y <= 2 && x === 2 && z === 0;
        if (wall && !door) {
          blocks.push({ dx: x, dy: y, dz: z, block: y === height ? "oak_planks" : "oak_planks" });
        }
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      blocks.push({ dx: x, dy: height + 1, dz: z, block: "oak_planks" });
    }
  }

  blocks.push({ dx: 2, dy: 1, dz: 0, block: "oak_door" });
  blocks.push({ dx: 1, dy: 1, dz: 2, block: "chest" });
  blocks.push({ dx: 3, dy: 1, dz: 2, block: "crafting_table" });
  blocks.push({ dx: 1, dy: 2, dz: 1, block: "torch" });
  blocks.push({ dx: 3, dy: 2, dz: 3, block: "torch" });

  return { id: "starter_hut", name: "Starter Hut", blocks };
}

export function materialList(blueprint: Blueprint): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const block of blueprint.blocks) {
    const item = block.block === "oak_door" ? "oak_door" : block.block;
    counts[item] = (counts[item] ?? 0) + 1;
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
): { position: Vec3; block: string } | undefined {
  for (const entry of worldBlocks(blueprint, origin)) {
    if (!isPlaced(entry.position, entry.block)) {
      return entry;
    }
  }
  return undefined;
}
