import { fail, ok, createEvent, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { lookAtPosition } from "./look.js";
import {
  evaluateFunctionalPlacement,
  isFunctionalItem,
  worldGetterFromBot,
  type PlacementIntent,
} from "./placement.js";

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

export async function sleep(ctx: SkillContext, preferred?: Vec3): Promise<ActionResult<{ rested: boolean }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const knowledge = minecraftKnowledge();
  const hostiles = ctx.body.nearbyEntities(8).some((entity) => entity.hostile);
  const preferredBlock = preferred
    ? bot.blockAt(new Vec3Class(Math.floor(preferred.x), Math.floor(preferred.y), Math.floor(preferred.z)))
    : null;
  const found =
    preferred && preferredBlock && preferredBlock.name.endsWith("_bed")
      ? { success: true as const, data: { name: preferredBlock.name, position: preferred } }
      : await findBlock(ctx, BED_NAMES, 32);
  const facts = knowledge.sleepFacts({
    timeOfDay: bot.time.timeOfDay,
    thundering: Boolean((bot as { thunderState?: number }).thunderState),
    raining: Boolean(bot.isRaining),
    bedPresent: found.success,
    bedReachable: found.success,
    hostilesNearby: hostiles,
  });
  if (!facts.validSleepTime) {
    return fail("NOT_SLEEP_TIME", facts.reasons.join(" ") || "It is not night enough to sleep", Date.now() - started, true);
  }
  if (hostiles) {
    return fail("HOSTILE_NEARBY", "Hostiles are too close to sleep", Date.now() - started, true);
  }
  if (!found.success) {
    return fail("BED_MISSING", "No bed nearby", Date.now() - started, true);
  }
  const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, found.data.position, {
    timeoutMs: ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (!move.success) {
    return fail("BED_UNREACHABLE", move.error, Date.now() - started, true);
  }
  const here = bot.entity?.position;
  if (here) {
    const onBed = Math.floor(here.x) === Math.floor(found.data.position.x) && Math.floor(here.z) === Math.floor(found.data.position.z);
    if (onBed) {
      const step = {
        x: found.data.position.x + 1,
        y: found.data.position.y,
        z: found.data.position.z,
      };
      await navigationBackend().navigateToPosition(ctx.bot, step, { range: 1.2, timeoutMs: 4_000, signal: ctx.signal });
    }
  }
  const bed = bot.findBlock({
    matching: (b) => b.name.endsWith("_bed"),
    maxDistance: 4,
  });
  if (!bed) {
    return fail("BED_MISSING", "Bed vanished", Date.now() - started, true);
  }
  await lookAtPosition(ctx, found.data.position);
  try {
    await bot.sleep(bed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes("occupied")) {
      return fail("BED_OCCUPIED", message, Date.now() - started, true);
    }
    if (lower.includes("night") || lower.includes("thunder") || lower.includes("day")) {
      return fail("NOT_SLEEP_TIME", message, Date.now() - started, true);
    }
    if (lower.includes("monster") || lower.includes("hostile")) {
      return fail("HOSTILE_NEARBY", message, Date.now() - started, true);
    }
    if (lower.includes("not sleeping") || lower.includes("too far") || lower.includes("can't sleep") || lower.includes("cannot sleep")) {
      return fail("INTERACTION_FAILED", message, Date.now() - started, true);
    }
    return fail("SLEEP_FAILED", message, Date.now() - started, true);
  }
  if (!bot.isSleeping) {
    return fail("INTERACTION_FAILED", "Mineflayer sleep returned but bot is not sleeping", Date.now() - started, true);
  }
  try {
    await bot.wake();
  } catch {
    // already awake is fine
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
    await ctx.bot.lookAt(resolved.position);
    ctx.bot.attack(resolved);
  } catch (error) {
    return fail("ATTACK_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  return ok({ entityId: resolved.id }, Date.now() - started);
}

export async function placeBlock(
  ctx: SkillContext,
  itemName: string,
  position: Vec3,
  intent?: PlacementIntent,
): Promise<ActionResult<{ name: string; position: Vec3 }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(itemName) || itemName;
  if (isFunctionalItem(name)) {
    const decision = evaluateFunctionalPlacement({
      item: name,
      purpose: intent?.purpose,
      position,
      getBlock: worldGetterFromBot(bot),
    });
    if (!decision.ok) {
      ctx.events?.emit(
        createEvent(
          "FunctionalBlockPlacedWithoutPurpose",
          {
            item: name,
            purpose: intent?.purpose,
            position,
            reason: decision.reason,
            blocked: true,
          },
          ctx.citizenId,
        ),
      );
      ctx.events?.emit(
        createEvent(
          "SystemIncident",
          {
            summary: `Blocked purposeless ${name} placement.`,
            error: decision.reason,
            code: decision.code ?? "PURPOSELESS_PLACEMENT",
          },
          ctx.citizenId,
        ),
      );
      return fail(
        decision.code ?? "PURPOSELESS_PLACEMENT",
        decision.reason ?? `Refusing to place ${name} without a valid context`,
        Date.now() - started,
        false,
        { item: name, position },
      );
    }
  }
  const item = bot.inventory.items().find((i) => i.name === name);
  if (!item) {
    return fail("ITEM_NOT_FOUND", `Cannot place ${name}; none in inventory`, Date.now() - started, true);
  }
  const dest = new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
  const move = await navigationBackend().navigateToPlaceBlock(ctx.bot, position, {
    timeoutMs: ctx.timeoutMs ?? 16_000,
    signal: ctx.signal,
  });
  if (!move.success) return move;
  const existing = bot.blockAt(dest);
  if (existing && !knowledge.isReplaceable(existing.name) && existing.name !== "air") {
    if (existing.name === name || (name.endsWith("_door") && existing.name.endsWith("_door"))) {
      return ok({ name: existing.name, position }, Date.now() - started);
    }
    return fail(
      "PLACE_FAILED",
      `Cannot place ${name}; ${existing.name} already occupies that cell`,
      Date.now() - started,
      true,
    );
  }
  try {
    await bot.equip(item, "hand");
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  await lookAtPosition(ctx, position);

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
    if (!nb || knowledge.isReplaceable(nb.name) || nb.name === "air" || nb.name === "cave_air") continue;
    try {
      await bot.placeBlock(nb, dest.minus(n));
      placed = true;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!placed) {
    return fail("PLACE_FAILED", `Could not place ${name}: ${lastError}`, Date.now() - started, true);
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
