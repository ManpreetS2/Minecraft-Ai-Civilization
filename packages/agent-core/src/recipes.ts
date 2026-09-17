import {
  LOG_TO_PLANKS,
  LOGS,
  PLANKS,
  countOf as knowledgeCountOf,
  minecraftKnowledge,
  type CraftPlanStep,
  type IngredientBag,
  type KnowledgeRecipe,
} from "@civ/minecraft-knowledge";

export type { IngredientBag };
export type RecipeDef = KnowledgeRecipe;
export type CraftStep = CraftPlanStep;
export { PLANKS, LOGS };

export function recipesFor(item: string): RecipeDef[] {
  return minecraftKnowledge().getRecipes(item);
}

export function recipeNeedsTable(item: string): boolean {
  return minecraftKnowledge().requiredWorkstation(item) === "crafting_table";
}

export function plankForLog(log: string): string | undefined {
  return LOG_TO_PLANKS[log];
}

export function countPlanks(inv: IngredientBag): number {
  return PLANKS.reduce((sum, name) => sum + (inv[name] ?? 0), 0);
}

export function countLogs(inv: IngredientBag): number {
  return LOGS.reduce((sum, name) => sum + (inv[name] ?? 0), 0);
}

export function countOf(inv: IngredientBag, item: string): number {
  return knowledgeCountOf(inv, item);
}

export function preferredLog(inv: IngredientBag): string {
  return LOGS.find((name) => (inv[name] ?? 0) > 0) ?? "oak_log";
}

export function preferredPlank(inv: IngredientBag): string {
  return PLANKS.find((name) => (inv[name] ?? 0) > 0) ?? plankForLog(preferredLog(inv)) ?? "oak_planks";
}

export function planCraft(
  item: string,
  quantity: number,
  inventory: IngredientBag,
  hasCraftingTable: boolean,
): CraftStep[] {
  return minecraftKnowledge().getCraftingDependencies(item, inventory, hasCraftingTable, quantity);
}

export function nextCraftStep(
  item: string,
  quantity: number,
  inventory: IngredientBag,
  hasCraftingTable: boolean,
): CraftStep | undefined {
  return planCraft(item, quantity, inventory, hasCraftingTable)[0];
}

export function gatherCategory(item: string): "wood" | "stone" | "crop" | "other" {
  if (LOGS.includes(item) || item === "any_log" || item.endsWith("_log")) return "wood";
  if (item === "cobblestone" || item === "stone" || item === "deepslate" || item === "coal") return "stone";
  if (item === "wheat" || item === "carrot" || item === "potato" || item === "beetroot") return "crop";
  return "other";
}

export function bagFromItems(items: Array<{ name: string; count: number }>): IngredientBag {
  const bag: IngredientBag = {};
  for (const item of items) {
    bag[item.name] = (bag[item.name] ?? 0) + item.count;
  }
  return bag;
}
