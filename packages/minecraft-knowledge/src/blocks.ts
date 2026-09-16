import type { McBlock, McData, McItem } from "./data.js";

export type ToolKind = "pickaxe" | "axe" | "shovel" | "hoe" | "shears" | "sword" | "hand";

const PICKAXE_ITEMS = ["wooden_pickaxe", "stone_pickaxe", "golden_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const AXE_ITEMS = ["wooden_axe", "stone_axe", "golden_axe", "iron_axe", "diamond_axe", "netherite_axe"];
const SHOVEL_ITEMS = ["wooden_shovel", "stone_shovel", "golden_shovel", "iron_shovel", "diamond_shovel", "netherite_shovel"];

const DANGEROUS_BLOCKS = new Set([
  "lava",
  "fire",
  "soul_fire",
  "magma_block",
  "cactus",
  "sweet_berry_bush",
  "campfire",
  "soul_campfire",
  "wither_rose",
  "powder_snow",
]);

const CLIMBABLE = new Set(["ladder", "vine", "twisting_vines", "weeping_vines", "scaffolding", "water"]);
const REPLACEABLE = new Set(["air", "cave_air", "void_air", "grass", "short_grass", "tall_grass", "fern", "snow", "water"]);

export function preferredTool(blockName: string, data: McData): ToolKind {
  if (PICKAXE_BLOCKS.has(blockName)) return "pickaxe";
  const block = data.blocksByName[blockName];
  const material = block?.material ?? "";
  if (material.includes("mine_pickaxe") || material === "rock" || material === "stone") return "pickaxe";
  if (material.includes("mine_axe") || material === "wood" || material === "plant") {
    if (blockName.endsWith("_log") || blockName.endsWith("_stem") || blockName.includes("planks")) return "axe";
  }
  if (blockName.endsWith("_log") || blockName.endsWith("_wood") || blockName.includes("bamboo")) return "axe";
  if (blockName.includes("leaves")) return "hand";
  if (material.includes("mine_shovel") || ["dirt", "sand", "gravel", "grass_block", "clay"].includes(blockName)) return "shovel";
  if (blockName.includes("wool") || blockName === "cobweb") return "shears";
  if (block?.harvestTools) {
    const names = harvestToolNames(block, data);
    if (names.some((name) => name.includes("pickaxe"))) return "pickaxe";
    if (names.some((name) => name.includes("_axe") && !name.includes("pickaxe"))) return "axe";
    if (names.some((name) => name.includes("shovel"))) return "shovel";
  }
  return "hand";
}

export function requiredTool(blockName: string, data: McData): ToolKind | undefined {
  const block = data.blocksByName[blockName];
  if (!block?.harvestTools) return undefined;
  return preferredTool(blockName, data);
}

const PICKAXE_BLOCKS = new Set([
  "stone",
  "cobblestone",
  "mossy_cobblestone",
  "deepslate",
  "cobbled_deepslate",
  "coal_ore",
  "iron_ore",
  "copper_ore",
  "gold_ore",
  "diamond_ore",
  "lapis_ore",
  "redstone_ore",
  "nether_gold_ore",
  "blackstone",
  "andesite",
  "diorite",
  "granite",
]);

export function canHarvest(blockName: string, toolName: string | undefined, data: McData): boolean {
  const block = data.blocksByName[blockName];
  if (block?.harvestTools && Object.keys(block.harvestTools).length > 0) {
    if (!toolName || toolName === "hand") return false;
    const item = data.itemsByName[toolName];
    if (!item) return false;
    return Boolean(block.harvestTools[String(item.id)]);
  }
  if (PICKAXE_BLOCKS.has(blockName)) {
    return Boolean(toolName && toolName.includes("pickaxe"));
  }
  return true;
}

export function breakTime(blockName: string, toolName: string | undefined, data: McData): number | undefined {
  const block = data.blocksByName[blockName];
  if (!block || block.hardness == null) return undefined;
  const hardness = block.hardness;
  if (hardness < 0) return Number.POSITIVE_INFINITY;
  const tool = toolName ? data.itemsByName[toolName] : undefined;
  const material = block.material ?? "";
  let speed = 1;
  if (tool && data.materials?.[material]) {
    const multiplier = data.materials[material]?.[String(tool.id)];
    if (typeof multiplier === "number") speed = multiplier;
  }
  if (!canHarvest(blockName, toolName, data) && block.harvestTools) {
    return hardness * 5 / Math.max(0.1, speed);
  }
  return (hardness * 1.5) / Math.max(0.1, speed);
}

export function isReplaceable(blockName: string): boolean {
  return REPLACEABLE.has(blockName) || blockName.endsWith("_carpet");
}

export function isSolid(blockName: string, data: McData): boolean {
  const block = data.blocksByName[blockName];
  if (!block) return false;
  return block.boundingBox === "block";
}

export function isClimbable(blockName: string): boolean {
  return CLIMBABLE.has(blockName) || blockName.includes("vines");
}

export function isDangerousBlock(blockName: string): boolean {
  return DANGEROUS_BLOCKS.has(blockName);
}

export function harvestToolNames(block: McBlock, data: McData): string[] {
  if (!block.harvestTools) return [];
  const names: string[] = [];
  for (const id of Object.keys(block.harvestTools)) {
    const item = data.items[id] ?? data.items[Number(id)];
    if (item?.name) names.push(item.name);
  }
  return names;
}

export function toolKindOf(itemName: string | undefined): ToolKind {
  if (!itemName) return "hand";
  if (PICKAXE_ITEMS.includes(itemName)) return "pickaxe";
  if (AXE_ITEMS.includes(itemName)) return "axe";
  if (SHOVEL_ITEMS.includes(itemName)) return "shovel";
  if (itemName.includes("hoe")) return "hoe";
  if (itemName === "shears") return "shears";
  if (itemName.includes("sword")) return "sword";
  return "hand";
}

export function isPreferredToolItem(blockName: string, toolName: string | undefined, data: McData): boolean {
  const kind = preferredTool(blockName, data);
  return toolKindOf(toolName) === kind;
}

export type { McItem };
