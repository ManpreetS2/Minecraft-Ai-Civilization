import { evaluateReturnHome } from "@civ/minecraft-adapter";
import type { BodyObservation, ErrorCode, Vec3 } from "@civ/shared";
import {
  HOME_CLAIM_REACH_BLOCKS,
  isCatalogPersonalChest,
  type CatalogHome,
} from "./available-homes.js";
import { housingOpportunity, housingTravelTarget } from "./home-discovery.js";
import { homeWaypoint, resolveStorageTarget, type CitizenHome } from "./homes.js";
import type { CivilizationStore } from "./store.js";
import {
  nearestReachableSite,
  siteIsReachable,
  type DiscoveredSite,
} from "./discovered-sites.js";
import type { PlannedTask, LastOutcome } from "./planner.js";
import { isTestFixtureChest } from "./test-fixtures.js";
import {
  suppressedActions,
  suppressedHomeIds,
  type UnresolvedFacts,
} from "./task-recovery.js";

export type ActivityId =
  | "fish_shore"
  | "mine_ore"
  | "work_farm"
  | "gather_food"
  | "gather_wood"
  | "obtain_tool"
  | "observe"
  | "return_home"
  | "claim_home"
  | "seek_housing"
  | "deposit";

const BOOTSTRAP_LOGS = ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"] as const;
const BOOTSTRAP_PLANKS = ["oak_planks", "birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"] as const;

export type BlockedActivity = {
  id: ActivityId;
  code: ErrorCode;
  missing: string;
  reason: string;
};

export type ActivityOption = {
  id: ActivityId;
  action: string;
  task: string;
  goal: string;
  reason: string;
  score: number;
  target?: Vec3;
  item?: string;
};

export type DecisionTrace = {
  observations: {
    food?: number;
    hungerItems: number;
    hasRod: boolean;
    hasPickaxe: boolean;
    animalsNearby: boolean;
    isNight?: boolean;
    timeOfDay?: number;
    position?: Vec3;
    homeId?: string;
    storage?: Vec3;
    visibleShores: number;
    knownShores: number;
  };
  options: ActivityOption[];
  blocked: BlockedActivity[];
  chosen?: ActivityOption;
  reason: string;
};

export type ActivityChoiceInput = {
  citizenId: string;
  observation: BodyObservation;
  home?: Pick<CitizenHome, "homeId" | "bed" | "status" | "entrance" | "origin" | "personalChest">;
  knownSites?: DiscoveredSite[];
  visibleShores?: Array<{ stand: Vec3; water: Vec3 }>;
  authorizedStorage?: Vec3;
  availableHomes?: CatalogHome[];
  heldFood: number;
  settlementFoodNeed?: boolean;
  lastOutcome?: LastOutcome;
};

const ANIMALS = new Set(["cow", "pig", "chicken", "sheep", "mooshroom"]);
const PICKAXES = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];

export function hasItem(obs: BodyObservation, name: string): boolean {
  return obs.inventory.some((item) => item.name === name && item.count > 0);
}

export function hasAnyItem(obs: BodyObservation, names: readonly string[]): boolean {
  return names.some((name) => hasItem(obs, name));
}

export function animalsNearby(obs: BodyObservation): boolean {
  return obs.nearby.some((entity) => ANIMALS.has(entity.name) && entity.distance < 16);
}

function storageGrantedToCitizen(store: CivilizationStore, citizenId: string | undefined, pos: Vec3): boolean {
  if (isTestFixtureChest(pos)) return false;
  if (citizenId) {
    const home = store.getCitizenHome(citizenId);
    if (home?.personalChest && home.status === "active") {
      const chest = home.personalChest;
      if (
        Math.floor(chest.x) === Math.floor(pos.x) &&
        Math.floor(chest.y) === Math.floor(pos.y) &&
        Math.floor(chest.z) === Math.floor(pos.z)
      ) {
        return true;
      }
    }
  }
  if (isCatalogPersonalChest(pos)) return false;
  return true;
}

export function authorizedWorkStorage(
  store: CivilizationStore,
  citizenId: string | undefined,
): Vec3 | undefined {
  if (citizenId) {
    const personal = resolveStorageTarget(store, citizenId, "personal");
    if (personal.success && storageGrantedToCitizen(store, citizenId, personal.data.position)) {
      return personal.data.position;
    }
  }
  const communal = resolveStorageTarget(store, citizenId, "communal");
  if (communal.success && storageGrantedToCitizen(store, citizenId, communal.data.position)) {
    return communal.data.position;
  }
  return undefined;
}

export function usableAuthorizedStorage(pos: Vec3 | undefined): Vec3 | undefined {
  if (!pos) return undefined;
  if (isTestFixtureChest(pos)) return undefined;
  return pos;
}

function option(
  id: ActivityId,
  action: string,
  task: string,
  goal: string,
  reason: string,
  score: number,
  extra: Partial<Pick<ActivityOption, "target" | "item">> = {},
): ActivityOption {
  return { id, action, task, goal, reason, score, ...extra };
}

/**
 * Lists genuine work the citizen can start now. Fishing appears only when a rod,
 * a known/visible reachable shore, and authorized storage all exist.
 * Does not assign a fisher occupation and does not inject harness coordinates.
 */
export function listActivityOptions(input: ActivityChoiceInput): {
  options: ActivityOption[];
  blocked: BlockedActivity[];
  observations: DecisionTrace["observations"];
} {
  const obs = input.observation;
  const pos = obs.position;
  const hasRod = hasItem(obs, "fishing_rod");
  const hasPickaxe = hasAnyItem(obs, PICKAXES);
  const animals = animalsNearby(obs);
  const visible = input.visibleShores ?? [];
  const sites = input.knownSites ?? [];
  const knownShores = sites.filter((site) => site.kind === "shore");
  const reachableVisible = pos ? visible.filter((shore) => siteIsReachable(pos, shore.stand, 24)) : [];
  const rememberedShore = nearestReachableSite(pos, sites, "shore");
  const shoreStand = reachableVisible[0]?.stand ?? rememberedShore?.stand ?? rememberedShore?.origin;
  const oreSite = nearestReachableSite(pos, sites, "ore");
  const farmSite = nearestReachableSite(pos, sites, "farm");
  const storage = usableAuthorizedStorage(input.authorizedStorage);
  const hungry = (obs.food ?? 20) <= 14 || input.heldFood < 2 || Boolean(input.settlementFoodNeed);
  const blocked: BlockedActivity[] = [];
  const options: ActivityOption[] = [];
  const hasHome = input.home?.status === "active";
  const facts: UnresolvedFacts = {
    hasStorage: Boolean(storage),
    hasRod,
    hasPickaxe,
    hasShore: Boolean(shoreStand),
    hasOre: Boolean(oreSite),
    availableHomeIds: (input.availableHomes ?? []).map((home) => home.id),
  };
  const suppressed = suppressedActions(input.lastOutcome?.unresolved, facts);
  const blockedHomes = suppressedHomeIds(input.lastOutcome?.unresolved, facts);

  if (!hasHome) {
    blocked.push({
      id: "return_home",
      code: "HOME_MISSING",
      missing: "claimed_home",
      reason: "BLOCKED: no persisted citizen home claim; H1 is not assigned",
    });
    const eligible = (input.availableHomes ?? []).filter((home) => !blockedHomes.has(home.id));
    const housing = housingOpportunity(pos, eligible);
    if (housing.kind === "claim" && !suppressed.has("claimHome") && !suppressed.has("claim_home")) {
      options.push(
        option(
          "claim_home",
          "claimHome",
          "claim_home",
          "housing",
          `Unclaimed house ${housing.home.id} is in claim reach (${housing.distance.toFixed(1)} blocks); claiming it (not assigned by roster)`,
          0.66,
          { target: housing.home.bed, item: housing.home.id },
        ),
      );
    } else if (housing.kind === "travel" && !suppressed.has("travelTowardHousing") && !suppressed.has("seek_housing")) {
      options.push(
        option(
          "seek_housing",
          "travelTowardHousing",
          "seek_housing",
          "housing",
          `Unclaimed house ${housing.home.id} is a known catalog destination ${housing.distance.toFixed(1)} blocks away (outside claim reach ${HOME_CLAIM_REACH_BLOCKS}); walk toward it, do not claim yet`,
          0.64,
          { target: housingTravelTarget(housing.home), item: housing.home.id },
        ),
      );
    } else if (housing.kind === "none" && input.availableHomes) {
      blocked.push({
        id: "seek_housing",
        code: "SEARCH_EXHAUSTED",
        missing: "eligible_house",
        reason: "BLOCKED: no eligible unclaimed house to walk toward; H1 is not invented",
      });
    }
  }

  if (hasRod && shoreStand && storage && hungry && !suppressed.has("fishShore") && !suppressed.has("fish_shore")) {
    options.push(
      option(
        "fish_shore",
        "fishShore",
        "fish_shore",
        "acquire_food",
        "Hunger or food need; a reachable discovered shore and authorized chest are available",
        0.58,
        { target: shoreStand },
      ),
    );
  } else if (hungry && (hasRod || shoreStand || visible.length > 0 || knownShores.length > 0)) {
    if (!hasRod) {
      blocked.push({
        id: "fish_shore",
        code: "MISSING_TOOL",
        missing: "fishing_rod",
        reason: "BLOCKED: no fishing rod; fishing is not chosen",
      });
    } else if (!shoreStand) {
      blocked.push({
        id: "fish_shore",
        code: "SEARCH_EXHAUSTED",
        missing: "reachable_shore",
        reason: "BLOCKED: no known reachable fishing shore; harness pond coordinates are not injected",
      });
    } else if (!storage) {
      blocked.push({
        id: "fish_shore",
        code: "ACCESS_DENIED",
        missing: "authorized_storage",
        reason: "BLOCKED: no authorized chest; knowing a chest exists is not permission",
      });
    }
  }

  if (animals && hungry) {
    options.push(option("gather_food", "gatherFood", "gather_food", "acquire_food", "Food animals are in sight", 0.6));
  }
  if (hasPickaxe && oreSite && storage && !suppressed.has("mineOre") && !suppressed.has("mine_ore")) {
    options.push(
      option("mine_ore", "mineOre", "mine_ore", "mine_ore", "A discovered ore pocket is reachable and a pickaxe is held", 0.5, {
        target: oreSite.origin,
        item: "coal_ore",
      }),
    );
  } else if (hasPickaxe || oreSite) {
    if (!hasPickaxe) {
      blocked.push({
        id: "mine_ore",
        code: "MISSING_TOOL",
        missing: "pickaxe",
        reason: "BLOCKED: no pickaxe; mining is not chosen",
      });
    } else if (!oreSite) {
      blocked.push({
        id: "mine_ore",
        code: "SEARCH_EXHAUSTED",
        missing: "ore_site",
        reason: "BLOCKED: no known reachable ore origin; harness coordinates are not injected",
      });
    } else if (!storage) {
      blocked.push({
        id: "mine_ore",
        code: "ACCESS_DENIED",
        missing: "authorized_storage",
        reason: "BLOCKED: no authorized chest; the mining-test chest is not settlement storage",
      });
    }
  }
  if (farmSite && hungry) {
    options.push(
      option("work_farm", "workFarmPlot", "work_farm", "acquire_food", "A discovered farm plot is reachable", 0.52, {
        target: farmSite.origin,
      }),
    );
  }
  const hasLogs = hasAnyItem(obs, BOOTSTRAP_LOGS);
  const hasPlanks = hasAnyItem(obs, BOOTSTRAP_PLANKS);
  if (!hasLogs && !hasPickaxe && !hasPlanks) {
    // Executor still maps gather_wood → mineBlock (excavation). Inventory gain is verified downstream.
    options.push(option("gather_wood", "mineBlock", "gather_wood", "bootstrap", "Need wood for tools", 0.55));
  }
  if (!hasPickaxe && (hasLogs || hasPlanks) && !suppressed.has("obtainItem") && !suppressed.has("obtain_item")) {
    // After logs/planks exist, keep progressing the tool chain instead of idle observation.
    options.push(
      option(
        "obtain_tool",
        "obtainItem",
        "obtain_item",
        "bootstrap",
        "Have wood materials; craft a wooden pickaxe through the recipe chain",
        0.56,
        { item: "wooden_pickaxe" },
      ),
    );
  }
  options.push(option("observe", "observeNearby", "observe", "idle", "Survey surroundings for work sites", 0.2));

  return {
    options,
    blocked,
    observations: {
      food: obs.food,
      hungerItems: input.heldFood,
      hasRod,
      hasPickaxe,
      animalsNearby: animals,
      isNight: obs.isNight,
      timeOfDay: obs.gameTime,
      position: pos,
      homeId: input.home?.homeId,
      storage,
      visibleShores: reachableVisible.length,
      knownShores: knownShores.length,
    },
  };
}

export function chooseActivity(input: ActivityChoiceInput): { option: ActivityOption; trace: DecisionTrace } {
  const listed = listActivityOptions(input);
  const pos = input.observation.position;
  const home = input.home;
  if (home?.status === "active" && pos && input.observation.gameTime != null) {
    const waypoint = homeWaypoint(home);
    const curfew = evaluateReturnHome({
      position: pos,
      home: waypoint,
      timeOfDay: input.observation.gameTime,
    });
    if (curfew.shouldStopOptionalWork) {
      const chosen = option(
        "return_home",
        "sleep",
        "sleep_at_home",
        "rest",
        `BLOCKED optional work: ${curfew.reason}`,
        0.9,
        { target: home.bed },
      );
      return {
        option: chosen,
        trace: {
          observations: listed.observations,
          options: [chosen, ...listed.options],
          blocked: listed.blocked,
          chosen,
          reason: chosen.reason,
        },
      };
    }
  }

  const ranked = [...listed.options].sort((a, b) => b.score - a.score);
  const chosen = ranked[0] ?? option("observe", "observeNearby", "observe", "idle", "No available work", 0.2);
  return {
    option: chosen,
    trace: {
      observations: listed.observations,
      options: listed.options,
      blocked: listed.blocked,
      chosen,
      reason: chosen.reason,
    },
  };
}

export function plannedTaskFromOption(option: ActivityOption, source: PlannedTask["source"] = "planner"): PlannedTask {
  return {
    goal: option.goal,
    task: option.task,
    action: option.action,
    source,
    reason: option.reason,
    priority: option.score,
    target: option.target,
    item: option.item,
  };
}
