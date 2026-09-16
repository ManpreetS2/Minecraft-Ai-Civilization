import { fail, ok, type ActionResult } from "@civ/shared";
import type { SkillContext } from "./context.js";
import { collectItem } from "./gather.js";
import { moveTo } from "./movement.js";

export async function dropItem(
  ctx: SkillContext,
  itemName: string,
  count = 1,
): Promise<ActionResult<{ item: string; count: number }>> {
  const started = Date.now();
  const item = ctx.bot.inventory.items().find((i) => i.name === itemName);
  if (!item) {
    return fail("ITEM_NOT_FOUND", `No ${itemName} to drop`, Date.now() - started, true);
  }
  const before = ctx.bot.inventory
    .items()
    .filter((i) => i.name === itemName)
    .reduce((sum, i) => sum + i.count, 0);
  try {
    await ctx.bot.toss(item.type, null, Math.min(count, item.count));
  } catch (error) {
    return fail("UNKNOWN", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const after = ctx.bot.inventory
    .items()
    .filter((i) => i.name === itemName)
    .reduce((sum, i) => sum + i.count, 0);
  if (after >= before) {
    return fail("VERIFY_FAILED", `Drop of ${itemName} did not reduce inventory`, Date.now() - started, true);
  }
  return ok({ item: itemName, count: before - after }, Date.now() - started);
}

export async function approachAndCollect(
  ctx: SkillContext,
  target: { x: number; y: number; z: number },
): Promise<ActionResult<{ collected: number }>> {
  const move = await moveTo(ctx, target, 2);
  if (!move.success) return move;
  return collectItem(ctx, undefined, 6);
}
