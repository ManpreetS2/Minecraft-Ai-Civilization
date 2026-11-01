/**
 * Verified collect/mine skill. Physical gather: mineflayer-tool equipForBlock,
 * SAFE approach, dig, pickup, inventory/world verification. Claims and
 * blacklists stay in this wrapper.
 */
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import {
  equipToolForBlock,
  navigationBackend,
  pickBestResourceTarget,
  shouldBlacklistTarget,
} from "@civ/minecraft-adapter";
import { minecraftKnowledge, refuseAccidentalPropertyBreak } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlockCandidates } from "./observe.js";
import { collectItem } from "./gather.js";
import { inventorySpace, canFitDrop } from "./inventory.js";
import { expectedDropItems } from "./drop-mapping.js";
import { digUnlessAborted } from "./dig-abort.js";
import { lookAtPosition } from "./look.js";
import { equipForBlock } from "./tools.js";

export async function collectResource(
  ctx: SkillContext,
  names: string[],
  amount = 1,
  maxDistance = 48,
  prefer?: Vec3,
  opts: { dropWaitMs?: number } = {},
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
      return fail("INTERRUPTED", "collectResource interrupted for this citizen", Date.now() - started, true, {
        collected: countMatching(ctx, names) - before,
        inventoryPreserved: true,
        workComplete: false,
      });
    }
    if (!canFitDrop(ctx, names) && inventorySpace(ctx) <= 0) {
      return fail("INVENTORY_FULL", "Inventory is full; store items before mining more", Date.now() - started, true);
    }
    const countAtIterationStart = countMatching(ctx, names);
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
    const block = ctx.bot.blockAt(
      new Vec3Class(Math.floor(best.position.x), Math.floor(best.position.y), Math.floor(best.position.z)),
    );
    if (!block || block.name === "air") {
      skipped.add(key);
      ctx.body.unreachable.mark(best.position, 8_000);
      continue;
    }
    await lookAtPosition(ctx, best.position);
    const pluginEquip = await equipToolForBlock(ctx.bot, block);
    if (!pluginEquip.equipped && pluginEquip.error?.includes("NoItem")) {
      return fail("MISSING_TOOL", `Need a suitable tool to harvest ${block.name}`, Date.now() - started, true, {
        item: block.name,
      });
    }
    if (!pluginEquip.equipped) {
      const equipped = await equipForBlock(ctx, best.name);
      if (!equipped.success && equipped.code === "MISSING_TOOL") return equipped;
    }
    const held = ctx.bot.heldItem?.name;
    if (!knowledge.canHarvest(best.name, held)) {
      return fail("MISSING_TOOL", `Need a suitable tool to harvest ${best.name}`, Date.now() - started, true, {
        item: best.name,
      });
    }
    let gone = blockMissing(ctx, best.position, block.name);
    if (!gone) {
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
      const current = ctx.bot.blockAt(
        new Vec3Class(Math.floor(best.position.x), Math.floor(best.position.y), Math.floor(best.position.z)),
      );
      if (!current || current.name === "air") {
        gone = true;
      } else {
        const protectedBlock = refuseAccidentalPropertyBreak(current.name);
        if (!protectedBlock.ok) {
          skipped.add(key);
          return fail(protectedBlock.code, protectedBlock.error, Date.now() - started, false);
        }
        await lookAtPosition(ctx, best.position);
        if (ctx.signal?.aborted) {
          return fail("INTERRUPTED", "collectResource interrupted before dig", Date.now() - started, true, {
            collected: countMatching(ctx, names) - before,
            inventoryPreserved: true,
            workComplete: false,
          });
        }
        try {
          if ((await digUnlessAborted(ctx, current)) === "aborted") {
            return fail("INTERRUPTED", "collectResource interrupted during dig", Date.now() - started, true, {
              collected: countMatching(ctx, names) - before,
              inventoryPreserved: true,
              workComplete: false,
            });
          }
        } catch (error) {
          ctx.body.unreachable.mark(best.position, 20_000);
          skipped.add(key);
          return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
        }
        gone = blockMissing(ctx, best.position, current.name);
        if (!gone) {
          return fail("VERIFY_FAILED", `Block ${current.name} still present after dig`, Date.now() - started, true);
        }
      }
    }
    mined += 1;
    lastPos = best.position;
    lastName = block.name;
    await collectItem(ctx, undefined, 8);
    // Drops can land a few ticks after the dig: poll the real inventory delta (bounded) before judging possession.
    await waitForInventoryGain(ctx, () => countMatching(ctx, names), countAtIterationStart, opts.dropWaitMs ?? DROP_WAIT_MS);
    if (mined >= Math.max(1, amount)) break;
  }

  const gained = countMatching(ctx, names) - before;
  if (gained <= 0) {
    return fail(
      mined > 0 ? "ITEM_NOT_FOUND" : "BLOCK_NOT_FOUND",
      mined > 0
        ? `Broke ${lastName} but did not collect a drop into inventory`
        : `Could not collect ${names.join("/")}`,
      Date.now() - started,
      true,
      { mined, collected: 0, workComplete: false, position: lastPos },
    );
  }
  return ok({ name: lastName, collected: gained, position: lastPos ?? { x: 0, y: 0, z: 0 } }, Date.now() - started);
}

function blockMissing(ctx: SkillContext, position: Vec3, expected: string): boolean {
  const after = ctx.bot.blockAt(
    new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)),
  );
  return !after || after.name === "air" || after.name === "cave_air" || after.name !== expected;
}

const DROP_WAIT_MS = 1_200;
const DROP_POLL_MS = 40;

async function waitForInventoryGain(
  ctx: SkillContext,
  current: () => number,
  baseline: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (current() <= baseline) {
    if (ctx.signal?.aborted || Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, DROP_POLL_MS));
  }
  return true;
}

function countMatching(ctx: SkillContext, names: string[]): number {
  const set = expectedDropItems(names);
  return ctx.bot.inventory
    .items()
    .filter((item) => set.has(item.name))
    .reduce((sum, item) => sum + item.count, 0);
}
