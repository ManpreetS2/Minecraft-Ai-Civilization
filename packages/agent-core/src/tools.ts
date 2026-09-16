import type { SkillContext } from "@civ/skills";
import { equipItem } from "@civ/skills";

const AXES = ["netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "golden_axe", "wooden_axe"];
const PICKAXES = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "golden_pickaxe", "wooden_pickaxe"];

export function usableTool(ctx: SkillContext, names: string[]): string | undefined {
  const items = ctx.bot.inventory.items();
  for (const name of names) {
    const item = items.find((entry) => entry.name === name);
    if (!item) continue;
    const max = item.maxDurability;
    const used = item.durabilityUsed;
    if (typeof max === "number" && typeof used === "number" && max - used <= 0) continue;
    return name;
  }
  return undefined;
}

export async function equipBestTool(ctx: SkillContext, kind: "axe" | "pickaxe"): Promise<string | undefined> {
  const name = usableTool(ctx, kind === "axe" ? AXES : PICKAXES);
  if (!name) return undefined;
  await equipItem(ctx, name);
  return name;
}

export function needsReplacement(ctx: SkillContext, kind: "axe" | "pickaxe"): boolean {
  return usableTool(ctx, kind === "axe" ? AXES : PICKAXES) === undefined;
}

export function bestCraftTarget(ctx: SkillContext): string {
  const cobble = ctx.bot.inventory.items().filter((i) => i.name === "cobblestone").reduce((s, i) => s + i.count, 0);
  if (needsReplacement(ctx, "pickaxe")) {
    return cobble >= 3 ? "stone_pickaxe" : "wooden_pickaxe";
  }
  if (needsReplacement(ctx, "axe")) {
    return cobble >= 3 ? "stone_axe" : "wooden_axe";
  }
  return cobble >= 3 ? "stone_pickaxe" : "wooden_pickaxe";
}
