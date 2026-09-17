import type { BodyObservation, DecisionSource, SettlementNeed, SettlementState } from "@civ/shared";
import { FOOD_ITEM_NAMES } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { intentToPlan, type DirectiveIntent, type DirectiveMode } from "./directive-parse.js";

export type PlannedTask = {
  goal: string;
  task: string;
  action: string;
  source: DecisionSource;
  reason: string;
  priority: number;
  occupation?: string;
  directiveId?: string;
  item?: string;
};

export type WorkRole = "wood" | "food" | "stone" | "tools" | "build";

export type PlannerInput = {
  citizenId: string;
  observation: BodyObservation;
  settlement: SettlementState;
  assignedNeeds: SettlementNeed[];
  workRole?: WorkRole;
  llmGoal?: string;
  llmReason?: string;
  projectStatus?: string;
  humanDirective?: {
    id: string;
    intent: DirectiveIntent;
    mode: DirectiveMode;
    args?: Record<string, string>;
  };
};

const TOOL_PICKAXES = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const TOOL_AXES = ["wooden_axe", "stone_axe", "iron_axe"];
const LOG_ITEMS = ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"];

const LLM_MAP: Record<string, { task: string; action: string }> = {
  gather_wood: { task: "gather_wood", action: "mineBlock" },
  gather_food: { task: "gather_food", action: "gatherFood" },
  mine_stone: { task: "mine_stone", action: "mineBlock" },
  craft_tools: { task: "craft_tools", action: "craftItem" },
  build_shelter: { task: "build_shelter", action: "buildShelter" },
  contribute_to_project: { task: "build_shelter", action: "buildShelter" },
  obtain_item: { task: "obtain_item", action: "obtainItem" },
  help_citizen: { task: "help_citizen", action: "shareItem" },
  assist_citizen: { task: "help_citizen", action: "shareItem" },
  deposit: { task: "deposit", action: "depositItems" },
  use_storage: { task: "deposit", action: "depositItems" },
  rest: { task: "seek_shelter", action: "seekSafety" },
  seek_safety: { task: "seek_shelter", action: "seekSafety" },
  explore: { task: "observe", action: "observeNearby" },
  defend: { task: "defend", action: "attack" },
  survive: { task: "acquire_food", action: "gatherFood" },
};

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

/** Personal carried food only. Settlement reserve is a different fact. */
export function personalFoodCount(obs: BodyObservation): number {
  const knowledge = minecraftKnowledge();
  return obs.inventory
    .filter((i) => knowledge.isFood(i.name) || FOOD_ITEM_NAMES.has(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}

export function planCitizen(input: PlannerInput): PlannedTask {
  const { observation: obs, settlement, assignedNeeds, llmGoal, llmReason, workRole, projectStatus, humanDirective } = input;
  const hostile = obs.nearby.find((e) => e.hostile && e.distance < 10);
  const heldFood = personalFoodCount(obs);
  const shelterReady = settlement.shelterComplete || projectStatus === "COMPLETED";
  const emergency = Boolean(((obs.health ?? 20) <= 6 && hostile) || (obs.health ?? 20) <= 4);

  if ((obs.health ?? 20) <= 6 && hostile) {
    return task("survive", "flee_danger", "flee", "reflex", "Critical health near a hostile", 1.0);
  }
  if ((obs.health ?? 20) <= 4) {
    return task("survive", "flee_danger", "flee", "reflex", "Health is critically low", 0.98);
  }
  if ((obs.food ?? 20) <= 7 && heldFood > 0) {
    return task("survive", "eat", "eatFood", "reflex", "Hunger is low and food is in inventory", 0.95);
  }
  if ((obs.food ?? 20) <= 8 && heldFood === 0) {
    const stored = Object.entries(settlement.storageContents ?? {}).some(
      ([name, qty]) => FOOD_ITEM_NAMES.has(name) && Number(qty) > 0,
    );
    if (stored) {
      return task("survive", "withdraw_food", "withdrawItems", "reflex", "Hunger is low; food is in shared storage", 0.94);
    }
    return task("survive", "acquire_food", "gatherFood", "reflex", "Hunger is low and inventory has no food", 0.93);
  }
  if (hostile && hostile.distance < 8) {
    return task("survive", "flee_danger", "flee", "reflex", `Hostile ${hostile.name} is too close`, 0.92, "guard");
  }

  if (humanDirective && humanDirective.mode !== "SUGGESTION" && !emergency) {
    const mapped = intentToPlan(humanDirective.intent, humanDirective.args);
    const planned = task(
      mapped.goal,
      mapped.task,
      mapped.action,
      "planner",
      `Human ${humanDirective.mode.toLowerCase()}: ${humanDirective.intent}`,
      humanDirective.mode === "ADMIN_OVERRIDE" ? 0.97 : 0.91,
    );
    planned.directiveId = humanDirective.id;
    planned.item = humanDirective.args?.item;
    return planned;
  }

  if (obs.isNight && hostile) {
    return task("survive", "seek_shelter", "seekSafety", "planner", "Night with nearby danger; use cover", 0.8);
  }
  if (obs.isNight && shelterReady) {
    return task("survive", "seek_shelter", "seekSafety", "planner", "Night; a usable shelter exists", 0.78);
  }
  if (obs.isNight && !shelterReady) {
    if (workRole === "build" || assignedNeeds.includes("NEED_HOUSING")) {
      return task("survive", "build_shelter", "buildShelter", "planner", "Night; keep the starter shelter moving", 0.8, "builder");
    }
    return task("survive", "seek_shelter", "seekSafety", "planner", "Night without a finished shelter; use nearby cover", 0.79);
  }

  if (inventorySlots(obs) >= 30) {
    return task("survive", "deposit", "depositItems", "reflex", "Inventory is nearly full", 0.86);
  }

  if (llmGoal && llmReason) {
    const mapped = LLM_MAP[llmGoal] ?? { task: llmGoal, action: llmGoal };
    return task(llmGoal, mapped.task, mapped.action, "llm", llmReason, 0.8);
  }

  if (!hasAny(obs, TOOL_PICKAXES) && !hasAny(obs, LOG_ITEMS) && count(obs, ["oak_planks", "spruce_planks", "birch_planks"]) < 4) {
    return task("bootstrap", "gather_wood", "mineBlock", "planner", "Need logs to craft the first tools", 0.84, "lumberjack");
  }
  if (!hasAny(obs, TOOL_PICKAXES) && (hasAny(obs, LOG_ITEMS) || hasAny(obs, ["oak_planks"]))) {
    return task("bootstrap", "craft_tools", "craftItem", "planner", "Have wood; craft a pickaxe through the recipe chain", 0.83, "crafter");
  }

  if (!settlement.storage && (hasAny(obs, LOG_ITEMS) || count(obs, ["oak_planks"]) >= 8) && workRole === "build") {
    return task("settlement", "craft_chest", "craftItem", "planner", "Settlement needs shared storage", 0.74, "builder");
  }

  if (workRole === "food" || assignedNeeds[0] === "NEED_FOOD") {
    return task("settlement", "gather_food", "gatherFood", "planner", "Assigned to obtain food", 0.7, "gatherer");
  }
  if (workRole === "wood" || assignedNeeds[0] === "NEED_WOOD") {
    return task("settlement", "gather_wood", "mineBlock", "planner", "Assigned to gather wood", 0.68, "lumberjack");
  }
  if (workRole === "stone" || assignedNeeds[0] === "NEED_STONE") {
    if (!hasAny(obs, TOOL_PICKAXES)) {
      return task("bootstrap", "craft_tools", "craftItem", "planner", "Need a pickaxe before mining stone", 0.67, "crafter");
    }
    return task("settlement", "mine_stone", "mineBlock", "planner", "Assigned to mine stone", 0.66, "miner");
  }
  if (workRole === "tools" || assignedNeeds[0] === "NEED_TOOLS") {
    return task("settlement", "craft_tools", "craftItem", "planner", "Assigned to craft tools", 0.64, "crafter");
  }
  if ((workRole === "build" || assignedNeeds[0] === "NEED_HOUSING" || assignedNeeds[0] === "NEED_BEDS") && !shelterReady) {
    return task("settlement", "build_shelter", "buildShelter", "planner", "Assigned to the starter shelter", 0.72, "builder");
  }

  if (!shelterReady && settlement.wood >= 16) {
    return task("settlement", "build_shelter", "buildShelter", "planner", "Enough wood to start the shelter", 0.62, "builder");
  }
  if (!hasAny(obs, TOOL_AXES) && hasAny(obs, LOG_ITEMS)) {
    return task("bootstrap", "craft_tools", "craftItem", "planner", "Craft an axe for faster gathering", 0.6, "crafter");
  }
  if (heldFood >= 4 && settlement.storage) {
    return task("settlement", "deposit", "depositItems", "planner", "Store surplus in the settlement chest", 0.45);
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

const ROLES: WorkRole[] = ["wood", "food", "stone", "tools", "build"];

export function assignWorkRoles(citizenIds: string[]): Map<string, WorkRole> {
  const map = new Map<string, WorkRole>();
  citizenIds.forEach((id, index) => {
    map.set(id, ROLES[index % ROLES.length] ?? "wood");
  });
  return map;
}
