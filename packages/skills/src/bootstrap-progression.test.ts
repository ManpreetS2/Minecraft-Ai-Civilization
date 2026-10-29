/**
 * Mission 019M — offline bootstrap progression (logs → planks → sticks → table → pickaxe).
 * Uses production craftItem / obtainItem. Physical Mineflayer/Paper interactions remain UNVERIFIED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { craftItem, synthesizeKnowledgeRecipe } from "./inventory.js";
import { obtainItem } from "./obtain.js";
import type { SkillContext } from "./context.js";

const knowledge = minecraftKnowledge();

function inReachNav(): NavigationBackend {
  const done = (target: { x: number; y: number; z: number }) =>
    Promise.resolve(ok({ position: { x: target.x, y: target.y, z: target.z }, distance: 1 }, 1));
  return {
    name: "bootstrap-nav",
    navigateToPosition: (_bot, target) => done(target),
    navigateNear: (_bot, target) => done(target),
    navigateToInteractWithBlock: (_bot, block) => done(block),
    navigateToPlaceBlock: (_bot, target) => done(target),
    followEntity: async () => ok({ username: "x", position: { x: 0.5, y: 64, z: 0.5 } }, 1),
    escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };
}

type InvItem = { name: string; count: number; slot: number; id?: number };

function bootstrapCtx(opts: {
  items?: Array<{ name: string; count: number }>;
  signal?: AbortSignal;
  placeOk?: boolean;
  tableInWorld?: boolean;
}): { ctx: SkillContext; items: InvItem[]; cells: Record<string, { name: string; boundingBox?: string; position?: { x: number; y: number; z: number } }> } {
  const items: InvItem[] = [];
  const slots: Array<InvItem | null> = Array.from({ length: 46 }, () => null);
  const push = (name: string, count: number) => {
    if (count <= 0) return;
    const existing = items.find((item) => item.name === name);
    if (existing) {
      existing.count += count;
      return;
    }
    const meta = knowledge.getItem(name);
    const next: InvItem = { name, count, slot: 9 + items.length, id: meta?.id };
    items.push(next);
    slots[next.slot] = next;
  };
  for (const item of opts.items ?? []) push(item.name, item.count);

  const itemsByName: Record<string, { id: number; name: string }> = {};
  const itemsById: Record<number, { id: number; name: string }> = {};
  for (const name of [
    "oak_log",
    "oak_planks",
    "stick",
    "crafting_table",
    "wooden_pickaxe",
    "spruce_planks",
    "birch_planks",
  ]) {
    const meta = knowledge.getItem(name);
    if (!meta) continue;
    itemsByName[name] = { id: meta.id, name };
    itemsById[meta.id] = { id: meta.id, name };
  }

  const cells: Record<string, { name: string; boundingBox?: string; position?: { x: number; y: number; z: number } }> = {};
  // Flat stone floor for placement.
  for (let x = -3; x <= 3; x += 1) {
    for (let z = -3; z <= 3; z += 1) {
      cells[`${x},63,${z}`] = { name: "stone", boundingBox: "block", position: { x, y: 63, z } };
      cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty", position: { x, y: 64, z } };
      cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty", position: { x, y: 65, z } };
    }
  }
  if (opts.tableInWorld) {
    cells["2,64,0"] = { name: "crafting_table", boundingBox: "block", position: { x: 2, y: 64, z: 0 } };
  }

  const bot = {
    entity: { position: { x: 0.5, y: 64, z: 0.5 }, eyeHeight: 1.62 },
    heldItem: undefined as InvItem | undefined,
    currentWindow: null,
    inventory: {
      items: () => items,
      slots,
      inventoryStart: 9,
      inventoryEnd: 44,
    },
    registry: {
      blocksByName: { crafting_table: { id: 1 } },
      itemsByName,
      items: itemsById,
    },
    findBlock(optsFind: { matching?: number; maxDistance?: number }) {
      if (optsFind.matching !== 1) return null;
      for (const [key, block] of Object.entries(cells)) {
        if (block.name !== "crafting_table") continue;
        const [x, y, z] = key.split(",").map(Number);
        return { name: "crafting_table", position: { x: x!, y: y!, z: z! } };
      }
      return null;
    },
    findBlocks(optsFind: { matching?: number | number[]; maxDistance?: number; count?: number }) {
      const wanted = new Set(
        Array.isArray(optsFind.matching) ? optsFind.matching : optsFind.matching != null ? [optsFind.matching] : [],
      );
      const hits: Array<{ x: number; y: number; z: number }> = [];
      for (const [key, block] of Object.entries(cells)) {
        if (block.name !== "crafting_table") continue;
        if (wanted.size > 0 && !wanted.has(1)) continue;
        const [x, y, z] = key.split(",").map(Number) as [number, number, number];
        hits.push({ x, y, z });
        if (hits.length >= (optsFind.count ?? 24)) break;
      }
      return hits;
    },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      return cells[key] ?? { name: "air", boundingBox: "empty", position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
    },
    recipesAll: () => [],
    recipesFor: () => [],
    async craft(recipe: { ingredients?: Array<{ id: number; count?: number }>; result?: { id?: number; count?: number } }, crafts: number) {
      for (let n = 0; n < crafts; n += 1) {
        for (const ingredient of recipe.ingredients ?? []) {
          const name = itemsById[ingredient.id]?.name;
          if (!name) throw new Error(`unknown ingredient id ${ingredient.id}`);
          const need = ingredient.count ?? 1;
          const stack = items.find((item) => item.name === name);
          if (!stack || stack.count < need) throw new Error(`missing ${name}`);
          stack.count -= need;
          if (stack.count <= 0) {
            const idx = items.indexOf(stack);
            if (idx >= 0) items.splice(idx, 1);
            slots[stack.slot] = null;
          }
        }
        const resultId = recipe.result?.id;
        const resultName = resultId != null ? itemsById[resultId]?.name : undefined;
        if (!resultName) throw new Error("craft missing result");
        push(resultName, recipe.result?.count ?? 1);
      }
    },
    async equip(item: InvItem) {
      bot.heldItem = item;
    },
    async unequip() {
      bot.heldItem = undefined;
    },
    async activateBlock() {
      return undefined;
    },
    async lookAt() {
      return undefined;
    },
    async placeBlock(against: { position: { x: number; y: number; z: number } }, faceVector: { x: number; y: number; z: number }) {
      if (opts.placeOk === false) throw new Error("place refused");
      const dest = {
        x: Math.floor(against.position.x + faceVector.x),
        y: Math.floor(against.position.y + faceVector.y),
        z: Math.floor(against.position.z + faceVector.z),
      };
      const held = bot.heldItem;
      if (!held || held.name !== "crafting_table") throw new Error("not holding table");
      cells[`${dest.x},${dest.y},${dest.z}`] = {
        name: "crafting_table",
        boundingBox: "block",
        position: dest,
      };
      held.count -= 1;
      if (held.count <= 0) {
        const idx = items.indexOf(held);
        if (idx >= 0) items.splice(idx, 1);
        slots[held.slot] = null;
        bot.heldItem = undefined;
      }
    },
  };

  const ctx = {
    citizenId: "citizen_atlas",
    signal: opts.signal,
    timeoutMs: 2_000,
    bot: bot as unknown as Bot,
    body: {
      position: () => ({ x: 0.5, y: 64, z: 0.5 }),
      nearbyEntities: () => [],
      unreachable: { has: () => false, mark: () => undefined },
    },
  } as unknown as SkillContext;

  return { ctx, items, cells };
}

describe("Mission 019M bootstrap progression", () => {
  beforeEach(() => {
    setNavigationBackend(inReachNav());
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
    vi.useRealTimers();
  });

  it("B1 — logs to planks consume log and gain planks", async () => {
    const { ctx, items } = bootstrapCtx({ items: [{ name: "oak_log", count: 2 }] });
    const promise = craftItem(ctx, "oak_planks", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.count).toBeGreaterThan(0);
    expect(items.find((item) => item.name === "oak_planks")?.count).toBe(4);
    expect(items.find((item) => item.name === "oak_log")?.count).toBe(1);
  });

  it("B2 — planks to sticks", async () => {
    const { ctx, items } = bootstrapCtx({ items: [{ name: "oak_planks", count: 4 }] });
    const promise = craftItem(ctx, "stick", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(items.find((item) => item.name === "stick")?.count).toBe(4);
    expect(items.find((item) => item.name === "oak_planks")?.count).toBe(2);
  });

  it("B3 — crafting table from planks", async () => {
    const { ctx, items } = bootstrapCtx({ items: [{ name: "oak_planks", count: 4 }] });
    const promise = craftItem(ctx, "crafting_table", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(items.find((item) => item.name === "crafting_table")?.count).toBe(1);
    expect(items.find((item) => item.name === "oak_planks")).toBeUndefined();
  });

  it("B4 — crafting table placement verifies block state", async () => {
    const { ctx, cells } = bootstrapCtx({
      items: [{ name: "crafting_table", count: 1 }],
      placeOk: true,
    });
    // obtain wooden_pickaxe forces ensure/place when table missing and ingredients present after nested crafts.
    // Direct path: craft pickaxe needs table → ensure places held table.
    const withMats = bootstrapCtx({
      items: [
        { name: "oak_planks", count: 8 },
        { name: "stick", count: 4 },
        { name: "crafting_table", count: 1 },
      ],
      placeOk: true,
    });
    const promise = obtainItem(withMats.ctx, "wooden_pickaxe", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(Object.values(withMats.cells).some((block) => block.name === "crafting_table")).toBe(true);
    expect(withMats.items.find((item) => item.name === "wooden_pickaxe")?.count).toBe(1);
    // no-valid-surface case
    const blocked = bootstrapCtx({
      items: [
        { name: "oak_planks", count: 8 },
        { name: "stick", count: 4 },
        { name: "crafting_table", count: 1 },
      ],
      placeOk: false,
    });
    // Fill air so placeAdjacent cannot find cells — already placeOk false throws.
    const failPromise = obtainItem(blocked.ctx, "wooden_pickaxe", 1);
    await vi.runAllTimersAsync();
    const failed = await failPromise;
    expect(failed.success).toBe(false);
    if (failed.success) throw new Error("placement failure must not invent pickaxe");
    expect(["PLACE_FAILED", "NEED_WORKSTATION", "TARGET_GONE", "CRAFT_FAILED"].includes(failed.code)).toBe(true);
    expect(blocked.items.find((item) => item.name === "wooden_pickaxe")).toBeUndefined();
    void ctx;
    void cells;
  });

  it("B5 — wooden pickaxe via obtain chain from logs", async () => {
    const { ctx, items } = bootstrapCtx({
      items: [{ name: "oak_log", count: 8 }],
      placeOk: true,
    });
    const promise = obtainItem(ctx, "wooden_pickaxe", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(items.find((item) => item.name === "wooden_pickaxe")?.count).toBe(1);
    expect(result.data.item).toBe("wooden_pickaxe");
  });

  it("B6 — no materials does not manufacture a pickaxe", async () => {
    const { ctx, items } = bootstrapCtx({ items: [] });
    const promise = obtainItem(ctx, "wooden_pickaxe", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(false);
    if (result.success) throw new Error("empty inventory must not invent tools");
    expect(items).toEqual([]);
  });

  it("B7 — cancellation during obtain preserves inventory", async () => {
    const ac = new AbortController();
    ac.abort();
    const { ctx, items } = bootstrapCtx({ items: [{ name: "oak_log", count: 8 }], signal: ac.signal });
    const result = await obtainItem(ctx, "wooden_pickaxe", 1);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("cancelled obtain should fail");
    expect(result.code).toBe("CANCELLED");
    expect(items).toEqual([expect.objectContaining({ name: "oak_log", count: 8 })]);
  });

  it("B8 — missing crafting station refuses wooden_pickaxe craft", async () => {
    const { ctx, items } = bootstrapCtx({
      items: [
        { name: "oak_planks", count: 8 },
        { name: "stick", count: 4 },
      ],
      placeOk: true,
    });
    // craftItem alone (not obtain) must not complete without a table in world or inventory-to-place path.
    const promise = craftItem(ctx, "wooden_pickaxe", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(false);
    if (result.success) throw new Error("pickaxe without table must fail");
    expect(result.code).toBe("NEED_WORKSTATION");
    expect(items.find((item) => item.name === "wooden_pickaxe")).toBeUndefined();
  });

  it("B9 — invalid recipe fails without inventing items", async () => {
    const { ctx, items } = bootstrapCtx({ items: [{ name: "oak_log", count: 2 }] });
    const promise = craftItem(ctx, "not_a_real_minecraft_item_zzz", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unknown item must fail");
    expect(["UNKNOWN_ITEM", "UNKNOWN_RECIPE"].includes(result.code)).toBe(true);
    expect(items.find((item) => item.name === "oak_log")?.count).toBe(2);
  });

  it("B10 — repeated acquisition failure terminates (no logs in world)", async () => {
    const { ctx } = bootstrapCtx({ items: [] });
    const promise = obtainItem(ctx, "oak_log", 1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(false);
    if (result.success) throw new Error("gather with no blocks must fail");
    expect(["BLOCK_NOT_FOUND", "ITEM_NOT_FOUND", "SEARCH_EXHAUSTED", "TARGET_UNREACHABLE"].includes(result.code)).toBe(
      true,
    );
  });

  it("knowledge recipe synthesis maps any_planks to held oak_planks", () => {
    const { ctx } = bootstrapCtx({ items: [{ name: "oak_planks", count: 4 }] });
    const recipe = synthesizeKnowledgeRecipe(ctx.bot, "stick");
    expect(recipe).toBeDefined();
    expect(recipe?.ingredients?.some((entry) => entry.count === 2)).toBe(true);
  });
});
