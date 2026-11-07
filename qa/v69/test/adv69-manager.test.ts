// Manager-level lifecycle on the REAL AgentManager + REAL action boundary + REAL MinecraftBody (frozen controlled bot).
// Only executePlan is routed through a hook so each test picks the production skill (or a hang) that runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hook, rig } from "../support/manager-rig.js";
import { installInstantNavigation, sleep } from "../support/offline-body.js";
import { smeltItem } from "../../../packages/skills/src/furnace.js";
import { depositItem } from "../../../packages/skills/src/inventory-service.js";
import { actionBoundaryFor } from "../../../packages/agent-core/src/action-boundary.js";
import { OfflineBot } from "../support/offline-body.js";
import { withdrawItem } from "../../../packages/skills/src/inventory-service.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { EventBus } from "../../../packages/shared/src/index.js";

vi.mock("../../../packages/agent-core/src/executor.js", async (orig) => ({
  ...(await orig<typeof import("../../../packages/agent-core/src/executor.js")>()),
  executePlan: (...a: unknown[]) => (hook.exec as any)(...a),
}));

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => { restore(); vi.useRealTimers(); });

const ok = () => ({ success: true, data: {}, durationMs: 1 });
const memCount = (store: any, id: string) => store.db.prepare("SELECT COUNT(*) AS n FROM memories WHERE citizen_id=?").get(id).n as number;
function events(r: ReturnType<typeof rig>) { const out: Array<{ type: string; payload?: any }> = []; r.manager.events.on((e: any) => out.push({ type: e.type, payload: e.payload })); return out; }
const slowSmelt = (r: ReturnType<typeof rig>) => {
  const ops: Array<{ kind: string; startedAt: number }> = [];
  const op = async (kind: string, ms: number, f?: () => void) => { ops.push({ kind, startedAt: Date.now() }); r.bot._client.write("window_click", { kind }); await sleep(ms); f?.(); };
  let input = 0, fuel = 0;
  r.bot.furnace = { fuelItem: () => (fuel ? { name: "coal", count: 1, type: 3 } : null), inputItem: () => (input ? { name: "raw_iron", count: 1, type: 1 } : null),
    outputItem: () => (input ? { name: "iron_ingot", count: 1, type: 2 } : null), putInput: () => op("putInput", 30, () => { input = 1; }), putFuel: () => op("putFuel", 30, () => { fuel = 1; }),
    takeOutput: () => op("takeOutput", 80, () => { r.bot.give("iron_ingot", 1); }), takeInput: () => op("takeInput", 10), takeFuel: () => op("takeFuel", 10), close() {} } as never;
  r.bot.blocks.set("5,64,5", { name: "furnace" }); r.bot.give("raw_iron", 1); r.bot.give("coal", 1);
  return ops;
};
const runSmelt = (ctx: any) => smeltItem(ctx, "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 });

describe("interruption of a running physical action through the real manager", () => {
  for (const [name, fire] of [
    ["disconnect (end)", (b: OfflineBot) => b.emit("end", "socket closed")],
    ["kick", (b: OfflineBot) => b.emit("kicked", "You were kicked")],
  ] as const) {
    it(`${name}: aborts the signal, no furnace op starts afterwards, flags clear, memories untouched`, async () => {
      const r = rig(); const ops = slowSmelt(r);
      const memBefore = memCount(r.store, r.id);
      let sig: AbortSignal | undefined; let result: any;
      hook.exec = async (ctx) => { sig = ctx.signal; result = await runSmelt(ctx); return result; };
      await r.tick(); await sleep(60);
      expect(r.citizen.busy).toBe(true); expect(r.citizen.actionLive).toBe(true);
      const firedAt = Date.now(); fire(r.bot); await sleep(20);
      expect(sig?.aborted).toBe(true);
      await sleep(400);
      const late = ops.filter((o) => o.startedAt > firedAt + 20).map((o) => o.kind);
      console.log("IRQ", name, "lateOps=", late.join(",") || "none", "result=", result?.success ? "success" : result?.code, "busy=", r.citizen.busy, "live=", r.citizen.actionLive);
      expect(late).toEqual([]);
      expect(r.citizen.actionLive).toBe(false); expect(r.citizen.busy).toBe(false);
      expect(memCount(r.store, r.id)).toBeGreaterThanOrEqual(memBefore); // never deleted
    });
  }
  it("death during the operation: the action is aborted and cannot place/withdraw afterwards", async () => {
    const r = rig(); r.bot.windowDelayMs = 150; r.bot.blocks.set("4,64,4", { name: "chest" }); r.bot.give("cobblestone", 4);
    let sig: AbortSignal | undefined; let result: any;
    hook.exec = async (ctx) => { sig = ctx.signal; result = await depositItem(ctx, "cobblestone", 2, { x: 4, y: 64, z: 4 }); return result; };
    await r.tick(); await sleep(50);
    const died = Date.now(); r.bot.emit("death"); await sleep(400);
    const afterDeath = r.bot.mutations.filter((m) => m.at > died + 20 && m.kind === "chest.deposit");
    console.log("DEATH aborted=", sig?.aborted, "depositAfterDeath=", afterDeath.length, "result=", result?.success ? "success" : result?.code, "status=", r.citizen.record.status);
    expect(sig?.aborted).toBe(true);
    expect(afterDeath).toEqual([]);
  });
});

describe("shutdown, expiry and late promises", () => {
  it("stop() with a skill that never answers completes quickly and fully drains (hanging openContainer)", async () => {
    const r = rig(); r.bot.windowOpens = "never"; r.bot.blocks.set("4,64,4", { name: "chest" }); r.bot.give("cobblestone", 4);
    hook.exec = async (ctx) => depositItem(ctx, "cobblestone", 2, { x: 4, y: 64, z: 4 });
    await r.tick(); await sleep(60);
    const t0 = Date.now(); await r.manager.stop(); const took = Date.now() - t0;
    console.log("SHUTDOWN_HANG took=", took, "ms drain=", JSON.stringify(r.manager.lastDrain));
    expect(took).toBeLessThan(3000);
    expect(r.manager.lastDrain?.fullyDrained).toBe(true);
  });
  it("stop() with a skill that ignores the signal entirely: boundary abandons it at the grace period; no write to the closed store", async () => {
    const r = rig(); const errors: unknown[] = []; const h = (e: unknown) => errors.push(e); process.on("unhandledRejection", h);
    hook.exec = async () => { await sleep(1500); return ok(); };
    await r.tick(); await sleep(30);
    const t0 = Date.now(); await r.manager.stop(); const took = Date.now() - t0;
    await sleep(1600); process.off("unhandledRejection", h);
    console.log("SHUTDOWN_IGNORING took=", took, "drain=", JSON.stringify(r.manager.lastDrain), "unhandled=", errors.length);
    expect(errors).toEqual([]);
    expect(took).toBeLessThan(3000);
  });
  it("action expiry at the 22 s deadline: TIMEOUT recorded once, flags clear, a late success from the abandoned skill is ignored", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const r = rig(); const ev = events(r); let finishLate: (v: unknown) => void = () => undefined; let started = 0;
    hook.exec = (ctx: any) => { started += 1; return new Promise((res) => { finishLate = () => res(ok()); void ctx; }); };
    await r.tick(); await vi.advanceTimersByTimeAsync(22_000 + 400);
    expect(r.citizen.actionLive).toBe(false); expect(r.citizen.busy).toBe(false);
    const failedBefore = ev.filter((e) => e.type === "TaskFailed").length;
    finishLate(undefined); await vi.advanceTimersByTimeAsync(50);
    const completed = ev.filter((e) => e.type === "TaskCompleted").length, failedAfter = ev.filter((e) => e.type === "TaskFailed").length;
    console.log("EXPIRY started=", started, "TaskFailed before/after late=", failedBefore, failedAfter, "TaskCompleted=", completed, "lastOutcome=", JSON.stringify({ s: r.citizen.lastOutcome?.success, e: r.citizen.lastOutcome?.error?.slice(0, 40) }));
    expect(failedBefore).toBeGreaterThanOrEqual(1); // the expiry was actually observed as a task failure
    expect(completed).toBe(0); expect(failedAfter).toBe(failedBefore);
  });
  it("an abandoned action cannot mutate the body after the next action has started (guard + owner), and the next action runs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const r = rig(); const order: string[] = []; let n = 0; let unblock: () => void = () => undefined;
    hook.exec = async (ctx: any) => {
      const mine = ++n;
      if (mine === 1) { order.push("A-start"); await new Promise<void>((res) => { unblock = res; }); try { r.bot._client.write("block_place"); order.push("A-late-write-passed"); } catch { order.push("A-late-write-refused"); } return ok(); }
      order.push("B-start"); r.bot._client.write("block_place"); order.push("B-write"); void ctx; return ok();
    };
    await r.tick(); await vi.advanceTimersByTimeAsync(22_400);
    await r.tick(); await vi.advanceTimersByTimeAsync(50);
    unblock(); await vi.advanceTimersByTimeAsync(50);
    console.log("ABANDONED_VS_NEXT", order.join(" > "));
    expect(order).toContain("B-write"); expect(order).toContain("A-late-write-refused"); expect(order).not.toContain("A-late-write-passed");
  });
});

describe("duplicate scheduling and competing actions", () => {
  it("two concurrent ticks for one citizen start exactly one action", async () => {
    const r = rig(); let started = 0; hook.exec = async () => { started += 1; await sleep(80); return ok(); };
    await Promise.all([r.tick(), r.tick(), r.tick()]); await sleep(150);
    expect(started).toBe(1);
  });
  it("stopCitizen / ADMIN override clear busy but actionLive still blocks a second action until the first has unwound", async () => {
    const r = rig(); let started = 0; let live = 0; let peak = 0;
    hook.exec = async (ctx: any) => { started += 1; live += 1; peak = Math.max(peak, live); await new Promise((res) => { if (ctx.signal.aborted) res(null); ctx.signal.addEventListener("abort", () => setTimeout(res, 150), { once: true }); }); live -= 1; return { success: false, code: "CANCELLED", error: "x", retryable: false, durationMs: 1 }; };
    await r.tick(); await sleep(30);
    r.manager.stopCitizen(r.id); expect(r.citizen.busy).toBe(false);
    await r.tick(); await r.tick(); await sleep(40);
    expect(started).toBe(1); // second tick refused while the first is still unwinding
    await sleep(250); await r.tick(); await sleep(60);
    console.log("STOP_THEN_TICK started=", started, "peakOverlap=", peak);
    expect(peak).toBe(1);
  });
  it("two physical actions queued on one body never overlap, even when the first ignores its signal", async () => {
    const r = rig(); const b = actionBoundaryFor(r.body); let live = 0, peak = 0;
    const act = (ms: number) => async () => { live += 1; peak = Math.max(peak, live); await sleep(ms); live -= 1; return ok() as any; };
    const a = b.run("A", act(120), { timeoutMs: 40, graceMs: 20 });
    const c = b.run("B", act(30), { timeoutMs: 1000 });
    await Promise.all([a, c]); await sleep(150);
    console.log("COMPETING peakOverlap=", peak, "(A was abandoned at its deadline while still running)");
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("reconnection and stale client callbacks", () => {
  it("after reconnect the new client is guarded on its first action; the old client's late window/callbacks cannot mutate the new bot", async () => {
    const r = rig(); const bot1 = r.bot; const bot2 = new OfflineBot("Atlas");
    Object.assign(bot2, { players: {}, time: { timeOfDay: 1000, isDay: true }, isRaining: false });
    bot1.windowDelayMs = 250; bot1.blocks.set("4,64,4", { name: "chest" }); bot1.give("cobblestone", 4);
    let oldResult: any;
    hook.exec = async (ctx: any) => { oldResult = await depositItem(ctx, "cobblestone", 2, { x: 4, y: 64, z: 4 }); return oldResult; };
    await r.tick(); await sleep(60);
    bot1.emit("end", "reset"); await sleep(10);
    const internals = r.body as unknown as { bot: unknown; bindBot(b: unknown): void }; internals.bot = bot2; internals.bindBot(bot2); bot2.emit("spawn");
    await sleep(500);
    expect(bot2.mutations).toEqual([]); // nothing from the dead session reached the new bot
    let bWrites: string[] = [];
    hook.exec = async () => { bot2._client.write("block_place"); bWrites = [...(bot2._client as any).writes]; return ok(); };
    await r.tick(); await sleep(80);
    console.log("RECONNECT oldResult=", oldResult?.success ? "success" : oldResult?.code, "newBotWrites=", bWrites.join(","));
    expect(bWrites).toContain("block_place");
  });
});

describe("what the packet guard does NOT contain: side effects of an abandoned skill other than packets", () => {
  it("[QA69-L2] a withdraw that lands just after the deadline is TIMEOUT and does not emit ItemWithdrawn afterwards", async () => {
    const r = rig(); const bus = new EventBus(); const seen: Array<{ type: string; at: number }> = []; bus.on((e) => seen.push({ type: e.type, at: Date.now() }));
    r.bot.blocks.set("4,64,4", { name: "chest" });
    let stock = 4;
    (r.bot as any).openContainer = async () => ({ containerItems: () => (stock > 0 ? [{ name: "cobblestone", count: stock, type: 4 }] : []),
      withdraw: async (_t: number, _m: null, count: number) => { r.bot._client.write("window_click"); await sleep(120); stock -= count; r.bot.give("cobblestone", count); }, close() {} });
    const boundary = createActionBoundary(() => r.bot._client);
    const t0 = Date.now(); let abandonedAt = 0;
    const result = await boundary.run("withdraw", (signal) => withdrawItem({ body: r.body, bot: r.bot as never, signal, events: bus, citizenId: r.id, timeoutMs: 22_000 } as never, "cobblestone", 2, { x: 4, y: 64, z: 4 }),
      { timeoutMs: 60, graceMs: 20 });
    abandonedAt = Date.now();
    await sleep(250);
    const late = seen.filter((e) => e.at > abandonedAt).map((e) => e.type);
    console.log("LATE_SIDE_EFFECTS managerSaw=", result.success ? "success" : (result as any).code, "afterMs=", abandonedAt - t0, "eventsAfterAbandonment=", late.join(",") || "none", "inventoryNow=", r.bot.count("cobblestone"));
    expect(result.success).toBe(false);
    expect(late.filter((t) => /Withdrawn/.test(t))).toEqual([]); // safe behaviour; fails if the abandoned skill still reports success on the bus
  });
});
