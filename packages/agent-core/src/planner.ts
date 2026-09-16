import type { BodyObservation, DecisionSource, SettlementNeed, SettlementState } from "@civ/shared";

export type PlannedTask = {
  goal: string;
  task: string;
  action: string;
  source: DecisionSource;
  reason: string;
  priority: number;
  occupation?: string;
};

export type PlannerInput = {
  citizenId: string;
  observation: BodyObservation;
  settlement: SettlementState;
  assignedNeeds: SettlementNeed[];
  llmGoal?: string;
  llmReason?: string;
};

const TOOL_PICKAXES = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const TOOL_AXES = ["wooden_axe", "stone_axe", "iron_axe"];
const LOG_ITEMS = ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"];
const FOOD_ITEMS = ["apple", "bread", "cooked_beef", "cooked_porkchop", "cooked_chicken", "beef", "porkchop", "chicken", "sweet_berries", "carrot"];

function count(obs: BodyObservation, names: string[]): number {
  const set = new Set(names);
  return obs.inventory.filter((i) => set.has(i.name)).reduce((sum, i) => sum + i.count, 0);
}

function hasAny(obs: BodyObservation, names: string[]): boolean {
  return count(obs, names) > 0;
}

function inventorySlots(obs: BodyObservation): number {
  return obs.inventory.reduce((sum, i) => sum + Math.ceil(i.count / 64), 0);
}

export function planCitizen(input: PlannerInput): PlannedTask {
  const { observation: obs, settlement, assignedNeeds, llmGoal, llmReason } = input;
  const hostile = obs.nearby.find((e) => e.hostile && e.distance < 10);
  const foodCount = count(obs, FOOD_ITEMS) + settlement.food;

  if ((obs.health ?? 20) <= 6 && hostile) {
    return task("survive", "flee_danger", "flee", "reflex", "Critical health near a hostile", 1.0);
  }
  if ((obs.health ?? 20) <= 4) {
    return task("survive", "flee_danger", "flee", "reflex", "Health is critically low", 0.98);
  }
  if ((obs.food ?? 20) <= 7 && hasAny(obs, FOOD_ITEMS)) {
    return task("survive", "eat", "eatFood", "reflex", "Hunger is low and food is in inventory", 0.95);
  }
  if ((obs.food ?? 20) <= 8 && !hasAny(obs, FOOD_ITEMS)) {
    return task("survive", "acquire_food", "gatherFood", "reflex", "Hunger is low and inventory has no food", 0.93);
  }
  if (hostile && hostile.name.includes("creeper") && hostile.distance < 8) {
    return task("survive", "flee_danger", "flee", "reflex", "Creeper is too close", 0.92, "guard");
  }
  if (hostile && hostile.distance < 6) {
    return task("survive", "defend", "attack", "reflex", `Hostile ${hostile.name} is nearby`, 0.9, "guard");
  }
  if (obs.isNight && !settlement.shelterComplete) {
    const hasWood = hasAny(obs, LOG_ITEMS) || hasAny(obs, ["oak_planks", "spruce_planks", "birch_planks"]);
    if (!hasWood) {
      return task("survive", "gather_wood", "mineBlock", "planner", "Night is coming and we still need wood for shelter", 0.88, "lumberjack");
    }
    return task("survive", "seek_shelter", "buildShelter", "planner", "Night without a finished shelter", 0.88, "builder");
  }
  if (inventorySlots(obs) >= 30) {
    return task("survive", "deposit", "depositItems", "reflex", "Inventory is nearly full", 0.86);
  }

  if (llmGoal && llmReason) {
    return task(llmGoal, llmGoal, llmGoal, "llm", llmReason, 0.8);
  }

  if (!hasAny(obs, TOOL_PICKAXES) && !hasAny(obs, LOG_ITEMS) && count(obs, ["oak_planks", "spruce_planks", "birch_planks"]) < 8) {
    return task("bootstrap", "gather_wood", "mineBlock", "planner", "Need logs to craft the first tools", 0.84, "lumberjack");
  }
  if (!hasAny(obs, TOOL_PICKAXES) && (hasAny(obs, LOG_ITEMS) || hasAny(obs, ["oak_planks"]))) {
    return task("bootstrap", "craft_tools", "craftItem", "planner", "Have wood; craft a pickaxe", 0.83, "crafter");
  }

  const need = assignedNeeds[0];
  if (need === "NEED_FOOD" || foodCount < 8) {
    return task("settlement", "gather_food", "gatherFood", "planner", "Settlement food reserves are low", 0.7, "gatherer");
  }
  if (need === "NEED_WOOD" || settlement.wood < 24) {
    return task("settlement", "gather_wood", "mineBlock", "planner", "Settlement needs more wood", 0.68, "lumberjack");
  }
  if (need === "NEED_STONE" || (hasAny(obs, TOOL_PICKAXES) && settlement.stone < 16)) {
    return task("settlement", "mine_stone", "mineBlock", "planner", "Settlement needs stone", 0.66, "miner");
  }
  if (need === "NEED_TOOLS") {
    return task("settlement", "craft_tools", "craftItem", "planner", "Settlement needs tools", 0.64, "crafter");
  }
  if (need === "NEED_HOUSING" || need === "NEED_BEDS") {
    return task("settlement", "build_shelter", "buildShelter", "planner", "Settlement needs housing", 0.72, "builder");
  }
  if (!hasAny(obs, TOOL_AXES) && hasAny(obs, LOG_ITEMS)) {
    return task("bootstrap", "craft_tools", "craftItem", "planner", "Craft an axe for faster gathering", 0.6, "crafter");
  }

  return task("idle", "observe", "observeNearby", "planner", "No urgent need; survey surroundings", 0.2);
}

function task(
  goal: string,
  taskName: string,
  action: string,
  source: DecisionSource,
  reason: string,
  priority: number,
  occupation?: string,
): PlannedTask {
  return { goal, task: taskName, action, source, reason, priority, occupation };
}

export function assignSettlementNeeds(
  citizenIds: string[],
  needs: SettlementNeed[],
): Map<string, SettlementNeed[]> {
  const unique = [...new Set(needs)];
  const map = new Map<string, SettlementNeed[]>();
  for (const id of citizenIds) map.set(id, []);
  unique.forEach((need, index) => {
    const owner = citizenIds[index % citizenIds.length];
    if (!owner) return;
    map.get(owner)?.push(need);
  });
  return map;
}
