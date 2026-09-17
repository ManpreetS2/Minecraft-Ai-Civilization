import { fail, ok, type ActionResult } from "@civ/shared";
import { equipItem } from "./inventory.js";
import type { SkillContext } from "./context.js";

const AXES = ["netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "golden_axe", "wooden_axe"];
const PICKAXES = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "golden_pickaxe", "wooden_pickaxe"];
const SHOVELS = ["netherite_shovel", "diamond_shovel", "iron_shovel", "stone_shovel", "golden_shovel", "wooden_shovel"];

export async function equipForBlock(ctx: SkillContext, blockName: string): Promise<ActionResult<{ item?: string }>> {
  const started = Date.now();
  const family = toolFamily(blockName);
  const held = pickBestHeld(ctx, family);
  if (!held) {
    if (family === "pickaxe" && needsPick(blockName)) {
      return fail("MISSING_TOOL", `Need a pickaxe to harvest ${blockName}`, Date.now() - started, true);
    }
    return ok({ item: undefined }, Date.now() - started);
  }
  const equipped = await equipItem(ctx, held);
  if (!equipped.success) return equipped;
  return ok({ item: held }, Date.now() - started);
}

function needsPick(blockName: string): boolean {
  return /stone|cobble|deepslate|ore|obsidian|netherrack/.test(blockName);
}

function toolFamily(hint: string): "axe" | "pickaxe" | "shovel" | "any" {
  if (/log|stem|hyphae|planks|wood/.test(hint)) return "axe";
  if (/stone|cobble|deepslate|ore|obsidian|netherrack/.test(hint)) return "pickaxe";
  if (/dirt|sand|gravel|clay|snow/.test(hint)) return "shovel";
  return "any";
}

function pickBestHeld(ctx: SkillContext, family: "axe" | "pickaxe" | "shovel" | "any"): string | undefined {
  const order =
    family === "axe" ? AXES : family === "pickaxe" ? PICKAXES : family === "shovel" ? SHOVELS : [...PICKAXES, ...AXES, ...SHOVELS];
  const items = ctx.bot.inventory.items();
  for (const name of order) {
    const item = items.find((entry) => entry.name === name);
    if (!item) continue;
    const max = item.maxDurability;
    const used = item.durabilityUsed;
    if (typeof max === "number" && typeof used === "number" && max - used <= 0) continue;
    return name;
  }
  return undefined;
}
