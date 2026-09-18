import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { lookAtPosition } from "./look.js";
import { pickupDroppedItem, countItem, equipItem } from "./inventory-service.js";

export type CropKind = "wheat" | "carrots" | "potatoes" | "beetroots";

export const CROP_BLOCKS: Record<CropKind, { crop: string; seed: string; matureAge: number }> = {
  wheat: { crop: "wheat", seed: "wheat_seeds", matureAge: 7 },
  carrots: { crop: "carrots", seed: "carrot", matureAge: 7 },
  potatoes: { crop: "potatoes", seed: "potato", matureAge: 7 },
  beetroots: { crop: "beetroots", seed: "beetroot_seeds", matureAge: 3 },
};

export function cropAge(block: {
  name: string;
  metadata?: number;
  getProperties?: () => { age?: number | string };
  _properties?: { age?: number | string };
} | null): number | undefined {
  if (!block) return undefined;
  const raw = block.getProperties?.()?.age ?? block._properties?.age ?? block.metadata;
  const age = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(age) ? age : undefined;
}

export function isMatureCrop(
  block: {
    name: string;
    metadata?: number;
    getProperties?: () => { age?: number | string };
    _properties?: { age?: number | string };
  } | null,
  kind: CropKind,
): boolean {
  if (!block || block.name !== CROP_BLOCKS[kind].crop) return false;
  const age = cropAge(block);
  return age === undefined ? false : age >= CROP_BLOCKS[kind].matureAge;
}

export async function harvestCrop(
  ctx: SkillContext,
  kind: CropKind = "wheat",
): Promise<ActionResult<{ crop: string; collected: number; replanted: boolean; position: Vec3 }>> {
  const started = Date.now();
  const spec = CROP_BLOCKS[kind];
  const block = ctx.bot.findBlock({
    matching: (candidate) => isMatureCrop(candidate, kind),
    maxDistance: 16,
  });
  if (!block) {
    const immature = ctx.bot.findBlock({
      matching: (candidate) => candidate.name === spec.crop,
      maxDistance: 16,
    });
    if (immature) {
      return fail("CROP_IMMATURE", `${spec.crop} at age ${cropAge(immature) ?? "?"} is not mature`, Date.now() - started, true, {
        item: spec.crop,
      });
    }
    return fail("BLOCK_NOT_FOUND", `No ${spec.crop} nearby`, Date.now() - started, true);
  }
  const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, block.position, {
    timeoutMs: ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (!move.success) return move;
  await lookAtPosition(ctx, { x: block.position.x, y: block.position.y, z: block.position.z });
  const beforeSeed = countItem(ctx, spec.seed);
  const beforeCrop =
    kind === "wheat" ? countItem(ctx, "wheat") : countItem(ctx, spec.seed === "carrot" || spec.seed === "potato" ? spec.seed : "beetroot");
  try {
    await ctx.bot.dig(block, true);
  } catch (error) {
    return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const afterBlock = ctx.bot.blockAt(block.position);
  if (afterBlock && afterBlock.name === spec.crop) {
    return fail("VERIFY_FAILED", `${spec.crop} still present after harvest`, Date.now() - started, true);
  }
  await pickupDroppedItem(ctx, undefined, 6);
  const collected =
    kind === "wheat"
      ? countItem(ctx, "wheat") - beforeCrop + (countItem(ctx, spec.seed) - beforeSeed)
      : countItem(ctx, spec.seed) - beforeSeed;
  let replanted = false;
  if (countItem(ctx, spec.seed) >= 1) {
    const planted = await plantCrop(ctx, kind, { x: block.position.x, y: block.position.y, z: block.position.z });
    replanted = planted.success;
  }
  return ok(
    {
      crop: spec.crop,
      collected: Math.max(0, collected),
      replanted,
      position: { x: block.position.x, y: block.position.y, z: block.position.z },
    },
    Date.now() - started,
  );
}

export async function plantCrop(
  ctx: SkillContext,
  kind: CropKind,
  position: Vec3,
): Promise<ActionResult<{ crop: string; position: Vec3 }>> {
  const started = Date.now();
  const spec = CROP_BLOCKS[kind];
  const soil = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y) - 1, Math.floor(position.z)));
  if (soil?.name !== "farmland") {
    return fail("PLACE_FAILED", `Need farmland under plant cell, found ${soil?.name ?? "none"}`, Date.now() - started, true);
  }
  const cell = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
  if (cell && cell.name !== "air" && cell.name !== "cave_air") {
    return fail("PLACE_FAILED", `Plant cell occupied by ${cell.name}`, Date.now() - started, true);
  }
  if (countItem(ctx, spec.seed) < 1) {
    return fail("ITEM_NOT_FOUND", `No ${spec.seed} to plant`, Date.now() - started, true);
  }
  const equipped = await equipItem(ctx, spec.seed);
  if (!equipped.success) return equipped;
  const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, position, {
    timeoutMs: ctx.timeoutMs ?? 10_000,
    signal: ctx.signal,
  });
  if (!move.success) return move;
  await lookAtPosition(ctx, position);
  try {
    await ctx.bot.activateBlock(soil);
  } catch (error) {
    return fail("PLACE_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const planted = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
  if (!planted || planted.name !== spec.crop) {
    return fail("VERIFY_FAILED", `Expected ${spec.crop} after plant, got ${planted?.name ?? "none"}`, Date.now() - started, true);
  }
  return ok({ crop: spec.crop, position }, Date.now() - started);
}

export async function tillAndPlant(
  ctx: SkillContext,
  position: Vec3,
  kind: CropKind = "wheat",
): Promise<ActionResult<{ position: Vec3 }>> {
  const started = Date.now();
  const dirt = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
  if (!dirt) return fail("BLOCK_NOT_FOUND", "No soil", Date.now() - started, true);
  if (dirt.name !== "farmland") {
    const hoe = ctx.bot.inventory.items().find((item) => item.name.endsWith("_hoe"));
    if (!hoe) return fail("MISSING_TOOL", "Need a hoe to till farmland", Date.now() - started, true);
    await equipItem(ctx, hoe.name);
    const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, position, {
      timeoutMs: ctx.timeoutMs ?? 10_000,
      signal: ctx.signal,
    });
    if (!move.success) return move;
    await lookAtPosition(ctx, position);
    try {
      await ctx.bot.activateBlock(dirt);
    } catch (error) {
      return fail("PLACE_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const soil = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
  if (soil?.name !== "farmland") {
    return fail("PLACE_FAILED", `Hoe did not till farmland, still ${soil?.name ?? "none"}`, Date.now() - started, true);
  }
  const planted = await plantCrop(ctx, kind, { x: position.x, y: position.y + 1, z: position.z });
  if (!planted.success) return planted;
  return ok({ position: planted.data.position }, Date.now() - started);
}
