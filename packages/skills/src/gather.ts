import { fail, ok, retry, type ActionResult, type Vec3 } from "@civ/shared";
import { shouldBlacklistTarget } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { moveTo } from "./movement.js";
import { findBlock } from "./observe.js";

export async function mineBlock(
  ctx: SkillContext,
  names: string[],
  maxDistance = 32,
): Promise<ActionResult<{ name: string; position: Vec3 }>> {
  return retry(
    async () => {
      const started = Date.now();
      const found = await findBlock(ctx, names, maxDistance);
      if (!found.success) return found;
      const target = found.data.position;
      const move = await moveTo(ctx, target, 3);
      if (!move.success) {
        if (shouldBlacklistTarget(move.code)) {
          ctx.body.unreachable.mark(target);
        }
        return move;
      }

      const bot = ctx.bot;
      const block = bot.blockAt(new Vec3Class(target.x, target.y, target.z));
      if (!block || block.name === "air") {
        return fail("BLOCK_NOT_FOUND", "Target block disappeared before mining", Date.now() - started, true);
      }
      try {
        if (ctx.signal?.aborted) {
          return fail("CANCELLED", "Cancelled before dig", Date.now() - started);
        }
        await bot.dig(block, true);
      } catch (error) {
        ctx.body.unreachable.mark(target, 20_000);
        return fail(
          "DIG_FAILED",
          error instanceof Error ? error.message : String(error),
          Date.now() - started,
          true,
        );
      }
      const after = bot.blockAt(new Vec3Class(target.x, target.y, target.z));
      if (after && after.name === block.name) {
        return fail("VERIFY_FAILED", `Block ${block.name} still present after dig`, Date.now() - started, true);
      }
      return ok({ name: block.name, position: target }, Date.now() - started);
    },
    2,
    400,
    ctx.signal,
  );
}

export async function collectItem(
  ctx: SkillContext,
  itemName?: string,
  maxDistance = 16,
): Promise<ActionResult<{ collected: number }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const origin = bot.entity?.position;
  if (!origin) {
    return fail("NOT_CONNECTED", "Not spawned", Date.now() - started);
  }
  const drops = Object.values(bot.entities).filter((entity) => {
    if (entity.name !== "item" && entity.entityType !== undefined && entity.name !== "Item") {
      if (entity.name !== "item") return false;
    }
    if (!entity.position) return false;
    const dist = origin.distanceTo(entity.position);
    if (dist > maxDistance) return false;
    if (!itemName) return entity.name === "item" || entity.displayName?.toString() === "Item";
    const metadata = entity.getDroppedItem?.();
    return !metadata || metadata.name === itemName || entity.name === "item";
  });

  const nearby = Object.values(bot.entities).filter((entity) => {
    if (!entity.position) return false;
    const isItem = entity.name === "item" || entity.name === "Item";
    if (!isItem) return false;
    return origin.distanceTo(entity.position) <= maxDistance;
  });

  const targets = nearby.length > 0 ? nearby : drops;
  if (targets.length === 0) {
    return fail("ITEM_NOT_FOUND", `No dropped items nearby${itemName ? ` matching ${itemName}` : ""}`, Date.now() - started, true);
  }

  let collected = 0;
  for (const entity of targets.slice(0, 8)) {
    if (ctx.signal?.aborted) break;
    const pos = entity.position;
    if (!pos) continue;
    const move = await moveTo(ctx, { x: pos.x, y: pos.y, z: pos.z }, 1.2);
    if (move.success) collected += 1;
  }
  if (collected === 0) {
    return fail("ITEM_NOT_FOUND", "Could not reach dropped items", Date.now() - started, true);
  }
  return ok({ collected }, Date.now() - started);
}
