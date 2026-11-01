import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import type { SkillContext } from "@civ/skills";
import { executePlan, completionMemoryForTask } from "./executor.js";
import { CivilizationStore } from "./store.js";
import { lastOutcomeFrom, physicalWorkComplete } from "./task-recovery.js";

function nav(): NavigationBackend {
  const done = (t: { x: number; y: number; z: number }) => Promise.resolve(ok({ position: { ...t }, distance: 1 }, 1));
  return {
    name: "t", navigateToPosition: (_b, t) => done(t), navigateNear: (_b, t) => done(t),
    navigateToInteractWithBlock: (_b, t) => done(t), navigateToPlaceBlock: (_b, t) => done(t),
    followEntity: async () => ok({ username: "x", position: { x: 5.5, y: 64, z: 5.5 } }, 1),
    escapeFrom: async (_b, f) => ok({ position: f, distance: 1 }, 1), probeReachability: () => ({ reachable: true, cost: 1 }), stop: () => undefined,
  };
}

function world(opts: { inventoryFullOfDirt?: boolean; dropOnDig?: boolean; startLogs?: number }, events?: EventBus) {
  const logs = new Map<string, string>([["6,64,5", "oak_log"], ["7,64,5", "oak_log"]]);
  const items: Array<{ name: string; count: number; slot: number }> = opts.inventoryFullOfDirt
    ? Array.from({ length: 36 }, (_, i) => ({ name: "dirt", count: 64, slot: 9 + i }))
    : opts.startLogs ? [{ name: "oak_log", count: opts.startLogs, slot: 9 }] : [];
  const slots: Array<unknown> = Array.from({ length: 46 }, () => null);
  items.forEach((i) => (slots[i.slot] = i));
  const bot = {
    entity: { position: { x: 5.5, y: 64, z: 5.5, distanceTo: () => 1 }, eyeHeight: 1.62 },
    heldItem: { name: "wooden_axe", count: 1 }, entities: {},
    registry: { blocksByName: { oak_log: { id: 17 } } },
    tool: { async equipForBlock() { return undefined; } },
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    findBlocks() { return [...logs.entries()].filter(([, n]) => n === "oak_log").map(([k]) => { const [x, y, z] = k.split(",").map(Number); return { x, y, z }; }); },
    blockAt(p: { x: number; y: number; z: number }) {
      const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
      const [x, y, z] = k.split(",").map(Number);
      return { name: logs.get(k) ?? "air", position: { x, y, z } };
    },
    async lookAt() {},
    async dig(b: { position: { x: number; y: number; z: number } }) {
      logs.set(`${b.position.x},${b.position.y},${b.position.z}`, "air");
      if (opts.dropOnDig) { const n = { name: "oak_log", count: 1, slot: 9 + items.length }; items.push(n); slots[n.slot] = n; }
    },
  };
  const ctx = { events, bot: bot as unknown as SkillContext["bot"], timeoutMs: 2000, body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined }, position: () => ({ x: 5.5, y: 64, z: 5.5 }) } } as unknown as SkillContext;
  return { ctx, items, logs };
}

const logsLeft = (logs: Map<string, string>) => [...logs.values()].filter((n) => n === "oak_log").length;
const countOf = (items: Array<{ name: string; count: number }>, name: string) => items.filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);
const gatherPlan = { goal: "gather_wood", task: "gather_wood", action: "mineBlock", source: "planner", reason: "t", priority: 0.5 } as never;

describe("gather_wood possession vs excavation", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));
  const newStore = () => new CivilizationStore(join(mkdtempSync(join(tmpdir(), "bh-")), "civ.sqlite"));

  it("control: a dig that drops a log is success with +1 oak_log, and physicalWorkComplete", async () => {
    setNavigationBackend(nav());
    const events = new EventBus();
    const { ctx, items, logs } = world({ dropOnDig: true }, events);
    const seen: string[] = [];
    events.on((e) => seen.push(e.type));
    expect(countOf(items, "oak_log")).toBe(0);
    const result = await executePlan(ctx, gatherPlan, newStore(), events);
    expect(countOf(items, "oak_log")).toBe(1); // inventory delta
    expect(logsLeft(logs)).toBe(1);
    expect(result.success).toBe(true);
    expect(physicalWorkComplete(result)).toBe(true);
  });

  // F11 (fixed): the inventory-verified collectResource path emits ResourceCollected with the REAL inventory delta.
  it("F11: verified collectResource gather emits ResourceCollected whose count is the observed inventory delta", async () => {
    setNavigationBackend(nav());
    const events = new EventBus();
    const { ctx, items } = world({ dropOnDig: true, startLogs: 2 }, events);
    const collected: Array<Record<string, unknown>> = [];
    events.on((e) => {
      if (e.type === "ResourceCollected") collected.push(e.payload as Record<string, unknown>);
    });
    const before = countOf(items, "oak_log");
    const result = await executePlan(ctx, gatherPlan, newStore(), events);
    const delta = countOf(items, "oak_log") - before;
    expect(result.success).toBe(true);
    expect(delta).toBe(1);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ name: "oak_log", item: "oak_log", count: delta }); // delta, not the 3 logs now held
    expect(collected[0]?.position).toBeDefined();
  });

  it("F11: no ResourceCollected when the verified path fails (nothing entered inventory)", async () => {
    setNavigationBackend(nav());
    const events = new EventBus();
    const { ctx, items } = world({ startLogs: 2 }, events);
    const seen: string[] = [];
    events.on((e) => seen.push(e.type));
    const result = await executePlan(ctx, gatherPlan, newStore(), events);
    expect(countOf(items, "oak_log")).toBe(2); // unchanged
    expect(result.success).toBe(false);
    expect(seen).not.toContain("ResourceCollected");
  });

  it("F11: exactly one ResourceCollected per gather (the fallback does not double-emit)", async () => {
    setNavigationBackend(nav());
    const events = new EventBus();
    const { ctx } = world({ dropOnDig: true }, events);
    const seen: string[] = [];
    events.on((e) => seen.push(e.type));
    await executePlan(ctx, gatherPlan, newStore(), events);
    expect(seen.filter((t) => t === "ResourceCollected")).toHaveLength(1);
  });

  it("excavation without an inventory gain is not success, workComplete, a ResourceCollected event, or a completion memory", async () => {
    setNavigationBackend(nav());
    const events = new EventBus();
    const { ctx, items, logs } = world({}, events);
    const seen: string[] = [];
    events.on((e) => seen.push(e.type));
    const result = await executePlan(ctx, gatherPlan, newStore(), events);
    expect(items.length).toBe(0); // inventory delta is zero
    expect(logsLeft(logs)).toBeGreaterThanOrEqual(1); // at most one block was destroyed trying
    expect(result.success).toBe(false);
    expect(physicalWorkComplete(result)).toBe(false);
    expect(lastOutcomeFrom(gatherPlan, result).workComplete).toBe(false);
    expect(completionMemoryForTask("gather_wood", result)).not.toBe("Completed gather_wood");
    expect(seen).not.toContain("ResourceCollected");
  });

  it("INVENTORY_FULL does not fall through to destroying more blocks", async () => {
    setNavigationBackend(nav());
    const events = new EventBus();
    const { ctx, items, logs } = world({ inventoryFullOfDirt: true }, events);
    const before = items.reduce((s, i) => s + i.count, 0);
    const seen: string[] = [];
    events.on((e) => seen.push(e.type));
    const result = await executePlan(ctx, gatherPlan, newStore(), events);
    expect(items.reduce((s, i) => s + i.count, 0)).toBe(before); // inventory delta is zero
    expect(logsLeft(logs)).toBe(2); // no block destroyed when nothing can be picked up
    expect(result.success).toBe(false);
    expect(seen).not.toContain("ResourceCollected");
  });
});
