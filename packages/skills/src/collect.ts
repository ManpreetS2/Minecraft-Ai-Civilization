/**
 * Verified collect/mine skill. Mirrors mineflayer-collectblock's path → tool → dig →
 * pickup sequence, but claims, blacklists, protected blocks, cancellation, and
 * inventory verification stay in this wrapper. Do not load collectblock as a plugin
 * that owns simulation state.
 */
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend, pickBestResourceTarget, shouldBlacklistTarget } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlockCandidates } from "./observe.js";
import { collectItem } from "./gather.js";
import { inventorySpace, canFitDrop } from "./inventory.js";
import { lookAtPosition } from "./look.js";
import { equipForBlock } from "./tools.js";

export async function collectResource(
  ctx: SkillContext,
  names: string[],
  amount = 1,
  maxDistance = 48,
  prefer?: Vec3,
): Promise<ActionResult<{ name: string; collected: number; position: Vec3 }>> {
  const started = Date.now();
  const knowledge = minecraftKnowledge();
  const before = countMatching(ctx, names);
  let lastPos: Vec3 | undefined;
  let lastName = names[0] ?? "block";
  let mined = 0;
  const skipped = new Set<string>();

  while (countMatching(ctx, names) - before < amount) {
    if (ctx.signal?.aborted) {
      return fail("INTERRUPTED", "collectResource interrupted", Date.now() - started, true);
    }
    if (!canFitDrop(ctx, names) && inventorySpace(ctx) <= 0) {
      return fail("INVENTORY_FULL", "Inventory is full; store items before mining more", Date.now() - started, true);
    }
    const candidates = [
      ...(prefer ? [{ name: names[0] ?? "block", position: prefer }] : []),
      ...findBlockCandidates(ctx, names, maxDistance),
    ].filter(
      (candidate) => !skipped.has(`${candidate.position.x},${candidate.position.y},${candidate.position.z}`),
    );
    if (candidates.length === 0) break;
    const best = pickBestResourceTarget(ctx.bot, candidates, {
      blacklisted: (pos) => ctx.body.unreachable.has(pos),
      hazardsNear: (pos) =>
        ctx.body.nearbyEntities(8).filter((e) => e.hostile && Math.hypot(e.position.x - pos.x, e.position.z - pos.z) < 6)
          .length,
    });
    if (!best || best.score < -100) {
      return fail("TARGET_UNREACHABLE", `No reachable ${names.join("/")} target`, Date.now() - started, true);
    }
    const key = `${best.position.x},${best.position.y},${best.position.z}`;
    const equipped = await equipForBlock(ctx, best.name);
    if (!equipped.success && equipped.code === "MISSING_TOOL") {
      return equipped;
    }
    const held = ctx.bot.heldItem?.name;
    if (!knowledge.canHarvest(best.name, held)) {
      return fail("MISSING_TOOL", `Need a suitable tool to harvest ${best.name}`, Date.now() - started, true, {
        item: best.name,
      });
    }
    const approach = await navigationBackend().navigateToInteractWithBlock(ctx.bot, best.position, {
      timeoutMs: ctx.timeoutMs ?? 18_000,
      signal: ctx.signal,
    });
    const here = ctx.bot.entity?.position;
    const reach = here
      ? Math.hypot(best.position.x - here.x, best.position.y - here.y, best.position.z - here.z)
      : 99;
    if (!approach.success && reach > 4.5) {
      if (shouldBlacklistTarget(approach.code)) ctx.body.unreachable.mark(best.position, 25_000);
      skipped.add(key);
      continue;
    }
    const block = ctx.bot.blockAt(
      new Vec3Class(Math.floor(best.position.x), Math.floor(best.position.y), Math.floor(best.position.z)),
    );
    if (!block || block.name === "air") {
      skipped.add(key);
      ctx.body.unreachable.mark(best.position, 8_000);
      continue;
    }
    await lookAtPosition(ctx, best.position);
    try {
      await ctx.bot.dig(block, true);
    } catch (error) {
      ctx.body.unreachable.mark(best.position, 20_000);
      skipped.add(key);
      return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
    }
    const after = ctx.bot.blockAt(
      new Vec3Class(Math.floor(best.position.x), Math.floor(best.position.y), Math.floor(best.position.z)),
    );
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
  const knowledge = minecraftKnowledge();
  const set = new Set(names.map((name) => knowledge.normalizeItemName(name) || name));
  return ctx.bot.inventory
    .items()
    .filter((item) => set.has(item.name) || names.some((name) => item.name.includes(name.replace(/_log$/, ""))))
    .reduce((sum, item) => sum + item.count, 0);
}
