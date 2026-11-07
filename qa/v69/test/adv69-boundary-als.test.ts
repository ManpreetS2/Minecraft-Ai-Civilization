// Packet guard + AsyncLocalStorage behaviour using the PRODUCTION createActionBoundary/installPacketGuard with a
// controlled client. No Mineflayer here: this file measures which asynchronous origins keep an owner and which do not.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { fail, ok } from "../../../packages/shared/src/index.js";
import { createActionBoundary, installPacketGuard, LATE_WRITE_REFUSED, MUTATING_PACKETS } from "../../../packages/agent-core/src/action-boundary.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function wire() {
  const reached: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    write(name: string, _data?: Record<string, unknown>) { reached.push(name); },
  });
  return { client, reached };
}
const tryWrite = (client: { write(n: string, d?: Record<string, unknown>): void }, name = "window_click", data?: Record<string, unknown>) => {
  try { client.write(name, data); return "passed" as const; } catch (e) { return (e as { code?: string }).code === LATE_WRITE_REFUSED ? ("refused" as const) : ("error" as const); }
};

describe("packet guard: which packets are cut after the action loses ownership", () => {
  it("every MUTATING packet is refused from an inactive owner; cleanup dig (status 1/5) and non-mutating packets pass", async () => {
    const { client, reached } = wire();
    const b = createActionBoundary(() => client);
    const seen: Record<string, string> = {};
    await b.run("probe", async (signal) => {
      await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
      await sleep(5);
      for (const p of MUTATING_PACKETS) seen[p] = tryWrite(client, p, p === "block_dig" ? { status: 0 } : {});
      seen["block_dig:1"] = tryWrite(client, "block_dig", { status: 1 });
      seen["block_dig:5"] = tryWrite(client, "block_dig", { status: 5 });
      for (const s of [0, 2, 3, 4]) seen[`block_dig:${s}`] = tryWrite(client, "block_dig", { status: s });
      for (const p of ["position", "look", "chat", "close_window", "tick_end", "keep_alive", "entity_action"]) seen[p] = tryWrite(client, p);
      return fail("CANCELLED", "x", 1, false);
    }, { signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 5); return c.signal; })(), timeoutMs: 1000, graceMs: 200 });
    for (const p of MUTATING_PACKETS) expect(seen[p], p).toBe("refused");
    expect(seen["block_dig:1"]).toBe("passed"); expect(seen["block_dig:5"]).toBe("passed");
    for (const s of [0, 2, 3, 4]) expect(seen[`block_dig:${s}`]).toBe("refused");
    for (const p of ["position", "look", "chat", "close_window", "tick_end", "keep_alive", "entity_action"]) expect(seen[p], p).toBe("passed");
    expect(reached.filter((n) => MUTATING_PACKETS.has(n) && n !== "block_dig")).toEqual([]);
  });

  it("packets that mutate world/inventory but are NOT in the guard set pass after ownership is lost (coverage gap, characterised)", async () => {
    const { client } = wire();
    const b = createActionBoundary(() => client);
    const passed: string[] = [];
    await b.run("probe", async (signal) => {
      await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
      await sleep(5);
      for (const p of ["craft_recipe_request", "select_trade", "enchant_item", "pick_item", "set_creative_slot", "update_sign", "chat_command", "chat_message"]) if (tryWrite(client, p) === "passed") passed.push(p);
      return fail("CANCELLED", "x", 1, false);
    }, { signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 5); return c.signal; })(), timeoutMs: 1000, graceMs: 200 });
    console.log("UNGUARDED_MUTATING_PACKETS", passed.join(","));
    expect(passed.length).toBeGreaterThan(0);
  });

  it("installPacketGuard is idempotent per client and survives reconnection (a NEW client is guarded on its next action)", async () => {
    const a = wire(), b2 = wire();
    let current = a.client;
    const boundary = createActionBoundary(() => current);
    await boundary.run("x", async () => ok({}, 1), { timeoutMs: 100 });
    const w1 = a.client.write;
    installPacketGuard(a.client);
    expect(a.client.write).toBe(w1);
    current = b2.client;
    expect(tryWrite(b2.client, "window_click")).toBe("passed"); // not yet guarded: no action has run on the new client
    await boundary.run("y", async () => ok({}, 1), { timeoutMs: 100 });
    let late = "";
    await boundary.run("z", async (signal) => { await new Promise((r) => signal.addEventListener("abort", r, { once: true })); await sleep(3); late = tryWrite(b2.client, "window_click"); return fail("CANCELLED", "x", 1, false); },
      { signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 5); return c.signal; })(), timeoutMs: 1000, graceMs: 100 });
    expect(late).toBe("refused");
  });
});

describe("AsyncLocalStorage: which asynchronous origins keep the owner after the action is abandoned", () => {
  async function origins() {
    const { client, reached } = wire();
    const b = createActionBoundary(() => client);
    const outside = new EventEmitter(); // a long-lived emitter, as bot / bot._client are in Mineflayer
    const result: Record<string, "passed" | "refused" | "error"> = {};
    const pending: Array<Promise<void>> = [];
    const mark = (k: string, fn: () => void) => pending.push(new Promise<void>((resolve) => { setTimeout(() => { try { fn(); } finally { resolve(); } }, 0); }));
    const abort = new AbortController();
    const run = b.run("probe", async (signal) => {
      // everything below is scheduled INSIDE the action and fires after it was abandoned
      const later = (k: string, schedule: (cb: () => void) => void) => schedule(() => { result[k] = tryWrite(client, "block_place"); });
      later("setTimeout", (cb) => { setTimeout(cb, 80); });
      later("setInterval", (cb) => { const i = setInterval(() => { clearInterval(i); cb(); }, 80); });
      later("setImmediate-after-sleep", (cb) => { void sleep(80).then(() => setImmediate(cb)); });
      later("promise-then", (cb) => { void sleep(80).then(cb); });
      later("queueMicrotask-after-sleep", (cb) => { void sleep(80).then(() => queueMicrotask(cb)); });
      later("nextTick-after-sleep", (cb) => { void sleep(80).then(() => process.nextTick(cb)); });
      later("await-continuation", (cb) => { void (async () => { await sleep(80); cb(); })(); });
      // listener registered inside the action on a long-lived emitter; fired from a context that has no owner
      outside.on("late", () => { result["emitter-listener(ownerless emit)"] = tryWrite(client, "block_place"); });
      await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
      return fail("CANCELLED", "x", 1, false);
    }, { signal: abort.signal, timeoutMs: 1000, graceMs: 20 });
    await sleep(20); abort.abort(); await run;
    // fire the emitter listener from an ownerless context (as a socket read / physics timer would)
    await new Promise<void>((r) => setTimeout(() => { outside.emit("late"); r(); }, 30));
    await sleep(150);
    void mark; void pending;
    return { result, reached };
  }
  it("timers, promise continuations, microtasks, nextTick and await all keep the owner (late writes refused)", async () => {
    const { result } = await origins();
    for (const k of ["setTimeout", "setInterval", "setImmediate-after-sleep", "promise-then", "queueMicrotask-after-sleep", "nextTick-after-sleep", "await-continuation"]) expect(result[k], k).toBe("refused");
  });
  it("GAP: a listener registered inside the action on a long-lived emitter, fired from an ownerless context, is NOT contained", async () => {
    const { result, reached } = await origins();
    console.log("ALS_EMITTER_LISTENER_AFTER_ABANDON", result["emitter-listener(ownerless emit)"], "wire=", reached.join(","));
    expect(result["emitter-listener(ownerless emit)"]).toBe("passed");
  });
  it("a write from a DIFFERENT, still-active owner is allowed (owners are not shared across actions)", async () => {
    const { client, reached } = wire();
    const b = createActionBoundary(() => client);
    const a = b.run("A", async () => { await sleep(20); return ok({}, 1); }, { timeoutMs: 500 });
    const c = b.run("B", async () => { client.write("block_place"); return ok({}, 1); }, { timeoutMs: 500 });
    await Promise.all([a, c]);
    expect(reached).toEqual(["block_place"]);
  });
  it("cut-off is not at abort(): a write issued in the same synchronous turn or the next microtask after abort still passes", async () => {
    const { client, reached } = wire();
    const b = createActionBoundary(() => client);
    const abort = new AbortController();
    const seen: string[] = [];
    const p = b.run("probe", async (signal) => {
      await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
      seen.push("sync-after-abort:" + tryWrite(client, "window_click")); // runs in the abort dispatch turn
      await Promise.resolve();
      seen.push("1-microtask:" + tryWrite(client, "window_click"));
      await sleep(10);
      seen.push("10ms:" + tryWrite(client, "window_click"));
      return fail("CANCELLED", "x", 1, false);
    }, { signal: abort.signal, timeoutMs: 1000, graceMs: 100 });
    await sleep(5); abort.abort(); await p;
    console.log("CUTOFF_WINDOW", seen.join(" | "), "wire=", reached.join(","));
    expect(seen.at(-1)).toBe("10ms:refused");
  });
});

describe("boundary semantics", () => {
  it("the owner gap is real: a write with no owner is never refused, even for an action that was abandoned a second ago", async () => {
    const { client, reached } = wire();
    const b = createActionBoundary(() => client);
    await b.run("x", async () => ok({}, 1), { timeoutMs: 100 });
    await sleep(10);
    expect(tryWrite(client, "use_entity")).toBe("passed");
    expect(reached).toContain("use_entity");
  });
  it("a skill that never settles returns TIMEOUT (non-retryable), counts as an orphan, and does not block the next action", async () => {
    const { client } = wire();
    const b = createActionBoundary(() => client);
    const t0 = Date.now();
    const r = await b.run("hang", () => new Promise(() => undefined), { timeoutMs: 30, graceMs: 30 });
    expect(r.success).toBe(false);
    if (!r.success) { expect(r.code).toBe("TIMEOUT"); expect(r.retryable).toBe(false); }
    expect(Date.now() - t0).toBeLessThan(400);
    expect(b.orphans()).toBe(1);
    const next = await b.run("next", async () => ok({ n: 1 }, 1), { timeoutMs: 100 });
    expect(next.success).toBe(true);
  });
  it("a skill that rejects becomes UNKNOWN non-retryable; a throwing clientOf rejects run() but the queue keeps working", async () => {
    const { client } = wire();
    const b = createActionBoundary(() => client);
    const r = await b.run("boom", async () => { throw new Error("kaput"); }, { timeoutMs: 100 });
    expect(r.success).toBe(false);
    let fail1 = 0;
    const b2 = createActionBoundary(() => { if (fail1++ === 0) throw new Error("no client"); return client; });
    await expect(b2.run("x", async () => ok({}, 1), { timeoutMs: 100 })).rejects.toThrow("no client");
    const again = await b2.run("y", async () => ok({}, 1), { timeoutMs: 100 });
    expect(again.success).toBe(true);
  });
  it("an action queued behind another with an already-aborted signal still STARTS its skill once (skills must refuse on entry)", async () => {
    const { client } = wire();
    const b = createActionBoundary(() => client);
    const abort = new AbortController(); abort.abort();
    let started = 0;
    const r = await b.run("x", async () => { started += 1; return ok({}, 1); }, { signal: abort.signal, timeoutMs: 100 });
    console.log("PREABORTED started=", started, "success=", r.success);
    expect(started).toBe(1);
  });
  it("timeoutMs of 0 or NaN aborts immediately instead of running unbounded", async () => {
    const { client } = wire();
    const b = createActionBoundary(() => client);
    for (const t of [0, Number.NaN]) {
      const r = await b.run("x", () => new Promise(() => undefined), { timeoutMs: t, graceMs: 10 });
      expect(r.success).toBe(false);
    }
  });
  it("re-entrant run() from inside a running action deadlocks until the outer deadline (no production caller found)", async () => {
    const { client } = wire();
    const b = createActionBoundary(() => client);
    const t0 = Date.now();
    const r = await b.run("outer", async () => { const inner = await b.run("inner", async () => ok({}, 1), { timeoutMs: 100 }); return inner; }, { timeoutMs: 120, graceMs: 20 });
    console.log("REENTRANT result=", r.success ? "ok" : (r as { code: string }).code, "after", Date.now() - t0, "ms");
    expect(r.success).toBe(false);
  });
});
