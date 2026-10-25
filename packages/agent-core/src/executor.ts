import type { MinecraftBody } from "@civ/minecraft-adapter";
import {
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
  craftItem,
  depositItems,
  eatFood,
  equipItem,
  findBlock,
  flee,
  mineBlock,
  observeNearby,
  placeBlock,
  wander,
  type SkillContext,
} from "@civ/skills";
import { materialList, nextUnplaced, starterHut, worldBlocks } from "./blueprint.js";
import { deferredCapabilityResult } from "./goal-dispatch.js";
import type { PlannedTask } from "./planner.js";
import type { CivilizationStore } from "./store.js";
import { Vec3 as Vec3Class } from "vec3";

export type FoodGatherSuccess = {
  acquired: true;
  foodGained: number;
  foodCount: number;
  source: string;
};

const PLANKS = ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks"];
const PICKAXES = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe"];
const FOOD_MOBS = new Set(["cow", "pig", "chicken", "sheep", "mooshroom"]);

export async function executePlan(
  ctx: SkillContext,
  plan: PlannedTask,
  store: CivilizationStore,
  events: EventBus,
): Promise<ActionResult> {
  events.emit(
    createEvent(
      "ActionStarted",
      { action: plan.action, task: plan.task, source: plan.source, reason: plan.reason },
      ctx.citizenId,
    ),
  );

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
      result = await depositItems(ctx);
      break;
    case "observeNearby":
      result = await observeNearby(ctx);
      break;
    case "wander":
      result = await wander(ctx, 28);
      break;
    case "gatherFood":
      result = await gatherFood(ctx);
      break;
    case "craftItem":
      result = await bootstrapTools(ctx);
      break;
    case "buildShelter":
      result = await buildShelter(ctx, store);
      break;
    case "mineBlock":
      result = await gatherByTask(ctx, plan.task);
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
        code: result.success ? undefined : result.code,
        error: result.success ? undefined : result.error,
        ...(foodMeta ? { food: foodMeta } : {}),
      },
      ctx.citizenId,
    ),
  );

  // Only sync settlement resources when food was newly acquired or other actions succeeded.
  if (result.success && ctx.citizenId && foodMeta?.acquired !== false) {
    const sync = updateSettlementFromInventory(ctx, store);
    if (sync && !sync.ok && sync.reason === "error") {
      events.emit(
        createEvent(
          "ErrorOccurred",
          {
            error: `Settlement sync failed after ${plan.task}: ${sync.error instanceof Error ? sync.error.message : String(sync.error)}`,
            durable: false,
          },
          ctx.citizenId,
        ),
      );
    }
  }
  return result;
}

function foodResultMeta(result: ActionResult): { acquired: boolean; foodGained?: number; alreadyHadFood?: boolean } | undefined {
  if (!result.success || !result.data || typeof result.data !== "object") return undefined;
  const data = result.data as Record<string, unknown>;
  if (data.acquired === true && typeof data.foodGained === "number") {
    return { acquired: true, foodGained: data.foodGained };
  }
  return undefined;
}

async function gatherByTask(ctx: SkillContext, task: string): Promise<ActionResult> {
  if (task === "mine_stone") {
    const pick = ctx.bot.inventory.items().find((i) => PICKAXES.includes(i.name));
    if (pick) {
      await equipItem(ctx, pick.name);
    }
    const mined = await mineBlock(ctx, ["stone", "cobblestone", "deepslate"], 48);
    if (!mined.success && mined.code === "BLOCK_NOT_FOUND") {
      await wander(ctx, 28);
      return mineBlock(ctx, ["stone", "cobblestone", "deepslate"], 48);
    }
    if (mined.success) {
      await collectItem(ctx, undefined, 8);
    }
    return mined;
  }
  const mined = await mineBlock(ctx, LOG_BLOCK_NAMES, 48);
  if (!mined.success && mined.code === "BLOCK_NOT_FOUND") {
    const walked = await wander(ctx, 28);
    if (!walked.success) return walked;
    return mineBlock(ctx, LOG_BLOCK_NAMES, 48);
  }
  if (mined.success) {
    await collectItem(ctx, undefined, 8);
  }
  return mined;
}

/** Count edible items currently in inventory (evidence for gather_food success). */
export function countInventoryFood(ctx: SkillContext): number {
  return ctx.bot.inventory.items().filter((i) => FOOD_ITEM_NAMES.has(i.name)).reduce((s, i) => s + i.count, 0);
}

/**
 * gather_food succeeds only when inventory food newly increases.
 * Already-owned food is FOOD_NOT_ACQUIRED (not credited as gathered).
 * Never treats log mining as food acquisition.
 */
export async function gatherFood(ctx: SkillContext): Promise<ActionResult> {
  const foodBefore = countInventoryFood(ctx);
  if (foodBefore > 0) {
    return fail(
      "FOOD_NOT_ACQUIRED",
      `Inventory already holds ${foodBefore} food; not credited as newly gathered (use eatFood to consume)`,
      0,
      false,
    );
  }

  const berries = await findBlock(ctx, ["sweet_berry_bush"], 20);
  if (berries.success) {
    const mined = await mineBlock(ctx, ["sweet_berry_bush"], 20);
    if (mined.success) {
      await collectItem(ctx, undefined, 8);
    }
    return finalizeFoodGather(ctx, foodBefore, mined, "sweet_berry_bush");
  }

  const animal = ctx.body.nearbyEntities(20).find((e) => FOOD_MOBS.has(e.name.toLowerCase()));
  if (animal) {
    const attacked = await attack(ctx, animal.id);
    if (attacked.success) {
      await collectItem(ctx, undefined, 10);
    }
    return finalizeFoodGather(ctx, foodBefore, attacked, animal.name);
  }

  return fail(
    "FOOD_NOT_FOUND",
    "No edible berries, food animals, or food items available — not mining wood as food",
    0,
    true,
  );
}

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
    return ok(data, attempt.durationMs);
  }
  if (!attempt.success) {
    return attempt;
  }
  return fail(
    "FOOD_NOT_FOUND",
    `Action at '${source}' completed but inventory food did not increase`,
    attempt.durationMs,
    true,
  );
}

async function bootstrapTools(ctx: SkillContext): Promise<ActionResult> {
  const count = (name: string) =>
    ctx.bot.inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
  const has = (names: string[]) => ctx.bot.inventory.items().some((i) => names.includes(i.name));

  if (has(LOG_BLOCK_NAMES.map((n) => n)) || has(["oak_log", "birch_log", "spruce_log"])) {
    const log = ctx.bot.inventory.items().find((i) => i.name.endsWith("_log"));
    if (log && count("oak_planks") + count("spruce_planks") + count("birch_planks") < 8) {
      const plankName = log.name.replace("_log", "_planks");
      const crafted = await craftItem(ctx, plankName, 1);
      if (!crafted.success) return crafted;
    }
  }

  if (!has(["crafting_table"]) && PLANKS.some((p) => count(p) >= 4)) {
    const table = await craftItem(ctx, "crafting_table", 1);
    if (table.success) {
      const pos = ctx.body.position();
      if (pos) {
        await placeBlock(ctx, "crafting_table", { x: Math.floor(pos.x) + 1, y: Math.floor(pos.y), z: Math.floor(pos.z) });
      }
    }
  }

  if (PLANKS.some((p) => count(p) >= 2) && count("stick") < 4) {
    const sticks = await craftItem(ctx, "stick", 1);
    if (!sticks.success && sticks.code !== "NO_RECIPE") return sticks;
  }

  if (!has(PICKAXES) && count("stick") >= 2 && PLANKS.some((p) => count(p) >= 3)) {
    return craftItem(ctx, "wooden_pickaxe", 1);
  }
  if (has(["cobblestone"]) && count("cobblestone") >= 3 && count("stick") >= 2 && !has(["stone_pickaxe", "iron_pickaxe"])) {
    return craftItem(ctx, "stone_pickaxe", 1);
  }
  if (has(PICKAXES)) {
    return { success: true, data: { item: "already_equipped" }, durationMs: 0 };
  }
  return mineBlock(ctx, LOG_BLOCK_NAMES, 48);
}

async function buildShelter(ctx: SkillContext, store: CivilizationStore): Promise<ActionResult> {
  if (!store.isOpen()) {
    return fail("DATABASE_ERROR", "Store closed before shelter build", 0, true);
  }
  const settlement = store.getSettlement();
  const hut = starterHut();
  let origin = settlement.origin;
  if (!origin) {
    const pos = ctx.body.position();
    if (!pos) {
      return { success: false, code: "NOT_CONNECTED", error: "No position for shelter origin", durationMs: 0, retryable: true };
    }
    origin = chooseOrigin(pos);
    settlement.origin = origin;
    settlement.construction = {
      blueprintId: hut.id,
      startedAt: new Date().toISOString(),
      totalBlocks: hut.blocks.length,
      placedBlocks: 0,
      complete: false,
    };
    const originWrite = store.safeWrite("saveSettlement:origin", () => store.saveSettlement(settlement));
    if (!originWrite.ok) {
      return fail(
        "DATABASE_ERROR",
        originWrite.reason === "closed"
          ? "Store closed while saving shelter origin"
          : `Unexpected DB error while saving shelter origin: ${originWrite.error instanceof Error ? originWrite.error.message : String(originWrite.error)}`,
        0,
        originWrite.reason === "closed",
      );
    }
    ctx.events?.emit(createEvent("ConstructionStarted", { origin, blueprint: hut.id }, ctx.citizenId));
  }

  const materials = materialList(hut);
  const planksNeeded = materials.oak_planks ?? 0;
  const plankCount = ctx.bot.inventory.items().filter((i) => i.name.endsWith("_planks")).reduce((s, i) => s + i.count, 0);
  if (plankCount < 8) {
    const logs = ctx.bot.inventory.items().find((i) => i.name.endsWith("_log"));
    if (logs) {
      return craftItem(ctx, logs.name.replace("_log", "_planks"), 1);
    }
    return mineBlock(ctx, LOG_BLOCK_NAMES, 48);
  }
  void planksNeeded;

  const bot = ctx.bot;
  const next = nextUnplaced(hut, origin, (position, block) => {
    const found = bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
    return Boolean(found && found.name === block);
  });

  if (!next) {
    settlement.shelterComplete = true;
    settlement.housingCapacity = 5;
    if (settlement.construction) {
      settlement.construction.complete = true;
      settlement.construction.placedBlocks = hut.blocks.length;
    }
    const completeWrite = store.safeWrite("saveSettlement:complete", () => store.saveSettlement(settlement));
    if (!completeWrite.ok) {
      return ok(
        {
          complete: true,
          persisted: false,
          persistReason: completeWrite.reason,
        },
        0,
      );
    }
    ctx.events?.emit(createEvent("ConstructionCompleted", { blueprint: hut.id, persisted: true }, ctx.citizenId));
    return { success: true, data: { complete: true, persisted: true }, durationMs: 0 };
  }

  const itemName = next.block === "oak_door" ? "oak_door" : next.block;
  if (itemName === "torch" && !ctx.bot.inventory.items().some((i) => i.name === "torch")) {
    const coal = ctx.bot.inventory.items().find((i) => i.name === "coal" || i.name === "charcoal");
    if (coal && ctx.bot.inventory.items().some((i) => i.name === "stick")) {
      const crafted = await craftItem(ctx, "torch", 1);
      if (!crafted.success) {
        return placeBlock(ctx, "oak_planks", next.position);
      }
    } else {
      return placeBlock(ctx, "oak_planks", { x: next.position.x, y: next.position.y, z: next.position.z });
    }
  }
  if (itemName === "chest" && !ctx.bot.inventory.items().some((i) => i.name === "chest")) {
    const crafted = await craftItem(ctx, "chest", 1);
    if (!crafted.success) return crafted;
  }
  if (itemName === "crafting_table" && !ctx.bot.inventory.items().some((i) => i.name === "crafting_table")) {
    const crafted = await craftItem(ctx, "crafting_table", 1);
    if (!crafted.success) return crafted;
  }

  const placed = await placeBlock(ctx, itemName === "oak_door" ? "oak_door" : itemName, next.position);
  if (placed.success) {
    const durable = persistConstructionProgress(store, ctx.events, ctx.citizenId, () => {
      const current = store.getSettlement();
      if (!current.construction) return undefined;
      current.construction.placedBlocks = worldBlocks(hut, origin).filter((entry) => {
        const found = bot.blockAt(
          new Vec3Class(Math.floor(entry.position.x), Math.floor(entry.position.y), Math.floor(entry.position.z)),
        );
        return Boolean(found && found.name === entry.block);
      }).length;
      store.saveSettlement(current);
      return { placed: current.construction.placedBlocks, total: current.construction.totalBlocks };
    });
    if (!durable.persisted) {
      return ok(
        { ...(typeof placed.data === "object" && placed.data ? placed.data : {}), persisted: false },
        placed.durationMs,
      );
    }
  }
  return placed;
}

/**
 * Persist construction progress, then announce only if the write succeeded.
 * Physical placement may still be successful when this returns persisted=false.
 */
export function persistConstructionProgress(
  store: CivilizationStore,
  events: EventBus | undefined,
  citizenId: string | undefined,
  mutate: () => { placed: number; total: number } | undefined,
): { persisted: boolean; write: ReturnType<CivilizationStore["safeWrite"]> } {
  if (!store.isOpen()) {
    return { persisted: false, write: { ok: false, reason: "closed" } };
  }
  let snapshot: { placed: number; total: number } | undefined;
  const write = store.safeWrite("saveSettlement:progress", () => {
    snapshot = mutate();
  });
  if (!write.ok || !snapshot) {
    return { persisted: false, write };
  }
  events?.emit(
    createEvent(
      "ConstructionProgress",
      { placed: snapshot.placed, total: snapshot.total, persisted: true },
      citizenId,
    ),
  );
  return { persisted: true, write };
}

function chooseOrigin(from: Vec3): Vec3 {
  const angle = (Math.floor(from.x + from.z) % 8) * (Math.PI / 4);
  return {
    x: Math.floor(from.x + Math.cos(angle) * 40),
    y: Math.floor(from.y),
    z: Math.floor(from.z + Math.sin(angle) * 40),
  };
}

function updateSettlementFromInventory(
  ctx: SkillContext,
  store: CivilizationStore,
): ReturnType<CivilizationStore["safeWrite"]> | undefined {
  if (!store.isOpen()) return { ok: false, reason: "closed" };
  return store.safeWrite("saveSettlement", () => {
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
  });
}

export function bodyContext(body: MinecraftBody, signal?: AbortSignal, events?: EventBus, citizenId?: string): SkillContext | undefined {
  const bot = body.getBot();
  if (!bot?.entity) return undefined;
  return { body, bot, signal, events, citizenId, timeoutMs: 22_000 };
}
