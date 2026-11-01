import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import type { SkillContext } from "@civ/skills";
import { executePlan } from "./executor.js";
import { CivilizationStore } from "./store.js";
import { cellClaimKey } from "./claims.js";
import { SettlementRuntime } from "./settlement-runtime.js";

/**
 * These tests REACH the excavation fallback (mineClaimed/mineClaimedTarget): the verified collectResource pass
 * fails on its first dig (DIG_FAILED is fallback-eligible), then the fallback digs the same block and the world
 * decides what, if anything, lands in inventory.
 */
function nav(): NavigationBackend {
  const done = (t: { x: number; y: number; z: number }) => Promise.resolve(ok({ position: { ...t }, distance: 1 }, 1));
  return {
    name: "t", navigateToPosition: (_b, t) => done(t), navigateNear: (_b, t) => done(t),
    navigateToInteractWithBlock: (_b, t) => done(t), navigateToPlaceBlock: (_b, t) => done(t),
    followEntity: async () => ok({ username: "x", position: { x: 5.5, y: 64, z: 5.5 } }, 1),
    escapeFrom: async (_b, f) => ok({ position: f, distance: 1 }, 1), probeReachability: () => ({ reachable: true, cost: 1 }), stop: () => undefined,
  };
}

type Item = { name: string; count: number; slot: number };
function world(o: { block: "oak_log" | "stone"; drop?: { name: string; count: number }; held: string }, events: EventBus) {
  const pos = { x: 6, y: 64, z: 5 };
  let cur: string = o.block;
  let digs = 0;
  const items: Item[] = [];
  const slots: Array<Item | null> = Array.from({ length: 46 }, () => null);
  const put = (name: string, count: number) => {
    const existing = items.find((i) => i.name === name);
    if (existing) { existing.count += count; return; }
    const it = { name, count, slot: 9 + items.length };
    items.push(it); slots[it.slot] = it;
  };
  put(o.held, 1);
  const bot = {
    entity: { position: { x: 5.5, y: 64, z: 5.5, distanceTo: () => 1 }, eyeHeight: 1.62 },
    heldItem: { name: o.held, count: 1 }, entities: {},
    registry: { blocksByName: { [o.block]: { id: 17 } } },
    tool: { async equipForBlock() { return undefined; } },
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    findBlocks() { return cur === o.block ? [{ ...pos }] : []; },
    blockAt(p: { x: number; y: number; z: number }) {
      if (Math.floor(p.x) === pos.x && Math.floor(p.y) === pos.y && Math.floor(p.z) === pos.z) return { name: cur, position: { ...pos } };
      return { name: "air", position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } };
    },
    async lookAt() {},
    async dig() {
      digs += 1;
      if (digs === 1) throw new Error("dig interrupted"); // collectResource -> DIG_FAILED -> fallback is eligible
      cur = "air";
      if (o.drop) put(o.drop.name, o.drop.count);
    },
  };
  const ctx = {
    events, citizenId: "citizen_atlas", bot: bot as unknown as SkillContext["bot"], timeoutMs: 2000,
    body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined }, position: () => ({ x: 5.5, y: 64, z: 5.5 }) },
  } as unknown as SkillContext;
  return { ctx, count: (n: string) => items.filter((i) => i.name === n).reduce((s, i) => s + i.count, 0), digs: () => digs, blockGone: () => cur === "air" };
}

const woodPlan = { goal: "gather_wood", task: "gather_wood", action: "mineBlock", source: "planner", reason: "t", priority: 0.5 } as never;
const stonePlan = { goal: "mine_stone", task: "mine_stone", action: "mineBlock", source: "planner", reason: "t", priority: 0.5 } as never;
const newStore = () => new CivilizationStore(join(mkdtempSync(join(tmpdir(), "bh-fb-")), "civ.sqlite"));

async function run(o: Parameters<typeof world>[0], plan: never, runtime?: SettlementRuntime) {
  setNavigationBackend(nav());
  const events = new EventBus();
  const w = world(o, events);
  const collected: Array<Record<string, unknown>> = [];
  events.on((e) => { if (e.type === "ResourceCollected") collected.push(e.payload as Record<string, unknown>); });
  const result = await executePlan(w.ctx, plan, newStore(), events, runtime);
  return { ...w, result, collected };
}

describe("gather_wood excavation fallback verifies the EXPECTED item", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("real gain: fallback dig that drops an oak_log is success, +1 oak_log, one ResourceCollected(count 1)", async () => {
    const r = await run({ block: "oak_log", drop: { name: "oak_log", count: 1 }, held: "wooden_axe" }, woodPlan);
    expect(r.digs()).toBe(2); // first dig failed in collectResource, second ran in the fallback
    expect(r.count("oak_log")).toBe(1);
    expect(r.result.success).toBe(true);
    expect(r.collected).toHaveLength(1);
    expect(r.collected[0]).toMatchObject({ item: "oak_log", count: 1 });
  });

  it("no gain: fallback dig that drops nothing fails ITEM_NOT_FOUND with no event", async () => {
    const r = await run({ block: "oak_log", held: "wooden_axe" }, woodPlan);
    expect(r.digs()).toBe(2);
    expect(r.blockGone()).toBe(true); // excavated, but...
    expect(r.count("oak_log")).toBe(0); // ...zero inventory delta
    expect(r.result.success).toBe(false);
    if (!r.result.success) expect(r.result.code).toBe("ITEM_NOT_FOUND");
    expect(r.collected).toHaveLength(0);
  });

  it("wrong item: an oak_sapling pickup grows total inventory but is not a log => failure, no event", async () => {
    const r = await run({ block: "oak_log", drop: { name: "oak_sapling", count: 2 }, held: "wooden_axe" }, woodPlan);
    expect(r.digs()).toBe(2);
    expect(r.count("oak_sapling")).toBe(2); // total inventory did grow (the old gate would have passed)
    expect(r.count("oak_log")).toBe(0);
    expect(r.result.success).toBe(false);
    if (!r.result.success) expect(r.result.code).toBe("ITEM_NOT_FOUND");
    expect(r.collected).toHaveLength(0);
  });
});

describe("mine_stone claim-contended fallback applies the same possession gate", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));
  // Another citizen already holds the "ore" claim on the cell, so mineClaimedTarget takes the contended branch.
  const contended = () => {
    const runtime = new SettlementRuntime();
    expect(runtime.claims.tryClaim("ore", cellClaimKey(6, 64, 5), "citizen_rival", 60_000)).toBe(true);
    return runtime;
  };

  it("real gain: cobblestone drop is success with ResourceCollected(cobblestone, 1) and the rival's claim is untouched", async () => {
    const runtime = contended();
    const r = await run({ block: "stone", drop: { name: "cobblestone", count: 1 }, held: "wooden_pickaxe" }, stonePlan, runtime);
    expect(r.digs()).toBe(2);
    expect(r.count("cobblestone")).toBe(1);
    expect(r.result.success).toBe(true);
    expect(r.collected).toHaveLength(1);
    expect(r.collected[0]).toMatchObject({ item: "cobblestone", count: 1 });
    expect(runtime.claims.ownerOf("ore", cellClaimKey(6, 64, 5))).toBe("citizen_rival");
  });

  it("no gain: excavation without a drop is a failure, not a success", async () => {
    const r = await run({ block: "stone", held: "wooden_pickaxe" }, stonePlan, contended());
    expect(r.digs()).toBe(2);
    expect(r.blockGone()).toBe(true);
    expect(r.count("cobblestone")).toBe(0);
    expect(r.result.success).toBe(false);
    expect(r.collected).toHaveLength(0);
  });

  it("wrong item: a dirt pickup is not cobblestone => failure, no event", async () => {
    const r = await run({ block: "stone", drop: { name: "dirt", count: 1 }, held: "wooden_pickaxe" }, stonePlan, contended());
    expect(r.count("dirt")).toBe(1);
    expect(r.count("cobblestone")).toBe(0);
    expect(r.result.success).toBe(false);
    expect(r.collected).toHaveLength(0);
  });
});
