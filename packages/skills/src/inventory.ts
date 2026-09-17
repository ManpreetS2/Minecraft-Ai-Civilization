import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { lookAtPosition } from "./look.js";

function countItem(ctx: SkillContext, name: string): number {
  const knowledge = minecraftKnowledge();
  const n = knowledge.normalizeItemName(name) || name;
  return ctx.bot.inventory
    .items()
    .filter((item) => item.name === n || knowledge.normalizeItemName(item.name) === n)
    .reduce((sum, item) => sum + item.count, 0);
}

export function inventoryCount(ctx: SkillContext, name: string): number {
  return countItem(ctx, name);
}

export function hasItem(ctx: SkillContext, name: string, count = 1): boolean {
  return inventoryCount(ctx, name) >= count;
}

export function listInventory(ctx: SkillContext): Array<{ name: string; count: number }> {
  const bag: Record<string, number> = {};
  for (const item of ctx.bot.inventory.items()) {
    bag[item.name] = (bag[item.name] ?? 0) + item.count;
  }
  return Object.entries(bag).map(([name, count]) => ({ name, count }));
}

export function inventorySpace(ctx: SkillContext): number {
  const inv = ctx.bot.inventory;
  const start = typeof inv.inventoryStart === "number" ? inv.inventoryStart : 9;
  const end = typeof inv.inventoryEnd === "number" ? inv.inventoryEnd : 44;
  let empty = 0;
  for (let i = start; i <= end; i += 1) {
    if (!inv.slots[i]) empty += 1;
  }
  return empty;
}

export function canFitDrop(ctx: SkillContext, names: string[]): boolean {
  if (inventorySpace(ctx) > 0) return true;
  const knowledge = minecraftKnowledge();
  const wanted = new Set(names.map((name) => knowledge.normalizeItemName(name) || name));
  return ctx.bot.inventory.items().some((item) => {
    if (!wanted.has(item.name)) return false;
    const max = item.stackSize ?? 64;
    return item.count < max;
  });
}

export function edibleItems(ctx: SkillContext): Array<{ name: string; count: number }> {
  const knowledge = minecraftKnowledge();
  return listInventory(ctx).filter((item) => knowledge.isFood(item.name));
}

export function toolsOwned(ctx: SkillContext): string[] {
  const knowledge = minecraftKnowledge();
  return listInventory(ctx)
    .filter((item) => knowledge.isTool(item.name))
    .map((item) => item.name);
}

export function buildingItems(ctx: SkillContext): Array<{ name: string; count: number }> {
  return listInventory(ctx).filter(
    (item) =>
      item.name.endsWith("_planks") ||
      item.name.endsWith("_log") ||
      item.name === "cobblestone" ||
      item.name === "dirt" ||
      item.name === "crafting_table" ||
      item.name.endsWith("_door"),
  );
}

export function findInventoryItem(ctx: SkillContext, name: string): { name: string; count: number } | undefined {
  const knowledge = minecraftKnowledge();
  const n = knowledge.normalizeItemName(name) || name;
  const found = ctx.bot.inventory.items().find((item) => item.name === n);
  return found ? { name: found.name, count: found.count } : undefined;
}

export async function equipItem(
  ctx: SkillContext,
  itemName: string,
  destination: "hand" | "head" | "torso" | "legs" | "feet" | "off-hand" = "hand",
): Promise<ActionResult<{ item: string }>> {
  const started = Date.now();
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(itemName) || itemName;
  const item = ctx.bot.inventory.items().find((entry) => entry.name === name);
  if (!item) {
    return fail("ITEM_NOT_FOUND", `No ${name} in inventory`, Date.now() - started, true);
  }
  try {
    await ctx.bot.equip(item, destination);
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const held = destination === "hand" ? ctx.bot.heldItem?.name : name;
  if (destination === "hand" && held !== name) {
    return fail("VERIFY_FAILED", `Expected to hold ${name}, holding ${held ?? "nothing"}`, Date.now() - started, true);
  }
  return ok({ item: name }, Date.now() - started);
}

export async function eatFood(ctx: SkillContext): Promise<ActionResult<{ item: string; food: number }>> {
  const started = Date.now();
  const knowledge = minecraftKnowledge();
  const hunger = ctx.bot.food ?? 20;
  const food = edibleItems(ctx)[0];
  if (!food) {
    return fail("NO_FOOD", "No edible item in inventory", Date.now() - started, true);
  }
  if (!knowledge.canEatNow({ hunger }, food.name) && hunger >= 20) {
    return fail("EAT_FAILED", "Hunger is already full", Date.now() - started, true);
  }
  const stack = ctx.bot.inventory.items().find((item) => item.name === food.name);
  if (!stack) {
    return fail("NO_FOOD", "No edible item in inventory", Date.now() - started, true);
  }
  const beforeHunger = hunger;
  const beforeCount = countItem(ctx, food.name);
  try {
    await ctx.bot.equip(stack, "hand");
    await ctx.bot.consume();
  } catch (error) {
    return fail("EAT_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const afterHunger = ctx.bot.food ?? 0;
  const afterCount = countItem(ctx, food.name);
  if (afterCount >= beforeCount && afterHunger <= beforeHunger && beforeHunger < 20) {
    return fail("VERIFY_FAILED", "Eating did not consume food or raise hunger", Date.now() - started, true);
  }
  return ok({ item: food.name, food: afterHunger }, Date.now() - started);
}

export type ContainerTarget = Vec3;

async function resolveContainer(
  ctx: SkillContext,
  preferred?: ContainerTarget,
  names: string[] = ["chest", "barrel", "trapped_chest"],
): Promise<ActionResult<{ position: Vec3 }>> {
  const started = Date.now();
  if (preferred) {
    const block = ctx.bot.blockAt(new Vec3Class(Math.floor(preferred.x), Math.floor(preferred.y), Math.floor(preferred.z)));
    if (!block || !names.includes(block.name)) {
      return fail("CONTAINER_NOT_FOUND", "Preferred container is missing", Date.now() - started, true);
    }
    const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, preferred, {
      timeoutMs: ctx.timeoutMs ?? 12_000,
      signal: ctx.signal,
    });
    if (!move.success) return move;
    return ok({ position: preferred }, Date.now() - started);
  }
  const found = await findBlock(ctx, names, 16);
  if (!found.success) return found;
  const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, found.data.position, {
    timeoutMs: ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (!move.success) return move;
  return ok({ position: found.data.position }, Date.now() - started);
}

type MineflayerRecipe = {
  requiresTable?: boolean;
  result?: { id?: number; count?: number };
  inShape?: Array<Array<{ id: number } | null | undefined>>;
  ingredients?: Array<{ id: number; count?: number }>;
  delta?: Array<{ id: number; count: number }>;
};

function recipeApi(bot: SkillContext["bot"]): {
  recipesAll: (itemType: number, metadata: number | null, craftingTable: unknown) => MineflayerRecipe[];
  recipesFor: (itemType: number, metadata: number | null, minResultCount: number | null, craftingTable: unknown) => MineflayerRecipe[];
  craft: (recipe: MineflayerRecipe, count: number, craftingTable?: unknown) => Promise<void>;
} {
  return bot as unknown as {
    recipesAll: (itemType: number, metadata: number | null, craftingTable: unknown) => MineflayerRecipe[];
    recipesFor: (itemType: number, metadata: number | null, minResultCount: number | null, craftingTable: unknown) => MineflayerRecipe[];
    craft: (recipe: MineflayerRecipe, count: number, craftingTable?: unknown) => Promise<void>;
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cellItemId(cell: { id: number } | number | null | undefined): number | undefined {
  if (cell == null) return undefined;
  if (typeof cell === "number") return cell >= 0 ? cell : undefined;
  if (typeof cell === "object" && typeof cell.id === "number" && cell.id >= 0) return cell.id;
  return undefined;
}

function recipeIngredientIds(recipe: MineflayerRecipe): Map<number, number> {
  const needed = new Map<number, number>();
  if (Array.isArray(recipe.inShape)) {
    for (const row of recipe.inShape) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const id = cellItemId(cell);
        if (id === undefined) continue;
        needed.set(id, (needed.get(id) ?? 0) + 1);
      }
    }
  }
  if (Array.isArray(recipe.ingredients)) {
    for (const ingredient of recipe.ingredients) {
      const id = cellItemId(ingredient);
      if (id === undefined) continue;
      needed.set(id, (needed.get(id) ?? 0) + Math.abs(ingredient.count ?? 1));
    }
  }
  if (needed.size === 0 && Array.isArray(recipe.delta)) {
    for (const delta of recipe.delta) {
      if (delta.count < 0) needed.set(delta.id, (needed.get(delta.id) ?? 0) + Math.abs(delta.count));
    }
  }
  return needed;
}

function inventoryByName(bot: SkillContext["bot"]): Record<string, number> {
  const bag: Record<string, number> = {};
  for (const item of bot.inventory.items()) {
    bag[item.name] = (bag[item.name] ?? 0) + item.count;
  }
  return bag;
}

function recipeIngredientsOwned(bot: SkillContext["bot"], recipe: MineflayerRecipe): boolean {
  const needed = recipeIngredientIds(recipe);
  if (needed.size === 0) return false;
  const bag = inventoryByName(bot);
  for (const [id, amount] of needed) {
    const name = bot.registry.items[id]?.name;
    if (!name || (bag[name] ?? 0) < amount) return false;
  }
  return true;
}

function scoreOwnedRecipe(bot: SkillContext["bot"], recipe: MineflayerRecipe): number {
  const bag = inventoryByName(bot);
  let score = 0;
  for (const [id, amount] of recipeIngredientIds(recipe)) {
    const name = bot.registry.items[id]?.name ?? "";
    score += Math.min(bag[name] ?? 0, amount);
    if (name.includes("oak_") || name === "stick" || name === "cobblestone") score += 8;
    if (name.includes("cherry_") || name.includes("pale_oak_") || name.includes("bamboo_") || name.includes("mangrove_")) {
      score -= 12;
    }
  }
  return score;
}

async function closeCraftWindow(bot: SkillContext["bot"]): Promise<void> {
  const current = bot.currentWindow;
  if (!current) return;
  try {
    await bot.closeWindow(current);
  } catch {
    // already closed
  }
}

async function emptyHand(bot: SkillContext["bot"]): Promise<void> {
  const safe = bot.inventory.items().find((item) => item.name === "cooked_beef" || item.name === "stick" || item.name.endsWith("_sapling"));
  try {
    if (safe) await bot.equip(safe, "hand");
    else await bot.unequip("hand");
  } catch {
    try {
      await bot.unequip("hand");
    } catch {
      // already empty
    }
  }
}

function faceTowardBlock(bot: SkillContext["bot"], block: { position: { x: number; y: number; z: number } }) {
  const origin = bot.entity?.position;
  if (!origin) return new Vec3Class(0, 1, 0);
  const eye = origin.offset(0, 1.62, 0);
  const center = new Vec3Class(block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5);
  const dx = center.x - eye.x;
  const dy = center.y - eye.y;
  const dz = center.z - eye.z;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ax >= ay && ax >= az) return new Vec3Class(dx > 0 ? -1 : 1, 0, 0);
  if (ay >= ax && ay >= az) return new Vec3Class(0, dy > 0 ? -1 : 1, 0);
  return new Vec3Class(0, 0, dz > 0 ? -1 : 1);
}

async function withDelayedActivate<T>(bot: SkillContext["bot"], fn: () => Promise<T>): Promise<T> {
  const original = bot.activateBlock.bind(bot);
  bot.activateBlock = async (block, direction, cursorPos) => {
    await wait(80);
    const face = direction ?? faceTowardBlock(bot, block);
    return original(block, face, cursorPos);
  };
  try {
    return await fn();
  } finally {
    bot.activateBlock = original;
  }
}

async function syncInventory(bot: SkillContext["bot"]): Promise<void> {
  const window = bot.currentWindow ?? bot.inventory;
  const sync = (bot as unknown as { _syncWindow?: (window: unknown) => Promise<void> })._syncWindow;
  if (typeof sync !== "function") return;
  try {
    await Promise.race([sync.call(bot, window), wait(1500)]);
  } catch {
    // 1.21.11 may not answer a dummy click; inventory packets still apply
  }
}

export async function craftItem(
  ctx: SkillContext,
  itemName: string,
  count = 1,
  table?: ContainerTarget,
): Promise<ActionResult<{ item: string; count: number }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const api = recipeApi(bot);
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(itemName) || itemName;
  const item = bot.registry.itemsByName[name] ?? knowledge.getItem(name);
  if (!item) {
    return fail("UNKNOWN_ITEM", `Unknown item ${itemName}`, Date.now() - started, false, { item: name });
  }

  const bag: Record<string, number> = {};
  for (const held of bot.inventory.items()) bag[held.name] = (bag[held.name] ?? 0) + held.count;

  const knownRecipes = knowledge.getRecipes(name);
  const existing = api.recipesAll(item.id, null, true);
  if (existing.length === 0 && knownRecipes.length === 0) {
    return fail(
      "UNKNOWN_RECIPE",
      `${name} has no crafting recipe in Minecraft ${knowledge.version}`,
      Date.now() - started,
      false,
      { item: name },
    );
  }

  const needsTable =
    existing.some((recipe) => recipe.requiresTable) ||
    knownRecipes.some((recipe) => recipe.needsTable) ||
    knowledge.requiredWorkstation(name) === "crafting_table";

  let craftingTable = table
    ? bot.blockAt(new Vec3Class(Math.floor(table.x), Math.floor(table.y), Math.floor(table.z)))
    : null;
  if (craftingTable && craftingTable.name !== "crafting_table") craftingTable = null;

  if (needsTable && (!craftingTable || craftingTable.name !== "crafting_table")) {
    const found = await findBlock(ctx, ["crafting_table"], 24);
    if (!found.success) {
      return fail(
        "NEED_WORKSTATION",
        `Couldn't craft ${name.replaceAll("_", " ")} because no crafting table is reachable.`,
        Date.now() - started,
        true,
        { item: name },
      );
    }
    const move = await navigationBackend().navigateToInteractWithBlock(bot, found.data.position, {
      timeoutMs: ctx.timeoutMs ?? 18_000,
      signal: ctx.signal,
    });
    if (!move.success) return move;
    craftingTable = bot.blockAt(
      new Vec3Class(Math.floor(found.data.position.x), Math.floor(found.data.position.y), Math.floor(found.data.position.z)),
    );
    if (!craftingTable || craftingTable.name !== "crafting_table") {
      craftingTable = bot.findBlock({
        matching: bot.registry.blocksByName.crafting_table?.id ?? -1,
        maxDistance: 6,
      });
    }
    if (!craftingTable || craftingTable.name !== "crafting_table") {
      return fail("TARGET_GONE", "Crafting table vanished", Date.now() - started, true, { item: name });
    }
  }

  const stations = craftingTable ? ["crafting_table"] : [];
  const analysis = knowledge.analyzeObtain(name, bag, stations, count);
  if (analysis.next?.kind === "gather") {
    const missing = Object.entries(analysis.missingIngredients)[0];
    return fail(
      "MISSING_INGREDIENT",
      `Need ${missing?.[1] ?? analysis.next.count} ${(missing?.[0] ?? analysis.next.item).replaceAll("_", " ")} to craft ${name.replaceAll("_", " ")}.`,
      Date.now() - started,
      true,
      {
        item: name,
        missing: missing?.[0] ?? analysis.next.item,
        missingCount: missing?.[1] ?? analysis.next.count,
        next: analysis.next.item,
        nextTask: analysis.next.item.endsWith("_log") ? "gather_wood" : "mine_stone",
        nextAction: "mineBlock",
      },
    );
  }
  if (analysis.next?.kind === "craft" && analysis.next.item !== name) {
    return fail(
      "PREREQUISITE_MISSING",
      `Need to craft ${analysis.next.item.replaceAll("_", " ")} before ${name.replaceAll("_", " ")}.`,
      Date.now() - started,
      true,
      { item: name, next: analysis.next.item, nextKind: "craft" },
    );
  }
  if (analysis.next?.kind === "ensure_table" || (needsTable && !craftingTable)) {
    return fail(
      "NEED_WORKSTATION",
      `Couldn't craft ${name.replaceAll("_", " ")} because no crafting table is reachable.`,
      Date.now() - started,
      true,
      { item: name },
    );
  }

  const tableContext = needsTable ? craftingTable : null;
  const craftable = api.recipesFor(item.id, null, Math.max(1, count), tableContext);
  if (craftable.length === 0) {
    const firstMissing = Object.entries(analysis.missingIngredients)[0];
    if (firstMissing) {
      return fail(
        "MISSING_INGREDIENT",
        `Need ${firstMissing[1]} ${firstMissing[0].replaceAll("_", " ")} to craft ${name.replaceAll("_", " ")}.`,
        Date.now() - started,
        true,
        { item: name, missing: firstMissing[0], missingCount: firstMissing[1], next: firstMissing[0] },
      );
    }
    if (needsTable && !craftingTable) {
      return fail("NEED_WORKSTATION", "Need a crafting table nearby", Date.now() - started, true, { item: name });
    }
    return fail(
      "CRAFT_FAILED",
      `Recipe for ${name.replaceAll("_", " ")} exists but is not craftable with the current inventory and table.`,
      Date.now() - started,
      true,
      { item: name },
    );
  }

  await closeCraftWindow(bot);
  await emptyHand(bot);
  if (tableContext) {
    await lookAtPosition(ctx, {
      x: tableContext.position.x,
      y: tableContext.position.y,
      z: tableContext.position.z,
    });
  }

  const owned = craftable.filter((recipe) => recipeIngredientsOwned(bot, recipe)).sort((a, b) => scoreOwnedRecipe(bot, b) - scoreOwnedRecipe(bot, a));
  if (owned.length === 0) {
    const firstMissing = Object.entries(analysis.missingIngredients)[0];
    return fail(
      "MISSING_INGREDIENT",
      firstMissing
        ? `Need ${firstMissing[1]} ${firstMissing[0].replaceAll("_", " ")} to craft ${name.replaceAll("_", " ")}.`
        : `Recipe for ${name.replaceAll("_", " ")} exists but none of the ingredient variants are in inventory.`,
      Date.now() - started,
      true,
      { item: name, missing: firstMissing?.[0], missingCount: firstMissing?.[1] },
    );
  }
  const pool = owned.slice(0, 6);
  let lastError = "no recipe attempted";
  for (const recipe of pool) {
    const resultCount = Math.max(1, recipe.result?.count ?? (knowledge.getRecipeOutputCount(name) || 1));
    const crafts = Math.max(1, Math.ceil(count / resultCount));
    const beforeNow = countItem(ctx, name);
    try {
      await withDelayedActivate(bot, () =>
        Promise.race([
          api.craft(recipe, crafts, tableContext ?? undefined),
          wait(6_000).then(() => Promise.reject(new Error("craft timed out waiting for the crafting window"))),
        ]),
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await closeCraftWindow(bot);
      await syncInventory(bot);
      await wait(250);
      const gained = countItem(ctx, name) - beforeNow;
      if (gained > 0) return ok({ item: name, count: gained }, Date.now() - started);
      continue;
    }
    await closeCraftWindow(bot);
    await wait(600);
    const afterNow = countItem(ctx, name);
    if (afterNow > beforeNow) return ok({ item: name, count: afterNow - beforeNow }, Date.now() - started);
    await syncInventory(bot);
    await wait(250);
    const synced = countItem(ctx, name);
    if (synced > beforeNow) return ok({ item: name, count: synced - beforeNow }, Date.now() - started);
    lastError = "inventory did not increase";
    const used = [...recipeIngredientIds(recipe).keys()].map((id) => bot.registry.items[id]?.name ?? String(id));
    console.warn(`craft ${name} recipe ${used.join("+")} did not increase inventory`);
  }
  return fail(
    "VERIFY_FAILED",
    `Crafted ${name.replaceAll("_", " ")} but inventory count did not increase (${lastError})`,
    Date.now() - started,
    true,
    { item: name },
  );
}

export async function depositItems(
  ctx: SkillContext,
  itemName?: string,
  container?: ContainerTarget,
): Promise<ActionResult<{ deposited: number; contents: Record<string, number>; position: Vec3 }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const found = await resolveContainer(ctx, container);
  if (!found.success) return found;
  const block = bot.blockAt(
    new Vec3Class(Math.floor(found.data.position.x), Math.floor(found.data.position.y), Math.floor(found.data.position.z)),
  );
  if (!block || !["chest", "barrel", "trapped_chest"].includes(block.name)) {
    return fail("CONTAINER_NOT_FOUND", "Container vanished", Date.now() - started, true);
  }
  try {
    const chest = await bot.openContainer(block);
    const before = chest.containerItems().reduce((sum, i) => sum + i.count, 0);
    const items = bot.inventory.items().filter((i) => (itemName ? i.name === itemName : keepForStorage(i.name)));
    let deposited = 0;
    for (const item of items) {
      try {
        await chest.deposit(item.type, null, item.count);
        deposited += item.count;
      } catch {
        // slot conflict; continue
      }
    }
    const contents: Record<string, number> = {};
    for (const item of chest.containerItems()) {
      contents[item.name] = (contents[item.name] ?? 0) + item.count;
    }
    const after = chest.containerItems().reduce((sum, i) => sum + i.count, 0);
    chest.close();
    if (deposited === 0 && after <= before) {
      return fail("DEPOSIT_FAILED", "No items moved into container", Date.now() - started, true);
    }
    return ok(
      { deposited: Math.max(deposited, after - before), contents, position: found.data.position },
      Date.now() - started,
    );
  } catch (error) {
    return fail("CONTAINER_BUSY", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
}

export async function withdrawItems(
  ctx: SkillContext,
  itemName: string,
  count = 1,
  container?: ContainerTarget,
): Promise<ActionResult<{ item: string; count: number; contents: Record<string, number> }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const found = await resolveContainer(ctx, container);
  if (!found.success) return found;
  const block = bot.blockAt(
    new Vec3Class(Math.floor(found.data.position.x), Math.floor(found.data.position.y), Math.floor(found.data.position.z)),
  );
  if (!block) {
    return fail("CONTAINER_NOT_FOUND", "Container vanished", Date.now() - started, true);
  }
  const before = countItem(ctx, itemName);
  try {
    const chest = await bot.openContainer(block);
    const stack = chest.containerItems().find((i) => i.name === itemName);
    if (!stack) {
      chest.close();
      return fail("ITEM_NOT_FOUND", `Container has no ${itemName}`, Date.now() - started, true);
    }
    await chest.withdraw(stack.type, null, Math.min(count, stack.count));
    const contents: Record<string, number> = {};
    for (const item of chest.containerItems()) {
      contents[item.name] = (contents[item.name] ?? 0) + item.count;
    }
    chest.close();
    const after = countItem(ctx, itemName);
    if (after <= before) {
      return fail("VERIFY_FAILED", `Withdraw of ${itemName} did not increase inventory`, Date.now() - started, true);
    }
    return ok({ item: itemName, count: after - before, contents }, Date.now() - started);
  } catch (error) {
    return fail("WITHDRAW_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
}

function keepForStorage(name: string): boolean {
  if (name.endsWith("_sword") || name.endsWith("_helmet") || name.endsWith("_chestplate")) return false;
  if (name === "crafting_table") return false;
  return true;
}
