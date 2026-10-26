import type { MinecraftBody } from "@civ/minecraft-adapter";
import { executeReturnHome, navigationBackend, shouldBlacklistTarget, findReachableInteractionPosition } from "@civ/minecraft-adapter";
import {
  confirmTransfer,
  createEvent,
  fail,
  FOOD_ITEM_NAMES,
  LOG_BLOCK_NAMES,
  type ActionResult,
  type EventBus,
  type Vec3,
} from "@civ/shared";
import {
  attack,
  collectItem,
  collectResource,
  depositItems,
  dropItem,
  eatFood,
  findBlock,
  flee,
  harvestCrop,
  mineBlock,
  mineKnownOre,
  fishAtShore,
  observeNearby,
  obtainItem,
  placeBlock,
  returnToSettlement,
  withdrawItems,
  workFarmPlot,
  type PlacementIntent,
  type SkillContext,
} from "@civ/skills";
import { Vec3 as Vec3Class } from "vec3";
import { cellClaimKey } from "./claims.js";
import { buildShelter, emitProjectCreated } from "./construction.js";
import { deferredCapabilityResult } from "./goal-dispatch.js";
import type { PlannedTask } from "./planner.js";
import { interiorStandingCells, isInsideShelter } from "./shelter.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import type { CivilizationStore } from "./store.js";
import { bestCraftTarget, equipBestTool, needsReplacement } from "./tools.js";
import { executeHouseholdStorage, executePersonalStorage, executeSleepAtHome } from "./home-ops.js";
import { resolveHomeSleepTarget } from "./homes.js";
import { authorizedWorkStorage } from "./activity-choice.js";
import { catalogHomeById, evaluateClaimHomeAction } from "./available-homes.js";
import { travelTowardHousingResult } from "./home-discovery.js";
import { rememberDiscoveredSite, visibleShoresFromWorld } from "./discovered-sites.js";
import { skipProtectedPropertyCell, assertMayUseChest } from "./property-safety.js";
import { decisionKind, physicalWorkComplete, skillStatusOf } from "./task-recovery.js";

export type FoodGatherSuccess = {
  acquired: true;
  foodGained: number;
  foodCount: number;
  source: string;
};

/** True when a successful action also confirmed its durable write (or had none to confirm). */
export function persistConfirmed(result: ActionResult): boolean {
  if (!result.success) return false;
  const data = result.data;
  if (!data || typeof data !== "object") return true;
  if (!("persisted" in data)) return true;
  return (data as { persisted?: unknown }).persisted !== false;
}

/**
 * Episodic completion text, or undefined when we must not claim the goal was saved.
 * Intermediate shelter steps (complete !== true) never write "Completed build_shelter".
 */
export function completionMemoryForTask(task: string, result: ActionResult): string | undefined {
  if (!result.success) {
    return `Task ${task} failed: ${result.error}`;
  }
  if (task === "gather_food") {
    const acquired =
      result.data && typeof result.data === "object" && (result.data as { acquired?: unknown }).acquired === true;
    if (!acquired) return undefined;
    const gained = (result.data as { foodGained?: number }).foodGained;
    return `Newly gathered food${typeof gained === "number" ? ` (+${gained})` : ""}`;
  }
  if (task === "build_shelter") {
    const complete =
      result.data && typeof result.data === "object" && (result.data as { complete?: unknown }).complete === true;
    if (!complete) return undefined;
    if (!persistConfirmed(result)) {
      return `Task build_shelter succeeded physically but was not persisted`;
    }
    return "Completed build_shelter";
  }
  if (task === "gather_wood") {
    return "Completed gather_wood";
  }
  return undefined;
}

/** Count edible items currently in inventory (evidence for gather_food success). */
export function countInventoryFood(ctx: SkillContext): number {
  return ctx.bot.inventory.items().filter((i) => FOOD_ITEM_NAMES.has(i.name)).reduce((s, i) => s + i.count, 0);
}

/**
 * gather_food succeeds only when inventory food newly increases.
 * Never treats log mining as food acquisition.
 */
export function finalizeFoodGather(
  ctx: SkillContext,
  foodBefore: number,
  attempt: ActionResult,
  source: string,
): ActionResult {
  const foodAfter = countInventoryFood(ctx);
  const gained = foodAfter - foodBefore;
  if (gained > 0) {
    const data: FoodGatherSuccess = {
      acquired: true,
      foodGained: gained,
      foodCount: foodAfter,
      source,
    };
    return { success: true, data, durationMs: attempt.durationMs };
  }
  if (!attempt.success) {
    return attempt;
  }
  return fail(
    "FOOD_NOT_ACQUIRED",
    `Action at '${source}' completed but inventory food did not increase`,
    attempt.durationMs,
    true,
  );
}

import {
  forgetWorkstation,
  knownChest,
  knownCraftingTable,
  rememberWorkstation,
  verifyWorkstation,
} from "./workstations.js";

const FOOD_MOBS = new Set(["cow", "pig", "chicken", "sheep", "mooshroom"]);

function claimedBed(store: CivilizationStore, citizenId: string | undefined): Vec3 | undefined {
  const home = resolveHomeSleepTarget(store, citizenId);
  return home.success ? home.data.bed : undefined;
}

export async function executePlan(
  ctx: SkillContext,
  plan: PlannedTask,
  store: CivilizationStore,
  events: EventBus,
  runtime = new SettlementRuntime(),
): Promise<ActionResult> {
  events.emit(
    createEvent(
      "ActionStarted",
      {
        action: plan.action,
        task: plan.task,
        source: plan.source,
        reason: plan.reason,
        decisionKind: decisionKind(ctx.citizenId, "intent"),
      },
      ctx.citizenId,
    ),
  );

  ctx.skipBlock = (position) => {
    if (skipProtectedPropertyCell(store, position)) return true;
    if (!ctx.citizenId) return false;
    const owner = runtime.claims.ownerOf("tree", cellClaimKey(position.x, position.y, position.z));
    return Boolean(owner && owner !== ctx.citizenId);
  };

  let result: ActionResult;
  switch (plan.action) {
    case "eatFood":
      result = await eatFood(ctx);
      break;
    case "flee": {
      const hostile = ctx.body.nearbyEntities(12).find((e) => e.hostile);
      const from = hostile?.position ?? ctx.body.position() ?? { x: 0, y: 64, z: 0 };
      result = await flee(ctx, from, 18);
      break;
    }
    case "attack":
      result = await attack(ctx);
      break;
    case "depositItems":
      if (plan.task === "deposit_personal") {
        result = await executePersonalStorage(ctx, store, events, runtime, "deposit", plan.item);
      } else if (plan.task === "deposit_household") {
        result = await executeHouseholdStorage(ctx, store, events, runtime, "deposit", plan.item);
      } else {
        result = await depositToSettlement(ctx, store, events, runtime);
      }
      break;
    case "withdrawItems":
      if (plan.task === "withdraw_personal") {
        result = await executePersonalStorage(ctx, store, events, runtime, "withdraw", plan.item ?? "bread", plan.count ?? 1);
      } else {
        result = await withdrawFood(ctx, store, events);
      }
      break;
    case "waitInsideHome":
    case "sleep":
      result = await executeSleepAtHome(ctx, store);
      break;
    case "returnHome": {
      const home = ctx.citizenId ? store.getCitizenHome(ctx.citizenId) : undefined;
      if (!home || home.status !== "active") {
        result = fail("HOME_MISSING", "BLOCKED: no legitimate claimed home to return to", 0, false);
        break;
      }
      result = await executeReturnHome(ctx.bot, {
        home: plan.target ?? home.entrance ?? home.origin ?? home.bed,
        bed: home.bed,
        entrance: home.entrance,
        signal: ctx.signal,
      });
      break;
    }
    case "claimHome": {
      if (!ctx.citizenId) {
        result = fail("HOME_MISSING", "BLOCKED: no citizen identity for claimHome", 0, false);
        break;
      }
      if (!plan.item) {
        result = fail("INVALID_ARGUMENT", "BLOCKED: claimHome requires a citizen-chosen catalog homeId", 0, false);
        break;
      }
      result = evaluateClaimHomeAction({
        store,
        citizenId: ctx.citizenId,
        homeId: plan.item,
        position: ctx.body.position(),
      });
      break;
    }
    case "travelTowardHousing": {
      const home = catalogHomeById(plan.item);
      if (!plan.target || !home) {
        result = fail(
          "INVALID_ARGUMENT",
          "BLOCKED: travelTowardHousing needs a catalog house destination; houses are not invented",
          0,
          false,
        );
        break;
      }
      const moved = await navigationBackend().navigateNear(ctx.bot, plan.target, 2, {
        timeoutMs: ctx.timeoutMs ?? 20_000,
        signal: ctx.signal,
      });
      result = travelTowardHousingResult({
        home,
        position: ctx.body.position(),
        moved,
      });
      break;
    }
    case "observeNearby": {
      result = await observeNearby(ctx);
      const here = ctx.body.position();
      if (result.success && ctx.citizenId && here) {
        const shores = visibleShoresFromWorld(here, (pos: Vec3) => {
          const block = ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
          if (!block) return undefined;
          return { name: block.name, boundingBox: block.boundingBox };
        });
        for (const shore of shores.slice(0, 3)) {
          rememberDiscoveredSite(store, {
            kind: "shore",
            origin: shore.stand,
            stand: shore.stand,
            citizenId: ctx.citizenId,
            seenAt: new Date().toISOString(),
          });
        }
      }
      break;
    }
    case "gatherFood":
      result = await gatherFood(ctx, store, events);
      break;
    case "workFarmPlot": {
      if (!plan.target) {
        result = {
          success: false,
          code: "INVALID_ARGUMENT",
          error: "workFarmPlot requires a citizen-chosen farm origin",
          durationMs: 0,
          retryable: false,
        };
        break;
      }
      result = await workFarmPlot(ctx, {
        origin: plan.target,
        size: 3,
        seedStorage: knownChest(ctx, store),
        cropStorage: knownChest(ctx, store),
        maxHarvest: plan.count,
      });
      break;
    }
    case "craftItem":
      result = await executeCraftChain(ctx, craftTarget(ctx, plan), store, events, runtime);
      break;
    case "buildShelter":
      result = await ensureAndBuild(ctx, store, events, runtime);
      break;
    case "seekSafety":
      result = await seekSafety(ctx, store);
      break;
    case "shareItem":
      result = await shareFoodNearby(ctx, events);
      break;
    case "obtainItem":
      result = await obtainItem(ctx, plan.item ?? plan.goal ?? "wooden_pickaxe");
      break;
    case "mineOre": {
      if (!plan.item || !plan.target) {
        result = {
          success: false,
          code: "INVALID_ARGUMENT",
          error:
            "mineOre requires a citizen-chosen resource and search origin. Citizens are not assigned miner roles by roster.",
          durationMs: 0,
          retryable: false,
        };
        break;
      }
      const oreStorage = authorizedWorkStorage(store, ctx.citizenId);
      if (!oreStorage) {
        result = fail(
          "ACCESS_DENIED",
          "BLOCKED: no authorized chest; the mining-test chest is not settlement storage",
          0,
          false,
        );
        break;
      }
      result = await mineKnownOre(ctx, {
        resource: plan.item,
        searchOrigin: plan.target,
        amount: plan.count ?? 1,
        destinationStorage: oreStorage,
        permittedStorage: oreStorage,
        returnHome: claimedBed(store, ctx.citizenId),
      });
      break;
    }
    case "fishShore": {
      if (!plan.target) {
        result = {
          success: false,
          code: "INVALID_ARGUMENT",
          error:
            "fishShore requires a citizen-chosen shore origin. Citizens are not assigned fisher roles by roster.",
          durationMs: 0,
          retryable: false,
        };
        break;
      }
      const storage = authorizedWorkStorage(store, ctx.citizenId);
      if (!storage) {
        result = fail(
          "ACCESS_DENIED",
          "BLOCKED: no authorized chest; test-fixture and unclaimed house chests are not settlement storage",
          0,
          false,
        );
        break;
      }
      result = await fishAtShore(ctx, {
        searchOrigin: plan.target,
        casts: plan.count ?? 1,
        destinationStorage: storage,
        permittedStorage: storage,
        returnHome: claimedBed(store, ctx.citizenId),
      });
      if (result.success && ctx.citizenId) {
        rememberDiscoveredSite(store, {
          kind: "shore",
          origin: plan.target,
          stand: plan.target,
          citizenId: ctx.citizenId,
          seenAt: new Date().toISOString(),
        });
      }
      break;
    }
    case "blocked":
      result = fail(
        (plan.blocked?.code as "HOME_MISSING" | "ACCESS_DENIED" | "SEARCH_EXHAUSTED" | "MISSING_TOOL" | "CLAIM_CONFLICT") ??
          "INVALID_ARGUMENT",
        plan.reason,
        0,
        false,
        plan.blocked,
      );
      break;
    case "returnToSettlement":
      result = await returnToSettlement(ctx, store.getSettlement().origin ?? store.getSettlement().storage);
      break;
    case "mineBlock":
      result = await gatherByTask(ctx, plan.task, runtime);
      break;
    case "deferCapability":
      result = deferredCapabilityResult(plan.task);
      break;
    default:
      result = fail(
        "UNSUPPORTED_ACTION",
        `Unsupported action '${plan.action}' for task '${plan.task}' — refusing silent wood-mining fallback`,
        0,
        false,
      );
      break;
  }

  const foodMeta = foodResultMeta(result);
  events.emit(
    createEvent(
      result.success ? "ActionCompleted" : "ActionFailed",
      {
        action: plan.action,
        task: plan.task,
        success: result.success,
        persisted: result.success ? persistConfirmed(result) : false,
        code: result.success ? undefined : result.code,
        error: result.success ? undefined : result.error,
        decisionKind: decisionKind(ctx.citizenId, "result"),
        skillStatus: skillStatusOf(result),
        workComplete: physicalWorkComplete(result),
        ...(foodMeta ? { food: foodMeta } : {}),
      },
      ctx.citizenId,
    ),
  );

  // Only sync settlement resources when food was newly acquired or other actions succeeded.
  if (result.success && ctx.citizenId && foodMeta?.acquired !== false) {
    if (store.isOpen()) {
      store.safeWrite("updateSettlementFromInventory", () => updateSettlementFromInventory(ctx, store));
    }
  }
  return result;
}

function foodResultMeta(
  result: ActionResult,
): { acquired: boolean; foodGained?: number; alreadyHadFood?: boolean } | undefined {
  if (!result.success || !result.data || typeof result.data !== "object") return undefined;
  const data = result.data as Record<string, unknown>;
  if (data.acquired === true && typeof data.foodGained === "number") {
    return { acquired: true, foodGained: data.foodGained };
  }
  return undefined;
}

async function ensureAndBuild(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  runtime: SettlementRuntime,
): Promise<ActionResult> {
  const settlement = store.getSettlement();
  if (settlement.shelterComplete && runtime.project?.status === "COMPLETED") {
    return seekSafety(ctx, store);
  }
  if (!runtime.project || runtime.project.status === "FAILED") {
    const created = runtime.ensureShelterProject();
    emitProjectCreated(events, created, ctx.citizenId);
    runtime.reservations.reserve(ctx.citizenId ?? "settlement", "construction", "oak_planks", 40, 10 * 60_000);
    events.emit(
      createEvent(
        "ResourceReserved",
        { item: "oak_planks", quantity: 40, purpose: "construction" },
        ctx.citizenId,
      ),
    );
  }
  return buildShelter(ctx, store, runtime, events);
}

function craftTarget(ctx: SkillContext, plan: PlannedTask): string {
  if (plan.task === "craft_chest" || plan.goal === "chest") return "chest";
  if (plan.task === "craft_table") return "crafting_table";
  if (plan.task === "craft_sticks") return "stick";
  return bestCraftTarget(ctx);
}

async function executeCraftChain(
  ctx: SkillContext,
  target: string,
  store: CivilizationStore,
  events: EventBus,
  runtime: SettlementRuntime,
): Promise<ActionResult> {
  const table = knownCraftingTable(ctx, store);
  const obtained = await obtainItem(ctx, target, 1);
  if (obtained.success) {
    events.emit(createEvent("ItemCrafted", { item: target, count: obtained.data.count }, ctx.citizenId));
    if (target === "crafting_table" && !table) {
      const existing = await findBlock(ctx, ["crafting_table"], 24);
      if (existing.success) {
        rememberWorkstation(store, "crafting_table", existing.data.position);
        return obtained;
      }
      return placeWorkstation(ctx, store, events, "crafting_table");
    }
    if (target === "chest") {
      const chest = knownChest(ctx, store);
      if (!chest) return placeWorkstation(ctx, store, events, "chest");
    }
  }
  if (ctx.citizenId && table) {
    runtime.claims.release("workstation", cellClaimKey(table.x, table.y, table.z), ctx.citizenId);
  }
  return obtained;
}

async function placeWorkstation(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  kind: "crafting_table" | "chest",
): Promise<ActionResult> {
  if (kind === "crafting_table") {
    const existing = await findBlock(ctx, ["crafting_table"], 24);
    if (existing.success) {
      rememberWorkstation(store, "crafting_table", existing.data.position);
      return { success: true, data: { reused: true, position: existing.data.position }, durationMs: 0 };
    }
  }
  const origin = store.getSettlement().origin;
  const intent: PlacementIntent =
    kind === "chest"
      ? { purpose: "household_storage", item: kind, structureId: "starter_hut" }
      : { purpose: "temporary_worksite", item: kind, temporary: true, cleanupPolicy: "pickup_when_idle" };
  const candidates: Vec3[] = [];
  if (kind === "chest" && origin) {
    for (const cell of interiorStandingCells(origin)) {
      candidates.push({ x: Math.floor(cell.x), y: Math.floor(cell.y), z: Math.floor(cell.z) });
    }
  } else {
    const pos = ctx.body.position();
    if (!pos) {
      return { success: false, code: "NOT_CONNECTED", error: "No position to place workstation", durationMs: 0, retryable: true };
    }
    const ox = Math.floor(pos.x);
    const oy = Math.floor(pos.y);
    const oz = Math.floor(pos.z);
    for (const offset of [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ]) {
      candidates.push({ x: ox + offset.x, y: oy, z: oz + offset.z });
      candidates.push({ x: ox + offset.x, y: oy + 1, z: oz + offset.z });
    }
  }
  for (const dest of candidates) {
    const placed = await placeBlock(ctx, kind, dest, intent);
    if (placed.success) {
      rememberWorkstation(store, kind, dest);
      events.emit(createEvent("WorkstationCreated", { kind, position: dest, temporary: intent.temporary === true }, ctx.citizenId));
      return placed;
    }
    if (placed.code === "PURPOSELESS_PLACEMENT") continue;
  }
  return {
    success: false,
    code: "PURPOSELESS_PLACEMENT",
    error: `No valid ${kind} placement context nearby`,
    durationMs: 0,
    retryable: true,
  };
}

async function gatherByTask(ctx: SkillContext, task: string, runtime: SettlementRuntime): Promise<ActionResult> {
  if (task === "mine_stone") {
    if (needsReplacement(ctx, "pickaxe")) {
      const crafted = await obtainItem(ctx, "wooden_pickaxe", 1);
      if (!crafted.success) return crafted;
    }
    await equipBestTool(ctx, "pickaxe");
    const collected = await collectResource(ctx, ["stone", "cobblestone", "deepslate"], 1, 48);
    if (collected.success) return collected;
    return mineClaimed(ctx, ["stone", "cobblestone", "deepslate"], runtime, "ore");
  }
  await equipBestTool(ctx, "axe");
  const collected = await collectResource(ctx, [...LOG_BLOCK_NAMES], 1, 48);
  if (collected.success) return collected;
  return mineClaimed(ctx, LOG_BLOCK_NAMES, runtime, "tree");
}

async function mineClaimed(
  ctx: SkillContext,
  names: string[],
  runtime: SettlementRuntime,
  kind: string,
): Promise<ActionResult> {
  const found = await findBlock(ctx, names, 48);
  if (!found.success) {
    const wider = await findBlock(ctx, names, 72);
    if (!wider.success) return wider;
    return mineClaimedTarget(ctx, names, runtime, kind, wider.data.position);
  }
  return mineClaimedTarget(ctx, names, runtime, kind, found.data.position);
}

async function mineClaimedTarget(
  ctx: SkillContext,
  names: string[],
  runtime: SettlementRuntime,
  kind: string,
  position: Vec3,
): Promise<ActionResult> {
  const key = cellClaimKey(position.x, position.y, position.z);
  if (ctx.citizenId && !runtime.claims.tryClaim(kind, key, ctx.citizenId, 60_000)) {
    ctx.body.unreachable.mark(position, 8_000);
    return mineBlock(ctx, names, 48);
  }
  const mined = await mineBlock(ctx, names, 48);
  runtime.claims.release(kind, key, ctx.citizenId);
  if (mined.success) {
    ctx.events?.emit(createEvent("ResourceCollected", { name: mined.data.name, position: mined.data.position }, ctx.citizenId));
    await collectItem(ctx, undefined, 8);
  }
  return mined;
}

/**
 * gather_food succeeds only when inventory food newly increases.
 * Eating already-held food is not credited as gathering (use eatFood via hunger reflex).
 * Preserves Windows farming, chest withdraw, berry, leaf, animal, and bread paths.
 */
async function gatherFood(ctx: SkillContext, store: CivilizationStore, events: EventBus): Promise<ActionResult> {
  const foodBefore = countInventoryFood(ctx);
  const heldFood = ctx.bot.inventory.items().find((i) => FOOD_ITEM_NAMES.has(i.name));
  if (heldFood && (ctx.bot.food ?? 20) <= 8) {
    // Hunger relief is a separate action; do not claim gather_food success from eating stock.
    return fail(
      "FOOD_NOT_ACQUIRED",
      `Inventory already holds food; not credited as newly gathered (hunger ${ctx.bot.food ?? 20} — use eatFood)`,
      0,
      false,
    );
  }
  if (foodBefore > 0) {
    return fail(
      "FOOD_NOT_ACQUIRED",
      `Inventory already holds ${foodBefore} food; not credited as newly gathered`,
      0,
      false,
    );
  }

  const chest = knownChest(ctx, store);
  const storedFood = Object.entries(store.getSettlement().storageContents ?? {}).find(
    ([name, count]) => FOOD_ITEM_NAMES.has(name) && count > 0,
  );
  if (!heldFood && chest && storedFood) {
    const withdrawn = await withdrawItemsNamed(ctx, store, events, storedFood[0], 1);
    return finalizeFoodGather(ctx, foodBefore, withdrawn, `chest:${storedFood[0]}`);
  }

  for (const kind of ["wheat", "carrots", "potatoes", "beetroots"] as const) {
    const harvested = await harvestCrop(ctx, kind);
    if (harvested.success || harvested.code !== "BLOCK_NOT_FOUND") {
      const finalized = finalizeFoodGather(ctx, foodBefore, harvested, `farm:${kind}`);
      if (finalized.success || harvested.success) return finalized;
    }
  }

  const berries = await findBlock(ctx, ["sweet_berry_bush"], 20);
  if (berries.success) {
    const mined = await mineBlock(ctx, ["sweet_berry_bush"], 20);
    if (mined.success) await collectItem(ctx, undefined, 8);
    return finalizeFoodGather(ctx, foodBefore, mined, "sweet_berry_bush");
  }

  const apples = await findBlock(ctx, ["oak_leaves", "dark_oak_leaves"], 20);
  if (apples.success) {
    const mined = await mineBlock(ctx, ["oak_leaves", "dark_oak_leaves"], 20);
    if (mined.success) await collectItem(ctx, undefined, 8);
    return finalizeFoodGather(ctx, foodBefore, mined, "leaves");
  }

  const animal = ctx.body.nearbyEntities(20).find((e) => FOOD_MOBS.has(e.name.toLowerCase()));
  if (animal) {
    const attacked = await attack(ctx, animal.id);
    if (attacked.success) await collectItem(ctx, undefined, 10);
    return finalizeFoodGather(ctx, foodBefore, attacked, animal.name);
  }

  const wheat = ctx.bot.inventory.items().filter((i) => i.name === "wheat").reduce((s, i) => s + i.count, 0);
  if (wheat >= 3) {
    const bread = await obtainItem(ctx, "bread", 1);
    return finalizeFoodGather(ctx, foodBefore, bread, "craft:bread");
  }

  const farther = await findBlock(ctx, ["sweet_berry_bush"], 48);
  if (farther.success) {
    const mined = await mineBlock(ctx, ["sweet_berry_bush"], 48);
    if (mined.success) await collectItem(ctx, undefined, 8);
    return finalizeFoodGather(ctx, foodBefore, mined, "sweet_berry_bush:far");
  }

  return fail("FOOD_NOT_FOUND", "No edible sources available — not mining wood as food", 0, true);
}

async function depositToSettlement(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  runtime: SettlementRuntime,
): Promise<ActionResult> {
  let chest = knownChest(ctx, store);
  if (!chest) {
    const hasChest = ctx.bot.inventory.items().some((i) => i.name === "chest");
    if (!hasChest) {
      return executeCraftChain(ctx, "chest", store, events, runtime);
    }
    const placed = await placeWorkstation(ctx, store, events, "chest");
    if (!placed.success) return placed;
    chest = knownChest(ctx, store);
  }
  if (!chest || !verifyWorkstation(ctx, chest, "chest")) {
    if (chest) {
      forgetWorkstation(store, "chest", chest);
      events.emit(createEvent("WorkstationDestroyed", { kind: "chest", position: chest }, ctx.citizenId));
    }
    return { success: false, code: "CONTAINER_NOT_FOUND", error: "Settlement chest is gone", durationMs: 0, retryable: true };
  }
  const access = assertMayUseChest(store, ctx.citizenId, chest, "communal");
  if (!access.success) return access;
  if (ctx.citizenId && !runtime.claims.tryClaim("container", cellClaimKey(chest.x, chest.y, chest.z), ctx.citizenId, 30_000)) {
    return { success: false, code: "CONTAINER_BUSY", error: "Chest is in use", durationMs: 0, retryable: true };
  }
  const result = await depositItems(ctx, undefined, chest);
  runtime.claims.release("container", cellClaimKey(chest.x, chest.y, chest.z), ctx.citizenId);
  if (result.success) {
    const settlement = store.getSettlement();
    settlement.storage = chest;
    settlement.storageContents = result.data.contents;
    store.saveSettlement(settlement);
    events.emit(
      createEvent("ItemDeposited", { count: result.data.deposited, contents: result.data.contents, position: chest }, ctx.citizenId),
    );
  }
  return result;
}

async function withdrawFood(ctx: SkillContext, store: CivilizationStore, events: EventBus): Promise<ActionResult> {
  const chest = knownChest(ctx, store);
  const foodName = Object.entries(store.getSettlement().storageContents ?? {}).find(
    ([name, count]) => FOOD_ITEM_NAMES.has(name) && count > 0,
  )?.[0];
  if (!chest || !foodName) {
    return gatherFood(ctx, store, events);
  }
  return withdrawItemsNamed(ctx, store, events, foodName, 1);
}

async function withdrawItemsNamed(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  itemName: string,
  count: number,
): Promise<ActionResult> {
  const chest = knownChest(ctx, store);
  if (!chest) {
    return { success: false, code: "CONTAINER_NOT_FOUND", error: "No settlement chest", durationMs: 0, retryable: true };
  }
  const access = assertMayUseChest(store, ctx.citizenId, chest, "communal");
  if (!access.success) return access;
  const result = await withdrawItems(ctx, itemName, count, chest);
  if (result.success) {
    const settlement = store.getSettlement();
    settlement.storageContents = result.data.contents;
    store.saveSettlement(settlement);
    events.emit(createEvent("ItemWithdrawn", { item: itemName, count: result.data.count, position: chest }, ctx.citizenId));
  }
  return result;
}

async function seekSafety(ctx: SkillContext, store: CivilizationStore): Promise<ActionResult> {
  // Temporary cover only. Never writes citizens.home_id or memberships.
  const settlement = store.getSettlement();
  const origin = settlement.origin;
  const pos = ctx.body.position();
  const hostiles = ctx.body.nearbyEntities(12).some((entity) => entity.hostile);
  if (origin && isInsideShelter(pos, origin) && !hostiles) {
    return { success: true, data: { verified: true, quality: "safe", position: pos }, durationMs: 0 };
  }

  const coveredBed = await findBlock(
    ctx,
    [
      "white_bed",
      "red_bed",
      "blue_bed",
      "yellow_bed",
      "black_bed",
      "brown_bed",
      "green_bed",
      "light_gray_bed",
      "gray_bed",
      "cyan_bed",
      "orange_bed",
      "lime_bed",
      "pink_bed",
      "purple_bed",
      "magenta_bed",
      "light_blue_bed",
    ],
    32,
  );
  if (coveredBed.success) {
    const standing = findReachableInteractionPosition(ctx.bot, coveredBed.data.position) ?? coveredBed.data.position;
    const moved = await navigationBackend().navigateNear(ctx.bot, standing, 1.4, {
      timeoutMs: ctx.timeoutMs ?? 16_000,
      signal: ctx.signal,
    });
    if (moved.success) {
      const here = ctx.body.position();
      const roof = ctx.bot.blockAt(
        new Vec3Class(Math.floor(coveredBed.data.position.x), Math.floor(coveredBed.data.position.y) + 2, Math.floor(coveredBed.data.position.z)),
      );
      if (roof && roof.boundingBox === "block") {
        if (!hostiles) {
          return { success: true, data: { verified: true, quality: "safe", reused: "village_or_human_bed", position: here }, durationMs: moved.durationMs };
        }
        return {
          success: false,
          code: "HOSTILE_NEARBY",
          error: "Bed is usable but not currently safe",
          durationMs: moved.durationMs,
          retryable: true,
          details: { quality: "usable", reused: "village_or_human_bed" },
        };
      }
    }
  }

  const cells = origin ? interiorStandingCells(origin) : [];
  for (const cell of cells) {
    if (ctx.body.unreachable.has(cell)) continue;
    const moved = await navigationBackend().navigateNear(ctx.bot, cell, 1.2, {
      timeoutMs: ctx.timeoutMs ?? 16_000,
      signal: ctx.signal,
    });
    if (!moved.success) {
      if (shouldBlacklistTarget(moved.code)) ctx.body.unreachable.mark(cell, 45_000);
      continue;
    }
    const here = ctx.body.position();
    if (isInsideShelter(here, origin) && !ctx.body.nearbyEntities(8).some((entity) => entity.hostile)) {
      return { success: true, data: { verified: true, quality: "safe", position: here }, durationMs: moved.durationMs };
    }
    if (isInsideShelter(here, origin)) {
      return { success: true, data: { verified: true, quality: "usable", position: here }, durationMs: moved.durationMs };
    }
    ctx.body.unreachable.mark(cell, 20_000);
  }

  return {
    success: false,
    code: "TARGET_UNREACHABLE",
    error: "Reached the area but not a usable interior standing cell",
    durationMs: 0,
    retryable: true,
    details: { nextTask: "build_shelter", quality: "reachable" },
  };
}

async function shareFoodNearby(ctx: SkillContext, events: EventBus): Promise<ActionResult> {
  const food = ctx.bot.inventory.items().find((i) => FOOD_ITEM_NAMES.has(i.name) && i.count >= 1);
  if (!food) {
    return { success: false, code: "NO_FOOD", error: "Nothing to share", durationMs: 0, retryable: true };
  }
  const nearby = ctx.body.nearbyPlayers(5);
  if (nearby.length === 0) {
    return observeNearby(ctx);
  }
  const before = ctx.bot.inventory.items().filter((i) => i.name === food.name).reduce((s, i) => s + i.count, 0);
  const dropped = await dropItem(ctx, food.name, 1, "TRANSFER");
  if (!dropped.success) return dropped;
  events.emit(
    createEvent(
      "ItemDropped",
      { item: food.name, count: dropped.data.count, purpose: "TRANSFER", pending: true, receiverHint: nearby[0]?.username, gift: false },
      ctx.citizenId,
    ),
  );
  void before;
  return dropped;
}

export async function completeVerifiedTransfer(args: {
  giverBefore: number;
  giverAfter: number;
  receiverBefore: number;
  receiverAfter: number;
  item: string;
  count: number;
  giverId: string;
  receiverId: string;
  purpose: string;
  events: EventBus;
}): Promise<boolean> {
  const okTransfer = confirmTransfer({
    item: args.item,
    count: args.count,
    giverBefore: args.giverBefore,
    giverAfter: args.giverAfter,
    receiverBefore: args.receiverBefore,
    receiverAfter: args.receiverAfter,
  });
  if (!okTransfer) return false;
  args.events.emit(
    createEvent(
      "ItemTransferCompleted",
      {
        giver: args.giverId,
        receiver: args.receiverId,
        item: args.item,
        count: args.count,
        purpose: args.purpose,
        timestamp: new Date().toISOString(),
      },
      args.giverId,
    ),
  );
  return true;
}

function updateSettlementFromInventory(ctx: SkillContext, store: CivilizationStore): void {
  const settlement = store.getSettlement();
  const items = ctx.bot.inventory.items();
  const wood = items.filter((i) => i.name.endsWith("_log") || i.name.endsWith("_planks")).reduce((s, i) => s + i.count, 0);
  const stone = items.filter((i) => i.name === "cobblestone" || i.name === "stone").reduce((s, i) => s + i.count, 0);
  const food = items.filter((i) => FOOD_ITEM_NAMES.has(i.name)).reduce((s, i) => s + i.count, 0);
  const tools = items.filter((i) => i.name.includes("pickaxe") || i.name.includes("_axe")).reduce((s, i) => s + i.count, 0);
  settlement.wood = Math.max(settlement.wood, wood);
  settlement.stone = Math.max(settlement.stone, stone);
  settlement.food = Math.max(settlement.food, food);
  settlement.tools = Math.max(settlement.tools, tools);
  store.saveSettlement(settlement);
}

export function bodyContext(
  body: MinecraftBody,
  signal?: AbortSignal,
  events?: EventBus,
  citizenId?: string,
): SkillContext | undefined {
  const bot = body.getBot();
  if (!bot?.entity) return undefined;
  return { body, bot, signal, events, citizenId, timeoutMs: 22_000 };
}
