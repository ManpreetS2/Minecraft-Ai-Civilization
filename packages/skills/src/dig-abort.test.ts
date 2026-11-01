import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { digUnlessAborted } from "./dig-abort.js";
import { mineBlock } from "./gather.js";
import { mineKnownOre } from "./mine.js";
import { harvestCropAt, tillSoil } from "./farm.js";
import { advanceBlueprintBuild, createBuildSession } from "./blueprint-build.js";
import type { SkillContext } from "./context.js";

/**
 * OPS-002: every unguarded bot.dig is raced against ctx.signal and calls bot.stopDigging() on abort, so a hung dig can no
 * longer pin a cancelled citizen. Each skill site gets a test whose dig NEVER settles and aborts from inside the dig call
 * (deterministic ordering, no timer race): the skill must settle promptly as CANCELLED and call stopDigging exactly once.
 */

type Pos = { x: number; y: number; z: number };

function inReachNav(): NavigationBackend {
  const done = (target: Pos) => Promise.resolve(ok({ position: { x: target.x, y: target.y, z: target.z }, distance: 1 }, 1));
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

/** A dig that aborts the citizen's controller from inside the call and then never settles (the OPS-001 hang). */
function hungDig(controller: AbortController, counters: { digs: number }) {
  return () => {
    counters.digs += 1;
    controller.abort();
    return new Promise<void>(() => undefined);
  };
}

async function settlesWithin<T>(run: Promise<T>, ms = 600): Promise<{ settled: true; value: T } | { settled: false }> {
  return Promise.race([run.then((value) => ({ settled: true as const, value })), new Promise<{ settled: false }>((r) => setTimeout(() => r({ settled: false }), ms))]);
}

describe("digUnlessAborted (shared helper)", () => {
  const fakeCtx = (dig: () => Promise<void>, signal?: AbortSignal, stop: () => void = () => undefined) =>
    ({ signal, bot: { dig, stopDigging: stop } }) as unknown as SkillContext;
  const block = {} as never;

  it("no signal: passes the dig through untouched", async () => {
    let digs = 0;
    await expect(digUnlessAborted(fakeCtx(async () => void (digs += 1)), block)).resolves.toBe("done");
    expect(digs).toBe(1);
  });

  it("a normal dig that finishes returns done and never calls stopDigging (an abort after it is over is ignored)", async () => {
    const controller = new AbortController();
    let stops = 0;
    await expect(digUnlessAborted(fakeCtx(async () => undefined, controller.signal, () => void (stops += 1)), block)).resolves.toBe("done");
    controller.abort(); // after the dig is over: nothing must react
    expect(stops).toBe(0);
  });

  it("a hung dig + abort returns aborted promptly and calls stopDigging once", async () => {
    const controller = new AbortController();
    let stops = 0;
    const run = digUnlessAborted(fakeCtx(() => new Promise<void>(() => undefined), controller.signal, () => void (stops += 1)), block);
    setTimeout(() => controller.abort(), 20);
    const r = await settlesWithin(run);
    expect(r).toEqual({ settled: true, value: "aborted" });
    expect(stops).toBe(1);
  });

  it("an already-aborted signal never starts a dig", async () => {
    const controller = new AbortController();
    controller.abort();
    let digs = 0;
    await expect(digUnlessAborted(fakeCtx(async () => void (digs += 1), controller.signal), block)).resolves.toBe("aborted");
    expect(digs).toBe(0);
  });

  it("a real dig error still throws to the caller", async () => {
    const controller = new AbortController();
    await expect(digUnlessAborted(fakeCtx(async () => Promise.reject(new Error("boom")), controller.signal), block)).rejects.toThrow("boom");
  });

  it("a throwing stopDigging cannot break the cancel, and an abandoned dig that later rejects is not an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const controller = new AbortController();
      let reject!: (e: Error) => void;
      const run = digUnlessAborted(
        fakeCtx(() => new Promise<void>((_, rej) => (reject = rej)), controller.signal, () => {
          throw new Error("bot gone");
        }),
        block,
      );
      controller.abort();
      await expect(run).resolves.toBe("aborted");
      reject(new Error("Digging aborted")); // mineflayer rejects the abandoned dig after stopDigging
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("OPS-002 hung dig at every skill site", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("gather.ts mineBlock", async () => {
    setNavigationBackend(inReachNav());
    const controller = new AbortController();
    const counters = { digs: 0, stops: 0 };
    const logPos = { x: 6, y: 64, z: 5 };
    const bot = {
      entity: { position: { x: 5.5, y: 64, z: 5.5 }, eyeHeight: 1.62 },
      registry: { blocksByName: { oak_log: { id: 17 } } },
      findBlocks: () => [logPos],
      blockAt: (p: Pos) =>
        Math.floor(p.x) === logPos.x && Math.floor(p.y) === logPos.y && Math.floor(p.z) === logPos.z
          ? { name: "oak_log", position: logPos }
          : { name: "air", position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } },
      lookAt: async () => undefined,
      dig: hungDig(controller, counters),
      stopDigging: () => void (counters.stops += 1),
    };
    const ctx = {
      bot: bot as unknown as Bot,
      signal: controller.signal,
      timeoutMs: 2_000,
      body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined } },
    } as unknown as SkillContext;
    const r = await settlesWithin(mineBlock(ctx, ["oak_log"]));
    expect(r.settled).toBe(true);
    expect(counters).toEqual({ digs: 1, stops: 1 });
    if (r.settled) {
      expect(r.value.success).toBe(false);
      if (!r.value.success) expect(r.value.code).toBe("CANCELLED");
    }
  });

  it("farm.ts harvestCropAt (crop dig)", async () => {
    setNavigationBackend(inReachNav());
    const controller = new AbortController();
    const counters = { digs: 0, stops: 0 };
    const cropPos = { x: 20, y: 69, z: 240 };
    const bot = {
      food: 18,
      heldItem: undefined,
      entities: {},
      entity: { position: { x: 20.5, y: 69, z: 240.5 }, eyeHeight: 1.62 },
      inventory: { items: () => [{ name: "wheat_seeds", count: 1, slot: 9 }], slots: [], inventoryStart: 9, inventoryEnd: 44 },
      blockAt: (p: Pos) =>
        Math.floor(p.x) === cropPos.x && Math.floor(p.y) === cropPos.y && Math.floor(p.z) === cropPos.z
          ? { name: "wheat", position: cropPos, getProperties: () => ({ age: 7 }) }
          : { name: "air" },
      lookAt: async () => undefined,
      dig: hungDig(controller, counters),
      stopDigging: () => void (counters.stops += 1),
    };
    const ctx = { bot: bot as unknown as Bot, signal: controller.signal, timeoutMs: 2_000, body: { nearbyEntities: () => [] } } as unknown as SkillContext;
    const r = await settlesWithin(harvestCropAt(ctx, cropPos, "wheat", { replant: false }));
    expect(r.settled).toBe(true);
    expect(counters).toEqual({ digs: 1, stops: 1 });
    if (r.settled) {
      expect(r.value.success).toBe(false);
      if (!r.value.success) expect(r.value.code).toBe("CANCELLED");
    }
  });

  it("farm.ts tillSoil (clearing the replaceable block above the soil)", async () => {
    setNavigationBackend(inReachNav());
    const controller = new AbortController();
    const counters = { digs: 0, stops: 0 };
    const soil = { x: 20, y: 68, z: 240 };
    const hoe = { name: "wooden_hoe", count: 1, slot: 9 };
    const bot = {
      food: 18,
      heldItem: undefined as { name: string; count: number } | undefined,
      entities: {},
      entity: { position: { x: 20.5, y: 69, z: 240.5 }, eyeHeight: 1.62 },
      inventory: { items: () => [hoe], slots: [], inventoryStart: 9, inventoryEnd: 44 },
      equip: async (item: { name: string; count?: number }) => {
        bot.heldItem = { name: item.name, count: 1 };
      },
      blockAt: (p: Pos) => {
        if (Math.floor(p.x) === soil.x && Math.floor(p.y) === soil.y && Math.floor(p.z) === soil.z) return { name: "dirt", position: soil };
        if (Math.floor(p.x) === soil.x && Math.floor(p.y) === soil.y + 1 && Math.floor(p.z) === soil.z) return { name: "short_grass", position: { ...soil, y: soil.y + 1 } };
        return { name: "air" };
      },
      lookAt: async () => undefined,
      dig: hungDig(controller, counters),
      stopDigging: () => void (counters.stops += 1),
    };
    const ctx = { bot: bot as unknown as Bot, signal: controller.signal, timeoutMs: 2_000, body: { nearbyEntities: () => [] } } as unknown as SkillContext;
    const r = await settlesWithin(tillSoil(ctx, soil));
    expect(r.settled).toBe(true);
    expect(counters).toEqual({ digs: 1, stops: 1 });
    if (r.settled) {
      expect(r.value.success).toBe(false);
      if (!r.value.success) expect(r.value.code).toBe("CANCELLED");
    }
  });

  it("blueprint-build.ts clearCell: a cancel during site clearing is INTERRUPTED and does NOT mark the session BLOCKED", async () => {
    setNavigationBackend(inReachNav());
    const controller = new AbortController();
    const counters = { digs: 0, stops: 0 };
    const origin = { x: 0, y: 64, z: 0 };
    const grass = { x: 0, y: 64, z: 0 };
    const bot = {
      food: 18,
      heldItem: undefined,
      entities: {},
      entity: { position: { x: 0.5, y: 64, z: -2.5 }, eyeHeight: 1.62 },
      inventory: { items: () => [], slots: [], inventoryStart: 9, inventoryEnd: 44 },
      blockAt: (p: Pos) =>
        Math.floor(p.x) === grass.x && Math.floor(p.y) === grass.y && Math.floor(p.z) === grass.z
          ? { name: "short_grass", position: grass }
          : { name: "air", position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } },
      lookAt: async () => undefined,
      dig: hungDig(controller, counters),
      stopDigging: () => void (counters.stops += 1),
    };
    const ctx = {
      bot: bot as unknown as Bot,
      signal: controller.signal,
      timeoutMs: 2_000,
      body: { position: () => ({ x: 0.5, y: 64, z: -2.5 }), nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined } },
    } as unknown as SkillContext;
    const session = createBuildSession({ origin });
    const r = await settlesWithin(advanceBlueprintBuild(ctx, session, { known: [] }));
    expect(r.settled).toBe(true);
    expect(counters).toEqual({ digs: 1, stops: 1 });
    expect(session.status).toBe("IN_PROGRESS");
    expect(session.stage).toBe("SITE_CLEARING");
    if (r.settled) {
      expect(r.value.success).toBe(false);
      if (!r.value.success) expect(r.value.code).toBe("INTERRUPTED");
    }
  });

  it("mine.ts mineKnownOre", async () => {
    setNavigationBackend(inReachNav());
    const controller = new AbortController();
    const counters = { digs: 0, stops: 0 };
    const orePos = { x: 6, y: 40, z: 5 };
    const pick = { name: "stone_pickaxe", count: 1, slot: 9 };
    const bot = {
      food: 18,
      heldItem: undefined as { name: string; count: number } | undefined,
      entities: {},
      time: { timeOfDay: 1000 },
      entity: { position: { x: 5.5, y: 40, z: 5.5 }, eyeHeight: 1.62 },
      registry: { blocksByName: { coal_ore: { id: 1 }, deepslate_coal_ore: { id: 2 } } },
      inventory: { items: () => [pick], slots: [], inventoryStart: 9, inventoryEnd: 44, emptySlotCount: () => 20 },
      equip: async (item: { name: string; count?: number }) => {
        bot.heldItem = { name: item.name, count: 1 };
      },
      tool: { equipForBlock: async () => { bot.heldItem = { name: "stone_pickaxe", count: 1 }; } },
      findBlocks: () => [orePos],
      blockAt: (p: Pos) => {
        const f = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        if (f.x === orePos.x && f.y === orePos.y && f.z === orePos.z) return { name: "coal_ore", position: orePos };
        if (f.y < orePos.y - 1) return { name: "stone", position: f };
        return { name: "air", position: f };
      },
      lookAt: async () => undefined,
      dig: hungDig(controller, counters),
      stopDigging: () => void (counters.stops += 1),
    };
    const ctx = {
      bot: bot as unknown as Bot,
      citizenId: "citizen_atlas",
      signal: controller.signal,
      timeoutMs: 4_000,
      body: { position: () => ({ x: 5.5, y: 40, z: 5.5 }), nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined } },
    } as unknown as SkillContext;
    const r = await settlesWithin(mineKnownOre(ctx, { resource: "coal", searchOrigin: { x: 5, y: 40, z: 5 }, searchRadius: 8, amount: 1 }), 2000);
    expect(r.settled).toBe(true);
    expect(counters).toEqual({ digs: 1, stops: 1 });
    if (r.settled) {
      expect(r.value.success).toBe(false);
      if (!r.value.success) expect(r.value.code).toBe("CANCELLED");
    }
  });
});
