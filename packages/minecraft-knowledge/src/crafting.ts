import { friendlyName, normalizeItemName } from "./names.js";

export type IngredientBag = Record<string, number>;

export type KnowledgeRecipe = {
  result: string;
  resultCount: number;
  ingredients: IngredientBag;
  needsTable: boolean;
  shaped: boolean;
  source: "minecraft-data" | "overlay";
};

export type CraftPlanStep =
  | { kind: "gather"; item: string; count: number }
  | { kind: "craft"; item: string; count: number; needsTable: boolean }
  | { kind: "ensure_table" };

export const LOG_TO_PLANKS: Record<string, string> = {
  oak_log: "oak_planks",
  birch_log: "birch_planks",
  spruce_log: "spruce_planks",
  jungle_log: "jungle_planks",
  acacia_log: "acacia_planks",
  dark_oak_log: "dark_oak_planks",
  mangrove_log: "mangrove_planks",
  cherry_log: "cherry_planks",
  pale_oak_log: "pale_oak_planks",
};

export const PLANKS = [...new Set(Object.values(LOG_TO_PLANKS))];
export const LOGS = Object.keys(LOG_TO_PLANKS);

// Overlay expands tag-like any_planks variants for planning.
// Authoritative shaped recipes still come from installed minecraft-data.
const OVERLAY: KnowledgeRecipe[] = [
  ...Object.entries(LOG_TO_PLANKS).map(([log, planks]) => ({
    result: planks,
    resultCount: 4,
    ingredients: { [log]: 1 },
    needsTable: false,
    shaped: true,
    source: "overlay" as const,
  })),
  { result: "stick", resultCount: 4, ingredients: { any_planks: 2 }, needsTable: false, shaped: true, source: "overlay" },
  { result: "crafting_table", resultCount: 1, ingredients: { any_planks: 4 }, needsTable: false, shaped: true, source: "overlay" },
  { result: "chest", resultCount: 1, ingredients: { any_planks: 8 }, needsTable: true, shaped: true, source: "overlay" },
  { result: "oak_door", resultCount: 3, ingredients: { oak_planks: 6 }, needsTable: true, shaped: true, source: "overlay" },
  { result: "wooden_pickaxe", resultCount: 1, ingredients: { any_planks: 3, stick: 2 }, needsTable: true, shaped: true, source: "overlay" },
  { result: "wooden_axe", resultCount: 1, ingredients: { any_planks: 3, stick: 2 }, needsTable: true, shaped: true, source: "overlay" },
  { result: "wooden_shovel", resultCount: 1, ingredients: { any_planks: 1, stick: 2 }, needsTable: true, shaped: true, source: "overlay" },
  { result: "stone_pickaxe", resultCount: 1, ingredients: { cobblestone: 3, stick: 2 }, needsTable: true, shaped: true, source: "overlay" },
  { result: "stone_axe", resultCount: 1, ingredients: { cobblestone: 3, stick: 2 }, needsTable: true, shaped: true, source: "overlay" },
  { result: "bread", resultCount: 1, ingredients: { wheat: 3 }, needsTable: false, shaped: true, source: "overlay" },
];

type RecipeLike = {
  result?: { id?: number; count?: number } | number;
  inShape?: unknown;
  ingredients?: unknown;
};

export function overlayRecipes(): KnowledgeRecipe[] {
  return OVERLAY;
}

export function recipesFromMinecraftData(args: {
  recipes: Record<number | string, unknown> | undefined;
  items: Record<number | string, { name: string }>;
  itemsByName: Record<string, { id: number; name: string }>;
}): KnowledgeRecipe[] {
  const out: KnowledgeRecipe[] = [];
  if (!args.recipes) return out;
  for (const [id, raw] of Object.entries(args.recipes)) {
    const list = Array.isArray(raw) ? raw : [raw];
    for (const entry of list) {
      const parsed = parseRecipe(entry as RecipeLike, Number(id), args.items);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

function parseRecipe(
  recipe: RecipeLike,
  fallbackId: number,
  items: Record<number | string, { name: string }>,
): KnowledgeRecipe | undefined {
  const resultId =
    typeof recipe.result === "number"
      ? recipe.result
      : typeof recipe.result === "object" && recipe.result
        ? recipe.result.id ?? fallbackId
        : fallbackId;
  const result = items[resultId]?.name;
  if (!result) return undefined;
  const resultCount =
    typeof recipe.result === "object" && recipe.result && typeof recipe.result.count === "number"
      ? recipe.result.count
      : 1;
  const ingredients: IngredientBag = {};
  let width = 0;
  let height = 0;
  if (Array.isArray(recipe.inShape)) {
    height = recipe.inShape.length;
    for (const row of recipe.inShape) {
      if (!Array.isArray(row)) continue;
      width = Math.max(width, row.length);
      for (const cell of row) {
        const name = cellIngredientName(cell, items);
        if (!name) continue;
        ingredients[name] = (ingredients[name] ?? 0) + 1;
      }
    }
  }
  if (Array.isArray(recipe.ingredients)) {
    for (const cell of recipe.ingredients) {
      const name = cellIngredientName(cell, items);
      if (!name) continue;
      ingredients[name] = (ingredients[name] ?? 0) + 1;
    }
  }
  if (Object.keys(ingredients).length === 0) return undefined;
  const shaped = Array.isArray(recipe.inShape);
  const shapelessCount = Object.values(ingredients).reduce((sum, n) => sum + n, 0);
  return {
    result,
    resultCount,
    ingredients,
    needsTable: width > 2 || height > 2 || (!shaped && shapelessCount > 4),
    shaped,
    source: "minecraft-data",
  };
}

/**
 * Installed minecraft-data 1.21.11 cells are `number | null`.
 * Older datasets in the same package use `{ id, metadata? }`.
 * prismarine-recipe also documents `[id, metadata]`.
 * Some recipe dumps use a list of alternative IDs in one cell.
 */
export function cellIngredientIds(cell: unknown): number[] {
  if (cell == null) return [];
  if (typeof cell === "number") return cell >= 0 ? [cell] : [];
  if (Array.isArray(cell)) return cell.flatMap(cellIngredientIds);
  if (typeof cell === "object" && cell && "id" in cell && typeof (cell as { id: unknown }).id === "number") {
    const id = (cell as { id: number }).id;
    return id >= 0 ? [id] : [];
  }
  return [];
}

export function cellIngredientName(
  cell: unknown,
  items: Record<number | string, { name: string }>,
): string | undefined {
  const names = cellIngredientIds(cell)
    .map((id) => items[id]?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return undefined;
  if (names.length > 1 && names.every((name) => name.endsWith("_planks"))) return "any_planks";
  if (names.length > 1 && names.every((name) => name.endsWith("_log"))) return "any_log";
  return names[0];
}

export function mergeRecipes(dataRecipes: KnowledgeRecipe[], overlay = OVERLAY): KnowledgeRecipe[] {
  const byResult = new Map<string, KnowledgeRecipe[]>();
  for (const recipe of [...dataRecipes, ...overlay]) {
    const list = byResult.get(recipe.result) ?? [];
    if (!list.some((existing) => JSON.stringify(existing.ingredients) === JSON.stringify(recipe.ingredients))) {
      list.push(recipe);
    }
    byResult.set(recipe.result, list);
  }
  return [...byResult.values()].flat();
}

export function countOf(inv: IngredientBag, item: string): number {
  if (item === "any_planks") return PLANKS.reduce((sum, name) => sum + (inv[name] ?? 0), 0);
  if (item === "any_log") return LOGS.reduce((sum, name) => sum + (inv[name] ?? 0), 0);
  return inv[item] ?? 0;
}

export function planCraft(
  item: string,
  quantity: number,
  inventory: IngredientBag,
  recipes: KnowledgeRecipe[],
  hasCraftingTable: boolean,
): CraftPlanStep[] {
  const target = item === "any_planks" || item === "any_log" ? item : normalizeItemName(item) || item;
  const working = { ...inventory };
  let table = hasCraftingTable;
  const steps: CraftPlanStep[] = [];
  fill(target, quantity, working, recipes, () => table, (value) => {
    table = value;
  }, steps);
  return mergeGathers(steps);
}

function fill(
  item: string,
  quantity: number,
  inv: IngredientBag,
  recipes: KnowledgeRecipe[],
  hasTable: () => boolean,
  setTable: (value: boolean) => void,
  steps: CraftPlanStep[],
  depth = 0,
  seen: string[] = [],
): void {
  if (countOf(inv, item) >= quantity) return;
  const missing = quantity - countOf(inv, item);
  if (depth > 14 || seen.includes(item)) {
    const gatherItem = item === "any_planks" || item.endsWith("_planks") ? preferredLog(inv) : item;
    steps.push({ kind: "gather", item: gatherItem, count: Math.max(1, missing) });
    inv[gatherItem] = (inv[gatherItem] ?? 0) + missing;
    return;
  }
  const recipe = pickRecipe(item, inv, recipes);
  if (!recipe) {
    const gatherItem = item === "any_planks" || item.endsWith("_planks") ? preferredLog(inv) : item === "any_log" ? preferredLog(inv) : item;
    const gatherCount = item === "any_planks" || item.endsWith("_planks") ? Math.ceil(missing / 4) : missing;
    steps.push({ kind: "gather", item: gatherItem, count: Math.max(1, gatherCount) });
    inv[gatherItem] = (inv[gatherItem] ?? 0) + gatherCount;
    if (item === "any_planks" || item.endsWith("_planks")) {
      fill(item, quantity, inv, recipes, hasTable, setTable, steps, depth + 1, [...seen, item]);
    }
    return;
  }
  const crafts = Math.ceil(missing / recipe.resultCount);
  const nextSeen = [...seen, item];
  for (const [ingredient, perCraft] of Object.entries(recipe.ingredients)) {
    fill(ingredient, perCraft * crafts, inv, recipes, hasTable, setTable, steps, depth + 1, nextSeen);
  }
  if (recipe.needsTable && !hasTable()) {
    fill("crafting_table", 1, inv, recipes, hasTable, setTable, steps, depth + 1, nextSeen);
    steps.push({ kind: "ensure_table" });
    setTable(true);
  }
  for (const [ingredient, perCraft] of Object.entries(recipe.ingredients)) {
    consume(inv, ingredient, perCraft * crafts);
  }
  inv[recipe.result] = (inv[recipe.result] ?? 0) + recipe.resultCount * crafts;
  steps.push({ kind: "craft", item: recipe.result, count: crafts, needsTable: recipe.needsTable });
}

function pickRecipe(item: string, inv: IngredientBag, recipes: KnowledgeRecipe[]): KnowledgeRecipe | undefined {
  const target = normalizeItemName(item) || item;
  if (target === "any_planks") {
    const log = preferredLog(inv);
    const planks = LOG_TO_PLANKS[log];
    return recipes.find((recipe) => recipe.result === planks);
  }
  const matches = recipes.filter((recipe) => recipe.result === target);
  if (matches.length === 0) return undefined;
  const scored = [...matches].sort((a, b) => scoreRecipe(b, inv) - scoreRecipe(a, inv));
  return scored[0];
}

function scoreRecipe(recipe: KnowledgeRecipe, inv: IngredientBag): number {
  let score = recipe.source === "overlay" ? 8 : 0;
  if (ingredientsMet(recipe, inv)) score += 50;
  if (Object.keys(recipe.ingredients).some((name) => name.startsWith("any_"))) score += 6;
  for (const [name, need] of Object.entries(recipe.ingredients)) {
    const have = countOf(inv, name);
    score += Math.min(have, need);
    if (have === 0) score -= 2;
    if (name === "cobblestone" || name === "oak_planks" || name === "oak_log") score += 4;
    if (name === "cobbled_deepslate" || name === "blackstone" || name.startsWith("cherry_")) score -= 4;
  }
  return score;
}

function ingredientsMet(recipe: KnowledgeRecipe, inv: IngredientBag): boolean {
  return Object.entries(recipe.ingredients).every(([name, count]) => countOf(inv, name) >= count);
}

function preferredLog(inv: IngredientBag): string {
  return LOGS.find((name) => (inv[name] ?? 0) > 0) ?? "oak_log";
}

function consume(inv: IngredientBag, item: string, count: number): void {
  if (item === "any_planks") {
    let remaining = count;
    for (const name of PLANKS) {
      const have = inv[name] ?? 0;
      const take = Math.min(have, remaining);
      if (take > 0) inv[name] = have - take;
      remaining -= take;
      if (remaining <= 0) return;
    }
    return;
  }
  inv[item] = (inv[item] ?? 0) - count;
}

function mergeGathers(steps: CraftPlanStep[]): CraftPlanStep[] {
  const merged: CraftPlanStep[] = [];
  for (const step of steps) {
    const last = merged[merged.length - 1];
    if (step.kind === "gather" && last?.kind === "gather" && last.item === step.item) {
      last.count += step.count;
    } else {
      merged.push({ ...step });
    }
  }
  return merged;
}

export function canCraftFromPlan(steps: CraftPlanStep[]): boolean {
  return steps.every((step) => step.kind !== "gather");
}

export function recipesForItem(item: string, recipes: KnowledgeRecipe[]): KnowledgeRecipe[] {
  const target = normalizeItemName(item) || item;
  return recipes.filter((recipe) => recipe.result === target);
}

export type ObtainAnalysis = {
  item: string;
  known: boolean;
  alreadyOwned: boolean;
  recipes: KnowledgeRecipe[];
  chosen?: KnowledgeRecipe;
  steps: CraftPlanStep[];
  next?: CraftPlanStep;
  needsTable: boolean;
  outputCount: number;
  missingIngredients: IngredientBag;
  facts: string[];
};

export function analyzeObtain(
  item: string,
  quantity: number,
  inventory: IngredientBag,
  recipes: KnowledgeRecipe[],
  hasCraftingTable: boolean,
  itemExists: boolean,
): ObtainAnalysis {
  const target = normalizeItemName(item) || item;
  const owned = countOf(inventory, target);
  const matches = recipesForItem(target, recipes);
  const chosen = pickRecipe(target, inventory, recipes);
  const alreadyOwned = owned >= quantity;
  const steps = alreadyOwned ? [] : planCraft(target, quantity, inventory, recipes, hasCraftingTable);
  const missingIngredients: IngredientBag = {};
  if (chosen) {
    for (const [name, need] of Object.entries(chosen.ingredients)) {
      const have = countOf(inventory, name);
      if (have < need) missingIngredients[name] = need - have;
    }
  }
  const facts: string[] = [];
  if (!itemExists && matches.length === 0) {
    facts.push(`No Minecraft item named ${friendlyName(target)}.`);
    return {
      item: target,
      known: false,
      alreadyOwned: false,
      recipes: [],
      steps: [],
      needsTable: false,
      outputCount: 0,
      missingIngredients,
      facts,
    };
  }
  if (alreadyOwned) {
    facts.push(`You already have ${owned} ${friendlyName(target)}.`);
  }
  if (chosen) {
    const parts = Object.entries(chosen.ingredients).map(([name, count]) => `${count} ${friendlyName(name)}`);
    facts.push(
      `${friendlyName(target)} requires ${parts.join(" and ")}${chosen.needsTable ? " at a crafting table" : " in the 2x2 inventory grid"}.`,
    );
    facts.push(`Each craft yields ${chosen.resultCount} ${friendlyName(target)}.`);
    facts.push(chosen.shaped ? "This is a shaped recipe." : "This is a shapeless recipe.");
    if (chosen.needsTable) {
      facts.push(hasCraftingTable ? "A crafting table is reachable nearby." : "No crafting table is reachable.");
    }
    for (const [name, need] of Object.entries(chosen.ingredients)) {
      facts.push(`You currently have ${countOf(inventory, name)} ${friendlyName(name)} (need ${need}).`);
    }
  } else if (itemExists) {
    facts.push(`${friendlyName(target)} is not crafted; it must be gathered or found.`);
  }
  const gather = steps.find((step) => step.kind === "gather");
  if (gather?.kind === "gather") {
    facts.push(`Need to gather ${gather.count} ${friendlyName(gather.item)} first.`);
  }
  return {
    item: target,
    known: matches.length > 0 || itemExists,
    alreadyOwned,
    recipes: matches,
    chosen,
    steps,
    next: steps[0],
    needsTable: Boolean(chosen?.needsTable),
    outputCount: chosen?.resultCount ?? 0,
    missingIngredients,
    facts,
  };
}

export { pickRecipe };

