import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { lookAtPosition } from "./look.js";

const LADDERS = ["ladder"];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTicks(bot: SkillContext["bot"], n: number): Promise<void> {
  const fn = (bot as SkillContext["bot"] & { waitForTicks?: (ticks: number) => Promise<void> }).waitForTicks;
  if (typeof fn === "function") {
    try {
      await fn.call(bot, n);
      return;
    } catch {
      // physics ticks can time out after teleport
    }
  }
  await wait(Math.max(50, n * 50));
}

function nearestLadder(ctx: SkillContext, preferred?: Vec3) {
  if (preferred) {
    const block = ctx.bot.blockAt(
      new Vec3Class(Math.floor(preferred.x), Math.floor(preferred.y), Math.floor(preferred.z)),
    );
    if (block && LADDERS.includes(block.name)) {
      return { success: true as const, data: { name: block.name, position: preferred } };
    }
  }
  return findBlock(ctx, LADDERS, 16);
}

/**
 * Bounded ladder climb. Pathfinder climbables are unused in current
 * mineflayer-pathfinder; this uses Mineflayer control states only.
 */
export async function climbLadder(
  ctx: SkillContext,
  direction: "up" | "down",
  preferred?: Vec3,
): Promise<ActionResult<{ startY: number; endY: number; displacement: number }>> {
  const started = Date.now();
  const found = await nearestLadder(ctx, preferred);
  if (!found.success) {
    return fail("BLOCK_NOT_FOUND", "No ladder nearby", Date.now() - started, true);
  }
  const start = ctx.bot.entity?.position;
  if (!start) return fail("NOT_CONNECTED", "Not spawned", Date.now() - started);
  const alreadyNear =
    Math.hypot(start.x - (found.data.position.x + 0.5), start.z - (found.data.position.z + 0.5)) < 1.6 &&
    Math.abs(start.y - found.data.position.y) < 8;
  if (!alreadyNear) {
    const approach = await navigationBackend().navigateToInteractWithBlock(ctx.bot, found.data.position, {
      timeoutMs: ctx.timeoutMs ?? 12_000,
      signal: ctx.signal,
    });
    if (!approach.success) {
      const fallback = await navigationBackend().navigateToPosition(
        ctx.bot,
        { x: found.data.position.x + 0.5, y: found.data.position.y, z: found.data.position.z + 0.5 },
        { range: 1.2, timeoutMs: 6_000, signal: ctx.signal },
      );
      if (!fallback.success) {
        const here = ctx.bot.entity?.position;
        const close = here && Math.hypot(here.x - found.data.position.x, here.z - found.data.position.z) < 2.5;
        if (!close) return fail("LADDER_FAILED", approach.error, Date.now() - started, true);
      }
    }
  }
  await lookAtPosition(ctx, found.data.position);
  ctx.bot.clearControlStates();
  const ladderPos = new Vec3Class(
    Math.floor(found.data.position.x) + 0.5,
    Math.floor(found.data.position.y),
    Math.floor(found.data.position.z) + 0.5,
  );
  try {
    await ctx.bot.look(ctx.bot.entity?.yaw ?? 0, direction === "up" ? -1.2 : 0.9, true);
  } catch {
    await lookAtPosition(ctx, { x: ladderPos.x, y: ladderPos.y, z: ladderPos.z });
  }
  ctx.bot.setControlState("forward", true);
  for (let i = 0; i < 8; i += 1) {
    const here = ctx.bot.entity?.position;
    if (here && Math.hypot(here.x - ladderPos.x, here.z - ladderPos.z) < 0.55) break;
    await waitTicks(ctx.bot, 2);
  }
  const startAfter = ctx.bot.entity?.position ?? start;
  const climbStartY = startAfter.y;
  const deadline = Date.now() + Math.min(ctx.timeoutMs ?? 12_000, 10_000);
  while (Date.now() < deadline) {
    if (ctx.signal?.aborted) {
      ctx.bot.clearControlStates();
      return fail("CANCELLED", "climbLadder interrupted", Date.now() - started, true);
    }
    const here = ctx.bot.entity?.position;
    if (!here) break;
    const climbed = direction === "up" ? here.y - climbStartY : climbStartY - here.y;
    if (climbed >= 3.2) break;
    ctx.bot.setControlState("forward", true);
    if (direction === "up") {
      ctx.bot.setControlState("jump", true);
      ctx.bot.setControlState("sneak", false);
    } else {
      ctx.bot.setControlState("jump", false);
      ctx.bot.setControlState("sneak", true);
    }
    await waitTicks(ctx.bot, 3);
  }
  ctx.bot.clearControlStates();
  await waitTicks(ctx.bot, 4);
  const end = ctx.bot.entity?.position ?? startAfter;
  const displacement = end.y - climbStartY;
  const expected = direction === "up" ? displacement >= 2.4 : displacement <= -2.4;
  if (!expected) {
    return fail(
      "LADDER_FAILED",
      `ladder ${direction} displacement ${displacement.toFixed(2)} from y=${climbStartY.toFixed(2)}`,
      Date.now() - started,
      true,
      { startY: climbStartY, endY: end.y, displacement },
    );
  }
  return ok({ startY: climbStartY, endY: end.y, displacement }, Date.now() - started);
}
