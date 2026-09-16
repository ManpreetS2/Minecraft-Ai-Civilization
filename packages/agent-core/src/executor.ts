import type { MinecraftBody } from "@civ/minecraft-adapter";
import {
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
  eatFood,
  findBlock,
  flee,
  mineBlock,
  moveTo,
  observeNearby,
  obtainItem,
  openDoor,
  placeBlock,
  returnToSettlement,
  withdrawItems,
  dropItem,
  type SkillContext,
} from "@civ/skills";
import { materialList, nextUnplaced, starterHut, starterHutSize, worldBlocks } from "./blueprint.js";
import { pickBestSite } from "./site.js";
import type { PlannedTask } from "./planner.js";
import type { CivilizationStore } from "./store.js";
import { Vec3 as Vec3Class } from "vec3";

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
    case "gatherFood":
      result = await gatherFood(ctx);
      break;
    case "craftItem":
      result = await bootstrapTools(ctx, plan.item ?? plan.goal);
      break;
    case "obtainItem":
      result = await obtainItem(ctx, plan.item ?? plan.goal ?? "wooden_pickaxe");
      break;
    case "buildShelter":
      result = await buildShelter(ctx, store);
      break;
    case "seekSafety":
      result = await seekSafety(ctx, store);
      break;
    case "returnToSettlement":
      result = await returnToSettlement(ctx, store.getSettlement().origin ?? store.getSettlement().storage);
      break;
    case "withdrawItems":
      result = await withdrawItems(ctx, plan.item ?? "oak_log", 1);
      break;
    case "shareItem":
      result = await shareNearby(ctx);
      break;
    case "mineBlock":
    default:
      result = await gatherByTask(ctx, plan.task);
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

async function gatherByTask(ctx: SkillContext, task: string): Promise<ActionResult> {
  if (task === "mine_stone") {
    return collectResource(ctx, ["stone", "cobblestone", "deepslate"], 1, 48);
  }
  return collectResource(ctx, [...LOG_BLOCK_NAMES], 1, 48);
}

async function gatherFood(ctx: SkillContext): Promise<ActionResult> {
  const berries = await findBlock(ctx, ["sweet_berry_bush"], 20);
  if (berries.success) {
    return mineBlock(ctx, ["sweet_berry_bush"], 20);
  }
  const animal = ctx.body.nearbyEntities(20).find((e) => FOOD_MOBS.has(e.name.toLowerCase()));
  if (animal) {
    const attacked = await attack(ctx, animal.id);
    if (attacked.success) {
      await collectItem(ctx, undefined, 10);
    }
    return attacked;
  }
  const heldFood = ctx.bot.inventory.items().find((i) => FOOD_ITEM_NAMES.has(i.name));
  if (heldFood) {
    return eatFood(ctx);
  }
  return mineBlock(ctx, LOG_BLOCK_NAMES, 48);
}

async function bootstrapTools(ctx: SkillContext, goal = "wooden_pickaxe"): Promise<ActionResult> {
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
  if (has(PICKAXES) && goal !== "stone_pickaxe") {
    return { success: true, data: { item: "already_equipped" }, durationMs: 0 };
  }
  if (goal === "stone_pickaxe" && has(["stone_pickaxe", "iron_pickaxe"])) {
    return { success: true, data: { item: "already_equipped" }, durationMs: 0 };
  }
  return collectResource(ctx, [...LOG_BLOCK_NAMES], 1, 48);
}

async function buildShelter(ctx: SkillContext, store: CivilizationStore): Promise<ActionResult> {
  const settlement = store.getSettlement();
  const hut = starterHut();
  let origin = settlement.origin;
  if (!origin) {
    const pos = ctx.body.position();
    if (!pos) {
      return { success: false, code: "NOT_CONNECTED", error: "No position for shelter origin", durationMs: 0, retryable: true };
    }
    origin = chooseOrigin(pos, ctx);

    settlement.origin = origin;
    settlement.construction = {
      blueprintId: hut.id,
      startedAt: new Date().toISOString(),
      totalBlocks: hut.blocks.length,
      placedBlocks: 0,
      complete: false,
    };
    store.saveSettlement(settlement);
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
    store.saveSettlement(settlement);
    ctx.events?.emit(createEvent("ConstructionCompleted", { blueprint: hut.id }, ctx.citizenId));
    return { success: true, data: { complete: true }, durationMs: 0 };
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
    const current = store.getSettlement();
    if (current.construction) {
      current.construction.placedBlocks = worldBlocks(hut, origin).filter((entry) => {
        const found = bot.blockAt(
          new Vec3Class(Math.floor(entry.position.x), Math.floor(entry.position.y), Math.floor(entry.position.z)),
        );
        return Boolean(found && found.name === entry.block);
      }).length;
      store.saveSettlement(current);
      ctx.events?.emit(
        createEvent(
          "ConstructionProgress",
          { placed: current.construction.placedBlocks, total: current.construction.totalBlocks },
          ctx.citizenId,
        ),
      );
    }
  }
  return placed;
}

function chooseOrigin(from: Vec3, ctx: SkillContext): Vec3 {
  const size = starterHutSize();
  const getBlock = (pos: Vec3) =>
    ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)))?.name;
  const best = pickBestSite(from, size.width, size.depth, getBlock);
  if (best) return best.origin;
  const angle = (Math.floor(from.x + from.z) % 8) * (Math.PI / 4);
  return {
    x: Math.floor(from.x + Math.cos(angle) * 40),
    y: Math.floor(from.y),
    z: Math.floor(from.z + Math.sin(angle) * 40),
  };
}

async function seekSafety(ctx: SkillContext, store: CivilizationStore): Promise<ActionResult> {
  const settlement = store.getSettlement();
  const target = settlement.origin ?? settlement.storage;
  if (target) {
    const moved = await moveTo(ctx, target, 4);
    if (moved.success) return moved;
  }
  const door = await findBlock(ctx, ["oak_door", "spruce_door", "birch_door"], 24);
  if (door.success) {
    await openDoor(ctx, door.data.position);
    return moveTo(ctx, door.data.position, 2);
  }
  return observeNearby(ctx);
}

async function shareNearby(ctx: SkillContext): Promise<ActionResult> {
  const food = ctx.bot.inventory.items().find((i) => FOOD_ITEM_NAMES.has(i.name));
  if (!food) {
    return { success: false, code: "NO_FOOD", error: "Nothing to share", durationMs: 0, retryable: true };
  }
  const nearby = ctx.body.nearbyPlayers(5);
  if (nearby.length === 0) {
    return observeNearby(ctx);
  }
  return dropItem(ctx, food.name, 1);
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

export function bodyContext(body: MinecraftBody, signal?: AbortSignal, events?: EventBus, citizenId?: string): SkillContext | undefined {
  const bot = body.getBot();
  if (!bot?.entity) return undefined;
  return { body, bot, signal, events, citizenId, timeoutMs: 22_000 };
}
