import type { MinecraftBody } from "@civ/minecraft-adapter";
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
  craftItem,
  depositItems,
  dropItem,
  eatFood,
  findBlock,
  flee,
  mineBlock,
  moveTo,
  observeNearby,
  obtainItem,
  placeBlock,
  returnToSettlement,
  wander,
  withdrawItems,
  type SkillContext,
} from "@civ/skills";
import { Vec3 as Vec3Class } from "vec3";
import { cellClaimKey } from "./claims.js";
import { buildShelter, emitProjectCreated } from "./construction.js";
import { bagFromItems, gatherCategory, nextCraftStep } from "./recipes.js";
import type { PlannedTask } from "./planner.js";
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
  const bag = bagFromItems(ctx.bot.inventory.items().map((i) => ({ name: i.name, count: i.count })));
  let table = knownCraftingTable(ctx, store);
  if (table && ctx.citizenId) {
    const claimed = runtime.claims.tryClaim("workstation", cellClaimKey(table.x, table.y, table.z), ctx.citizenId, 40_000);
    if (!claimed) table = undefined;
  }

  const hasTableItem = ctx.bot.inventory.items().some((i) => i.name === "crafting_table");
  const step = nextCraftStep(target, 1, bag, Boolean(table) || hasTableItem);
  if (!step) {
    if (hasTableItem && !table) {
      return placeWorkstation(ctx, store, events, "crafting_table");
    }
    return { success: true, data: { item: target, already: true }, durationMs: 0 };
  }

  if (step.kind === "gather") {
    const category = gatherCategory(step.item);
    if (category === "stone") return gatherByTask(ctx, "mine_stone", runtime);
    if (category === "crop") return gatherFood(ctx, store, events);
    return gatherByTask(ctx, "gather_wood", runtime);
  }

  if (step.kind === "ensure_table") {
    if (hasTableItem) return placeWorkstation(ctx, store, events, "crafting_table");
    return executeCraftChain(ctx, "crafting_table", store, events, runtime);
  }

  if (step.kind === "craft") {
    if (step.needsTable && !table && hasTableItem) {
      const placed = await placeWorkstation(ctx, store, events, "crafting_table");
      if (!placed.success) return placed;
      table = knownCraftingTable(ctx, store);
    }
    const crafted = await craftItem(ctx, step.item, step.count, table);
    if (crafted.success) {
      events.emit(createEvent("ItemCrafted", { item: step.item, count: crafted.data.count }, ctx.citizenId));
      if (step.item === "crafting_table" && !table) {
        return placeWorkstation(ctx, store, events, "crafting_table");
      }
      if (step.item === "chest") {
        const chest = knownChest(ctx, store);
        if (!chest) return placeWorkstation(ctx, store, events, "chest");
      }
      return crafted;
    }
    if (crafted.code === "NO_RECIPE" || crafted.code === "NO_CRAFTING_TABLE") {
      const retry = nextCraftStep(step.item, 1, bag, Boolean(table));
      if (retry && retry.kind === "gather") {
        return gatherByTask(ctx, gatherCategory(retry.item) === "stone" ? "mine_stone" : "gather_wood", runtime);
      }
      if (retry && retry.kind === "craft" && retry.item !== step.item) {
        return craftItem(ctx, retry.item, retry.count, table);
      }
    }
    return crafted;
  }

  return gatherByTask(ctx, "gather_wood", runtime);
}

async function placeWorkstation(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  kind: "crafting_table" | "chest",
): Promise<ActionResult> {
  const pos = ctx.body.position();
  if (!pos) {
    return { success: false, code: "NOT_CONNECTED", error: "No position to place workstation", durationMs: 0, retryable: true };
  }
  const target = { x: Math.floor(pos.x) + 1, y: Math.floor(pos.y), z: Math.floor(pos.z) };
  const existing = ctx.bot.blockAt(new Vec3Class(target.x, target.y, target.z));
  const dest =
    existing && existing.name !== "air" && existing.name !== "cave_air"
      ? { x: target.x, y: target.y + 1, z: target.z }
      : target;
  const placed = await placeBlock(ctx, kind, dest);
  if (!placed.success) return placed;
  rememberWorkstation(store, kind, dest);
  events.emit(createEvent("WorkstationCreated", { kind, position: dest }, ctx.citizenId));
  return placed;
}

async function gatherByTask(ctx: SkillContext, task: string, runtime: SettlementRuntime): Promise<ActionResult> {
  if (task === "mine_stone") {
    if (needsReplacement(ctx, "pickaxe")) {
      const crafted = await craftItem(ctx, "wooden_pickaxe", 1);
      if (!crafted.success && crafted.code === "NO_RECIPE") {
        return gatherByTask(ctx, "gather_wood", runtime);
      }
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
    const walked = await wander(ctx, 28);
    if (!walked.success) return walked;
    return mineBlock(ctx, names, 48);
  }
  const key = cellClaimKey(found.data.position.x, found.data.position.y, found.data.position.z);
  if (ctx.citizenId && !runtime.claims.tryClaim(kind, key, ctx.citizenId, 60_000)) {
    ctx.body.unreachable.mark(found.data.position, 8_000);
    return mineBlock(ctx, names, 48);
  }
  const mined = await mineBlock(ctx, names, 48);
  runtime.claims.release(kind, key, ctx.citizenId);
  if (!mined.success && mined.code === "BLOCK_NOT_FOUND") {
    await wander(ctx, 28);
    return mineBlock(ctx, names, 48);
  }
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
    return craftItem(ctx, "bread", 1);
  }

  return wander(ctx, 20);
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
  const target = settlement.origin ?? settlement.storage ?? knownCraftingTable(ctx, store);
  if (target) {
    return moveTo(ctx, target, 4);
  }
  const house = await findBlock(ctx, ["oak_door", "spruce_door", "white_bed", "crafting_table"], 24);
  if (house.success) {
    return moveTo(ctx, house.data.position, 3);
  }
  return observeNearby(ctx);
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
  const dropped = await dropItem(ctx, food.name, 1);
  if (!dropped.success) return dropped;
  events.emit(
    createEvent(
      "ItemTransferred",
      { item: food.name, count: dropped.data.count, pending: true, receiverHint: nearby[0]?.username },
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
