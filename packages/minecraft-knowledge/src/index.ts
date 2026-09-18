import {
  canHarvest,
  isClimbable,
  isDangerousBlock,
  isReplaceable,
  isSolid,
  preferredAvailableTool,
  preferredTool,
  requiredTool,
  breakTime,
} from "./blocks.js";
import {
  analyzeObtain,
  countOf,
  mergeRecipes,
  overlayRecipes,
  planCraft,
  recipesForItem,
  recipesFromMinecraftData,
  type CraftPlanStep,
  type IngredientBag,
  type KnowledgeRecipe,
  type ObtainAnalysis,
} from "./crafting.js";
import { loadMinecraftData, resolveMinecraftVersion, type McBlock, type McData, type McItem } from "./data.js";
import { canEatNow, foodIndex, foodValue, getFoodOptions, isFood, saturationValue, type FoodInfo } from "./food.js";
import { classifyHazard, getThreatInfo } from "./mobs.js";
import { compactFacts, type RelevantGameKnowledge, type RelevantQuery } from "./relevant.js";
import { classifyTimeOfDay, nightIncreasesHostileRisk, SURVIVAL_RULES, ticksUntil, type TimePeriod } from "./survival.js";
import { interpretVillageFeature, villageChestImpliesOwnership } from "./village.js";
import { classifyBlockUse, WORLD_CONSTRAINTS } from "./world.js";
import {
  entityAttitude,
  interactionType,
  isBed,
  isContainer,
  isDisposableScaffold,
  canOccupyFeet,
  canStandOn,
  hasCollision,
  isDoor,
  isFenceGate,
  isHazard,
  isHostileEntity,
  isIronDoor,
  isPassable,
  isProjectileEntity,
  isStandable,
  isTool,
  isTrapdoor,
  isWoodenDoor,
  isWorkstation,
  type InteractionType,
} from "./classify.js";
import { looksLikeItemName, normalizeBlockName, normalizeItemName } from "./names.js";
import { nightRisk, sleepFacts, type SleepFacts, type SleepQuery } from "./sleep.js";

export class MinecraftKnowledge {
  readonly version: string;
  readonly data: McData;
  readonly recipes: KnowledgeRecipe[];
  readonly foods: Record<string, FoodInfo>;

  constructor(requestedVersion?: string) {
    this.data = loadMinecraftData(requestedVersion);
    this.version = this.data.version.minecraftVersion;
    this.recipes = mergeRecipes(
      recipesFromMinecraftData({
        recipes: this.data.recipes,
        items: this.data.items,
        itemsByName: this.data.itemsByName,
      }),
    );
    this.foods = foodIndex(this.data);
  }

  getItem(name: string): McItem | undefined {
    const n = this.normalizeItemName(name);
    return this.data.itemsByName[n];
  }

  /** Authoritative max stack size from minecraft-data. */
  stackSize(name: string): number {
    const item = this.getItem(name);
    if (!item) return 1;
    if (typeof item.stackSize === "number" && item.stackSize > 0) return item.stackSize;
    return 64;
  }

  getBlock(name: string): McBlock | undefined {
    const n = this.normalizeBlockName(name);
    return this.data.blocksByName[n];
  }

  getRecipesFor(item: string): KnowledgeRecipe[] {
    return recipesForItem(item, this.recipes);
  }

  getRecipe(item: string, inventory: IngredientBag = {}): KnowledgeRecipe | undefined {
    const matches = this.getRecipesFor(item);
    if (matches.length === 0) return undefined;
    return analyzeObtain(item, 1, inventory, this.recipes, true, Boolean(this.getItem(item))).chosen ?? matches[0];
  }

  getRecipes(item: string): KnowledgeRecipe[] {
    return this.getRecipesFor(item);
  }

  getRecipeInputs(item: string, inventory: IngredientBag = {}): IngredientBag {
    return { ...(this.getRecipe(item, inventory)?.ingredients ?? {}) };
  }

  getRecipeOutputCount(item: string): number {
    return this.getRecipe(item)?.resultCount ?? 0;
  }

  requiredWorkstation(item: string): "crafting_table" | undefined {
    const recipe = this.getRecipe(item);
    return recipe?.needsTable ? "crafting_table" : undefined;
  }

  isCraftable(item: string, inventory: IngredientBag, nearbyWorkstations: string[]): boolean {
    return this.canCraft(inventory, nearbyWorkstations, item);
  }

  preferredToolForInventory(block: string, inventory: Array<{ name: string; count: number }>) {
    return preferredAvailableTool(block, inventory, this.data);
  }

  isTool(item: string) {
    return isTool(item);
  }
  isReplaceable(block: string) {
    return isReplaceable(this.normalizeBlockName(block));
  }
  isPassable(block: string) {
    return isPassable(block, this.data);
  }
  isStandable(block: string) {
    return isStandable(block, this.data);
  }
  isContainer(block: string) {
    return isContainer(block);
  }
  isDoor(block: string) {
    return isDoor(block);
  }
  isWoodenDoor(block: string) {
    return isWoodenDoor(block);
  }
  isIronDoor(block: string) {
    return isIronDoor(block);
  }
  isFenceGate(block: string) {
    return isFenceGate(block);
  }
  isTrapdoor(block: string) {
    return isTrapdoor(block);
  }
  hasCollision(block: string) {
    return hasCollision(block, this.data);
  }
  canOccupyFeet(block: string) {
    return canOccupyFeet(block, this.data);
  }
  canStandOn(block: string) {
    return canStandOn(block, this.data);
  }
  isBed(block: string) {
    return isBed(block);
  }
  isWorkstation(block: string) {
    return isWorkstation(block);
  }
  isHazard(block: string) {
    return isHazard(block);
  }
  isHostileEntity(entity: string) {
    return isHostileEntity(entity, this.data);
  }
  isProjectileEntity(entity: string) {
    return isProjectileEntity(entity, this.data);
  }
  isDisposableScaffold(item: string) {
    return isDisposableScaffold(item);
  }
  interactionType(block: string): InteractionType {
    return interactionType(block);
  }
  entityAttitude(entity: string) {
    return entityAttitude(entity, this.data);
  }
  normalizeItemName(name: string) {
    return normalizeItemName(name);
  }
  normalizeBlockName(name: string) {
    return normalizeBlockName(name);
  }
  sleepFacts(query: SleepQuery): SleepFacts {
    return sleepFacts(query);
  }

  analyzeObtain(item: string, inventory: IngredientBag, nearbyWorkstations: string[], quantity = 1): ObtainAnalysis {
    const hasTable = nearbyWorkstations.includes("crafting_table");
    return analyzeObtain(item, quantity, inventory, this.recipes, hasTable, Boolean(this.getItem(item)) || looksLikeItemName(item) && this.getRecipesFor(item).length > 0);
  }

  factsForObtain(item: string, inventory: IngredientBag, nearbyWorkstations: string[]): string[] {
    return compactFacts(this.analyzeObtain(item, inventory, nearbyWorkstations).facts, 8);
  }

  nextObtainAction(item: string, inventory: IngredientBag, nearbyWorkstations: string[]): CraftPlanStep | { kind: "done"; item: string } | { kind: "unknown"; item: string } {
    const analysis = this.analyzeObtain(item, inventory, nearbyWorkstations);
    if (analysis.alreadyOwned) return { kind: "done", item: analysis.item };
    if (!analysis.known && analysis.recipes.length === 0 && !this.getItem(item)) return { kind: "unknown", item: analysis.item };
    return analysis.next ?? { kind: "done", item: analysis.item };
  }

  getIngredients(recipe: KnowledgeRecipe): IngredientBag {
    return { ...recipe.ingredients };
  }

  requiresCraftingTable(recipe: KnowledgeRecipe): boolean {
    return recipe.needsTable;
  }

  recipeExists(item: string): boolean {
    return this.getRecipesFor(item).length > 0;
  }

  getCraftingDependencies(
    item: string,
    inventory: IngredientBag = {},
    hasTable = false,
    quantity = 1,
  ): CraftPlanStep[] {
    return planCraft(item, quantity, inventory, this.recipes, hasTable);
  }

  canCraft(inventory: IngredientBag, nearbyWorkstations: string[], item: string): boolean {
    const hasTable = nearbyWorkstations.includes("crafting_table");
    const analysis = this.analyzeObtain(item, inventory, nearbyWorkstations);
    if (analysis.alreadyOwned) return true;
    if (!analysis.chosen) return false;
    if (analysis.chosen.needsTable && !hasTable) return false;
    return Object.entries(analysis.chosen.ingredients).every(([name, need]) => countOf(inventory, name) >= need);
  }

  planFor(item: string, inventory: IngredientBag, nearbyInfrastructure: string[]): CraftPlanStep[] {
    const hasTable = nearbyInfrastructure.includes("crafting_table");
    return this.getCraftingDependencies(item, inventory, hasTable);
  }

  preferredTool(block: string) {
    return preferredTool(block, this.data);
  }
  requiredTool(block: string) {
    return requiredTool(block, this.data);
  }
  canHarvest(block: string, tool?: string) {
    return canHarvest(this.normalizeBlockName(block), tool ? this.normalizeItemName(tool) : undefined, this.data);
  }
  breakTime(block: string, tool?: string) {
    return breakTime(block, tool, this.data);
  }
  isSolid(block: string) {
    return isSolid(block, this.data);
  }
  isClimbable(block: string) {
    return isClimbable(block);
  }
  isDangerous(name: string) {
    return isDangerousBlock(name) || classifyHazard(name).dangerous;
  }

  isFood(item: string) {
    const n = this.normalizeItemName(item);
    return isFood(n, this.foods) || isFood(item, this.foods);
  }
  foodValue(item: string) {
    return foodValue(item, this.foods);
  }
  saturationValue(item: string) {
    return saturationValue(item, this.foods);
  }
  canEatNow(citizenState: { hunger?: number }, item: string) {
    return canEatNow({ hunger: citizenState.hunger, item }, this.foods);
  }
  getFoodOptions(inventory: Array<{ name: string; count: number }>) {
    return getFoodOptions(inventory, this.foods);
  }

  classifyTimeOfDay(timeOfDay: number): TimePeriod {
    return classifyTimeOfDay(timeOfDay);
  }
  ticksUntil(period: TimePeriod, timeOfDay: number) {
    return ticksUntil(period, timeOfDay);
  }
  getThreatInfo(entity: string) {
    return getThreatInfo(entity);
  }
  classifyHazard(blockOrEntity: string) {
    if (isDangerousBlock(blockOrEntity)) {
      return { kind: "block" as const, dangerous: true, reason: `${blockOrEntity} damages citizens on contact.` };
    }
    return classifyHazard(blockOrEntity);
  }

  interpretVillageFeature = interpretVillageFeature;
  villageChestImpliesOwnership = villageChestImpliesOwnership;
  classifyBlockUse = classifyBlockUse;

  getRelevantRules(query: RelevantQuery): RelevantGameKnowledge {
    const facts: string[] = [];
    const goal = query.goal ?? "";
    const inv = Object.fromEntries((query.inventory ?? []).map((item) => [item.name, item.count]));
    const hasPickaxe = query.hasPickaxe ?? Object.keys(inv).some((name) => name.includes("pickaxe"));
    const tableNearby = Boolean(query.hasCraftingTableNearby);

    if (goal.includes("stone") || query.nearbyBlocks?.some((name) => name === "stone" || name === "cobblestone")) {
      facts.push("Stone normally requires a pickaxe to collect.");
      facts.push(hasPickaxe ? "Citizen has a pickaxe." : "Citizen has no pickaxe.");
      if (!hasPickaxe) {
        const plan = this.planFor("wooden_pickaxe", inv, tableNearby ? ["crafting_table"] : []);
        const needTable = plan.some((step) => step.kind === "ensure_table" || (step.kind === "craft" && step.needsTable));
        if (needTable) facts.push(tableNearby ? "A crafting table is nearby." : "Wooden tools need a crafting table.");
        const planks = Object.entries(inv)
          .filter(([name]) => name.endsWith("_planks"))
          .reduce((sum, [, count]) => sum + count, 0);
        const sticks = inv.stick ?? 0;
        facts.push(`Citizen has ${planks} planks and ${sticks} sticks.`);
      }
    }
    if (goal.includes("craft") || goal.includes("tool") || goal.includes("pickaxe")) {
      const plan = this.planFor("wooden_pickaxe", inv, tableNearby ? ["crafting_table"] : []);
      facts.push(`Wooden pickaxe plan: ${summarizePlan(plan)}`);
    }
    if (goal.includes("food") || (query.hunger ?? 20) <= 10) {
      const foods = this.getFoodOptions(query.inventory ?? []);
      facts.push(foods.length ? `Edible items held: ${foods.map((food) => food.name).join(", ")}.` : "No edible items in inventory.");
      facts.push("Eating requires possessing an edible item.");
    }
    for (const entity of query.nearbyEntities ?? []) {
      const info = this.getThreatInfo(entity);
      if (info.attitude === "HOSTILE" || info.threat !== "none") facts.push(`${info.name}: ${info.notes}`);
    }
    for (const block of query.nearbyBlocks ?? []) {
      if (isDangerousBlock(block)) facts.push(`${block} is physically dangerous.`);
      if (classifyBlockUse(block) === "crafting_table") facts.push("A crafting table enables 3x3 recipes.");
      if (classifyBlockUse(block) === "chest") facts.push("A chest stores physical items. Presence is not ownership.");
    }
    if (goal.includes("door") || goal.includes("shelter") || goal.includes("build")) {
      facts.push(...this.factsForObtain("oak_door", inv, tableNearby ? ["crafting_table"] : []));
    }
    if (goal.includes("night") || goal.includes("shelter")) {
      facts.push("Night increases hostile-mob risk; it does not force a single action.");
      if (typeof query.timeOfDay === "number") {
        facts.push(nightRisk(query.timeOfDay) ? "It is currently a risky time of day." : "It is currently daytime.");
      }
    }
    return { goal: query.goal, facts: compactFacts(facts), source: "minecraft-mechanics" };
  }
}

function summarizePlan(steps: CraftPlanStep[]): string {
  if (steps.length === 0) return "already craftable or owned";
  return steps
    .map((step) => {
      if (step.kind === "gather") return `gather ${step.item}`;
      if (step.kind === "ensure_table") return "need crafting table";
      return `craft ${step.item}`;
    })
    .join(" → ");
}

let singleton: MinecraftKnowledge | undefined;

export function createMinecraftKnowledge(version?: string): MinecraftKnowledge {
  return new MinecraftKnowledge(version);
}

export function minecraftKnowledge(): MinecraftKnowledge {
  singleton ??= new MinecraftKnowledge();
  return singleton;
}

export const crafting = {
  planFor: (item: string, inventory: IngredientBag, nearbyInfrastructure: string[]) =>
    minecraftKnowledge().planFor(item, inventory, nearbyInfrastructure),
  getRecipesFor: (item: string) => minecraftKnowledge().getRecipesFor(item),
};

export const food = {
  getOptions: (inventory: Array<{ name: string; count: number }>) => minecraftKnowledge().getFoodOptions(inventory),
  isFood: (item: string) => minecraftKnowledge().isFood(item),
};

export const world = {
  classifyHazard: (name: string) => minecraftKnowledge().classifyHazard(name),
};

export const entity = {
  getThreatInfo: (name: string) => minecraftKnowledge().getThreatInfo(name),
};

export {
  resolveMinecraftVersion,
  overlayRecipes,
  SURVIVAL_RULES,
  WORLD_CONSTRAINTS,
  nightIncreasesHostileRisk,
};
export {
  PLANKS,
  LOGS,
  LOG_TO_PLANKS,
  countOf,
  recipesFromMinecraftData,
  cellIngredientIds,
  cellIngredientName,
} from "./crafting.js";
export { interpretVillageFeature, villageChestImpliesOwnership } from "./village.js";
export { normalizeItemName, normalizeBlockName, friendlyName } from "./names.js";
export { sleepFacts } from "./sleep.js";
export type { SleepFacts, SleepQuery } from "./sleep.js";
export type {
  CraftPlanStep,
  IngredientBag,
  KnowledgeRecipe,
  ObtainAnalysis,
  RelevantGameKnowledge,
  RelevantQuery,
  TimePeriod,
  InteractionType,
};
