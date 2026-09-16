export type IngredientBag = Record<string, number>;

export type KnowledgeRecipe = {
  result: string;
  resultCount: number;
  ingredients: IngredientBag;
  needsTable: boolean;
  source: "minecraft-data" | "overlay";
};

export type CraftPlanStep =
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

const OVERLAY: KnowledgeRecipe[] = [
  ...Object.entries(LOG_TO_PLANKS).map(([log, planks]) => ({
    result: planks,
    resultCount: 4,
    ingredients: { [log]: 1 },
    needsTable: false,
    source: "overlay" as const,
  })),
  { result: "stick", resultCount: 4, ingredients: { any_planks: 2 }, needsTable: false, source: "overlay" },
  { result: "crafting_table", resultCount: 1, ingredients: { any_planks: 4 }, needsTable: false, source: "overlay" },
  { result: "chest", resultCount: 1, ingredients: { any_planks: 8 }, needsTable: true, source: "overlay" },
  { result: "wooden_pickaxe", resultCount: 1, ingredients: { any_planks: 3, stick: 2 }, needsTable: true, source: "overlay" },
  { result: "wooden_axe", resultCount: 1, ingredients: { any_planks: 3, stick: 2 }, needsTable: true, source: "overlay" },
  { result: "wooden_shovel", resultCount: 1, ingredients: { any_planks: 1, stick: 2 }, needsTable: true, source: "overlay" },
  { result: "stone_pickaxe", resultCount: 1, ingredients: { cobblestone: 3, stick: 2 }, needsTable: true, source: "overlay" },
  { result: "stone_axe", resultCount: 1, ingredients: { cobblestone: 3, stick: 2 }, needsTable: true, source: "overlay" },
  { result: "bread", resultCount: 1, ingredients: { wheat: 3 }, needsTable: false, source: "overlay" },
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
        const id = cellId(cell);
        if (id == null) continue;
        const name = items[id]?.name;
        if (!name) continue;
        ingredients[name] = (ingredients[name] ?? 0) + 1;
      }
    }
  }
  if (Array.isArray(recipe.ingredients)) {
    for (const cell of recipe.ingredients) {
      const id = cellId(cell);
      if (id == null) continue;
      const name = items[id]?.name;
      if (!name) continue;
      ingredients[name] = (ingredients[name] ?? 0) + 1;
    }
  }
  if (Object.keys(ingredients).length === 0) return undefined;
  return {
    result,
    resultCount,
    ingredients,
    needsTable: width > 2 || height > 2,
    source: "minecraft-data",
  };
}

function cellId(cell: unknown): number | undefined {
  if (cell == null) return undefined;
  if (typeof cell === "number") return cell;
  if (typeof cell === "object" && cell && "id" in cell && typeof (cell as { id: unknown }).id === "number") {
    return (cell as { id: number }).id;
  }
  return undefined;
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
  const working = { ...inventory };
  let table = hasCraftingTable;
  const steps: CraftPlanStep[] = [];
  fill(item, quantity, working, recipes, () => table, (value) => {
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
): void {
  if (countOf(inv, item) >= quantity) return;
  const missing = quantity - countOf(inv, item);
  const recipe = pickRecipe(item, inv, recipes);
  if (!recipe) {
    const gatherItem = item === "any_planks" || item.endsWith("_planks") ? preferredLog(inv) : item === "any_log" ? preferredLog(inv) : item;
    const gatherCount = item === "any_planks" || item.endsWith("_planks") ? Math.ceil(missing / 4) : missing;
    steps.push({ kind: "gather", item: gatherItem, count: Math.max(1, gatherCount) });
    inv[gatherItem] = (inv[gatherItem] ?? 0) + gatherCount;
    if (item === "any_planks" || item.endsWith("_planks")) fill(item, quantity, inv, recipes, hasTable, setTable, steps);
    return;
  }
  const crafts = Math.ceil(missing / recipe.resultCount);
  for (const [ingredient, perCraft] of Object.entries(recipe.ingredients)) {
    fill(ingredient, perCraft * crafts, inv, recipes, hasTable, setTable, steps);
  }
  if (recipe.needsTable && !hasTable()) {
    fill("crafting_table", 1, inv, recipes, hasTable, setTable, steps);
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
  if (item === "any_planks") {
    const log = preferredLog(inv);
    const planks = LOG_TO_PLANKS[log];
    return recipes.find((recipe) => recipe.result === planks);
  }
  const matches = recipes.filter((recipe) => recipe.result === item);
  return (
    matches.find((recipe) => recipe.source === "overlay") ??
    matches.find((recipe) => ingredientsMet(recipe, inv)) ??
    matches[0]
  );
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
