import type { BodyObservation, DecisionSource, SettlementNeed, SettlementState, Vec3 } from "@civ/shared";
import { FOOD_ITEM_NAMES } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { intentToPlan, type DirectiveIntent, type DirectiveMode } from "./directive-parse.js";
import {
  chooseActivity,
  plannedTaskFromOption,
  type ActivityChoiceInput,
  type DecisionTrace,
} from "./activity-choice.js";
import type { CatalogHome } from "./available-homes.js";
import { HOME_CLAIM_REACH_BLOCKS } from "./available-homes.js";
import { housingOpportunity, housingTravelTarget } from "./home-discovery.js";
import { nearestReachableSite, type DiscoveredSite } from "./discovered-sites.js";
import { evaluateCitizenCurfew, planCurfewBedtimeAction, workHandoffToCurfew } from "./curfew-runtime.js";
import { shouldBackoffToObserve, suppressedHomeIds, type UnresolvedBlock } from "./task-recovery.js";
import {
  foodSearchBackoffReason,
  homeSleepBackoffReason,
  shouldBackoffFoodSearch,
  shouldBackoffHomeSleepRoute,
} from "./failure-backoff.js";
import { plannedTaskForConstructionProject, type BuildStructureProject } from "./build-structure.js";

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
  target?: { x: number; y: number; z: number };
  count?: number;
  blocked?: { code: string; missing: string };
  trace?: DecisionTrace;
};

export type WorkRole = "wood" | "food" | "stone" | "tools" | "build";

export type LastOutcome = {
  task: string;
  action: string;
  success: boolean;
  code?: string;
  error?: string;
  item?: string;
  nextTask?: string;
  nextAction?: string;
  streak: number;
  retryable?: boolean;
  workComplete?: boolean;
  skillStatus?: string;
  collected?: number;
  unresolved?: UnresolvedBlock[];
};

export type PlannerInput = {
  citizenId: string;
  observation: BodyObservation;
  settlement: SettlementState;
  assignedNeeds: SettlementNeed[];
  workRole?: WorkRole;
  llmGoal?: string;
  llmReason?: string;
  projectStatus?: string;
  /** Active structure project owned by this citizen — resumes without human injection. */
  constructionProject?: BuildStructureProject;
  lastOutcome?: LastOutcome;
  /** Already-claimed home. Planner never assigns houses by roster; selection stays UNVERIFIED. */
  home?: {
    homeId: string;
    bed: { x: number; y: number; z: number };
    status: "active" | "displaced" | "left";
    entrance?: { x: number; y: number; z: number };
    origin?: { x: number; y: number; z: number };
    personalChest?: { x: number; y: number; z: number };
  };
  knownSites?: DiscoveredSite[];
  visibleShores?: Array<{ stand: Vec3; water: Vec3 }>;
  authorizedStorage?: Vec3;
  /** Unclaimed catalog houses. Never a roster map and never hardcoded to H1. */
  availableHomes?: CatalogHome[];
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
  mine_ore: { task: "mine_ore", action: "mineOre" },
  fish_shore: { task: "fish_shore", action: "fishShore" },
  work_farm: { task: "work_farm", action: "workFarmPlot" },
  claim_home: { task: "claim_home", action: "claimHome" },
  craft_tools: { task: "craft_tools", action: "craftItem" },
  build_shelter: { task: "build_shelter", action: "buildShelter" },
  build_structure: { task: "build_structure", action: "buildStructure" },
  contribute_to_project: { task: "build_structure", action: "buildStructure" },
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
    // Day 2: hunger reflex re-issued gatherFood ~362× after FOOD_NOT_FOUND. Bound the loop.
    if (shouldBackoffFoodSearch(input.lastOutcome)) {
      const hasRod = obs.inventory.some((item) => item.name === "fishing_rod");
      const shore = input.visibleShores?.[0]?.stand;
      if (hasRod && shore) {
        const planned = task(
          "survive",
          "fish_shore",
          "fishShore",
          "reflex",
          `Hunger low; land food search exhausted — try fishing at a visible shore`,
          0.92,
          "gatherer",
        );
        planned.target = shore;
        return planned;
      }
      return task("idle", "observe", "observeNearby", "reflex", foodSearchBackoffReason(input.lastOutcome!), 0.4);
    }
    return task("survive", "acquire_food", "gatherFood", "reflex", "Hunger is low and inventory has no food", 0.93);
  }
  if (hostile && hostile.distance < 8) {
    return task("survive", "flee_danger", "flee", "reflex", `Hostile ${hostile.name} is too close`, 0.92, "guard");
  }

  if (humanDirective && humanDirective.mode === "ADMIN_OVERRIDE" && !emergency) {
    const mapped = intentToPlan(humanDirective.intent, humanDirective.args);
    const planned = task(
      mapped.goal,
      mapped.task,
      mapped.action,
      "planner",
      `Human admin override: ${humanDirective.intent}`,
      0.97,
    );
    planned.directiveId = humanDirective.id;
    planned.item = humanDirective.args?.item ?? (mapped.task === "obtain_item" ? mapped.goal : undefined);
    return planned;
  }

  // Resume owned structure intention (procurement or build) before generic settlement work.
  if (!emergency) {
    const constructionPlan = plannedTaskForConstructionProject(input.constructionProject, input.citizenId);
    if (constructionPlan) return constructionPlan;
  }

  const curfew = evaluateCitizenCurfew({
    home: input.home,
    position: obs.position,
    timeOfDay: obs.gameTime,
    isNight: obs.isNight,
  });
  const bedtime = planCurfewBedtimeAction({ curfew, timeOfDay: obs.gameTime });
  if (bedtime) {
    // Day 2: sleep_at_home retried 19× on the same blocked route (crafting_table). Bound it.
    if (shouldBackoffHomeSleepRoute(input.lastOutcome)) {
      return task("idle", "observe", "observeNearby", "planner", homeSleepBackoffReason(input.lastOutcome!), 0.42);
    }
    const planned = task("rest", bedtime.task, bedtime.action, "planner", bedtime.reason, 0.88);
    planned.target = bedtime.target;
    return planned;
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
    planned.item = humanDirective.args?.item ?? (mapped.task === "obtain_item" ? mapped.goal : undefined);
    return planned;
  }

  const corrective = correctiveFromFailure(input);
  if (corrective && !emergency) return corrective;

  if (obs.isNight && hostile) {
    return task("survive", "seek_shelter", "seekSafety", "planner", "Night with nearby danger; use cover", 0.8);
  }
  if (obs.isNight && (!input.home || input.home.status !== "active")) {
    // Prefer catalog housing travel/claim over local seek_shelter. Day-1 evidence: seekSafety
    // failed instantly (no nearby cover) then corrective forced buildShelter while exposed.
    const nightHousing = planHomelessHousing(input);
    if (nightHousing) return nightHousing;
    if (shelterReady) {
      return task("survive", "seek_shelter", "seekSafety", "planner", "Night with no claimed home; use nearby cover, do not invent H1", 0.78);
    }
    if (workRole === "build" || assignedNeeds.includes("NEED_HOUSING")) {
      return task("survive", "build_shelter", "buildShelter", "planner", "Night; keep the starter shelter moving", 0.8, "builder");
    }
    return task("survive", "seek_shelter", "seekSafety", "planner", "Night without a claimed home or finished shelter; use nearby cover", 0.79);
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

  const housing = planHomelessHousing(input);
  if (housing && !emergency) return housing;

  if (inventorySlots(obs) >= 30) {
    return task("survive", "deposit", "depositItems", "reflex", "Inventory is nearly full", 0.86);
  }

  if (llmGoal && llmReason) {
    const mapped = LLM_MAP[llmGoal] ?? { task: llmGoal, action: llmGoal };
    const planned = task(llmGoal, mapped.task, mapped.action, "llm", llmReason, 0.8);
    return attachDiscoveredTarget(planned, input);
  }

  if (!hasAny(obs, TOOL_PICKAXES) && !hasAny(obs, LOG_ITEMS) && count(obs, ["oak_planks", "spruce_planks", "birch_planks"]) < 4) {
    return task("bootstrap", "gather_wood", "mineBlock", "planner", "Need logs to craft the first tools", 0.84, "lumberjack");
  }
  if (!hasAny(obs, TOOL_PICKAXES) && (hasAny(obs, LOG_ITEMS) || hasAny(obs, ["oak_planks"]))) {
    const planned = task("bootstrap", "obtain_item", "obtainItem", "planner", "Have wood; craft a pickaxe through the recipe chain", 0.83, "crafter");
    planned.item = "wooden_pickaxe";
    return planned;
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
      const planned = task("bootstrap", "obtain_item", "obtainItem", "planner", "Need a pickaxe before mining stone", 0.67, "crafter");
      planned.item = "wooden_pickaxe";
      return planned;
    }
    return task("settlement", "mine_stone", "mineBlock", "planner", "Assigned to mine stone", 0.66, "miner");
  }
  if (workRole === "tools" || assignedNeeds[0] === "NEED_TOOLS") {
    const planned = task("settlement", "obtain_item", "obtainItem", "planner", "Assigned to craft tools", 0.64, "crafter");
    planned.item = hasAny(obs, TOOL_PICKAXES) ? "stone_pickaxe" : "wooden_pickaxe";
    return planned;
  }
  if ((workRole === "build" || assignedNeeds[0] === "NEED_HOUSING" || assignedNeeds[0] === "NEED_BEDS") && !shelterReady) {
    return task("settlement", "build_shelter", "buildShelter", "planner", "Assigned to the starter shelter", 0.72, "builder");
  }

  if (!shelterReady && settlement.wood >= 16) {
    return task("settlement", "build_shelter", "buildShelter", "planner", "Enough wood to start the shelter", 0.62, "builder");
  }
  if (!hasAny(obs, TOOL_AXES) && hasAny(obs, LOG_ITEMS)) {
    const planned = task("bootstrap", "obtain_item", "obtainItem", "planner", "Craft an axe for faster gathering", 0.6, "crafter");
    planned.item = "wooden_axe";
    return planned;
  }
  if (heldFood >= 4 && settlement.storage) {
    return task("settlement", "deposit", "depositItems", "planner", "Store surplus in the settlement chest", 0.45);
  }

  if (!workRole) {
    return autonomousWork(input);
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

function activityHome(home: PlannerInput["home"]): ActivityChoiceInput["home"] {
  if (!home) return undefined;
  return {
    homeId: home.homeId,
    bed: home.bed,
    status: home.status,
    origin: home.origin ?? home.bed,
    entrance: home.entrance,
    personalChest: home.personalChest,
  };
}

function autonomousWork(input: PlannerInput): PlannedTask {
  const { option, trace } = chooseActivity(activityInput(input));
  if (option.id === "fish_shore" && !option.target) {
    const blocked = task(
      "blocked",
      "blocked",
      "blocked",
      "planner",
      "BLOCKED: fishing chosen without a discovered shore",
      0.3,
    );
    blocked.blocked = { code: "SEARCH_EXHAUSTED", missing: "reachable_shore" };
    blocked.trace = trace;
    return blocked;
  }
  const planned = plannedTaskFromOption(option);
  planned.trace = trace;
  if (trace.blocked.length > 0 && option.id === "observe") {
    planned.reason = `${trace.blocked.map((entry) => entry.reason).join("; ")}; surveying instead`;
  }
  return planned;
}

function attachDiscoveredTarget(planned: PlannedTask, input: PlannerInput): PlannedTask {
  if (planned.action === "fishShore" && !planned.target) {
    const { option, trace } = chooseActivity({ ...activityInput(input), settlementFoodNeed: true });
    planned.trace = trace;
    if (option.action === "fishShore" && option.target) {
      planned.target = option.target;
      return planned;
    }
    planned.action = "blocked";
    planned.task = "blocked";
    planned.goal = "blocked";
    planned.reason = "BLOCKED: llm asked to fish but no discovered reachable shore";
    planned.blocked = { code: "SEARCH_EXHAUSTED", missing: "reachable_shore" };
    return planned;
  }
  if (planned.action === "mineOre") {
    if (!hasAny(input.observation, TOOL_PICKAXES)) {
      planned.action = "blocked";
      planned.task = "blocked";
      planned.goal = "blocked";
      planned.reason = "BLOCKED: llm asked to mine ore but no pickaxe is held";
      planned.blocked = { code: "MISSING_TOOL", missing: "pickaxe" };
      return planned;
    }
    if (!input.authorizedStorage) {
      planned.action = "blocked";
      planned.task = "blocked";
      planned.goal = "blocked";
      planned.reason = "BLOCKED: llm asked to mine ore but no authorized chest; fixture chests are not storage";
      planned.blocked = { code: "ACCESS_DENIED", missing: "authorized_storage" };
      return planned;
    }
    const ore = nearestReachableSite(input.observation.position, input.knownSites ?? [], "ore");
    if (ore) {
      planned.target = ore.origin;
      planned.item = planned.item ?? "coal_ore";
      return planned;
    }
    planned.action = "blocked";
    planned.task = "blocked";
    planned.goal = "blocked";
    planned.reason = "BLOCKED: llm asked to mine ore but no discovered reachable ore origin";
    planned.blocked = { code: "SEARCH_EXHAUSTED", missing: "ore_site" };
    return planned;
  }
  if (planned.action === "workFarmPlot" && !planned.target) {
    const farm = (input.knownSites ?? []).find((site) => site.kind === "farm");
    if (farm) {
      planned.target = farm.origin;
      return planned;
    }
    planned.action = "blocked";
    planned.task = "blocked";
    planned.goal = "blocked";
    planned.reason = "BLOCKED: llm asked to farm but no discovered farm origin";
    planned.blocked = { code: "SEARCH_EXHAUSTED", missing: "farm_site" };
    return planned;
  }
  if (planned.action === "claimHome" || planned.action === "travelTowardHousing") {
    const opportunity = housingOpportunity(input.observation.position, homesForClaim(input));
    planned.trace = planned.trace;
    if (opportunity.kind === "claim") {
      planned.action = "claimHome";
      planned.task = "claim_home";
      planned.goal = "housing";
      planned.item = opportunity.home.id;
      planned.target = opportunity.home.bed;
      return planned;
    }
    if (opportunity.kind === "travel") {
      planned.action = "travelTowardHousing";
      planned.task = "seek_housing";
      planned.goal = "housing";
      planned.item = opportunity.home.id;
      planned.target = housingTravelTarget(opportunity.home);
      planned.reason = `Unclaimed house ${opportunity.home.id} is ${opportunity.distance.toFixed(1)} blocks away; walk toward it (claim reach ${HOME_CLAIM_REACH_BLOCKS})`;
      return planned;
    }
    planned.action = "blocked";
    planned.task = "blocked";
    planned.goal = "blocked";
    planned.reason = "BLOCKED: no eligible unclaimed house to walk toward or claim";
    planned.blocked = { code: "SEARCH_EXHAUSTED", missing: "eligible_house" };
    return planned;
  }
  if (planned.action === "observeNearby" && (!input.home || input.home.status !== "active")) {
    const opportunity = housingOpportunity(input.observation.position, homesForClaim(input));
    if (opportunity.kind === "travel") {
      planned.action = "travelTowardHousing";
      planned.task = "seek_housing";
      planned.goal = "housing";
      planned.item = opportunity.home.id;
      planned.target = housingTravelTarget(opportunity.home);
      planned.reason = `Explore toward known unclaimed house ${opportunity.home.id} (${opportunity.distance.toFixed(1)} blocks); not a claim`;
      return planned;
    }
  }
  return planned;
}

function activityInput(input: PlannerInput): ActivityChoiceInput {
  return {
    citizenId: input.citizenId,
    observation: input.observation,
    home: activityHome(input.home),
    knownSites: input.knownSites,
    visibleShores: input.visibleShores,
    authorizedStorage: input.authorizedStorage,
    availableHomes: homesForClaim(input),
    heldFood: personalFoodCount(input.observation),
    settlementFoodNeed: input.settlement.needs.includes("NEED_FOOD") || input.settlement.food < 4,
    lastOutcome: input.lastOutcome,
  };
}

function homesForClaim(input: PlannerInput): CatalogHome[] | undefined {
  const homes = input.availableHomes;
  if (!homes) return homes;
  const blocked = suppressedHomeIds(input.lastOutcome?.unresolved, {
    hasStorage: Boolean(input.authorizedStorage),
    hasRod: hasAny(input.observation, ["fishing_rod"]),
    hasPickaxe: hasAny(input.observation, TOOL_PICKAXES),
    hasShore: Boolean(input.visibleShores?.length),
    hasOre: Boolean((input.knownSites ?? []).some((site) => site.kind === "ore")),
    availableHomeIds: homes.map((home) => home.id),
  });
  const last = input.lastOutcome;
  const skipLast =
    last &&
    !last.success &&
    last.item &&
    (last.action === "travelTowardHousing" || last.task === "seek_housing") &&
    (last.code === "TARGET_UNREACHABLE" || last.code === "HAZARD_BLOCKED" || last.code === "PATH_BLOCKED")
      ? last.item
      : undefined;
  return homes.filter((home) => !blocked.has(home.id) && home.id !== skipLast);
}

function planHomelessHousing(input: PlannerInput): PlannedTask | undefined {
  if (input.home?.status === "active") return undefined;
  if (input.availableHomes === undefined) return undefined;
  const opportunity = housingOpportunity(input.observation.position, homesForClaim(input));
  if (opportunity.kind === "claim") {
    const planned = task(
      "housing",
      "claim_home",
      "claimHome",
      "planner",
      `Unclaimed house ${opportunity.home.id} is in claim reach (${opportunity.distance.toFixed(1)} blocks); not assigned by roster`,
      0.82,
    );
    planned.item = opportunity.home.id;
    planned.target = opportunity.home.bed;
    return planned;
  }
  if (opportunity.kind === "travel") {
    const planned = task(
      "housing",
      "seek_housing",
      "travelTowardHousing",
      "planner",
      `Unclaimed house ${opportunity.home.id} is a known catalog destination ${opportunity.distance.toFixed(1)} blocks away (outside claim reach ${HOME_CLAIM_REACH_BLOCKS}); walk toward it, do not claim yet`,
      0.81,
    );
    planned.item = opportunity.home.id;
    planned.target = housingTravelTarget(opportunity.home);
    return planned;
  }
  return undefined;
}

function correctiveFromFailure(input: PlannerInput): PlannedTask | undefined {
  const last = input.lastOutcome;
  if (!last || last.success) return undefined;
  if (workHandoffToCurfew(last.code) || last.code === "NOT_SLEEP_TIME" || last.code === "PATH_BLOCKED" || last.code === "HAZARD_BLOCKED" || last.code === "BED_MISSING" || last.code === "INTERIOR_UNREACHABLE") {
    return undefined;
  }
  if (last.workComplete === false && (last.code === "CURFEW_STOP" || last.code === "CANCELLED" || last.code === "INTERRUPTED")) {
    return undefined;
  }
  if (
    codeIsBlockedWork(last.code) ||
    (last.code === "MISSING_TOOL" && (last.action === "fishShore" || last.task === "fish_shore"))
  ) {
    return undefined;
  }
  const knowledge = minecraftKnowledge();
  const bag = Object.fromEntries(input.observation.inventory.map((item) => [item.name, item.count]));
  const item = typeof last.item === "string" && last.item ? last.item : undefined;
  const code = last.code ?? "";

  if (code === "INVENTORY_FULL") {
    return task("survive", "deposit", "depositItems", "planner", "Inventory is full; store items", 0.88);
  }
  if (code === "MISSING_TOOL") {
    const planned = task("bootstrap", "obtain_item", "obtainItem", "planner", "Need a usable tool first", 0.86, "crafter");
    planned.item = "wooden_pickaxe";
    return planned;
  }
  if (code === "NO_CRAFTING_TABLE" || code === "NEED_WORKSTATION") {
    const planned = task("bootstrap", "obtain_item", "obtainItem", "planner", "Need a reachable crafting table", 0.86, "crafter");
    planned.item = "crafting_table";
    return planned;
  }

  if (
    last.nextTask === "gather_wood" ||
    (last.task === "build_shelter" && /wood|oak_log|planks/i.test(`${last.error ?? ""} ${item ?? ""}`))
  ) {
    return task("settlement", "gather_wood", "mineBlock", "planner", "Gathering wood for the shelter", 0.83, "lumberjack");
  }

  if (
    (code === "MISSING_INGREDIENT" ||
      code === "PREREQUISITE_MISSING" ||
      code === "NO_RECIPE" ||
      code === "UNKNOWN_RECIPE" ||
      code === "UNKNOWN_ITEM") &&
    item
  ) {
    const analysis = knowledge.analyzeObtain(item, bag, []);
    if ((code === "NO_RECIPE" || code === "UNKNOWN_RECIPE" || code === "UNKNOWN_ITEM") && !analysis.known) {
      return task("idle", "observe", "observeNearby", "planner", `${item.replaceAll("_", " ")} is not a known Minecraft item or recipe`, 0.4);
    }
    const next = analysis.next;
    if (next?.kind === "gather") {
      const gatherWood = next.item.endsWith("_log") || next.item.includes("plank");
      return task(
        "settlement",
        gatherWood ? "gather_wood" : "mine_stone",
        "mineBlock",
        "planner",
        `Gathering ${next.item.replaceAll("_", " ")}`,
        0.83,
        gatherWood ? "lumberjack" : "miner",
      );
    }
    if (next?.kind === "craft" || next?.kind === "ensure_table") {
      const planned = task(
        "bootstrap",
        "obtain_item",
        "obtainItem",
        "planner",
        next.kind === "ensure_table" ? "Need a crafting table" : `Crafting ${next.item.replaceAll("_", " ")}`,
        0.84,
        "crafter",
      );
      planned.item = next.kind === "ensure_table" ? "crafting_table" : next.item;
      return planned;
    }
  }

  if (last.task === "seek_shelter" && (code === "TARGET_UNREACHABLE" || code === "TIMEOUT" || code === "PATH_BLOCKED") && last.streak >= 3) {
    // Do not keep retrying an impossible local cover goal — change strategy.
    const housingFallback = planHomelessHousing(input);
    if (housingFallback) {
      housingFallback.reason = `Seek shelter failed ${last.streak}x; ${housingFallback.reason}`;
      return housingFallback;
    }
    if (!input.settlement.shelterComplete) {
      return task("settlement", "build_shelter", "buildShelter", "planner", "Failed shelter coordinate; resume building", 0.7, "builder");
    }
    return task("idle", "observe", "observeNearby", "planner", "Seek shelter unreachable and no housing fallback; back off", 0.4);
  }
  if (shouldBackoffFoodSearch(last)) {
    return task("idle", "observe", "observeNearby", "planner", foodSearchBackoffReason(last), 0.35);
  }
  if (shouldBackoffHomeSleepRoute(last)) {
    return task("idle", "observe", "observeNearby", "planner", homeSleepBackoffReason(last), 0.35);
  }
  if (shouldBackoffToObserve(last)) {
    return task("idle", "observe", "observeNearby", "planner", "Backing off after repeated failures", 0.35);
  }
  return undefined;
}

function codeIsBlockedWork(code: string | undefined): boolean {
  return (
    code === "ACCESS_DENIED" ||
    code === "SEARCH_EXHAUSTED" ||
    code === "CLAIM_CONFLICT" ||
    code === "HOME_MISSING"
  );
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

/** Roster jobs for legacy tests. Experiment 1 keeps assignRoles false so nobody is given a permanent job. */
export function experimentWorkAssignment(
  citizenIds: string[],
  needs: SettlementNeed[],
  assignRoles: boolean,
): { roles: Map<string, WorkRole>; assignedNeeds: Map<string, SettlementNeed[]> } {
  if (!assignRoles) {
    return {
      roles: new Map(),
      assignedNeeds: new Map(citizenIds.map((id) => [id, []])),
    };
  }
  return {
    roles: assignWorkRoles(citizenIds),
    assignedNeeds: assignSettlementNeeds(citizenIds, needs),
  };
}
