import { fail, ok, retry, type ActionResult, type ErrorCode, type Vec3 } from "@civ/shared";
import { navigationBackend, retreatFromHazard, shouldBlacklistTarget } from "@civ/minecraft-adapter";
import { refuseAccidentalPropertyBreak } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { lookAtPosition } from "./look.js";
import { moveTo } from "./movement.js";
import { isStandingInLiquid } from "./fish.js";

function botWorldGetter(bot: SkillContext["bot"]) {
  return (pos: Vec3) => {
    const block = bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
    if (!block) return undefined;
    return { name: block.name, boundingBox: block.boundingBox };
  };
}

export function classifyStaleTarget(expected?: string, actual?: string): ErrorCode | undefined {
  if (!actual || actual === "air" || actual === "cave_air" || actual === "void_air") return "TARGET_GONE";
  if (expected && actual !== expected) return "TARGET_CHANGED";
  return undefined;
}

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
      const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, target, {
        timeoutMs: ctx.timeoutMs ?? 18_000,
        signal: ctx.signal,
      });
      if (!move.success) {
        if (shouldBlacklistTarget(move.code)) {
          ctx.body.unreachable.mark(target);
        }
        return move;
      }

      const bot = ctx.bot;
      // Day 2: Atlas drowned while gathering. Refuse dig while feet/head are in liquid.
      const stand = bot.entity?.position;
      if (stand && isStandingInLiquid({ x: stand.x, y: stand.y, z: stand.z }, botWorldGetter(bot))) {
        const away = {
          dx: Math.sign(stand.x - target.x) || 1,
          dz: Math.sign(stand.z - target.z) || 0,
        };
        await retreatFromHazard(bot, away, ctx.signal);
        const after = bot.entity?.position;
        if (after && isStandingInLiquid({ x: after.x, y: after.y, z: after.z }, botWorldGetter(bot))) {
          ctx.body.unreachable.mark(target, 20_000);
          return fail(
            "HAZARD_BLOCKED",
            "Standing in water after approach; refusing dig to avoid drowning",
            Date.now() - started,
            true,
            { position: { x: after.x, y: after.y, z: after.z }, workComplete: false },
          );
        }
      }
      const block = bot.blockAt(new Vec3Class(target.x, target.y, target.z));
      const stale = classifyStaleTarget(found.data.name, block?.name);
      if (stale) {
        ctx.body.unreachable.mark(target, 8_000);
        return fail(stale, "Target block disappeared or changed before mining", Date.now() - started, true);
      }
      if (!block || block.name === "air") {
        return fail("TARGET_GONE", "Target block disappeared before mining", Date.now() - started, true);
      }
      const protectedBlock = refuseAccidentalPropertyBreak(block.name);
      if (!protectedBlock.ok) {
        return fail(protectedBlock.code, protectedBlock.error, Date.now() - started, false);
      }
      await lookAtPosition(ctx, target);
      try {
        if (ctx.signal?.aborted) {
          return fail("CANCELLED", "Cancelled before dig", Date.now() - started, false, { workComplete: false });
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
  const before = bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  const nearby = Object.values(bot.entities).filter((entity) => {
    if (!entity.position) return false;
    const raw = `${entity.name ?? ""} ${entity.displayName ?? ""}`.toLowerCase();
    const isItem =
      raw.includes("item") ||
      Boolean((entity as { getDroppedItem?: () => unknown }).getDroppedItem?.()) ||
      Boolean((entity as { item?: unknown }).item);
    if (!isItem) return false;
    return origin.distanceTo(entity.position) <= maxDistance;
  });
  if (nearby.length === 0) {
    return fail("ITEM_NOT_FOUND", `No dropped items nearby${itemName ? ` matching ${itemName}` : ""}`, Date.now() - started, true, {
      collected: 0,
      workComplete: false,
    });
  }

  let reached = 0;
  for (const entity of nearby.slice(0, 8)) {
    if (ctx.signal?.aborted) break;
    const pos = entity.position;
    if (!pos) continue;
    const move = await moveTo(ctx, { x: pos.x, y: pos.y, z: pos.z }, 1.2);
    if (move.success) reached += 1;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  const collected = Math.max(0, after - before);
  if (ctx.signal?.aborted && collected === 0) {
    return fail("CANCELLED", "Pickup cancelled for this citizen", Date.now() - started, false, {
      collected: 0,
      reached,
      workComplete: false,
    });
  }
  if (ctx.signal?.aborted) {
    return fail("INTERRUPTED", "Pickup interrupted after partial inventory gain", Date.now() - started, true, {
      collected,
      reached,
      workComplete: false,
    });
  }
  if (collected === 0) {
    return fail(
      "ITEM_NOT_FOUND",
      reached === 0 ? "Could not reach dropped items" : "Reached drops but inventory did not increase",
      Date.now() - started,
      true,
      {
        collected: 0,
        reached,
        workComplete: false,
      },
    );
  }
  return ok({ collected }, Date.now() - started);
}
