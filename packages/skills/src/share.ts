import type { ActionResult } from "@civ/shared";
import type { SkillContext } from "./context.js";
import {
  dropItem as dropThroughInventory,
  pickupDroppedItem,
  type DropPurpose,
} from "./inventory-service.js";
import { moveTo } from "./movement.js";

export async function dropItem(
  ctx: SkillContext,
  itemName: string,
  count = 1,
  purpose: DropPurpose = "DISCARD",
): Promise<ActionResult<{ item: string; count: number }>> {
  const result = await dropThroughInventory(ctx, itemName, count, purpose);
  if (!result.success) return result;
  return { success: true, data: { item: result.data.item, count: result.data.count }, durationMs: result.durationMs };
}

export async function approachAndCollect(
  ctx: SkillContext,
  target: { x: number; y: number; z: number },
): Promise<ActionResult<{ collected: number }>> {
  const move = await moveTo(ctx, target, 2);
  if (!move.success) return move;
  return pickupDroppedItem(ctx, undefined, 6);
}

export { pickupDroppedItem };
