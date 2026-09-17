import { fail, ok, LOG_BLOCK_NAMES, type ActionResult } from "@civ/shared";
import type { SkillContext } from "./context.js";
import { collectResource } from "./collect.js";
import { craftItem, inventoryCount } from "./inventory.js";

export type RecipeStep = {
  item: string;
  kind: "collect" | "craft";
  blocks?: string[];
  ingredients?: Array<{ item: string; count: number }>;
};

const STONE = ["cobblestone", "stone", "cobbled_deepslate"];
const LOGS = [...LOG_BLOCK_NAMES];

const RECIPES: Record<string, RecipeStep> = {
  oak_log: { item: "oak_log", kind: "collect", blocks: LOGS },
  birch_log: { item: "birch_log", kind: "collect", blocks: LOGS },
  spruce_log: { item: "spruce_log", kind: "collect", blocks: LOGS },
  cobblestone: { item: "cobblestone", kind: "collect", blocks: STONE },
  stone: { item: "stone", kind: "collect", blocks: STONE },
  oak_planks: { item: "oak_planks", kind: "craft", ingredients: [{ item: "oak_log", count: 1 }] },
  stick: { item: "stick", kind: "craft", ingredients: [{ item: "oak_planks", count: 2 }] },
  crafting_table: { item: "crafting_table", kind: "craft", ingredients: [{ item: "oak_planks", count: 4 }] },
  wooden_pickaxe: {
    item: "wooden_pickaxe",
    kind: "craft",
    ingredients: [
      { item: "oak_planks", count: 3 },
      { item: "stick", count: 2 },
    ],
  },
  wooden_axe: {
    item: "wooden_axe",
    kind: "craft",
    ingredients: [
      { item: "oak_planks", count: 3 },
      { item: "stick", count: 2 },
    ],
  },
  stone_pickaxe: {
    item: "stone_pickaxe",
    kind: "craft",
    ingredients: [
      { item: "stick", count: 2 },
      { item: "cobblestone", count: 3 },
    ],
  },
  stone_axe: {
    item: "stone_axe",
    kind: "craft",
    ingredients: [
      { item: "stick", count: 2 },
      { item: "cobblestone", count: 3 },
    ],
  },
};

const ALIASES: Record<string, string[]> = {
  oak_planks: ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks"],
  oak_log: ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"],
  cobblestone: ["cobblestone", "stone", "cobbled_deepslate"],
};

export function recipeFor(item: string): RecipeStep | undefined {
  return RECIPES[item];
}

export function missingPrerequisites(held: Record<string, number>, item: string, depth = 0): string[] {
  if (depth > 8) return [item];
  if (countHeld(held, item) > 0) return [];
  const recipe = RECIPES[item];
  if (!recipe) return [item];
  if (recipe.kind === "collect") return [item];
  const missing: string[] = [];
  for (const ingredient of recipe.ingredients ?? []) {
    if (countHeld(held, ingredient.item) >= ingredient.count) continue;
    missing.push(...missingPrerequisites(held, ingredient.item, depth + 1));
  }
  if (missing.length === 0) missing.push(item);
  return missing;
}

export function prerequisiteChain(item: string): string[] {
  return missingPrerequisites({}, item);
}

function countHeld(held: Record<string, number>, item: string): number {
  const names = ALIASES[item] ?? [item];
  return names.reduce((sum, name) => sum + (held[name] ?? 0), 0);
}

export async function obtainItem(
  ctx: SkillContext,
  item: string,
  amount = 1,
  depth = 0,
): Promise<ActionResult<{ item: string; count: number }>> {
  const started = Date.now();
  if (depth > 12) {
    return fail("PREREQUISITE_MISSING", `Could not finish prerequisite chain for ${item}`, Date.now() - started, true);
  }
  if (inventoryCount(ctx, item) >= amount) {
    return ok({ item, count: inventoryCount(ctx, item) }, Date.now() - started);
  }
  const held = inventoryMap(ctx);
  const next = missingPrerequisites(held, item)[0];
  if (!next) {
    return fail("PREREQUISITE_MISSING", `No recipe path for ${item}`, Date.now() - started, true);
  }
  const recipe = RECIPES[next];
  if (!recipe) {
    return fail("NO_RECIPE", `Unknown item ${next}`, Date.now() - started, true);
  }
  if (recipe.kind === "collect") {
    const collected = await collectResource(ctx, recipe.blocks ?? [next], 1, 48);
    if (!collected.success) return collected;
    if (next === item && inventoryCount(ctx, item) >= amount) {
      return ok({ item, count: inventoryCount(ctx, item) }, Date.now() - started);
    }
    return obtainItem(ctx, item, amount, depth + 1);
  }
  const crafted = await craftItem(ctx, recipe.item, 1);
  if (!crafted.success) {
    if (crafted.code === "MISSING_INGREDIENT" || crafted.code === "NO_RECIPE") {
      return fail("PREREQUISITE_MISSING", crafted.error, Date.now() - started, true);
    }
    return crafted;
  }
  if (inventoryCount(ctx, item) >= amount) {
    return ok({ item, count: inventoryCount(ctx, item) }, Date.now() - started);
  }
  return obtainItem(ctx, item, amount, depth + 1);
}

function inventoryMap(ctx: SkillContext): Record<string, number> {
  const held: Record<string, number> = {};
  for (const item of ctx.bot.inventory.items()) {
    held[item.name] = (held[item.name] ?? 0) + item.count;
  }
  return held;
}
