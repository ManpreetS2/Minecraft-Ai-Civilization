import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";

const DOOR_NAMES = [
  "oak_door",
  "spruce_door",
  "birch_door",
  "jungle_door",
  "acacia_door",
  "dark_oak_door",
  "mangrove_door",
  "cherry_door",
  "bamboo_door",
  "iron_door",
];

export async function openDoor(ctx: SkillContext, position?: Vec3): Promise<ActionResult<{ position: Vec3; opened: boolean }>> {
  const started = Date.now();
  const target = position
    ? { success: true as const, data: { name: "door", position } }
    : await findBlock(ctx, DOOR_NAMES, 8);
  if (!target.success) return target;
  const nav = navigationBackend();
  const moved = await nav.navigateToInteractWithBlock(ctx.bot, target.data.position, {
    timeoutMs: ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (!moved.success) return moved;
  const block = ctx.bot.blockAt(
    new Vec3Class(Math.floor(target.data.position.x), Math.floor(target.data.position.y), Math.floor(target.data.position.z)),
  );
  if (!block || !block.name.endsWith("_door")) {
    return fail("BLOCK_NOT_FOUND", "Door vanished", Date.now() - started, true);
  }
  try {
    const props = (block as { getProperties?: () => { open?: boolean } }).getProperties?.();
    if (props?.open) return ok({ position: target.data.position, opened: true }, Date.now() - started);
    await ctx.bot.activateBlock(block);
  } catch (error) {
    return fail("PLACE_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  return ok({ position: target.data.position, opened: true }, Date.now() - started);
}
