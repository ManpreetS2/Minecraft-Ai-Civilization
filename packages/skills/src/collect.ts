import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend, pickBestResourceTarget, shouldBlacklistTarget } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlockCandidates } from "./observe.js";
import { collectItem } from "./gather.js";
import { equipForBlock } from "./tools.js";

export async function collectResource(
  ctx: SkillContext,
  names: string[],
  amount = 1,
  maxDistance = 48,
): Promise<ActionResult<{ name: string; collected: number; position: Vec3 }>> {
  const started = Date.now();
  const before = countMatching(ctx, names);
  let lastPos: Vec3 | undefined;
  let lastName = names[0] ?? "block";
  let mined = 0;

  while (countMatching(ctx, names) - before < amount) {
    if (ctx.signal?.aborted) {
      return fail("INTERRUPTED", "collectResource interrupted", Date.now() - started, true);
    }
    const candidates = findBlockCandidates(ctx, names, maxDistance);
    if (candidates.length === 0) {
      break;
    }
    const best = pickBestResourceTarget(ctx.bot, candidates, {
      blacklisted: (pos) => ctx.body.unreachable.has(pos),
      hazardsNear: (pos) => ctx.body.nearbyEntities(8).filter((e) => e.hostile && Math.hypot(e.position.x - pos.x, e.position.z - pos.z) < 6).length,
    });
    if (!best || best.score < -100) {
      return fail("TARGET_UNREACHABLE", `No reachable ${names.join("/")} target`, Date.now() - started, true);
    }
    const equipped = await equipForBlock(ctx, best.name);
    if (!equipped.success && equipped.code === "MISSING_TOOL") {
      return equipped;
    }
    const nav = navigationBackend();
    const approach = await nav.navigateToInteractWithBlock(ctx.bot, best.position, {
      timeoutMs: ctx.timeoutMs ?? 18_000,
      signal: ctx.signal,
    });
    if (!approach.success) {
      if (shouldBlacklistTarget(approach.code)) ctx.body.unreachable.mark(best.position, 25_000);
      return approach;
    }
    const block = ctx.bot.blockAt(new Vec3Class(Math.floor(best.position.x), Math.floor(best.position.y), Math.floor(best.position.z)));
    if (!block || block.name === "air") {
      return fail("WORLD_CHANGED", "Target disappeared before mining", Date.now() - started, true);
    }
    try {
      await ctx.bot.dig(block, true);
    } catch (error) {
      ctx.body.unreachable.mark(best.position, 20_000);
      return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
    }
    const after = ctx.bot.blockAt(new Vec3Class(Math.floor(best.position.x), Math.floor(best.position.y), Math.floor(best.position.z)));
    if (after && after.name === block.name) {
      return fail("VERIFY_FAILED", `Block ${block.name} still present after dig`, Date.now() - started, true);
    }
    mined += 1;
    lastPos = best.position;
    lastName = block.name;
    await collectItem(ctx, undefined, 8);
    if (mined >= Math.max(1, amount)) break;
  }

  const gained = countMatching(ctx, names) - before;
  if (gained <= 0 && mined === 0) {
    return fail("BLOCK_NOT_FOUND", `Could not collect ${names.join("/")}`, Date.now() - started, true);
  }
  return ok({ name: lastName, collected: Math.max(gained, mined), position: lastPos ?? { x: 0, y: 0, z: 0 } }, Date.now() - started);
}

function countMatching(ctx: SkillContext, names: string[]): number {
  const set = new Set(names);
  return ctx.bot.inventory
    .items()
    .filter((item) => set.has(item.name) || names.some((name) => item.name.includes(name.replace(/_log$/, ""))))
    .reduce((sum, item) => sum + item.count, 0);
}
