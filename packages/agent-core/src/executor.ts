import type { MinecraftBody } from "@civ/minecraft-adapter";
import { navigationBackend, shouldBlacklistTarget, findReachableInteractionPosition } from "@civ/minecraft-adapter";
import {
  confirmTransfer,
  createEvent,
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
  mineBlock,
  observeNearby,
  obtainItem,
  placeBlock,
  returnToSettlement,
  withdrawItems,
  type PlacementIntent,
  type SkillContext,
} from "@civ/skills";
import { Vec3 as Vec3Class } from "vec3";
import { cellClaimKey } from "./claims.js";
import { buildShelter, emitProjectCreated } from "./construction.js";
import type { PlannedTask } from "./planner.js";
import { interiorStandingCells, isInsideShelter } from "./shelter.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import type { CivilizationStore } from "./store.js";
import { bestCraftTarget, equipBestTool, needsReplacement } from "./tools.js";
import {
  forgetWorkstation,
  knownChest,
  knownCraftingTable,
  rememberWorkstation,
  verifyWorkstation,
} from "./workstations.js";

const FOOD_MOBS = new Set(["cow", "pig", "chicken", "sheep", "mooshroom"]);
const CROP_BLOCKS = ["wheat", "carrots", "potatoes", "beetroots"];

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
      { action: plan.action, task: plan.task, source: plan.source, reason: plan.reason },
      ctx.citizenId,
    ),
  );

  if (ctx.citizenId) {
    ctx.skipBlock = (position) => {
      const owner = runtime.claims.ownerOf("tree", cellClaimKey(position.x, position.y, position.z));
      return Boolean(owner && owner !== ctx.citizenId);
    };
  }

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
      result = await depositToSettlement(ctx, store, events, runtime);
      break;
    case "withdrawItems":
      result = await withdrawFood(ctx, store, events);
      break;
    case "observeNearby":
      result = await observeNearby(ctx);
      break;
    case "gatherFood":
      result = await gatherFood(ctx, store, events);
      break;
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
    case "returnToSettlement":
      result = await returnToSettlement(ctx, store.getSettlement().origin ?? store.getSettlement().storage);
      break;
    case "mineBlock":
    default:
      result = await gatherByTask(ctx, plan.task, runtime);
      break;
  }

  events.emit(
    createEvent(
      result.success ? "ActionCompleted" : "ActionFailed",
      {
        action: plan.action,
        task: plan.task,
        success: result.success,
        code: result.success ? undefined : result.code,
        error: result.success ? undefined : result.error,
      },
      ctx.citizenId,
    ),
  );

  if (result.success && ctx.citizenId) {
    updateSettlementFromInventory(ctx, store);
  }
  return result;
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

async function gatherFood(ctx: SkillContext, store: CivilizationStore, events: EventBus): Promise<ActionResult> {
  const heldFood = ctx.bot.inventory.items().find((i) => FOOD_ITEM_NAMES.has(i.name));
  if (heldFood && (ctx.bot.food ?? 20) <= 8) {
    return eatFood(ctx);
  }

  const chest = knownChest(ctx, store);
  const storedFood = Object.entries(store.getSettlement().storageContents ?? {}).find(([name, count]) => FOOD_ITEM_NAMES.has(name) && count > 0);
  if (!heldFood && chest && storedFood) {
    const withdrawn = await withdrawItemsNamed(ctx, store, events, storedFood[0], 1);
    if (withdrawn.success) return withdrawn;
  }

  const mature = await findMatureCrop(ctx);
  if (mature.success) {
    const mined = await mineBlock(ctx, CROP_BLOCKS, 24);
    if (mined.success) await collectItem(ctx, undefined, 8);
    return mined;
  }

  const berries = await findBlock(ctx, ["sweet_berry_bush"], 20);
  if (berries.success) {
    const mined = await mineBlock(ctx, ["sweet_berry_bush"], 20);
    if (mined.success) await collectItem(ctx, undefined, 8);
    return mined;
  }

  const apples = await findBlock(ctx, ["oak_leaves", "dark_oak_leaves"], 20);
  if (apples.success) {
    const mined = await mineBlock(ctx, ["oak_leaves", "dark_oak_leaves"], 20);
    if (mined.success) await collectItem(ctx, undefined, 8);
    return mined;
  }

  const animal = ctx.body.nearbyEntities(20).find((e) => FOOD_MOBS.has(e.name.toLowerCase()));
  if (animal) {
    const attacked = await attack(ctx, animal.id);
    if (attacked.success) await collectItem(ctx, undefined, 10);
    return attacked;
  }

  const wheat = ctx.bot.inventory.items().filter((i) => i.name === "wheat").reduce((s, i) => s + i.count, 0);
  if (wheat >= 3) {
    return obtainItem(ctx, "bread", 1);
  }

  const farther = await findBlock(ctx, [...CROP_BLOCKS, "sweet_berry_bush"], 48);
  if (farther.success) {
    const mined = await mineBlock(ctx, [...CROP_BLOCKS, "sweet_berry_bush"], 48);
    if (mined.success) await collectItem(ctx, undefined, 8);
    return mined;
  }

  return {
    success: false,
    code: "NO_FOOD",
    error: "No food sources in search range",
    durationMs: 0,
    retryable: true,
  };
}

async function findMatureCrop(ctx: SkillContext): Promise<ActionResult<{ name: string; position: Vec3 }>> {
  const found = await findBlock(ctx, CROP_BLOCKS, 24);
  if (!found.success) return found;
  const block = ctx.bot.blockAt(
    new Vec3Class(found.data.position.x, found.data.position.y, found.data.position.z),
  );
  const age = Number((block as { getProperties?: () => { age?: number } } | null)?.getProperties?.().age ?? 7);
  if (age < 7) {
    ctx.body.unreachable.mark(found.data.position, 12_000);
    return findBlock(ctx, CROP_BLOCKS, 24);
  }
  return found;
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
