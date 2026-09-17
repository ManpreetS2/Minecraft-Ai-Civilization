import { createEvent, fail, ok, LOG_BLOCK_NAMES, type ActionResult } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import type { SkillContext } from "./context.js";
import { Vec3 as Vec3Class } from "vec3";
import { collectResource } from "./collect.js";
import { craftItem, inventoryCount } from "./inventory.js";
import { lookAtPosition } from "./look.js";
import { findBlock } from "./observe.js";
import {
  evaluateFunctionalPlacement,
  worldGetterFromBot,
} from "./placement.js";

export type RecipeStep = {
  item: string;
  kind: "collect" | "craft";
  blocks?: string[];
  ingredients?: Array<{ item: string; count: number }>;
};

const STONE = ["cobblestone", "stone", "cobbled_deepslate"];
const MAX_OBTAIN_DEPTH = 12;

export function recipeFor(item: string): RecipeStep | undefined {
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(item) || item;
  const recipe = knowledge.getRecipe(name);
  if (recipe) {
    return {
      item: recipe.result,
      kind: "craft",
      ingredients: Object.entries(recipe.ingredients).map(([ingredient, count]) => ({ item: ingredient, count })),
    };
  }
  if (knowledge.getItem(name) && knowledge.getRecipes(name).length === 0) {
    return { item: name, kind: "collect", blocks: collectBlocks(name) };
  }
  if (name.endsWith("_log") || name === "cobblestone" || name === "stone") {
    return { item: name, kind: "collect", blocks: collectBlocks(name) };
  }
  return undefined;
}

export function missingPrerequisites(held: Record<string, number>, item: string): string[] {
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(item) || item;
  const analysis = knowledge.analyzeObtain(name, held, []);
  if (analysis.alreadyOwned) return [];
  const missing: string[] = [];
  for (const step of analysis.steps) {
    if (step.kind === "gather" && !missing.includes(step.item)) missing.push(step.item);
    if (step.kind === "ensure_table" && !missing.includes("crafting_table") && !held.crafting_table) {
      missing.push("crafting_table");
    }
  }
  if (missing.length === 0 && analysis.next?.kind === "craft") missing.push(analysis.next.item);
  if (missing.length === 0 && !analysis.known) return [name];
  if (missing.length === 0) missing.push(name);
  return missing;
}

export function prerequisiteChain(item: string): string[] {
  return missingPrerequisites({}, item);
}

function collectBlocks(item: string): string[] {
  if (item.endsWith("_log") || item === "oak_log" || item === "any_log") return [...LOG_BLOCK_NAMES];
  if (item === "cobblestone" || item === "stone") return STONE;
  if (item === "coal") return ["coal_ore", "deepslate_coal_ore"];
  return [item];
}

function isGatherable(item: string): boolean {
  return (
    item.endsWith("_log") ||
    item === "any_log" ||
    item === "cobblestone" ||
    item === "stone" ||
    item === "coal" ||
    item === "wheat"
  );
}

export async function obtainItem(
  ctx: SkillContext,
  item: string,
  amount = 1,
  depth = 0,
  stack: string[] = [],
): Promise<ActionResult<{ item: string; count: number }>> {
  const started = Date.now();
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(item) || item;
  if (depth > MAX_OBTAIN_DEPTH) {
    return fail("PREREQUISITE_MISSING", `Could not finish prerequisite chain for ${name}`, Date.now() - started, true, {
      item: name,
    });
  }
  if (stack.includes(name)) {
    return fail("PREREQUISITE_MISSING", `Recipe cycle while obtaining ${name}`, Date.now() - started, false, { item: name });
  }
  const nextStack = [...stack, name];
  if (inventoryCount(ctx, name) >= amount) {
    return ok({ item: name, count: inventoryCount(ctx, name) }, Date.now() - started);
  }

  for (let guard = 0; guard < 20; guard += 1) {
    if (inventoryCount(ctx, name) >= amount) {
      return ok({ item: name, count: inventoryCount(ctx, name) }, Date.now() - started);
    }
    const held = inventoryMap(ctx);
    const tableBlock = ctx.bot.findBlock({
      matching: ctx.bot.registry.blocksByName.crafting_table?.id ?? -1,
      maxDistance: 24,
    });
    const stations = tableBlock ? ["crafting_table"] : [];
    const analysis = knowledge.analyzeObtain(name, held, stations, amount);

    if (!analysis.known && analysis.recipes.length === 0 && !knowledge.recipeExists(name)) {
      if (isGatherable(name)) {
        const collected = await collectResource(ctx, collectBlocks(name), Math.max(1, amount - inventoryCount(ctx, name)), 48);
        if (!collected.success) return collected;
        continue;
      }
      if (!knowledge.getItem(name)) {
        return fail("UNKNOWN_ITEM", `Unknown item ${name}`, Date.now() - started, false, { item: name });
      }
      return fail(
        "UNKNOWN_RECIPE",
        `${name} has no crafting recipe in Minecraft ${knowledge.version}`,
        Date.now() - started,
        false,
        { item: name },
      );
    }

    const step = analysis.next;
    if (!step) break;
    if (step.kind === "gather") {
      const collected = await collectResource(ctx, collectBlocks(step.item), Math.max(1, step.count), 64);
      if (!collected.success) return collected;
      continue;
    }
    if (step.kind === "ensure_table") {
      const ensured = await ensureCraftingTable(ctx, depth, nextStack);
      if (!ensured.success) return ensured;
      continue;
    }
    if (step.kind !== "craft") break;
    if (step.item !== name) {
      const output = Math.max(1, knowledge.getRecipeOutputCount(step.item) || 1);
      const want = inventoryCount(ctx, step.item) + Math.max(output, (step.count || 1) * output);
      const nested = await obtainItem(ctx, step.item, want, depth + 1, nextStack);
      if (!nested.success) return nested;
      continue;
    }
    if (step.needsTable) {
      const ensured = await ensureCraftingTable(ctx, depth, nextStack);
      if (!ensured.success) return ensured;
    }
    const crafted = await craftItem(ctx, step.item, Math.max(1, step.count));
    if (crafted.success) {
      ctx.events?.emit(createEvent("ItemCrafted", { item: step.item, count: crafted.data.count }, ctx.citizenId));
      continue;
    }
    const nextItem =
      (typeof crafted.details?.next === "string" && crafted.details.next) ||
      (typeof crafted.details?.missing === "string" && crafted.details.missing) ||
      (analysis.next?.kind === "craft" && analysis.next.item !== name ? analysis.next.item : undefined) ||
      Object.keys(analysis.missingIngredients)[0];
    if (
      nextItem &&
      nextItem !== name &&
      !nextStack.includes(nextItem) &&
      (crafted.code === "PREREQUISITE_MISSING" || crafted.code === "MISSING_INGREDIENT")
    ) {
      const need = Math.max(1, Number(crafted.details?.missingCount) || 1);
      const nested = await obtainItem(ctx, nextItem, inventoryCount(ctx, nextItem) + need, depth + 1, nextStack);
      if (!nested.success) return nested;
      continue;
    }
    if (crafted.code === "NEED_WORKSTATION" || crafted.code === "NO_CRAFTING_TABLE") {
      const ensured = await ensureCraftingTable(ctx, depth, nextStack);
      if (!ensured.success) return ensured;
      continue;
    }
    return crafted;
  }

  if (inventoryCount(ctx, name) >= amount) {
    return ok({ item: name, count: inventoryCount(ctx, name) }, Date.now() - started);
  }
  return fail("VERIFY_FAILED", `Could not obtain ${amount} ${name.replaceAll("_", " ")}`, Date.now() - started, true, {
    item: name,
  });
}

async function ensureCraftingTable(
  ctx: SkillContext,
  depth: number,
  stack: string[],
): Promise<ActionResult<{ item: string; count: number } | { name: string }>> {
  const close = await findBlock(ctx, ["crafting_table"], 24);
  if (close.success) {
    return ok({ item: "crafting_table", count: 1 }, 0);
  }
  if (inventoryCount(ctx, "crafting_table") < 1) {
    const made = await obtainItem(ctx, "crafting_table", 1, depth + 1, stack);
    if (!made.success) return made;
  }
  const pos = ctx.body.position();
  if (!pos) return fail("NOT_CONNECTED", "No position to place a crafting table", 0, true, { item: "crafting_table" });
  const placed = await placeAdjacentCraftingTable(ctx);
  if (placed.success) return placed;
  return fail("PLACE_FAILED", "Could not place a crafting table nearby", 0, true, { item: "crafting_table" });
}

async function placeAdjacentCraftingTable(ctx: SkillContext) {
  const started = Date.now();
  const bot = ctx.bot;
  const pos = ctx.body.position();
  if (!pos) return fail("NOT_CONNECTED", "No position to place a crafting table", 0, true, { item: "crafting_table" });
  const item = bot.inventory.items().find((entry) => entry.name === "crafting_table");
  if (!item) return fail("ITEM_NOT_FOUND", "No crafting table item to place", 0, true, { item: "crafting_table" });
  try {
    await bot.equip(item, "hand");
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true, {
      item: "crafting_table",
    });
  }
  const originX = Math.floor(pos.x);
  const originY = Math.floor(pos.y);
  const originZ = Math.floor(pos.z);
  const offsets = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
    { x: 2, z: 0 },
    { x: -2, z: 0 },
    { x: 0, z: 2 },
    { x: 0, z: -2 },
    { x: 1, z: 1 },
    { x: -1, z: -1 },
    { x: 1, z: -1 },
    { x: -1, z: 1 },
  ];
  const replaceable = new Set(["air", "cave_air", "short_grass", "grass", "tall_grass", "snow", "fern"]);
  for (const y of [originY, originY + 1, originY - 1]) {
    for (const offset of offsets) {
      const dest = new Vec3Class(originX + offset.x, y, originZ + offset.z);
      const feet = bot.blockAt(dest);
      const below = bot.blockAt(dest.offset(0, -1, 0));
      if (!feet || !below) continue;
      if (!replaceable.has(feet.name)) continue;
      if (below.boundingBox !== "block") continue;
      const allowed = evaluateFunctionalPlacement({
        item: "crafting_table",
        purpose: "temporary_worksite",
        position: { x: dest.x, y: dest.y, z: dest.z },
        getBlock: worldGetterFromBot(bot),
      });
      if (!allowed.ok) continue;
      await lookAtPosition(ctx, { x: dest.x, y: dest.y, z: dest.z });
      try {
        await bot.placeBlock(below, new Vec3Class(0, 1, 0));
      } catch {
        continue;
      }
      const after = bot.blockAt(dest);
      if (after?.name === "crafting_table") {
        ctx.events?.emit(
          createEvent(
            "WorkstationCreated",
            {
              kind: "crafting_table",
              temporary: true,
              purpose: "temporary_worksite",
              cleanupPolicy: "pickup_when_idle",
              position: { x: dest.x, y: dest.y, z: dest.z },
            },
            ctx.citizenId,
          ),
        );
        return ok({ name: "crafting_table", position: { x: dest.x, y: dest.y, z: dest.z } }, Date.now() - started);
      }
    }
  }
  return fail("PLACE_FAILED", "No adjacent air cell to place a crafting table", Date.now() - started, true, {
    item: "crafting_table",
  });
}

function inventoryMap(ctx: SkillContext): Record<string, number> {
  const held: Record<string, number> = {};
  for (const item of ctx.bot.inventory.items()) {
    held[item.name] = (held[item.name] ?? 0) + item.count;
  }
  return held;
}
