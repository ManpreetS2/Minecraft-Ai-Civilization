import {
  canHarvest,
  isClimbable,
  isDangerousBlock,
  isReplaceable,
  isSolid,
  preferredTool,
  requiredTool,
  breakTime,
} from "./blocks.js";
import {
  canCraftFromPlan,
  mergeRecipes,
  overlayRecipes,
  planCraft,
  recipesFromMinecraftData,
  type CraftPlanStep,
  type IngredientBag,
  type KnowledgeRecipe,
} from "./crafting.js";
import { loadMinecraftData, resolveMinecraftVersion, type McData } from "./data.js";
import { canEatNow, foodIndex, foodValue, getFoodOptions, isFood, saturationValue, type FoodInfo } from "./food.js";
import { classifyHazard, getThreatInfo } from "./mobs.js";
import { compactFacts, type RelevantGameKnowledge, type RelevantQuery } from "./relevant.js";
import { classifyTimeOfDay, nightIncreasesHostileRisk, SURVIVAL_RULES, ticksUntil, type TimePeriod } from "./survival.js";
import { interpretVillageFeature, villageChestImpliesOwnership } from "./village.js";
import { classifyBlockUse, WORLD_CONSTRAINTS } from "./world.js";

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

  getRecipesFor(item: string): KnowledgeRecipe[] {
    return this.recipes.filter((recipe) => recipe.result === item);
  }

  getIngredients(recipe: KnowledgeRecipe): IngredientBag {
    return { ...recipe.ingredients };
  }

  requiresCraftingTable(recipe: KnowledgeRecipe): boolean {
    return recipe.needsTable;
  }

  getCraftingDependencies(item: string, inventory: IngredientBag = {}, hasTable = false): CraftPlanStep[] {
    return planCraft(item, 1, inventory, this.recipes, hasTable);
  }

  canCraft(inventory: IngredientBag, nearbyWorkstations: string[], item: string): boolean {
    const hasTable = nearbyWorkstations.includes("crafting_table") || (inventory.crafting_table ?? 0) > 0;
    const steps = this.getCraftingDependencies(item, inventory, hasTable);
    return canCraftFromPlan(steps);
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
    return canHarvest(block, tool, this.data);
  }
  breakTime(block: string, tool?: string) {
    return breakTime(block, tool, this.data);
  }
  isReplaceable(block: string) {
    return isReplaceable(block);
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
    return isFood(item, this.foods);
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
    if (goal.includes("night") || goal.includes("shelter")) {
      facts.push("Night increases hostile-mob risk; it does not force a single action.");
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
export { interpretVillageFeature, villageChestImpliesOwnership } from "./village.js";
export type { CraftPlanStep, IngredientBag, KnowledgeRecipe, RelevantGameKnowledge, RelevantQuery, TimePeriod };
