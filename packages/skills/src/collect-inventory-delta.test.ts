import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { collectResource } from "./collect.js";
import type { SkillContext } from "./context.js";
import { canFitDrop } from "./inventory-service.js";
import { dropItemsForBlock, expectedDropItems } from "./drop-mapping.js";

function nav(): NavigationBackend {
  const done = (t: { x: number; y: number; z: number }) => Promise.resolve(ok({ position: { ...t }, distance: 1 }, 1));
  return {
    name: "t", navigateToPosition: (_b, t) => done(t), navigateNear: (_b, t) => done(t),
    navigateToInteractWithBlock: (_b, t) => done(t), navigateToPlaceBlock: (_b, t) => done(t),
    followEntity: async () => ok({ username: "x", position: { x: 5.5, y: 64, z: 5.5 } }, 1),
    escapeFrom: async (_b, f) => ok({ position: f, distance: 1 }, 1), probeReachability: () => ({ reachable: true, cost: 1 }), stop: () => undefined,
  };
}

type Item = { name: string; count: number; slot: number; stackSize: number };
type Opts = {
  block: string;
  drop?: { name: string; count: number };
  held?: string;
  start?: Array<{ name: string; count: number }>;
  fillWithDirt?: boolean;
  dropDelayMs?: number;
};

/** Slot-accurate inventory: drops merge into partial stacks first, then free slots; overflow is lost (partial pickup). */
function world(o: Opts) {
  const pos = { x: 6, y: 64, z: 5 };
  let cur = o.block;
  const items: Item[] = [];
  const slots: Array<Item | null> = Array.from({ length: 46 }, () => null);
  const put = (name: string, n: number): number => {
    let left = n;
    for (const it of items) {
      if (it.name !== name || left <= 0) continue;
      const room = it.stackSize - it.count;
      const add = Math.min(room, left);
      it.count += add; left -= add;
    }
    for (let slot = 9; slot <= 44 && left > 0; slot++) {
      if (slots[slot]) continue;
      const add = Math.min(64, left);
      const it = { name, count: add, slot, stackSize: 64 };
      items.push(it); slots[slot] = it; left -= add;
    }
    return n - left; // actually picked up
  };
  for (const s of o.start ?? []) put(s.name, s.count);
  if (o.fillWithDirt) for (let slot = 9; slot <= 44; slot++) if (!slots[slot]) put("dirt", 64);
  const bot = {
    entity: { position: { x: 5.5, y: 64, z: 5.5 }, eyeHeight: 1.62 },
    heldItem: { name: o.held ?? "wooden_pickaxe", count: 1 }, entities: {},
    registry: { blocksByName: { [o.block]: { id: 17 } } },
    tool: { async equipForBlock() { return undefined; } },
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    findBlocks() { return cur === o.block ? [pos] : []; },
    blockAt(p: { x: number; y: number; z: number }) {
      if (Math.floor(p.x) === pos.x && Math.floor(p.y) === pos.y && Math.floor(p.z) === pos.z) return { name: cur, position: pos };
      return { name: "air", position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } };
    },
    async lookAt() {},
    async dig() {
      cur = "air";
      const d = o.drop;
      if (!d) return;
      if (o.dropDelayMs) setTimeout(() => put(d.name, d.count), o.dropDelayMs);
      else put(d.name, d.count);
    },
  };
  const ctx = { bot: bot as unknown as Bot, timeoutMs: 2000, body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined } } } as unknown as SkillContext;
  return { ctx, blockStillThere: () => cur === o.block };
}

const count = (ctx: SkillContext, name: string) => ctx.bot.inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
const STONE = ["stone", "cobblestone", "deepslate"];
const LOGS = ["oak_log", "birch_log"];

describe("collectResource inventory-delta verification", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("stacked drop: a 3-item drop is one stack of 3 and collected is the delta (3), not the stack total", async () => {
    setNavigationBackend(nav());
    const { ctx } = world({ block: "oak_log", drop: { name: "oak_log", count: 3 }, held: "wooden_axe", start: [{ name: "oak_log", count: 5 }] });
    const r = await collectResource(ctx, LOGS, 2, 48);
    expect(count(ctx, "oak_log")).toBe(8);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.collected).toBe(3);
  });

  it("partial pickup: only the part that fits counts (64-stack with 63 held, 3 dropped => +1)", async () => {
    setNavigationBackend(nav());
    const { ctx } = world({ block: "stone", drop: { name: "cobblestone", count: 3 }, fillWithDirt: false, start: [{ name: "cobblestone", count: 63 }, ...Array.from({ length: 35 }, () => ({ name: "dirt", count: 64 }))] });
    expect(canFitDrop(ctx, STONE)).toBe(true); // room exists only in the partial cobblestone stack
    const r = await collectResource(ctx, STONE, 1, 48);
    expect(count(ctx, "cobblestone")).toBe(64);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.collected).toBe(1);
  });

  it("full inventory: refuses INVENTORY_FULL before digging, and the block survives", async () => {
    setNavigationBackend(nav());
    const { ctx, blockStillThere } = world({ block: "stone", drop: { name: "cobblestone", count: 1 }, fillWithDirt: true });
    expect(canFitDrop(ctx, STONE)).toBe(false);
    const r = await collectResource(ctx, STONE, 1, 48);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.code).toBe("INVENTORY_FULL");
    expect(blockStillThere()).toBe(true);
    expect(count(ctx, "cobblestone")).toBe(0);
  });

  it("no false INVENTORY_FULL: 'stone' is judged by its cobblestone drop (full slots, one partial cobblestone stack)", async () => {
    setNavigationBackend(nav());
    const { ctx } = world({ block: "stone", drop: { name: "cobblestone", count: 1 }, start: [{ name: "cobblestone", count: 10 }, ...Array.from({ length: 35 }, () => ({ name: "dirt", count: 64 }))] });
    // Old canFitDrop looked for room for an item literally named "stone"/"cobblestone"/"deepslate"; "coal_ore" never matched "coal".
    expect(canFitDrop(ctx, ["stone"])).toBe(true);
    const r = await collectResource(ctx, STONE, 1, 48);
    expect(r.success).toBe(true);
    expect(count(ctx, "cobblestone")).toBe(11);
  });

  it("no false INVENTORY_FULL for ores: coal_ore with a partial coal stack in an otherwise full inventory", async () => {
    setNavigationBackend(nav());
    const { ctx } = world({ block: "coal_ore", drop: { name: "coal", count: 1 }, start: [{ name: "coal", count: 20 }, ...Array.from({ length: 35 }, () => ({ name: "dirt", count: 64 }))] });
    expect(canFitDrop(ctx, ["coal_ore"])).toBe(true);
    const r = await collectResource(ctx, ["coal_ore", "deepslate_coal_ore"], 1, 48);
    expect(r.success).toBe(true);
    expect(count(ctx, "coal")).toBe(21);
  });

  it("delayed drop: an item arriving after the dig (within the poll window) is still counted", async () => {
    setNavigationBackend(nav());
    const { ctx } = world({ block: "oak_log", drop: { name: "oak_log", count: 1 }, held: "wooden_axe", dropDelayMs: 250 });
    const r = await collectResource(ctx, LOGS, 1, 48);
    expect(r.success).toBe(true);
    expect(count(ctx, "oak_log")).toBe(1);
  });

  it("delayed drop beyond the poll timeout is a failure (no credit for items that never arrived in time)", async () => {
    setNavigationBackend(nav());
    const { ctx } = world({ block: "oak_log", drop: { name: "oak_log", count: 1 }, held: "wooden_axe", dropDelayMs: 600 });
    const r = await collectResource(ctx, LOGS, 1, 48, undefined, { dropWaitMs: 60 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.code).toBe("ITEM_NOT_FOUND");
    expect(count(ctx, "oak_log")).toBe(0);
  });
});

describe("drop mapping", () => {
  it("covers the common ores and derives a safe fallback for unmapped ones", () => {
    for (const [block, item] of [["diamond_ore", "diamond"], ["deepslate_lapis_ore", "lapis_lazuli"], ["redstone_ore", "redstone"], ["emerald_ore", "emerald"], ["coal_ore", "coal"]] as const) {
      expect(dropItemsForBlock(block)).toContain(item);
    }
    expect(dropItemsForBlock("deepslate_tin_ore")).toEqual(["tin", "raw_tin"]); // unmapped modded/new ore: conservative guess
    expect(dropItemsForBlock("oak_log")).toEqual([]); // plain blocks: the item itself (added by expectedDropItems)
    expect(expectedDropItems(["oak_log"]).has("oak_log")).toBe(true);
    expect(expectedDropItems(["stone"]).has("oak_planks")).toBe(false);
  });
});
