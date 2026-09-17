import { DISPOSABLE_SCAFFOLD } from "./scaffold.js";
import { isDangerousBlock, isReplaceable, isSolid } from "./blocks.js";
import type { McData } from "./data.js";
import { classifyBlockUse } from "./world.js";
import { knownThreat, getThreatInfo, type EntityAttitude } from "./mobs.js";
import { normalizeBlockName, normalizeItemName } from "./names.js";

export type InteractionType = "mine" | "open" | "craft" | "sleep" | "door" | "place" | "use" | "none";

const CONTAINERS = new Set(["chest", "trapped_chest", "barrel", "ender_chest", "shulker_box", "hopper", "dispenser", "dropper"]);
const WORKSTATIONS = new Set([
  "crafting_table",
  "furnace",
  "blast_furnace",
  "smoker",
  "anvil",
  "smithing_table",
  "stonecutter",
  "cartography_table",
  "loom",
  "grindstone",
  "fletching_table",
]);
const PASSABLE_EXTRA = new Set([
  "air",
  "cave_air",
  "void_air",
  "water",
  "short_grass",
  "tall_grass",
  "grass",
  "fern",
  "dead_bush",
  "snow",
  "torch",
  "wall_torch",
  "soul_torch",
]);

export function isDoor(name: string): boolean {
  const n = normalizeBlockName(name);
  return n.endsWith("_door") || n === "iron_door";
}

export function isBed(name: string): boolean {
  return normalizeBlockName(name).endsWith("_bed");
}

export function isContainer(name: string): boolean {
  const n = normalizeBlockName(name);
  return CONTAINERS.has(n) || n.endsWith("_shulker_box") || classifyBlockUse(n) === "chest";
}

export function isWorkstation(name: string): boolean {
  return WORKSTATIONS.has(normalizeBlockName(name));
}

export function isTool(name: string): boolean {
  const n = normalizeItemName(name);
  return (
    n.endsWith("_pickaxe") ||
    n.endsWith("_axe") ||
    n.endsWith("_shovel") ||
    n.endsWith("_hoe") ||
    n.endsWith("_sword") ||
    n === "shears" ||
    n === "flint_and_steel"
  );
}

export function isDisposableScaffold(name: string): boolean {
  return DISPOSABLE_SCAFFOLD.has(normalizeItemName(name));
}

export function isPassable(name: string, data: McData): boolean {
  const n = normalizeBlockName(name);
  if (PASSABLE_EXTRA.has(n) || isReplaceable(n) || isDoor(n) || n.endsWith("_carpet") || n.endsWith("_sign")) return true;
  const block = data.blocksByName[n];
  if (!block) return false;
  return block.boundingBox !== "block" || Boolean(block.transparent && !isSolid(n, data));
}

export function isStandable(name: string, data: McData): boolean {
  const n = normalizeBlockName(name);
  if (n === "water" || n === "lava" || n === "air" || n === "cave_air") return false;
  return isSolid(n, data);
}

export function isHazard(name: string): boolean {
  return isDangerousBlock(normalizeBlockName(name));
}

export function interactionType(name: string): InteractionType {
  const n = normalizeBlockName(name);
  if (isReplaceable(n) || n === "air" || n === "cave_air") return "place";
  if (n === "crafting_table") return "craft";
  if (isContainer(n)) return "open";
  if (isBed(n)) return "sleep";
  if (isDoor(n)) return "door";
  if (isWorkstation(n) || n.endsWith("_button") || n.includes("lever") || n.includes("gate")) return "use";
  return "mine";
}

export function isHostileEntity(name: string, data: McData): boolean {
  return entityAttitude(name, data) === "HOSTILE";
}

export function entityAttitude(name: string, data: McData): EntityAttitude {
  const n = normalizeItemName(name);
  const known = knownThreat(n);
  if (known) return known.attitude;
  const entity = data.entitiesByName?.[n];
  if (entity?.type === "hostile") return "HOSTILE";
  if (entity?.type === "animal" || entity?.type === "passive" || entity?.category?.toLowerCase().includes("passive")) return "PASSIVE";
  if (entity?.type === "projectile") return "OTHER";
  return getThreatInfo(n).attitude;
}

export function isProjectileEntity(name: string, data: McData): boolean {
  const n = normalizeItemName(name);
  const entity = data.entitiesByName?.[n];
  return entity?.type === "projectile" || entity?.category?.toLowerCase().includes("projectile") === true;
}

export function isIronDoor(name: string): boolean {
  const n = normalizeBlockName(name);
  return n === "iron_door" || n.includes("copper_door");
}

export function isWoodenDoor(name: string): boolean {
  return isDoor(name) && !isIronDoor(name);
}

export function isFenceGate(name: string): boolean {
  return normalizeBlockName(name).endsWith("_fence_gate") || normalizeBlockName(name).endsWith("_gate");
}

export function isTrapdoor(name: string): boolean {
  return normalizeBlockName(name).endsWith("_trapdoor");
}

export function hasCollision(name: string, data: McData): boolean {
  return isSolid(name, data);
}

export function canOccupyFeet(name: string, data: McData): boolean {
  return isPassable(name, data);
}

export function canStandOn(name: string, data: McData): boolean {
  return isStandable(name, data);
}
