import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { moveTo } from "./movement.js";

const BED_NAMES = [
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
];

export async function sleep(ctx: SkillContext): Promise<ActionResult<{ rested: boolean }>> {
  const started = Date.now();
  const bot = ctx.bot;
  if (bot.time.timeOfDay < 12_500 || bot.time.timeOfDay > 23_000) {
    return fail("SLEEP_FAILED", "It is not night enough to sleep", Date.now() - started, true);
  }
  const found = await findBlock(ctx, BED_NAMES, 16);
  if (!found.success) {
    return fail("NO_BED", "No bed nearby", Date.now() - started, true);
  }
  const move = await moveTo(ctx, found.data.position, 2);
  if (!move.success) return move;
  const bed = bot.findBlock({
    matching: (b) => b.name.endsWith("_bed"),
    maxDistance: 4,
  });
  if (!bed) {
    return fail("NO_BED", "Bed vanished", Date.now() - started, true);
  }
  try {
    await bot.sleep(bed);
  } catch (error) {
    return fail("SLEEP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  return ok({ rested: true }, Date.now() - started);
}

export async function attack(
  ctx: SkillContext,
  entityId?: number,
): Promise<ActionResult<{ entityId: number }>> {
  const started = Date.now();
  const bot = ctx.bot;
  if (!bot.entity?.position) {
    return fail("NOT_CONNECTED", "Not spawned", Date.now() - started);
  }
  const resolved =
    (entityId !== undefined ? bot.entities[entityId] : undefined) ??
    (() => {
      const hostile = ctx.body.nearbyEntities(8).find((e) => e.hostile);
      return hostile ? bot.entities[hostile.id] : undefined;
    })();
  if (!resolved) {
    return fail("ENTITY_NOT_FOUND", "No hostile target nearby", Date.now() - started, true);
  }
  try {
    bot.attack(resolved);
  } catch (error) {
    return fail("ATTACK_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  return ok({ entityId: resolved.id }, Date.now() - started);
}

export async function placeBlock(
  ctx: SkillContext,
  itemName: string,
  position: Vec3,
): Promise<ActionResult<{ name: string; position: Vec3 }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) {
    return fail("ITEM_NOT_FOUND", `Cannot place ${itemName}; none in inventory`, Date.now() - started, true);
  }
  const move = await moveTo(ctx, position, 3.5);
  if (!move.success) return move;
  const dest = new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
  const existing = bot.blockAt(dest);
  if (existing && existing.name !== "air" && existing.name !== "cave_air" && existing.name !== "void_air") {
    return ok({ name: existing.name, position }, Date.now() - started);
  }
  try {
    await bot.equip(item, "hand");
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }

  const neighbors = [
    dest.offset(0, -1, 0),
    dest.offset(1, 0, 0),
    dest.offset(-1, 0, 0),
    dest.offset(0, 0, 1),
    dest.offset(0, 0, -1),
    dest.offset(0, 1, 0),
  ];
  let placed = false;
  let lastError = "no supporting neighbor";
  for (const n of neighbors) {
    const nb = bot.blockAt(n);
    if (!nb || nb.name === "air" || nb.name === "cave_air") continue;
    try {
      await bot.placeBlock(nb, dest.minus(n));
      placed = true;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!placed) {
    return fail("PLACE_FAILED", `Could not place ${itemName}: ${lastError}`, Date.now() - started, true);
  }
  const after = bot.blockAt(dest);
  if (!after || after.name === "air") {
    return fail(
      "VERIFY_FAILED",
      `Block not present after place at ${position.x},${position.y},${position.z}`,
      Date.now() - started,
      true,
    );
  }
  return ok({ name: after.name, position }, Date.now() - started);
}
