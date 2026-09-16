export type IngredientBag = Record<string, number>;

export type RecipeDef = {
  result: string;
  resultCount: number;
  ingredients: IngredientBag;
  needsTable: boolean;
};

export type CraftStep =
  | { kind: "gather"; item: string; count: number }
  | { kind: "craft"; item: string; count: number; needsTable: boolean }
  | { kind: "ensure_table" };

const LOG_TO_PLANKS: Record<string, string> = {
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

const RECIPES: RecipeDef[] = [
  ...Object.entries(LOG_TO_PLANKS).map(([log, planks]) => ({
    result: planks,
    resultCount: 4,
    ingredients: { [log]: 1 },
    needsTable: false,
  })),
  { result: "stick", resultCount: 4, ingredients: { any_planks: 2 }, needsTable: false },
  { result: "crafting_table", resultCount: 1, ingredients: { any_planks: 4 }, needsTable: false },
  { result: "chest", resultCount: 1, ingredients: { any_planks: 8 }, needsTable: true },
  { result: "oak_door", resultCount: 3, ingredients: { oak_planks: 6 }, needsTable: true },
  { result: "wooden_pickaxe", resultCount: 1, ingredients: { any_planks: 3, stick: 2 }, needsTable: true },
  { result: "wooden_axe", resultCount: 1, ingredients: { any_planks: 3, stick: 2 }, needsTable: true },
  { result: "wooden_shovel", resultCount: 1, ingredients: { any_planks: 1, stick: 2 }, needsTable: true },
  { result: "stone_pickaxe", resultCount: 1, ingredients: { cobblestone: 3, stick: 2 }, needsTable: true },
  { result: "stone_axe", resultCount: 1, ingredients: { cobblestone: 3, stick: 2 }, needsTable: true },
  { result: "torch", resultCount: 4, ingredients: { coal: 1, stick: 1 }, needsTable: false },
  { result: "bread", resultCount: 1, ingredients: { wheat: 3 }, needsTable: false },
];

const RAW_GATHER: Record<string, string> = {
  oak_log: "log",
  birch_log: "log",
  spruce_log: "log",
  jungle_log: "log",
  acacia_log: "log",
  dark_oak_log: "log",
  cobblestone: "stone",
  coal: "coal",
  wheat: "crop",
};

export function recipesFor(item: string): RecipeDef[] {
  return RECIPES.filter((recipe) => recipe.result === item);
}

export function recipeNeedsTable(item: string): boolean {
  return RECIPES.some((recipe) => recipe.result === item && recipe.needsTable);
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
  if (item === "any_planks") return countPlanks(inv);
  if (item === "any_log") return countLogs(inv);
  if (item.endsWith("_planks")) return countPlanks(inv);
  return inv[item] ?? 0;
}

export function preferredLog(inv: IngredientBag): string {
  return LOGS.find((name) => (inv[name] ?? 0) > 0) ?? "oak_log";
}

export function preferredPlank(inv: IngredientBag): string {
  return PLANKS.find((name) => (inv[name] ?? 0) > 0) ?? plankForLog(preferredLog(inv)) ?? "oak_planks";
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

function add(inv: IngredientBag, item: string, count: number): void {
  inv[item] = (inv[item] ?? 0) + count;
}

export function planCraft(
  item: string,
  quantity: number,
  inventory: IngredientBag,
  hasCraftingTable: boolean,
): CraftStep[] {
  const working = { ...inventory };
  let table = hasCraftingTable;
  const steps: CraftStep[] = [];
  fill(item, quantity, working, () => table, (value) => {
    table = value;
  }, steps);
  return mergeGathers(steps);
}

function fill(
  item: string,
  quantity: number,
  inv: IngredientBag,
  hasTable: () => boolean,
  setTable: (value: boolean) => void,
  steps: CraftStep[],
): void {
  const have = countOf(inv, item);
  if (have >= quantity) return;

  const missing = quantity - have;
  const recipe = pickRecipe(item, inv);
  if (!recipe) {
    const gatherItem = item === "any_planks" ? preferredLog(inv) : item === "any_log" ? preferredLog(inv) : item;
    const gatherCount =
      item === "any_planks" ? Math.ceil(missing / 4) : missing;
    steps.push({ kind: "gather", item: gatherItem, count: Math.max(1, gatherCount) });
    add(inv, gatherItem, gatherCount);
    if (item === "any_planks" || item.endsWith("_planks")) {
      fill(item, quantity, inv, hasTable, setTable, steps);
    }
    return;
  }

  const crafts = Math.ceil(missing / recipe.resultCount);
  for (const [ingredient, perCraft] of Object.entries(recipe.ingredients)) {
    fill(ingredient, perCraft * crafts, inv, hasTable, setTable, steps);
  }

  if (recipe.needsTable && !hasTable()) {
    fill("crafting_table", 1, inv, hasTable, setTable, steps);
    steps.push({ kind: "ensure_table" });
    setTable(true);
  }

  for (const [ingredient, perCraft] of Object.entries(recipe.ingredients)) {
    consume(inv, ingredient, perCraft * crafts);
  }
  const resultName = recipe.result === "oak_planks" ? preferredPlank(inv) : recipe.result;
  add(inv, recipe.result, recipe.resultCount * crafts);
  steps.push({
    kind: "craft",
    item: resultName === "oak_planks" && PLANKS.includes(recipe.result) ? recipe.result : recipe.result,
    count: crafts,
    needsTable: recipe.needsTable,
  });
}

function pickRecipe(item: string, inv: IngredientBag): RecipeDef | undefined {
  if (item === "any_planks") {
    const log = preferredLog(inv);
    const planks = plankForLog(log);
    if (!planks) return undefined;
    return RECIPES.find((recipe) => recipe.result === planks);
  }
  if (item.endsWith("_planks")) {
    return RECIPES.find((recipe) => recipe.result === item);
  }
  return RECIPES.find((recipe) => recipe.result === item);
}

function mergeGathers(steps: CraftStep[]): CraftStep[] {
  const merged: CraftStep[] = [];
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

export function nextCraftStep(
  item: string,
  quantity: number,
  inventory: IngredientBag,
  hasCraftingTable: boolean,
): CraftStep | undefined {
  return planCraft(item, quantity, inventory, hasCraftingTable)[0];
}

export function gatherCategory(item: string): "wood" | "stone" | "crop" | "other" {
  if (LOGS.includes(item) || item === "any_log" || RAW_GATHER[item] === "log") return "wood";
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
