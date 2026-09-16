import { fail, ok, type ActionResult, FOOD_ITEM_NAMES, type Vec3 } from "@civ/shared";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { moveTo } from "./movement.js";
import { findBlock } from "./observe.js";

function countItem(ctx: SkillContext, name: string): number {
  return ctx.bot.inventory
    .items()
    .filter((item) => item.name === name)
    .reduce((sum, item) => sum + item.count, 0);
}

export function inventoryCount(ctx: SkillContext, name: string): number {
  return countItem(ctx, name);
}

export async function equipItem(
  ctx: SkillContext,
  itemName: string,
  destination: "hand" | "head" | "torso" | "legs" | "feet" | "off-hand" = "hand",
): Promise<ActionResult<{ item: string }>> {
  const started = Date.now();
  const item = ctx.bot.inventory.items().find((i) => i.name === itemName);
  if (!item) {
    return fail("ITEM_NOT_FOUND", `No ${itemName} in inventory`, Date.now() - started, true);
  }
  try {
    await ctx.bot.equip(item, destination);
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const held = destination === "hand" ? ctx.bot.heldItem?.name : itemName;
  if (destination === "hand" && held !== itemName) {
    return fail("VERIFY_FAILED", `Expected to hold ${itemName}, holding ${held ?? "nothing"}`, Date.now() - started, true);
  }
  return ok({ item: itemName }, Date.now() - started);
}

export async function eatFood(ctx: SkillContext): Promise<ActionResult<{ item: string; food: number }>> {
  const started = Date.now();
  const food = ctx.bot.inventory.items().find((item) => FOOD_ITEM_NAMES.has(item.name));
  if (!food) {
    return fail("NO_FOOD", "No edible item in inventory", Date.now() - started, true);
  }
  try {
    await ctx.bot.equip(food, "hand");
    await ctx.bot.consume();
  } catch (error) {
    return fail("EAT_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  return ok({ item: food.name, food: ctx.bot.food }, Date.now() - started);
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
    const move = await moveTo(ctx, preferred, 3);
    if (!move.success) return move;
    return ok({ position: preferred }, Date.now() - started);
  }
  const found = await findBlock(ctx, names, 16);
  if (!found.success) return found;
  const move = await moveTo(ctx, found.data.position, 3);
  if (!move.success) return move;
  return ok({ position: found.data.position }, Date.now() - started);
}

export async function craftItem(
  ctx: SkillContext,
  itemName: string,
  count = 1,
  table?: ContainerTarget,
): Promise<ActionResult<{ item: string; count: number }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const item = bot.registry.itemsByName[itemName];
  if (!item) {
    return fail("ITEM_NOT_FOUND", `Unknown item ${itemName}`, Date.now() - started);
  }
  const before = countItem(ctx, itemName);
  const inventoryRecipes = bot.recipesFor(item.id, null, count, false);
  const anyRecipes = inventoryRecipes.length > 0 ? inventoryRecipes : bot.recipesFor(item.id, null, count, null);
  if (anyRecipes.length === 0) {
    return fail("NO_RECIPE", `No craftable recipe for ${itemName}`, Date.now() - started, true);
  }
  let craftingTable = null;
  if (inventoryRecipes.length === 0) {
    const found = table
      ? { success: true as const, data: { position: table } }
      : await findBlock(ctx, ["crafting_table"], 24);
    if (!found.success) {
      return fail("NO_CRAFTING_TABLE", "Need a crafting table nearby", Date.now() - started, true);
    }
    const tablePos = found.data.position;
    const move = await moveTo(ctx, tablePos, 3);
    if (!move.success) return move;
    craftingTable = bot.blockAt(new Vec3Class(Math.floor(tablePos.x), Math.floor(tablePos.y), Math.floor(tablePos.z)));
    if (!craftingTable || craftingTable.name !== "crafting_table") {
      craftingTable = bot.findBlock({
        matching: bot.registry.blocksByName.crafting_table?.id ?? -1,
        maxDistance: 6,
      });
    }
    if (!craftingTable || craftingTable.name !== "crafting_table") {
      return fail("NO_CRAFTING_TABLE", "Crafting table vanished", Date.now() - started, true);
    }
  }
  try {
    await bot.craft(anyRecipes[0]!, count, craftingTable ?? undefined);
  } catch (error) {
    return fail("CRAFT_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const after = countItem(ctx, itemName);
  if (after <= before) {
    return fail("VERIFY_FAILED", `Crafted ${itemName} but inventory count did not increase`, Date.now() - started, true);
  }
  return ok({ item: itemName, count: after - before }, Date.now() - started);
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
