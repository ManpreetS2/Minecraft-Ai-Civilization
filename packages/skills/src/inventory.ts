import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { lookAtPosition } from "./look.js";
import { waitForSignal } from "./window-open.js";
import {
  availableUnreservedCount,
  countItem,
  depositItem,
  edibleItems,
  equipItem as equipThroughInventory,
  withdrawItem,
} from "./inventory-service.js";

export {
  availableUnreservedCount,
  buildingItems,
  canFitDrop,
  canReceive,
  clearReservations,
  compactInventoryFacts,
  countItem,
  edibleItems,
  findInventoryItem,
  findStacks,
  freeCapacity,
  hasItem,
  heldItem,
  inventorySpace,
  listInventory,
  releaseReservation,
  reserveItems,
  snapshotInventory,
  toolsOwned,
  durabilityFromItem,
  toolDurabilityFacts,
} from "./inventory-service.js";

export function inventoryCount(ctx: SkillContext, name: string): number {
  return countItem(ctx, name);
}

export async function equipItem(
  ctx: SkillContext,
  itemName: string,
  destination: "hand" | "head" | "torso" | "legs" | "feet" | "off-hand" = "hand",
): Promise<ActionResult<{ item: string }>> {
  const result = await equipThroughInventory(ctx, itemName, destination);
  if (!result.success) return result;
  return ok({ item: result.data.item }, result.durationMs);
}

function waitAbortable(ms: number, signal?: AbortSignal): Promise<"done" | "aborted"> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve("aborted");
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve("done");
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function eatFood(ctx: SkillContext): Promise<ActionResult<{ item: string; food: number }>> {
  const started = Date.now();
  if (ctx.signal?.aborted) {
    return fail("CANCELLED", "eatFood cancelled before eating", Date.now() - started, false, {
      inventoryPreserved: true,
      workComplete: false,
    });
  }
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
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "eatFood cancelled before equip", Date.now() - started, false, {
        inventoryPreserved: true,
        workComplete: false,
      });
    }
    await ctx.bot.equip(stack, "hand");
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "eatFood cancelled before consume", Date.now() - started, false, {
        inventoryPreserved: true,
        workComplete: false,
        item: food.name,
      });
    }
    await ctx.bot.consume();
    const waitResult = await waitAbortable(800, ctx.signal);
    if (waitResult === "aborted") {
      // Consume may already have applied; report inventory/hunger truthfully.
      const midHunger = ctx.bot.food ?? 0;
      const midCount = countItem(ctx, food.name);
      const midConsumed = midCount < beforeCount;
      const midRecovered = midHunger > beforeHunger;
      if (midConsumed || midRecovered) {
        return fail("INTERRUPTED", "eatFood cancelled after food was consumed", Date.now() - started, true, {
          inventoryPreserved: !midConsumed,
          workComplete: false,
          item: food.name,
          food: midHunger,
          consumed: midConsumed,
        });
      }
      return fail("CANCELLED", "eatFood cancelled during verification wait", Date.now() - started, false, {
        inventoryPreserved: true,
        workComplete: false,
        item: food.name,
      });
    }
  } catch (error) {
    return fail("EAT_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const afterHunger = ctx.bot.food ?? 0;
  const afterCount = countItem(ctx, food.name);
  const consumed = afterCount < beforeCount;
  const recovered = afterHunger > beforeHunger;
  if (ctx.signal?.aborted) {
    if (consumed || recovered) {
      return fail("INTERRUPTED", "eatFood cancelled after food was consumed", Date.now() - started, true, {
        inventoryPreserved: !consumed,
        workComplete: false,
        item: food.name,
        food: afterHunger,
        consumed,
      });
    }
    return fail("CANCELLED", "eatFood cancelled without consumption", Date.now() - started, false, {
      inventoryPreserved: true,
      workComplete: false,
      item: food.name,
    });
  }
  if (!consumed && !recovered) {
    return fail("VERIFY_FAILED", "Eating did not consume food or raise hunger", Date.now() - started, true);
  }
  return ok({ item: food.name, food: afterHunger }, Date.now() - started);
}

export type ContainerTarget = Vec3;

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

const PLANK_NAMES = [
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "mangrove_planks",
  "cherry_planks",
  "bamboo_planks",
  "crimson_planks",
  "warped_planks",
] as const;

/**
 * When Mineflayer has not exposed recipes yet (or offline fixtures omit them),
 * synthesize a recipe from `@civ/minecraft-knowledge` using concrete inventory
 * ingredient ids. Does not invent items — craft still requires inventory gain.
 */
export function synthesizeKnowledgeRecipe(
  bot: SkillContext["bot"],
  itemName: string,
): MineflayerRecipe | undefined {
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(itemName) || itemName;
  const bag = inventoryByName(bot);
  const known = knowledge.getRecipe(name, bag);
  if (!known) return undefined;
  const resultMeta = bot.registry.itemsByName[name] ?? knowledge.getItem(name);
  if (!resultMeta || typeof resultMeta.id !== "number") return undefined;

  const ingredients: Array<{ id: number; count: number }> = [];
  for (const [rawName, amount] of Object.entries(known.ingredients)) {
    let remaining = amount;
    if (rawName === "any_planks") {
      for (const plank of PLANK_NAMES) {
        if (remaining <= 0) break;
        const have = bag[plank] ?? 0;
        if (have <= 0) continue;
        const take = Math.min(have, remaining);
        const id = bot.registry.itemsByName[plank]?.id ?? knowledge.getItem(plank)?.id;
        if (typeof id !== "number") continue;
        ingredients.push({ id, count: take });
        remaining -= take;
      }
      if (remaining > 0) return undefined;
      continue;
    }
    const id = bot.registry.itemsByName[rawName]?.id ?? knowledge.getItem(rawName)?.id;
    if (typeof id !== "number") return undefined;
    if ((bag[rawName] ?? 0) < amount) return undefined;
    ingredients.push({ id, count: amount });
  }
  if (ingredients.length === 0) return undefined;
  return {
    requiresTable: Boolean(known.needsTable),
    result: { id: resultMeta.id, count: known.resultCount ?? (knowledge.getRecipeOutputCount(name) || 1) },
    ingredients,
  };
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

const craftActivateGeneration = new WeakMap<object, number>();

/** Keeps the crafting click delayed, and refuses it after this attempt is cancelled, timed out, or replaced. */
function installCraftActivateGuard(bot: SkillContext["bot"], signal?: AbortSignal): { abandon(): void; release(): void } {
  const original = bot.activateBlock.bind(bot);
  const generation = (craftActivateGeneration.get(bot) ?? 0) + 1;
  craftActivateGeneration.set(bot, generation);
  let abandoned = false;
  const refused = () =>
    Object.assign(new Error("craft activate refused after this attempt was cancelled or timed out"), { code: "CANCELLED" });
  bot.activateBlock = async (block, direction, cursorPos) => {
    if (craftActivateGeneration.get(bot) !== generation || abandoned || signal?.aborted) throw refused();
    await waitForSignal(signal, 80);
    if (craftActivateGeneration.get(bot) !== generation || abandoned || signal?.aborted) throw refused();
    const positioned = block as { position?: { x: number; y: number; z: number } } | undefined;
    if (!positioned?.position) throw new Error("craft activate missing block");
    const face = direction ?? faceTowardBlock(bot, positioned as { position: { x: number; y: number; z: number } });
    return original(block, face, cursorPos);
  };
  return {
    abandon() {
      abandoned = true;
    },
    release() {
      if (craftActivateGeneration.get(bot) !== generation) return;
      bot.activateBlock = original;
      craftActivateGeneration.delete(bot);
    },
  };
}

function craftingCancelled(started: number, item: string) {
  return fail("CANCELLED", "Crafting cancelled for this citizen", Date.now() - started, false, {
    item,
    inventoryPreserved: true,
    workComplete: false,
  });
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
  if (ctx.signal?.aborted) {
    return fail("CANCELLED", "Crafting cancelled for this citizen", 0, false, {
      item: itemName,
      inventoryPreserved: true,
      workComplete: false,
    });
  }
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
  let craftable = api.recipesFor(item.id, null, Math.max(1, count), tableContext);
  if (craftable.length === 0) {
    // Knowledge fallback: Mineflayer recipe list can be empty while the 1.21 recipe is known
    // and ingredients are already held. Still requires a later inventory increase to succeed.
    const synthesized = synthesizeKnowledgeRecipe(bot, name);
    if (synthesized && (!needsTable || craftingTable)) {
      craftable = [synthesized];
    }
  }
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
  if (ctx.signal?.aborted) return craftingCancelled(started, name);
  await emptyHand(bot);
  if (ctx.signal?.aborted) return craftingCancelled(started, name);
  if (tableContext) {
    await lookAtPosition(ctx, {
      x: tableContext.position.x,
      y: tableContext.position.y,
      z: tableContext.position.z,
    });
    if (ctx.signal?.aborted) return craftingCancelled(started, name);
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
    if (ctx.signal?.aborted) return craftingCancelled(started, name);
    const resultCount = Math.max(1, recipe.result?.count ?? (knowledge.getRecipeOutputCount(name) || 1));
    const crafts = Math.max(1, Math.ceil(count / resultCount));
    for (const [id, amount] of recipeIngredientIds(recipe)) {
      const ingredientName = bot.registry.items[id]?.name;
      if (!ingredientName) continue;
      const need = amount * crafts;
      if (availableUnreservedCount(ctx, ingredientName) < need) {
        return fail(
          "ITEM_RESERVED",
          `${ingredientName.replaceAll("_", " ")} is reserved and cannot be used to craft ${name.replaceAll("_", " ")}.`,
          Date.now() - started,
          true,
          { item: name, missing: ingredientName, missingCount: need },
        );
      }
    }
    const beforeNow = countItem(ctx, name);
    const guard = installCraftActivateGuard(bot, ctx.signal);
    const craftPromise = api.craft(recipe, crafts, tableContext ?? undefined);
    void craftPromise.finally(() => guard.release()).catch(() => undefined);
    const raced = await Promise.race([
      craftPromise.then(
        () => "done" as const,
        (error: unknown) => ({ error }),
      ),
      waitForSignal(ctx.signal, 6_000).then(() => (ctx.signal?.aborted ? ("aborted" as const) : ("timeout" as const))),
    ]);
    if (raced === "done") {
      await closeCraftWindow(bot);
      await waitForSignal(ctx.signal, 600);
      const afterNow = countItem(ctx, name);
      if (afterNow > beforeNow) return ok({ item: name, count: afterNow - beforeNow }, Date.now() - started);
      await syncInventory(bot);
      await waitForSignal(ctx.signal, 250);
      const synced = countItem(ctx, name);
      if (synced > beforeNow) return ok({ item: name, count: synced - beforeNow }, Date.now() - started);
      if (ctx.signal?.aborted) return craftingCancelled(started, name);
      lastError = "inventory did not increase";
      const used = [...recipeIngredientIds(recipe).keys()].map((id) => bot.registry.items[id]?.name ?? String(id));
      console.warn(`craft ${name} recipe ${used.join("+")} did not increase inventory`);
      continue;
    }
    if (typeof raced === "object") {
      lastError = raced.error instanceof Error ? raced.error.message : String(raced.error);
      await closeCraftWindow(bot);
      await syncInventory(bot);
      await waitForSignal(ctx.signal, 250);
      const gained = countItem(ctx, name) - beforeNow;
      if (gained > 0) return ok({ item: name, count: gained }, Date.now() - started);
      if (ctx.signal?.aborted) return craftingCancelled(started, name);
      continue;
    }
    await closeCraftWindow(bot);
    await syncInventory(bot);
    const gained = countItem(ctx, name) - beforeNow;
    if (gained > 0) return ok({ item: name, count: gained }, Date.now() - started);
    guard.abandon();
    if (raced === "aborted" || ctx.signal?.aborted) return craftingCancelled(started, name);
    return fail("TIMEOUT", "Crafting timed out before the recipe finished", Date.now() - started, true, {
      item: name,
      inventoryPreserved: true,
      workComplete: false,
    });
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
  const names = itemName
    ? [itemName]
    : ctx.bot.inventory.items().map((item) => item.name).filter(keepForStorage);
  const unique = [...new Set(names)];
  if (unique.length === 0) {
    return fail("ITEM_NOT_FOUND", "Nothing to deposit", Date.now() - started, true);
  }
  let deposited = 0;
  let position: Vec3 | undefined;
  const contents: Record<string, number> = {};
  for (const name of unique) {
    const result = await depositItem(ctx, name, undefined, container ?? position);
    if (!result.success) {
      if (deposited === 0) return result;
      break;
    }
    deposited += result.data.deposited;
    position = result.data.position;
    contents[name] = result.data.containerAfter;
  }
  if (deposited === 0 || !position) {
    return fail("DEPOSIT_FAILED", "No items moved into container", Date.now() - started, true);
  }
  return ok({ deposited, contents, position }, Date.now() - started);
}

export async function withdrawItems(
  ctx: SkillContext,
  itemName: string,
  count = 1,
  container?: ContainerTarget,
): Promise<ActionResult<{ item: string; count: number; contents: Record<string, number> }>> {
  const result = await withdrawItem(ctx, itemName, count, container);
  if (!result.success) return result;
  return ok(
    { item: result.data.item, count: result.data.count, contents: { [result.data.item]: result.data.containerAfter } },
    result.durationMs,
  );
}

function keepForStorage(name: string): boolean {
  if (name.endsWith("_sword") || name.endsWith("_helmet") || name.endsWith("_chestplate")) return false;
  if (name === "crafting_table") return false;
  return true;
}
