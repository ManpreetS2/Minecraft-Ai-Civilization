import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { collectItem } from "./gather.js";
import { depositItems, withdrawItems, equipItem } from "./inventory.js";
import { mineBlock } from "./gather.js";
import { placeBlock } from "./world.js";
import { eatFood } from "./inventory.js";
import { openDoor } from "./doors.js";

export async function navigateTo(ctx: SkillContext, target: Vec3) {
  return navigationBackend().navigateToPosition(ctx.bot, target, { timeoutMs: ctx.timeoutMs, signal: ctx.signal });
}

export async function navigateNear(ctx: SkillContext, target: Vec3, range = 3) {
  return navigationBackend().navigateNear(ctx.bot, target, range, { timeoutMs: ctx.timeoutMs, signal: ctx.signal });
}

export async function approachBlock(ctx: SkillContext, block: Vec3) {
  return navigationBackend().navigateToInteractWithBlock(ctx.bot, block, { timeoutMs: ctx.timeoutMs, signal: ctx.signal });
}

export async function collectItemDrop(ctx: SkillContext, itemName?: string) {
  return collectItem(ctx, itemName, 8);
}

export async function breakBlock(ctx: SkillContext, names: string[]) {
  return mineBlock(ctx, names);
}

export async function equipTool(ctx: SkillContext, itemName: string) {
  return equipItem(ctx, itemName);
}

export async function openContainer(ctx: SkillContext): Promise<ActionResult<{ position: Vec3 }>> {
  const found = await findBlock(ctx, ["chest", "barrel", "trapped_chest"], 16);
  if (!found.success) return found;
  const moved = await approachBlock(ctx, found.data.position);
  if (!moved.success) return fail("CONTAINER_UNREACHABLE", moved.error, moved.durationMs, moved.retryable);
  return ok({ position: found.data.position }, moved.durationMs);
}

export async function depositItem(ctx: SkillContext, itemName?: string) {
  return depositItems(ctx, itemName);
}

export async function withdrawItem(ctx: SkillContext, itemName: string, count = 1) {
  return withdrawItems(ctx, itemName, count);
}

export async function transferItem(ctx: SkillContext, itemName: string, count = 1) {
  return withdrawItems(ctx, itemName, count);
}

export async function returnToSettlement(ctx: SkillContext, origin?: Vec3) {
  if (!origin) return fail("TARGET_UNREACHABLE", "No settlement origin", 0, true);
  return navigateNear(ctx, origin, 4);
}

export async function assistProject(ctx: SkillContext, next?: { position: Vec3; block: string }) {
  if (!next) return fail("WORLD_CHANGED", "No unclaimed construction job", 0, true);
  return placeBlock(ctx, next.block, next.position, { purpose: "shelter_blueprint" });
}

export { eatFood, openDoor, placeBlock };

export async function closeDoor(ctx: SkillContext, position?: Vec3): Promise<ActionResult<{ position: Vec3; opened: boolean }>> {
  const started = Date.now();
  const opened = await openDoor(ctx, position);
  if (!opened.success) return opened;
  const block = ctx.bot.blockAt(
    new Vec3Class(Math.floor(opened.data.position.x), Math.floor(opened.data.position.y), Math.floor(opened.data.position.z)),
  );
  if (!block) return opened;
  try {
    const props = (block as { getProperties?: () => { open?: boolean } }).getProperties?.();
    if (props?.open) await ctx.bot.activateBlock(block);
  } catch {
    return fail("PLACE_FAILED", "Could not close door", Date.now() - started, true);
  }
  return ok({ position: opened.data.position, opened: false }, Date.now() - started);
}
