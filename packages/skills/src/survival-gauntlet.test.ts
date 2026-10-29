/**
 * Mission 017 offline survival gauntlet.
 * Exercises production skill functions with fake-Mineflayer fixtures only.
 * Does not launch Paper, Minecraft, or cloud inference.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { fail, ok, type Vec3 } from "@civ/shared";
import {
  arrivalAccepted,
  createNavigationBackend,
  setNavigationBackend,
  type NavigationBackend,
} from "@civ/minecraft-adapter";
import { collectResource } from "./collect.js";
import { craftItem, eatFood } from "./inventory.js";
import { harvestCropAt, harvestPlot, workFarmPlot, plotCells } from "./farm.js";
import { mineBlock } from "./gather.js";
import { obtainItem } from "./obtain.js";
import { sleep } from "./world.js";
import type { SkillContext } from "./context.js";

function inReachNav(): NavigationBackend {
  const done = (target: { x: number; y: number; z: number }) =>
    Promise.resolve(ok({ position: { x: target.x, y: target.y, z: target.z }, distance: 1 }, 1));
  return {
    name: "gauntlet-nav",
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

function unreachableNav(): NavigationBackend {
  const blocked = () => Promise.resolve(fail("PATH_BLOCKED", "unreachable destination", 1, true));
  return {
    name: "gauntlet-unreachable",
    navigateToPosition: blocked,
    navigateNear: blocked,
    navigateToInteractWithBlock: blocked,
    navigateToPlaceBlock: blocked,
    followEntity: async () => fail("PATH_BLOCKED", "unreachable", 1, true),
    escapeFrom: blocked,
    probeReachability: () => ({ reachable: false, cost: 99 }),
    stop: () => undefined,
  };
}

describe("Mission 017 survival gauntlet", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("scenario 1 — resource acquisition requires inventory delta", async () => {
    setNavigationBackend(inReachNav());
    const logPos = { x: 6, y: 64, z: 5 };
    let logName = "oak_log";
    const items: Array<{ name: string; count: number; slot: number }> = [];
    const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
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
      inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
      findBlocks: () => (logName === "oak_log" ? [logPos] : []),
      blockAt(pos: { x: number; y: number; z: number }) {
        if (Math.floor(pos.x) === logPos.x && Math.floor(pos.y) === logPos.y && Math.floor(pos.z) === logPos.z) {
          return { name: logName, position: logPos };
        }
        return { name: "air", position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
      },
      async lookAt() {
        return undefined;
      },
      async dig() {
        logName = "air";
        const next = { name: "oak_log", count: 1, slot: 9 };
        items.push(next);
        slots[9] = next;
      },
    };
    const ctx = {
      bot: bot as unknown as Bot,
      timeoutMs: 2_000,
      body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined } },
    } as unknown as SkillContext;
    const before = 0;
    const result = await collectResource(ctx, ["oak_log"], 1, 48);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.collected).toBe(1);
    expect(items.reduce((sum, item) => sum + (item.name === "oak_log" ? item.count : 0), 0) - before).toBe(1);

    // Excavation-only path must not invent acquisition.
    logName = "oak_log";
    items.length = 0;
    slots[9] = null;
    const excavated = await mineBlock(ctx, ["oak_log"]);
    expect(excavated.success).toBe(true);
    if (!excavated.success) throw new Error(excavated.error);
    expect(excavated.data.excavated).toBe(true);
    expect(excavated.data.resourceAcquired).toBe(false);
  });

  it("scenario 2 — crafting fails closed without inventing sticks from logs", async () => {
    const items = [{ name: "oak_log", count: 4, slot: 9 }];
    const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
    slots[9] = items[0]!;
    const ctx = {
      bot: {
        inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
        registry: { blocksByName: { crafting_table: { id: 1 } }, itemsByName: {}, items: {} },
        findBlock: () => null,
        recipesAll: () => [],
        recipesFor: () => [],
        craft: async () => undefined,
        entity: { position: { x: 0, y: 64, z: 0 } },
      },
      body: { position: () => ({ x: 0, y: 64, z: 0 }) },
    } as unknown as SkillContext;
    const crafted = await craftItem(ctx, "stick");
    expect(crafted.success).toBe(false);
    if (crafted.success) throw new Error("logs alone must not craft sticks");
    expect(["MISSING_INGREDIENT", "PREREQUISITE_MISSING", "UNKNOWN_RECIPE"].includes(crafted.code)).toBe(true);
    expect(items[0]?.count).toBe(4);

    const cancelled = new AbortController();
    cancelled.abort();
    const obtain = await obtainItem(
      { ...ctx, signal: cancelled.signal, citizenId: "citizen_atlas" } as SkillContext,
      "wooden_pickaxe",
    );
    expect(obtain.success).toBe(false);
    if (obtain.success) throw new Error("cancelled obtain should fail");
    expect(obtain.code).toBe("CANCELLED");
  });

  it("scenario 3 — hunger recovery requires observable evidence", async () => {
    const items = [{ name: "bread", count: 2, slot: 9 }];
    const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
    slots[9] = items[0]!;
    const bot = {
      food: 8,
      items,
      heldItem: undefined as { name: string; count: number } | undefined,
      inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
      async equip(stack: { name: string; count: number }) {
        bot.heldItem = stack;
      },
      async consume() {
        items[0]!.count -= 1;
        bot.food = Math.min(20, bot.food + 5);
      },
    };
    const ctx = { bot: bot as unknown as Bot, body: { nearbyEntities: () => [] } } as unknown as SkillContext;
    const ate = await eatFood(ctx);
    expect(ate.success).toBe(true);
    if (!ate.success) throw new Error(ate.error);
    expect(ate.data.food).toBe(13);
    expect(items[0]?.count).toBe(1);

    bot.consume = async () => undefined;
    bot.food = 8;
    items[0]!.count = 2;
    const noop = await eatFood(ctx);
    expect(noop.success).toBe(false);
    if (noop.success) throw new Error("no-op eat must fail");
    expect(noop.code).toBe("VERIFY_FAILED");
  });

  it("scenario 4 — farming reports zero invented yield", async () => {
    setNavigationBackend(inReachNav());
    const origin = { x: 20, y: 68, z: 240 };
    const cells: Record<string, { name: string; position?: Vec3; getProperties?: () => { age?: number } }> = {};
    for (const soil of plotCells(origin, 1)) {
      cells[`${soil.x},${soil.y},${soil.z}`] = { name: "farmland" };
      cells[`${soil.x},${soil.y + 1},${soil.z}`] = {
        name: "wheat",
        position: { x: soil.x, y: soil.y + 1, z: soil.z },
        getProperties: () => ({ age: 7 }),
      };
    }
    cells["23,68,241"] = { name: "water" };
    const items = [
      { name: "wooden_hoe", count: 1, slot: 9 },
      { name: "wheat_seeds", count: 4, slot: 10 },
      { name: "wheat", count: 9, slot: 11 },
    ];
    const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
    items.forEach((item) => {
      slots[item.slot] = item;
    });
    const bot = {
      food: 18,
      heldItem: items[0],
      entities: {},
      entity: { position: { x: 20.5, y: 69, z: 240.5 }, eyeHeight: 1.62 },
      inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
      async equip(item: { name: string; count?: number }) {
        bot.heldItem = { name: item.name, count: item.count ?? 1, slot: 9 };
      },
      blockAt(pos: { x: number; y: number; z: number }) {
        return cells[`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`] ?? { name: "air" };
      },
      async dig(block: { position: Vec3 }) {
        cells[`${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`] = {
          name: "air",
        };
      },
      async activateBlock() {
        return undefined;
      },
      async lookAt() {
        return undefined;
      },
    };
    const ctx = {
      bot: bot as unknown as Bot,
      timeoutMs: 2_000,
      body: { nearbyEntities: () => [] },
    } as unknown as SkillContext;
    const plot = await harvestPlot(ctx, origin, 1, "wheat", { replant: false });
    expect(plot.success).toBe(true);
    if (!plot.success) throw new Error(plot.error);
    expect(plot.data.collected).toBe(0);
    expect(plot.data.harvested).toHaveLength(1);

    const one = await harvestCropAt(ctx, { x: 20, y: 69, z: 240 }, "wheat", { replant: false });
    expect(one.success).toBe(false);
    if (one.success) throw new Error("already-broken crop should be gone");
    expect(one.code).toBe("BLOCK_NOT_FOUND");
  });

  it("scenario 5 — sleep guards daytime, missing bed, and hostiles", async () => {
    setNavigationBackend(inReachNav());
    const bed: Vec3 = { x: 10, y: 64, z: 10 };
    const makeSleep = (over: { timeOfDay?: number; hostile?: boolean; missing?: boolean }) => {
      const blocks: Record<string, { name: string; position: Vec3 }> = {};
      if (!over.missing) blocks[`${bed.x},${bed.y},${bed.z}`] = { name: "red_bed", position: bed };
      const bot = {
        time: { timeOfDay: over.timeOfDay ?? 14_000 },
        isRaining: false,
        isSleeping: false,
        thunderState: 0,
        entity: { position: { x: 10.5, y: 64, z: 10.5 } },
        blockAt(pos: { x: number; y: number; z: number }) {
          return (
            blocks[`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`] ?? {
              name: "air",
              position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
            }
          );
        },
        findBlock: () => null,
        lookAt: async () => undefined,
        async sleep() {
          bot.isSleeping = true;
        },
        async wake() {
          bot.isSleeping = false;
        },
      };
      return {
        bot: bot as unknown as Bot,
        body: {
          nearbyEntities: () => (over.hostile ? [{ hostile: true, position: { x: 11, y: 64, z: 11 } }] : []),
        },
      } as unknown as SkillContext;
    };

    const day = await sleep(makeSleep({ timeOfDay: 1000 }), bed);
    expect(day.success).toBe(false);
    if (day.success) throw new Error("daytime sleep should fail");
    expect(day.code).toBe("NOT_SLEEP_TIME");

    const missing = await sleep(makeSleep({ missing: true }), bed);
    expect(missing.success).toBe(false);
    if (missing.success) throw new Error("missing bed should fail");
    expect(missing.code).toBe("BED_MISSING");

    const hostile = await sleep(makeSleep({ hostile: true }), bed);
    expect(hostile.success).toBe(false);
    if (hostile.success) throw new Error("hostile sleep should fail");
    expect(hostile.code).toBe("HOSTILE_NEARBY");

    const okSleep = await sleep(makeSleep({}), bed);
    expect(okSleep.success).toBe(true);
  });

  it("scenario 6 — interrupted task does not invent completion", async () => {
    setNavigationBackend(inReachNav());
    const ac = new AbortController();
    ac.abort();
    const items = [{ name: "bread", count: 1, slot: 9 }];
    const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
    slots[9] = items[0]!;
    const ctx = {
      signal: ac.signal,
      bot: {
        food: 8,
        inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
        async equip() {
          return undefined;
        },
        async consume() {
          throw new Error("should not consume after cancel");
        },
      },
      body: { nearbyEntities: () => [] },
    } as unknown as SkillContext;
    const result = await eatFood(ctx);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("cancelled eat must fail");
    expect(result.code).toBe("CANCELLED");
    expect(items[0]?.count).toBe(1);
  });

  it("scenario 7 — unreachable destination fails without false arrival", async () => {
    setNavigationBackend(unreachableNav());
    const bot = {
      entity: { position: { x: 0.5, y: 64, z: 0.5 }, eyeHeight: 1.62 },
      registry: { blocksByName: { oak_log: { id: 17 } } },
      findBlocks: () => [{ x: 40, y: 64, z: 40 }],
      blockAt: () => ({ name: "oak_log", position: { x: 40, y: 64, z: 40 } }),
      async lookAt() {
        return undefined;
      },
      async dig() {
        throw new Error("should not dig unreachable");
      },
    };
    const ctx = {
      bot: bot as unknown as Bot,
      timeoutMs: 1_000,
      body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined } },
    } as unknown as SkillContext;
    const result = await mineBlock(ctx, ["oak_log"]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable mine should fail");
    expect(result.code).toBe("PATH_BLOCKED");
    expect(arrivalAccepted({ x: 0.5, y: 64, z: 0.5 }, { x: 40, y: 64, z: 40 }, 2)).toBe(false);
  });

  it("scenario 8 — multi-step sequence fails when intermediate physical action fails", async () => {
    setNavigationBackend(unreachableNav());
    const origin = { x: 20, y: 68, z: 240 };
    const cells: Record<string, { name: string; getProperties?: () => { age?: number } }> = {};
    for (const soil of plotCells(origin, 3)) {
      cells[`${soil.x},${soil.y},${soil.z}`] = { name: "dirt" };
      cells[`${soil.x},${soil.y + 1},${soil.z}`] = { name: "air" };
    }
    cells["23,68,241"] = { name: "water" };
    const items = [
      { name: "wooden_hoe", count: 1, slot: 9 },
      { name: "wheat_seeds", count: 9, slot: 10 },
    ];
    const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
    items.forEach((item) => {
      slots[item.slot] = item;
    });
    const ctx = {
      bot: {
        food: 18,
        heldItem: items[0],
        entities: {},
        entity: { position: { x: 0.5, y: 64, z: 0.5 }, eyeHeight: 1.62 },
        inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
        async equip() {
          return undefined;
        },
        blockAt(pos: { x: number; y: number; z: number }) {
          return cells[`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`] ?? { name: "air" };
        },
        async activateBlock() {
          return undefined;
        },
      } as unknown as Bot,
      timeoutMs: 1_000,
      body: { nearbyEntities: () => [] },
    } as unknown as SkillContext;
    const result = await workFarmPlot(ctx, { origin, water: { x: 23, y: 68, z: 241 } });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable till/plant must not mark farm complete");
    expect(result.details?.workComplete).toBe(false);
  });
});

describe("Mission 017 gauntlet — UNVERIFIED offline limits", () => {
  it("documents live-only Mineflayer pathfinder / recipe window timing", () => {
    // Fake bots cannot exercise real Mineflayer pathfinder against Paper or
    // authentic crafting-table window packet timing. Those remain UNVERIFIED offline.
    expect(true).toBe(true);
  });
});
