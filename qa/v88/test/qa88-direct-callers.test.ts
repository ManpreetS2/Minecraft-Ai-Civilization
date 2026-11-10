// QA88 task 1: what does a DIRECT caller of depositItem/withdrawItem observe after the transfer was abandoned? (isolated fake body, ordinary assertions)
// Abandonment is simulated exactly as PR #88 models it: ctx.isActionCurrent() flips to false (generation replaced / boundary owner inactive) while the window click is in flight.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../packages/shared/src/index.js";
import { depositItem, withdrawItem } from "../../../packages/skills/src/inventory-service.js";
import { depositItems } from "../../../packages/skills/src/inventory.js";
import { installInstantNavigation, offlineBody, skillContext, sleep } from "../support/offline-body.js";
import { installSlowChest } from "../support/slow-world.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
const CHEST = { x: 4, y: 64, z: 4 };

function setup(o: { carry?: number; stock?: number; windowMs?: number; lagMs?: number; item?: string }) {
  const body = offlineBody(); const bot = body.fake; const item = o.item ?? "cobblestone";
  bot.blocks.set("4,64,4", { name: "chest" }); if (o.carry) bot.give(item, o.carry);
  const chest = installSlowChest(bot, { item, type: 4, withdrawMs: o.windowMs ?? 100, depositMs: o.windowMs ?? 100, lagMs: o.lagMs, stock: o.stock ?? 0 });
  const bus = new EventBus(); const seen: Array<{ type: string; at: number; payload?: Record<string, unknown> }> = []; bus.on((e) => seen.push({ type: e.type, at: Date.now(), payload: e.payload as Record<string, unknown> }));
  let current = true;
  const ctx = { ...skillContext(body, { timeoutMs: 20_000 }), events: bus, isActionCurrent: () => current } as never;
  return { bot, chest, seen, ctx, abandon: () => { current = false; }, item };
}

describe("a direct depositItem whose action is abandoned while the click is in flight", () => {
  it("reports success: the items DID move. It is a physical-truth success, never an action completion: the data matches the chest and inventory exactly", async () => {
    const s = setup({ carry: 4, stock: 0, windowMs: 100 });
    const pending = depositItem(s.ctx, "cobblestone", 2, CHEST);
    await sleep(40); s.abandon();
    const r = await pending;
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.deposited).toBe(2);
      expect(r.data.citizenAfter).toBe(s.bot.count("cobblestone")); expect(r.data.containerAfter).toBe(s.chest.stock);
    }
    expect(s.bot.count("cobblestone") + s.chest.stock).toBe(4);                // conservation: nothing created or destroyed
  });
  it("emits NO success event; the only event is a pending SystemIncident carrying the counts (so no consumer can count it as an accepted transfer)", async () => {
    const s = setup({ carry: 4, stock: 0, windowMs: 100 });
    const pending = depositItem(s.ctx, "cobblestone", 2, CHEST); await sleep(40); s.abandon(); await pending;
    expect(s.seen.map((e) => e.type)).toEqual(["SystemIncident"]);
    expect(s.seen[0]!.payload).toMatchObject({ kind: "AbandonedTransferObservation", reconciliation: "PENDING", direction: "deposit", item: "cobblestone", count: 2 });
  });
  it("control: without abandonment the same call emits exactly one ItemDeposited and no incident", async () => {
    const s = setup({ carry: 4, stock: 0, windowMs: 60 }); await depositItem(s.ctx, "cobblestone", 2, CHEST);
    expect(s.seen.map((e) => e.type)).toEqual(["ItemDeposited"]);
  });
  it("abandonment BEFORE the click starts: nothing moves, CANCELLED, no event (the gate is real, not cosmetic)", async () => {
    const s = setup({ carry: 4, stock: 0 }); s.abandon();
    const r = await depositItem(s.ctx, "cobblestone", 2, CHEST);
    expect(r.success).toBe(false); expect(s.chest.stock).toBe(0); expect(s.bot.count("cobblestone")).toBe(4); expect(s.seen).toEqual([]);
  });
  it("the deposit wrapper `depositItems` stops after the first abandoned success: it never starts a transfer for the NEXT item", async () => {
    const body = offlineBody(); const bot = body.fake; bot.blocks.set("4,64,4", { name: "chest" }); bot.give("cobblestone", 3); bot.give("oak_log", 3);
    const chest = installSlowChest(bot, { item: "cobblestone", type: 4, depositMs: 100, stock: 0 });
    let current = true; const ctx = { ...skillContext(body, { timeoutMs: 20_000 }), isActionCurrent: () => current } as never;
    const pending = depositItems(ctx, undefined, CHEST); await sleep(30); current = false; await pending;
    expect(chest.windowClicks.length).toBe(1);   // exactly one click: the one already in flight
    expect(bot.count("oak_log")).toBe(3);        // the second stack was never touched
  });
});

describe("a direct withdrawItem whose action is abandoned while the click is in flight", () => {
  it("success with the physically moved count; incident only; conservation holds", async () => {
    const s = setup({ carry: 0, stock: 4, windowMs: 100 });
    const pending = withdrawItem(s.ctx, "cobblestone", 1, CHEST); await sleep(40); s.abandon();
    const r = await pending;
    expect(r.success).toBe(true); if (r.success) expect(r.data.count).toBe(1);
    expect(s.seen.map((e) => e.type)).toEqual(["SystemIncident"]);
    expect(s.bot.count("cobblestone") + s.chest.stock).toBe(4);
  });
});

describe("production call sites of the chest skills (tripwire: a NEW call site must be classified before the first Paper trial)", () => {
  const root = join(process.cwd(), "packages");
  const walk = (d: string, out: string[] = []): string[] => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p, out); } else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p); } return out; };
  const sites = walk(root).flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((l, _i) => (/\b(depositItems?|withdrawItems?)\(/.test(l) && !/^\s*(export )?(async )?function|^\s*\/\//.test(l) && !/^\s*return (depositItems|withdrawItems)\(ctx/.test(l) ? [`${f.slice(root.length + 1)}`] : [])));
  const uniq = [...new Set(sites)].sort();
  it("the set of production files that call the chest skills is exactly the reviewed set", () => {
    expect(uniq).toEqual([
      "agent-core/src/executor.ts",     // settlement chest: GUARDED by PR #88 (executionIsCurrent before events / ledger / claim release)
      "agent-core/src/home-ops.ts",     // personal + household chest: NOT guarded (QA88-M1)
      "skills/src/farm.ts",             // seed restock / crop deposit inside workFarmPlot, reached only through executePlan (tail gate)
      "skills/src/fish-quota.ts",       // fishQuotaAtShore: only reached from apps/orchestrator/src/live-two-fish-test.ts (live harness, not production)
      "skills/src/fish.ts",             // fishAtShore deposit, through executePlan fishShore / gatherFood (tail gate)
      "skills/src/inventory.ts",        // depositItems/withdrawItems wrappers
      "skills/src/mine.ts",             // mineKnownOre deposit, through executePlan (tail gate)
    ]);
  });
  it("the runtime orchestrator never calls them directly; only live-*-test/demo harnesses do", () => {
    const apps = join(process.cwd(), "apps");
    const hits = walk(apps).filter((f) => /\b(depositItems?|withdrawItems?)\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(apps.length + 1)).sort();
    expect(hits.every((h) => /live-.*-(test|demo)\.ts$/.test(h)), hits.join(",")).toBe(true);
  });
});
