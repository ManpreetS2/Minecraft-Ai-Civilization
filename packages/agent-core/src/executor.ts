import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { captureActionOwnership } from "./action-boundary.js";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import { executeReturnHome, navigationBackend, shouldBlacklistTarget, findReachableInteractionPosition } from "@civ/minecraft-adapter";
import {
  confirmTransfer,
  createEvent,
  fail,
  FOOD_ITEM_NAMES,
  LOG_BLOCK_NAMES,
  ok,
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
import { actionEvidenceFor, type ActionEvidenceObservation } from "./action-evidence.js";
import { cellClaimKey } from "./claims.js";
import { executeBuildStructurePlan } from "./build-structure.js";
import { buildShelter, emitProjectCreated } from "./construction.js";
import { deferredCapabilityResult, enforceModelOriginatedPlan, validateModelOriginatedPlan } from "./goal-dispatch.js";
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
import { communityConstruction } from "./community-construction.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
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
  if (task === "build_shelter" || task === "build_structure") {
    const complete =
      result.data && typeof result.data === "object" && (result.data as { complete?: unknown }).complete === true;
    if (!complete) return undefined;
    if (!persistConfirmed(result)) {
      return `Task ${task} succeeded physically but was not persisted`;
    }
    return task === "build_structure" ? "Completed build_structure" : "Completed build_shelter";
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

function inventorySnapshot(ctx: SkillContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of ctx.bot.inventory.items()) {
    if (!item?.name || !/^[a-z0-9_]+$/.test(item.name) || !Number.isSafeInteger(item.count) || item.count < 0) continue;
    out[item.name] = (out[item.name] ?? 0) + item.count;
  }
  return out;
}

function hungerSnapshot(ctx: SkillContext): number | undefined {
  const food = ctx.bot.food;
  return typeof food === "number" && food >= 0 && food <= 20 ? food : undefined;
}

function pointSnapshot(pos: { x: number; y: number; z: number } | null | undefined): { x: number; y: number; z: number } | undefined {
  if (!pos || ![pos.x, pos.y, pos.z].every((value) => Number.isFinite(value))) return undefined;
  return { x: pos.x, y: pos.y, z: pos.z };
}

/** Planned log gain, chosen from the plan or the block that will be dug. Not an inventory measurement. */
async function plannedWoodDelta(
  ctx: SkillContext,
  plan: PlannedTask,
): Promise<{ item?: string; delta: Record<string, number>; target?: { x: number; y: number; z: number } }> {
  if (plan.item && /^[a-z0-9_]+$/.test(plan.item)) {
    const count = plan.count && Number.isSafeInteger(plan.count) && plan.count > 0 ? plan.count : 1;
    return { item: plan.item, delta: { [plan.item]: count }, target: plan.target };
  }
  const found = await findBlock(ctx, [...LOG_BLOCK_NAMES], 48);
  if (!found.success || !/^[a-z0-9_]+$/.test(found.data.name)) return { delta: {} };
  return { item: found.data.name, delta: { [found.data.name]: 1 }, target: pointSnapshot(found.data.position) };
}

function worldChangesFrom(result: ActionResult): ActionEvidenceObservation["worldChanges"] {
  if (!result.success || !result.data || typeof result.data !== "object") return [];
  const data = result.data as { name?: unknown; position?: { x: number; y: number; z: number } };
  const position = pointSnapshot(data.position);
  if (typeof data.name !== "string" || !/^[a-z0-9_]+$/.test(data.name) || !position) return [];
  return [{ position, before: data.name, after: "air" }];
}

function finishGatherEvidence(
  evidence: ReturnType<typeof actionEvidenceFor>,
  attemptId: string | undefined,
  ctx: SkillContext,
  beforeInventory: Record<string, number> | undefined,
  hungerBefore: number | undefined,
  result: ActionResult,
): void {
  if (!evidence || !attemptId) return;
  const failureCode = result.success ? undefined : result.code && /^[A-Z0-9_]+$/.test(result.code) ? result.code : "FAILED";
  evidence.finish(attemptId, {
    successReported: result.success,
    beforeInventory: beforeInventory ?? {},
    afterInventory: inventorySnapshot(ctx),
    position: pointSnapshot(ctx.body.position()),
    hungerBefore,
    hungerAfter: hungerSnapshot(ctx),
    worldChanges: worldChangesFrom(result),
    failureCode,
  });
}

const executionGenerations = new WeakMap<object, object>();
const executionScope = new AsyncLocalStorage<() => boolean>();
function executionIsCurrent(ctx: SkillContext): boolean {
  return !ctx.signal?.aborted && (executionScope.getStore()?.() ?? true);
}
function abandonedObservation(ctx: SkillContext, events: EventBus, action: string, result: ActionResult): ActionResult {
  // Chest skills own physical transfer observations, including abandoned transfers.
  // Failed/no-effect actions do not introduce a second reconciliation receipt.
  if (result.success && action !== "depositItems" && action !== "withdrawItems") events.emit(createEvent("SystemIncident", {
    kind: "AbandonedActionObservation", action, reconciliation: "PENDING",
    observedResult: result, authoritativeStorageUpdated: false,
  }, ctx.citizenId));
  return fail("CANCELLED", "Action ownership ended; observed effects require reconciliation", result.durationMs, false);
}
export async function executePlan(
  ctx: SkillContext, plan: PlannedTask, store: CivilizationStore, events: EventBus,
  baseRuntime = new SettlementRuntime(),
): Promise<ActionResult> {
  const generation = {};
  executionGenerations.set(ctx.bot, generation);
  const ownsBoundary = captureActionOwnership();
  let active = true;
  const isActionCurrent = () => active && executionGenerations.get(ctx.bot) === generation && ownsBoundary();
  try {
    return await executionScope.run(
      isActionCurrent,
      () => executeOwnedPlan({ ...ctx, events, isActionCurrent, actionId: randomUUID() }, plan, store, events, baseRuntime),
    );
  } finally {
    active = false;
  }
}

async function executeOwnedPlan(
  ctx: SkillContext,
  plan: PlannedTask,
  store: CivilizationStore,
  events: EventBus,
  baseRuntime = new SettlementRuntime(),
): Promise<ActionResult> {
  if (!store.isOpen()) return fail("CANCELLED", "Application storage is closed; construction cannot continue", 0, false);
  // Community mode: project state and reservations live in a per-community runtime bound to the authenticated caller.
  let runtime = baseRuntime;
  if (store.hasCommunities()) {
    const communityId = ctx.citizenId ? store.getCommunityDirectory().communityOf(ctx.citizenId) : undefined;
    if (!communityId) {
      return { success: false, code: "ACCESS_DENIED", error: "Construction requires authenticated community membership", durationMs: 0, retryable: false };
    }
    runtime = baseRuntime.forCommunity(communityId, store);
  }
  // Shared boundary: model-originated plans must stay on the cognition allowlist.
  // Reflex / planner / human-directive plans are not rewritten here.
  const gated = plan.source === "llm" ? enforceModelOriginatedPlan(plan) : plan;
  const integrity = plan.source === "llm" ? validateModelOriginatedPlan(plan) : { ok: true as const };

  const started = createEvent(
    "ActionStarted",
    {
      action: gated.action,
      task: gated.task,
      source: gated.source,
      reason: gated.reason,
      decisionKind: decisionKind(ctx.citizenId, "intent"),
      goal: gated.goal,
      dispatchIntegrity: integrity.ok ? "allowlisted" : "rewritten_fail_closed",
      ...(integrity.ok ? {} : { integrityReason: integrity.reason }),
      ...(gated.modelProvenance ? { modelProvenance: gated.modelProvenance } : {}),
    },
    ctx.citizenId,
  );
  events.emit(started);

  ctx.skipBlock = (position) => {
    if (skipProtectedPropertyCell(store, position)) return true;
    if (!ctx.citizenId) return false;
    const owner = runtime.claims.ownerOf("tree", cellClaimKey(position.x, position.y, position.z));
    return Boolean(owner && owner !== ctx.citizenId);
  };

  const evidence = actionEvidenceFor(events);
  let attemptId: string | undefined;
  let beforeInventory: Record<string, number> | undefined;
  let hungerBefore: number | undefined;
  if (evidence && ctx.citizenId && gated.action === "mineBlock" && gated.task === "gather_wood") {
    beforeInventory = inventorySnapshot(ctx);
    hungerBefore = hungerSnapshot(ctx);
    const planned = await plannedWoodDelta(ctx, gated);
    attemptId = evidence.begin({
      citizenId: ctx.citizenId,
      eventId: started.id,
      planSource: gated.source,
      action: "gather",
      task: gated.task,
      expectedItem: planned.item,
      expectedDelta: planned.delta,
      originPosition: pointSnapshot(ctx.body.position()),
      target: planned.target,
    });
  }

  let result: ActionResult;
  try {
  switch (gated.action) {
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
      } else if (plan.task === "withdraw_household") {
        result = await executeHouseholdStorage(ctx, store, events, runtime, "withdraw", plan.item ?? "bread", plan.count ?? 1);
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
    case "buildStructure":
      result = await executeBuildStructurePlan({
        ctx,
        plan,
        runtime,
        persist: (project) => {
          if (!store.isOpen()) return { ok: false, reason: "store_closed" };
          // The shared settlement row is never written in community mode; the community's own row is.
          if (store.hasCommunities()) {
            try {
              return communityConstruction(store).forCitizen(ctx.citizenId).save(project)
                ? { ok: true }
                : { ok: false, reason: "error" };
            } catch {
              return { ok: false, reason: "error" };
            }
          }
          const write = store.safeWrite("saveSettlement:structureProject", () => {
            const settlement = store.getSettlement();
            settlement.projectJson = JSON.stringify(project);
            if (project.site) settlement.origin = project.site;
            store.saveSettlement(settlement);
          });
          return write.ok ? { ok: true } : { ok: false, reason: write.reason };
        },
      });
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
      result = deferredCapabilityResult(gated.task);
      break;
    default:
      result = fail(
        "UNSUPPORTED_ACTION",
        `Unsupported action '${gated.action}' for task '${gated.task}' — refusing silent wood-mining fallback`,
        0,
        false,
      );
      break;
  }
  } catch (error) {
    finishGatherEvidence(evidence, attemptId, ctx, beforeInventory, hungerBefore, {
      success: false,
      code: ctx.signal?.aborted ? "CANCELLED" : "INTERRUPTED",
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
      retryable: true,
    });
    throw error;
  }
  finishGatherEvidence(evidence, attemptId, ctx, beforeInventory, hungerBefore, result);

  if (!executionIsCurrent(ctx)) {
    return abandonedObservation(ctx, events, gated.action, result);
  }

  const foodMeta = foodResultMeta(result);
  events.emit(
    createEvent(
      result.success ? "ActionCompleted" : "ActionFailed",
      {
        action: gated.action,
        task: gated.task,
        goal: gated.goal,
        source: gated.source,
        success: result.success,
        persisted: result.success ? persistConfirmed(result) : false,
        code: result.success ? undefined : result.code,
        error: result.success ? undefined : result.error,
        decisionKind: decisionKind(ctx.citizenId, "result"),
        skillStatus: skillStatusOf(result),
        workComplete: physicalWorkComplete(result),
        dispatchIntegrity: integrity.ok ? "allowlisted" : "rewritten_fail_closed",
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
  if ((store.hasCommunities() || settlement.shelterComplete) && runtime.project?.status === "COMPLETED") {
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
        if (!store.hasCommunities()) rememberWorkstation(store, "crafting_table", existing.data.position);
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
      if (!store.hasCommunities()) rememberWorkstation(store, "crafting_table", existing.data.position);
      return { success: true, data: { reused: true, position: existing.data.position }, durationMs: 0 };
    }
  }
  const origin = store.hasCommunities() ? undefined : store.getSettlement().origin;
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
      if (store.hasCommunities()) {
        // Creation, unlike merely finding a nearby block, establishes ownership.
        const dimension = ctx.bot.game?.dimension;
        if (!ctx.citizenId || typeof dimension !== "string" || !dimension.trim()) {
          return fail("VERIFY_FAILED", "Placed workstation has no authenticated owner/dimension", placed.durationMs, false);
        }
        const recorded = communityPhysicalState(store).forCitizen(ctx.citizenId).registerAsset(kind, dimension.replace(/^minecraft:/, ""), dest);
        if (!recorded) return fail("VERIFY_FAILED", "Placed workstation ownership could not be recorded", placed.durationMs, false);
      } else {
        rememberWorkstation(store, kind, dest);
      }
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
    const before = inventoryCounts(ctx);
    const collected = await collectResource(ctx, ["stone", "cobblestone", "deepslate"], 1, 48);
    if (collected.success) {
      emitResourceCollected(ctx, before, collected.data.position, expectedItemNames(["stone", "cobblestone", "deepslate"]));
      return collected;
    }
    if (!mayFallBackToExcavation(collected.code)) return collected;
    return mineClaimed(ctx, ["stone", "cobblestone", "deepslate"], runtime, "ore");
  }
  await equipBestTool(ctx, "axe");
  const before = inventoryCounts(ctx);
  const collected = await collectResource(ctx, [...LOG_BLOCK_NAMES], 1, 48);
  if (collected.success) {
    emitResourceCollected(ctx, before, collected.data.position, expectedItemNames(LOG_BLOCK_NAMES));
    return collected;
  }
  if (!mayFallBackToExcavation(collected.code)) return collected;
  return mineClaimed(ctx, LOG_BLOCK_NAMES, runtime, "tree");
}

/**
 * The excavation-only fallback is for "could not reach/claim this target" failures only.
 * It must never run when the world is fine but possession failed (INVENTORY_FULL, ITEM_NOT_FOUND),
 * when the citizen was cancelled, or when a tool is missing: digging more blocks there destroys
 * resources without acquiring any.
 */
function mayFallBackToExcavation(code: string): boolean {
  return !["INVENTORY_FULL", "ITEM_NOT_FOUND", "MISSING_TOOL", "CANCELLED", "INTERRUPTED"].includes(code);
}

function inventoryCounts(ctx: SkillContext): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of ctx.bot.inventory.items()) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
  return counts;
}

/**
 * Inventory item names that prove possession of a block family. A stone block drops cobblestone, deepslate drops
 * cobbled_deepslate; logs are themselves. Anything else that lands in inventory (a sapling, a stick) is NOT the
 * requested resource and must not turn an excavation into a success.
 */
function expectedItemNames(blockNames: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const name of blockNames) {
    out.add(name);
    if (name === "stone") out.add("cobblestone");
    if (name === "deepslate") out.add("cobbled_deepslate");
  }
  return out;
}

function countExpected(counts: Map<string, number>, expected: Set<string>): number {
  let total = 0;
  for (const [name, n] of counts) if (expected.has(name)) total += n;
  return total;
}

/**
 * Emits one ResourceCollected per EXPECTED item whose inventory count really increased since `before`.
 * `count` is the observed inventory delta (never the number of blocks dug), `item`/`name` is the item that
 * entered inventory (a stone block yields cobblestone, so this is the drop, not the block).
 * Emits nothing when the expected items did not grow.
 */
function emitResourceCollected(
  ctx: SkillContext,
  before: Map<string, number>,
  position: Vec3 | undefined,
  expected: Set<string>,
): void {
  if (!ctx.events) return;
  for (const [name, after] of inventoryCounts(ctx)) {
    if (!expected.has(name)) continue;
    const delta = after - (before.get(name) ?? 0);
    if (delta <= 0) continue;
    ctx.events.emit(createEvent("ResourceCollected", { name, item: name, count: delta, position }, ctx.citizenId));
  }
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
  // A contended claim still digs (the block is reachable), but possession is verified exactly like the claimed path.
  const contended = Boolean(ctx.citizenId && !runtime.claims.tryClaim(kind, key, ctx.citizenId, 60_000));
  if (contended) ctx.body.unreachable.mark(position, 8_000);
  const expected = expectedItemNames(names);
  const countsBefore = inventoryCounts(ctx);
  const mined = await mineBlock(ctx, names, 48);
  if (!contended) runtime.claims.release(kind, key, ctx.citizenId);
  if (!mined.success) return mined;
  await collectItem(ctx, undefined, 8);
  const gained = countExpected(inventoryCounts(ctx), expected) - countExpected(countsBefore, expected);
  if (gained <= 0) {
    // Excavation is not possession: no gain of the EXPECTED item (an unrelated pickup does not count) means no
    // ResourceCollected event, no workComplete, no success.
    return fail("ITEM_NOT_FOUND", `Excavated ${mined.data.name} but no ${[...expected].join("/")} entered inventory`, 0, true, {
      excavated: true,
      resourceAcquired: false,
      collected: 0,
      workComplete: false,
      position: mined.data.position,
    });
  }
  emitResourceCollected(ctx, countsBefore, mined.data.position, expected);
  return ok({ name: mined.data.name, position: mined.data.position, collected: gained }, mined.durationMs);
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
  const storedFood = Object.entries(storedContentsFor(ctx, store, chest)).find(
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

  // Day 2: Atlas held a fishing_rod at the pond but gatherFood never tried fishing before FOOD_NOT_FOUND.
  const hasRod = ctx.bot.inventory.items().some((item) => item.name === "fishing_rod");
  const pos = ctx.body.position() ?? ctx.bot.entity?.position;
  if (hasRod && pos) {
    const getBlock = (p: Vec3) => {
      const block = ctx.bot.blockAt(new Vec3Class(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
      if (!block) return undefined;
      return { name: block.name, boundingBox: block.boundingBox };
    };
    const shores = visibleShoresFromWorld(pos, getBlock);
    const storage = authorizedWorkStorage(store, ctx.citizenId);
    if (shores.length > 0 && storage) {
      const shore = shores[0]!;
      const fished = await fishAtShore(ctx, {
        searchOrigin: shore.stand,
        casts: 1,
        destinationStorage: storage,
        permittedStorage: storage,
        returnHome: claimedBed(store, ctx.citizenId),
      });
      return finalizeFoodGather(ctx, foodBefore, fished, "fish_shore");
    }
    if (shores.length > 0 && !storage) {
      return fail(
        "ACCESS_DENIED",
        "Shore/water food is reachable with a rod, but no authorized chest exists to complete fishing — not inventing food",
        0,
        false,
        { hasRod: true, shores: shores.length, workComplete: false },
      );
    }
  }

  // Exhausted local edible evidence. retryable=false so the planner must change strategy (Day 2 spin).
  return fail(
    "FOOD_NOT_FOUND",
    "No edible sources available in reach (crops/berries/leaves/animals/fish) — not mining wood as food",
    0,
    false,
    { workComplete: false, nextTask: "observe" },
  );
}

/** Community mode: last-observed contents of the chest this citizen may use; legacy mode: the settlement snapshot. */
function storedContentsFor(ctx: SkillContext, store: CivilizationStore, chest: Vec3 | undefined): Record<string, number> {
  if (!store.hasCommunities()) return store.getSettlement().storageContents ?? {};
  const dimension = ctx.bot.game?.dimension;
  if (!ctx.citizenId || !chest || typeof dimension !== "string" || !dimension.trim()) return {};
  const key = physicalBlockKey(dimension.replace(/^minecraft:/, ""), chest);
  return communityPhysicalState(store).forCitizen(ctx.citizenId).observedContainerContents(key) ?? {};
}

/** Token read before a live chest check. Undefined when this citizen cannot use the container. */
function containerObservationToken(ctx: SkillContext, store: CivilizationStore, chest: Vec3): number | undefined {
  const dimension = ctx.bot.game?.dimension;
  if (!store.hasCommunities() || !ctx.citizenId || typeof dimension !== "string" || !dimension.trim()) return undefined;
  const key = physicalBlockKey(dimension.replace(/^minecraft:/, ""), chest);
  try {
    return communityPhysicalState(store).forCitizen(ctx.citizenId).containerObservationToken(key);
  } catch (error) {
    console.error(`[executor] container observation token unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** Persists only counts the adapter just observed, scoped to the container's owner/grantees. */
function recordObservedContents(
  ctx: SkillContext,
  store: CivilizationStore,
  chest: Vec3,
  observed: Record<string, number>,
  expectedRevision: number | undefined,
): boolean {
  const dimension = ctx.bot.game?.dimension;
  if (!ctx.citizenId || typeof dimension !== "string" || !dimension.trim()) return false;
  if (expectedRevision === undefined) {
    console.error("[executor] container observation skipped: no revision token from before the live check");
    return false;
  }
  const key = physicalBlockKey(dimension.replace(/^minecraft:/, ""), chest);
  try {
    const accepted = communityPhysicalState(store)
      .forCitizen(ctx.citizenId)
      .recordContainerObservation(key, observed, { expectedRevision });
    if (!accepted) console.error("[executor] stale container observation discarded");
    return accepted;
  } catch (error) {
    // The physical transfer already happened; a lost observation only makes the next withdrawal re-verify live.
    console.error(`[executor] container observation not recorded: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
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
      if (!store.hasCommunities()) forgetWorkstation(store, "chest", chest);
      events.emit(createEvent("WorkstationDestroyed", { kind: "chest", position: chest }, ctx.citizenId));
    }
    return { success: false, code: "CONTAINER_NOT_FOUND", error: "Settlement chest is gone", durationMs: 0, retryable: true };
  }
  const access = assertMayUseChest(store, ctx.citizenId, chest, "communal", ctx.bot.game?.dimension);
  if (!access.success) return access;
  if (ctx.citizenId && !runtime.claims.tryClaim("container", cellClaimKey(chest.x, chest.y, chest.z), ctx.citizenId, 30_000)) {
    return { success: false, code: "CONTAINER_BUSY", error: "Chest is in use", durationMs: 0, retryable: true };
  }
  const expectedRevision = containerObservationToken(ctx, store, chest);
  const result = await depositItems({ ...ctx, storageAccess: "communal" }, undefined, chest);
  if (!executionIsCurrent(ctx)) return abandonedObservation(ctx, events, "depositItems", result);
  runtime.claims.release("container", cellClaimKey(chest.x, chest.y, chest.z), ctx.citizenId);
  if (result.success) {
    // Container contents are restricted to the actual readers, not every community
    // member. Do not publish them to the legacy or community-wide stock snapshots.
    if (store.hasCommunities()) {
      recordObservedContents(ctx, store, chest, result.data.contents, expectedRevision);
    } else {
      const settlement = store.getSettlement();
      settlement.storage = chest;
      settlement.storageContents = result.data.contents;
      store.saveSettlement(settlement);
    }
    // Physical transfer events belong to inventory-service; ActionCompleted belongs here.
  }
  return result;
}

async function withdrawFood(ctx: SkillContext, store: CivilizationStore, events: EventBus): Promise<ActionResult> {
  const chest = knownChest(ctx, store);
  const foodName = Object.entries(storedContentsFor(ctx, store, chest)).find(
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
  const access = assertMayUseChest(store, ctx.citizenId, chest, "communal", ctx.bot.game?.dimension);
  if (!access.success) return access;
  const expectedRevision = containerObservationToken(ctx, store, chest);
  const result = await withdrawItems({ ...ctx, storageAccess: "communal" }, itemName, count, chest);
  if (!executionIsCurrent(ctx)) return abandonedObservation(ctx, events, "withdrawItems", result);
  if (result.success) {
    if (store.hasCommunities()) {
      recordObservedContents(ctx, store, chest, result.data.contents, expectedRevision);
    } else {
      const settlement = store.getSettlement();
      settlement.storageContents = result.data.contents;
      store.saveSettlement(settlement);
    }
    // inventory-service already emitted the physical observation.
  } else if (
    store.hasCommunities() &&
    (result.code === "ITEM_NOT_FOUND" || result.code === "VERIFY_FAILED")
  ) {
    // Live adapter proved this item is absent (or the withdraw did not move it). Clear only that
    // item's last-observed count so planners do not retry a stale positive stock belief. Do not
    // invent a full inventory snapshot from the failure. The token was read before the live check.
    recordObservedContents(ctx, store, chest, { [itemName]: 0 }, expectedRevision);
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
  // This compatibility aggregate predates authenticated community ownership. Personal
  // possession is not a transfer into shared storage, even for one's own community.
  // Keep this check at the write boundary so future callers cannot reintroduce it.
  if (store.hasCommunities()) return;
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
