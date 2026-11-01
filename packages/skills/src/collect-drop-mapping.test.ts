import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { collectResource } from "./collect.js";
import type { SkillContext } from "./context.js";

function nav(): NavigationBackend {
  const done = (t: { x: number; y: number; z: number }) => Promise.resolve(ok({ position: { ...t }, distance: 1 }, 1));
  return {
    name: "t", navigateToPosition: (_b, t) => done(t), navigateNear: (_b, t) => done(t),
    navigateToInteractWithBlock: (_b, t) => done(t), navigateToPlaceBlock: (_b, t) => done(t),
    followEntity: async () => ok({ username: "x", position: { x: 5.5, y: 64, z: 5.5 } }, 1),
    escapeFrom: async (_b, f) => ok({ position: f, distance: 1 }, 1), probeReachability: () => ({ reachable: true, cost: 1 }), stop: () => undefined,
  };
}

function ctxFor(blockName: string, dropName: string | undefined, held = "wooden_pickaxe", extraItems: Array<{ name: string; count: number }> = []): SkillContext {
  const pos = { x: 6, y: 64, z: 5 };
  let cur = blockName;
  const items: Array<{ name: string; count: number; slot: number }> = [];
  const slots: Array<unknown> = Array.from({ length: 46 }, () => null);
  for (const e of extraItems) { const n = { ...e, slot: 9 + items.length }; items.push(n); slots[n.slot] = n; }
  const bot = {
    entity: { position: { x: 5.5, y: 64, z: 5.5 }, eyeHeight: 1.62 },
    heldItem: { name: held, count: 1 }, entities: {},
    registry: { blocksByName: { [blockName]: { id: 17 } } },
    tool: { async equipForBlock() { return undefined; } },
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    findBlocks() { return cur === blockName ? [pos] : []; },
    blockAt(p: { x: number; y: number; z: number }) {
      if (Math.floor(p.x) === pos.x && Math.floor(p.y) === pos.y && Math.floor(p.z) === pos.z) return { name: cur, position: pos };
      return { name: "air", position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } };
    },
    async lookAt() {},
    async dig() {
      cur = "air";
      if (dropName) { const n = { name: dropName, count: 1, slot: 9 + items.length }; items.push(n); slots[n.slot] = n; }
    },
  };
  return { bot: bot as unknown as Bot, timeoutMs: 2000, body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined } } } as unknown as SkillContext;
}

function count(ctx: SkillContext, name: string): number {
  return ctx.bot.inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
}
function total(ctx: SkillContext): number {
  return ctx.bot.inventory.items().reduce((s, i) => s + i.count, 0);
}

describe("collectResource drop-to-possession mapping", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("counts coal as possession after breaking coal_ore", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("coal_ore", "coal");
    expect(count(ctx, "coal")).toBe(0);
    const r = await collectResource(ctx, ["coal_ore", "deepslate_coal_ore"], 1, 48);
    expect(count(ctx, "coal")).toBe(1); // real inventory delta
    expect(r.success).toBe(true);
  });
  it("counts raw_iron as possession after breaking iron_ore", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("iron_ore", "raw_iron", "stone_pickaxe");
    const r = await collectResource(ctx, ["iron_ore", "deepslate_iron_ore"], 1, 48);
    expect(count(ctx, "raw_iron")).toBe(1);
    expect(r.success).toBe(true);
  });
  it("does not count an unrelated oak_sapling pickup as a log", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("oak_log", "oak_sapling", "wooden_axe");
    const r = await collectResource(ctx, ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log"], 1, 48);
    expect(count(ctx, "oak_sapling")).toBe(1); // something entered inventory...
    expect(count(ctx, "oak_log")).toBe(0); // ...but it is not the requested resource
    expect(r.success).toBe(false);
  });
  it("does not count a stick pickup as a log", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("oak_log", "stick", "wooden_axe");
    const r = await collectResource(ctx, ["oak_log", "birch_log"], 1, 48);
    expect(count(ctx, "oak_log")).toBe(0);
    expect(r.success).toBe(false);
  });
  it("fails when stone is broken and nothing is picked up", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("stone", undefined);
    const r = await collectResource(ctx, ["stone", "cobblestone", "deepslate"], 1, 48);
    expect(total(ctx)).toBe(0); // block excavated, zero inventory delta
    expect(r.success).toBe(false);
  });
  it("control: oak_log broken and an oak_log picked up is success with +1 oak_log", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("oak_log", "oak_log", "wooden_axe");
    const r = await collectResource(ctx, ["oak_log", "birch_log"], 1, 48);
    expect(count(ctx, "oak_log")).toBe(1);
    expect(r.success).toBe(true);
  });
  it("control: stone broken and cobblestone picked up is success with +1 cobblestone", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("stone", "cobblestone");
    const r = await collectResource(ctx, ["stone", "cobblestone", "deepslate"], 1, 48);
    expect(count(ctx, "cobblestone")).toBe(1);
    expect(r.success).toBe(true);
  });
  it("a pre-existing coal stack is not mistaken for a new acquisition when nothing drops", async () => {
    setNavigationBackend(nav());
    const ctx = ctxFor("coal_ore", undefined, "wooden_pickaxe", [{ name: "coal", count: 3 }]);
    const r = await collectResource(ctx, ["coal_ore", "deepslate_coal_ore"], 1, 48);
    expect(count(ctx, "coal")).toBe(3); // unchanged: no delta
    expect(r.success).toBe(false);
  });
});
