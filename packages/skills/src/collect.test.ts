import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";
import {
  createNavigationBackend,
  setNavigationBackend,
  type NavigationBackend,
} from "@civ/minecraft-adapter";
import { collectResource } from "./collect.js";
import type { SkillContext } from "./context.js";

function inReachNav(): NavigationBackend {
  const done = (target: { x: number; y: number; z: number }) =>
    Promise.resolve(ok({ position: { x: target.x, y: target.y, z: target.z }, distance: 1 }, 1));
  return {
    name: "test-nav",
    navigateToPosition: (_bot, target) => done(target),
    navigateNear: (_bot, target) => done(target),
    navigateToInteractWithBlock: (_bot, block) => done(block),
    navigateToPlaceBlock: (_bot, target) => done(target),
    followEntity: async () => ok({ username: "x", position: { x: 5.5, y: 64, z: 5.5 } }, 1),
    escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };
}

function collectCtx(opts: {
  removeOnDig?: boolean;
  grantDrop?: boolean;
  signal?: AbortSignal;
  inventoryFull?: boolean;
}): SkillContext {
  const logPos = { x: 6, y: 64, z: 5 };
  let logName = "oak_log";
  const items: Array<{ name: string; count: number; slot: number }> = opts.inventoryFull
    ? Array.from({ length: 36 }, (_, i) => ({ name: "dirt", count: 64, slot: 9 + i }))
    : [];
  const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from(
    { length: 46 },
    () => null,
  );
  items.forEach((item) => {
    slots[item.slot] = item;
  });
  const bot = {
    entity: { position: { x: 5.5, y: 64, z: 5.5 }, eyeHeight: 1.62 },
    heldItem: { name: "wooden_axe", count: 1 },
    entities: {},
    registry: { blocksByName: { oak_log: { id: 17 } } },
    tool: {
      async equipForBlock() {
        return undefined;
      },
    },
    inventory: {
      items: () => items,
      slots,
      inventoryStart: 9,
      inventoryEnd: 44,
    },
    findBlocks() {
      return logName === "oak_log" ? [logPos] : [];
    },
    blockAt(pos: { x: number; y: number; z: number }) {
      if (
        Math.floor(pos.x) === logPos.x &&
        Math.floor(pos.y) === logPos.y &&
        Math.floor(pos.z) === logPos.z
      ) {
        return { name: logName, position: logPos };
      }
      return {
        name: "air",
        position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
      };
    },
    async lookAt() {
      return undefined;
    },
    async dig() {
      if (opts.removeOnDig !== false) logName = "air";
      if (opts.grantDrop) {
        const existing = items.find((item) => item.name === "oak_log");
        if (existing) existing.count += 1;
        else {
          const next = { name: "oak_log", count: 1, slot: 9 + items.length };
          items.push(next);
          slots[next.slot] = next;
        }
      }
    },
  };
  return {
    bot: bot as unknown as Bot,
    signal: opts.signal,
    timeoutMs: 2_000,
    body: {
      nearbyEntities: () => [],
      unreachable: { has: () => false, mark: () => undefined },
    },
  } as unknown as SkillContext;
}

describe("collectResource inventory truthfulness", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("succeeds only when the expected item enters inventory", async () => {
    setNavigationBackend(inReachNav());
    const result = await collectResource(
      collectCtx({ removeOnDig: true, grantDrop: true }),
      ["oak_log"],
      1,
      48,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.collected).toBe(1);
    expect(result.data.name).toBe("oak_log");
  });

  it("fails ITEM_NOT_FOUND when the block is removed but no drop is collected", async () => {
    setNavigationBackend(inReachNav());
    const result = await collectResource(
      collectCtx({ removeOnDig: true, grantDrop: false }),
      ["oak_log"],
      1,
      48,
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("excavation without pickup must not invent collection");
    expect(result.code).toBe("ITEM_NOT_FOUND");
    expect(result.details?.collected).toBe(0);
    expect(result.details?.mined).toBeGreaterThan(0);
  });

  it("fails VERIFY_FAILED when the block is unchanged after dig", async () => {
    setNavigationBackend(inReachNav());
    const result = await collectResource(collectCtx({ removeOnDig: false }), ["oak_log"], 1, 48);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("undug block should fail");
    expect(result.code).toBe("VERIFY_FAILED");
  });

  it("fails BLOCK_NOT_FOUND when no target remains", async () => {
    setNavigationBackend(inReachNav());
    const ctx = collectCtx({ removeOnDig: true });
    // Clear the only log before the skill runs.
    const block = ctx.bot.blockAt({ x: 6, y: 64, z: 5 } as never);
    if (block) await ctx.bot.dig(block, true);
    const result = await collectResource(ctx, ["oak_log"], 1, 48);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("missing target should fail");
    expect(result.code).toBe("BLOCK_NOT_FOUND");
  });

  it("fails INVENTORY_FULL before mining when there is no free slot", async () => {
    setNavigationBackend(inReachNav());
    const result = await collectResource(collectCtx({ inventoryFull: true }), ["oak_log"], 1, 48);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("full inventory should refuse");
    expect(result.code).toBe("INVENTORY_FULL");
  });

  it("honours cancellation before digging", async () => {
    setNavigationBackend(inReachNav());
    const ac = new AbortController();
    ac.abort();
    const result = await collectResource(
      collectCtx({ signal: ac.signal, grantDrop: true }),
      ["oak_log"],
      1,
      48,
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("aborted collect should fail");
    expect(result.code === "INTERRUPTED" || result.code === "CANCELLED").toBe(true);
    expect(result.details?.workComplete).toBe(false);
  });
});

describe("collectResource target changes while navigating", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it.each(
    ["dirt", "crafting_table", "stone"].flatMap((replacement) =>
      ["navigation", "look"].map((timing) => [replacement, timing]),
    ),
  )("never digs a log replaced with %s during %s", async (replacement, timing) => {
    const ctx = collectCtx({ grantDrop: false });
    let replaced = false;
    const originalBlockAt = ctx.bot.blockAt.bind(ctx.bot);
    vi.spyOn(ctx.bot, "blockAt").mockImplementation((position, extraInfos) => {
      const block = originalBlockAt(position, extraInfos);
      if (block && replaced && block.name === "oak_log") block.name = replacement;
      return block;
    });
    const dig = vi.spyOn(ctx.bot, "dig");
    let looks = 0;
    vi.spyOn(ctx.bot, "lookAt").mockImplementation(async () => {
      if (++looks >= 2 && timing === "look") replaced = true;
    });
    const nav = inReachNav();
    nav.navigateToInteractWithBlock = async () => {
      if (timing === "navigation") replaced = true;
      return ok({ position: { x: 6, y: 64, z: 5 }, distance: 1 }, 1);
    };
    setNavigationBackend(nav);
    const result = await collectResource(ctx, ["oak_log"], 1, 48, undefined, { dropWaitMs: 0 });
    expect(dig).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(ctx.bot.inventory.items()).toEqual([]);
  });
});
