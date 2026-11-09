// QA78: adversarial tests of the 250 ms fishing-cleanup permit (runBoundedCleanup). Every assertion is an ordinary assertion.
// Question under test: is the exception one scoped, expiring `use_item` for the retrieve, or a general late-write permission?
import { describe, expect, it } from "vitest";
import { createActionBoundary, LATE_WRITE_REFUSED, MUTATING_PACKETS } from "../../../packages/agent-core/src/action-boundary.js";
import { runBoundedCleanup, MAX_CLEANUP_MS } from "../../../packages/shared/src/action-cleanup.js";
import { runMineflayerFishCycle } from "../../../packages/skills/src/mineflayer-fish-cycle.js";
import { CANCELLED, fishBot, sleep } from "../support/fish-rig.js";

type Bite = "none" | "metadata" | "splash" | "both";

/** Cast, bind a bobber, abort, then fire `bites` at the given delays after the abort. Returns the wire after everything settles. */
async function cancelledCycle(bites: Bite, delaysAfterAbort: number[]) {
  const f = fishBot();
  const boundary = createActionBoundary(() => f.client);
  const abort = new AbortController();
  const run = boundary.run("fish", (signal) => runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal }).then(() => CANCELLED), {
    signal: abort.signal, timeoutMs: 10_000, graceMs: 600,
  });
  await sleep(30); f.spawnBobber(); await sleep(120);
  const beforeAbort = f.useItems();
  abort.abort();
  const t0 = Date.now();
  for (const d of delaysAfterAbort) {
    setTimeout(() => {
      if (bites === "metadata" || bites === "both") f.bite();
      if (bites === "splash" || bites === "both") f.splash();
    }, d);
  }
  const result = await run;
  const returnedAfter = Date.now() - t0;
  await sleep(400);
  return { f, result, beforeAbort, returnedAfter, afterAbort: f.useItems() - beforeAbort, listeners: ["spawn_entity", "world_particles", "entity_metadata", "entity_destroy"].map((e) => f.client.listenerCount(e)) };
}

describe("fishing cleanup: one retrieve, bites after abort are inert", () => {
  it("control: cancel with a bound bobber casts once and sends exactly ONE retrieve use_item, before the boundary returns", async () => {
    const r = await cancelledCycle("none", []);
    expect(r.beforeAbort).toBe(1);
    expect(r.afterAbort).toBe(1);
    expect(r.f.reached.map((w) => w.name)).toEqual(["use_item", "use_item"]);
    expect(r.listeners).toEqual([0, 0, 0, 0]);
    expect(r.returnedAfter).toBeLessThan(600);
  });

  for (const kind of ["metadata", "splash", "both"] as const) {
    it(`a ${kind} bite storm (20 bites over 0-380 ms after abort) adds NO use_item beyond the one retrieve`, async () => {
      const delays = Array.from({ length: 20 }, (_, i) => i * 20);
      const control = await cancelledCycle("none", []);
      const storm = await cancelledCycle(kind, delays);
      expect(storm.afterAbort).toBe(control.afterAbort);
      expect(storm.afterAbort).toBe(1);
      expect(storm.listeners).toEqual([0, 0, 0, 0]);
    });
  }

  it("a bite emitted in the same synchronous turn as abort() is also inert (no second use_item)", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    const abort = new AbortController();
    const run = boundary.run("fish", (signal) => runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal }).then(() => CANCELLED), { signal: abort.signal, timeoutMs: 10_000, graceMs: 600 });
    await sleep(30); f.spawnBobber(); await sleep(120);
    abort.abort(); f.bite(); f.splash();
    await run; await sleep(200);
    expect(f.useItems()).toBe(2);
  });

  it("an ordinary bite while the action is live still reels (the fix did not disable fishing)", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    let cycle = "";
    const run = boundary.run("fish", async (signal) => {
      cycle = (await runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal })).result;
      return { success: true, data: {}, durationMs: 1 } as never;
    }, { timeoutMs: 10_000 });
    await sleep(30); f.spawnBobber(); await sleep(120);
    f.bite();
    await run;
    expect(cycle).toBe("reeled");
    expect(f.useItems()).toBe(2); // cast + the reel on the bite
  });

  it("repeated cycles on an aborted signal (5x) never cast", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    const abort = new AbortController();
    const results: string[] = [];
    const run = boundary.run("fish", async (signal) => {
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      for (let i = 0; i < 5; i += 1) results.push((await runMineflayerFishCycle(f.bot, { timeoutMs: 500, signal })).result);
      return CANCELLED;
    }, { signal: abort.signal, timeoutMs: 5_000, graceMs: 300 });
    await sleep(10); abort.abort(); await run; await sleep(100);
    expect(results).toEqual(["cancelled", "cancelled", "cancelled", "cancelled", "cancelled"]);
    expect(f.useItems()).toBe(0);
  });

  it("deadline abandonment (boundary timeout, not a caller abort) also retrieves exactly once and detaches", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    const run = boundary.run("fish", (signal) => runMineflayerFishCycle(f.bot, { timeoutMs: 60_000, signal }).then(() => CANCELLED), { timeoutMs: 220, graceMs: 400 });
    await sleep(30); f.spawnBobber();
    const result = await run; await sleep(300);
    expect(result.success).toBe(false);
    expect(f.reached.map((w) => w.name)).toEqual(["use_item", "use_item"]);
    expect(boundary.orphans()).toBe(0);
    expect(f.client.listenerCount("entity_metadata")).toBe(0);
  });

  it("two citizens: aborting A leaves B fishing; A's stale bite does not reel B and B's own bite still reels B", async () => {
    const a = fishBot(); const b = fishBot();
    const ba = createActionBoundary(() => a.client); const bb = createActionBoundary(() => b.client);
    const abortA = new AbortController(); let bResult = "";
    const runA = ba.run("fish", (signal) => runMineflayerFishCycle(a.bot, { timeoutMs: 5_000, signal }).then(() => CANCELLED), { signal: abortA.signal, timeoutMs: 10_000, graceMs: 400 });
    const runB = bb.run("fish", async (signal) => { bResult = (await runMineflayerFishCycle(b.bot, { timeoutMs: 5_000, signal })).result; return { success: true, data: {}, durationMs: 1 } as never; }, { timeoutMs: 10_000 });
    await sleep(30); a.spawnBobber(); b.spawnBobber(); await sleep(100);
    abortA.abort(); a.bite(); a.splash();
    await runA; await sleep(80);
    expect(b.useItems()).toBe(1);
    b.bite(); await runB;
    expect(bResult).toBe("reeled");
    expect(b.useItems()).toBe(2);
    expect(a.useItems()).toBe(2);
  });
});

describe("the cleanup permit is scoped: named packet only, expiring, not inherited", () => {
  /** Run `probe` inside an action whose owner is already inactive (signal aborted), as the fishing cleanup does. */
  async function inInactiveOwner<T>(probe: (f: ReturnType<typeof fishBot>) => Promise<T> | T): Promise<{ out: T; wire: string[] }> {
    const f = fishBot(); const boundary = createActionBoundary(() => f.client); const abort = new AbortController();
    let out!: T;
    const run = boundary.run("probe", async (signal) => {
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      await sleep(15); // owner.active flips a few microtasks AFTER abort() (known, documented in QA69); wait until it is provably inactive
      out = await probe(f);
      return CANCELLED;
    }, { signal: abort.signal, timeoutMs: 5_000, graceMs: 1_000 });
    await sleep(5); abort.abort(); await run;
    return { out, wire: f.reached.map((w) => w.name) };
  }
  const code = (fn: () => void) => { try { fn(); return "sent"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

  it("a use_item permit refuses EVERY other mutating packet (block_dig start, block_place, window_click, use_entity, held_item_slot, arm_animation)", async () => {
    const { out, wire } = await inInactiveOwner((f) => runBoundedCleanup(() => {
      const res: Record<string, string> = {};
      for (const name of MUTATING_PACKETS) res[name] = code(() => f.client.write(name, name === "block_dig" ? { status: 0 } : {}));
      return res;
    }, { packets: ["use_item"], deadlineMs: 250 }));
    for (const name of MUTATING_PACKETS) expect(out[name], name).toBe(name === "use_item" ? "sent" : LATE_WRITE_REFUSED);
    expect(wire).toEqual(["use_item"]);
  });

  it("the permit has no effect without the packet name: an empty packet list permits nothing", async () => {
    const { out } = await inInactiveOwner((f) => runBoundedCleanup(() => code(() => f.client.write("use_item")), { packets: [], deadlineMs: 250 }));
    expect(out).toBe(LATE_WRITE_REFUSED);
  });

  it("outside runBoundedCleanup the same inactive owner is refused (the permit does not leak out of its frame)", async () => {
    const { out, wire } = await inInactiveOwner((f) => {
      runBoundedCleanup(() => f.client.write("use_item"), { packets: ["use_item"], deadlineMs: 250 });
      return code(() => f.client.write("use_item"));
    });
    expect(out).toBe(LATE_WRITE_REFUSED);
    expect(wire).toEqual(["use_item"]);
  });

  it("a timer scheduled BEFORE the cleanup and firing DURING its window does not inherit the permit", async () => {
    const { out, wire } = await inInactiveOwner(async (f) => {
      const stale = new Promise<string>((resolve) => setTimeout(() => resolve(code(() => f.client.write("use_item"))), 15));
      runBoundedCleanup(() => f.client.write("use_item"), { packets: ["use_item"], deadlineMs: 250 });
      return stale;
    });
    expect(out).toBe(LATE_WRITE_REFUSED);
    expect(wire).toEqual(["use_item"]);
  });

  it("an async cleanup that outlives its deadline is refused when it resumes (real clock, 60 ms permit, write at 120 ms)", async () => {
    const { out } = await inInactiveOwner(async (f) => {
      try {
        await runBoundedCleanup(async () => { await sleep(120); f.client.write("use_item"); }, { packets: ["use_item"], deadlineMs: 60 });
        return "sent";
      } catch (e) { return (e as { code?: string }).code ?? String(e); }
    });
    expect(out).toBe(LATE_WRITE_REFUSED);
  });

  it(`the permit is capped at MAX_CLEANUP_MS (${MAX_CLEANUP_MS} ms) even if the caller asks for 10 s`, async () => {
    expect(MAX_CLEANUP_MS).toBe(500);
    const { out } = await inInactiveOwner(async (f) => {
      try {
        await runBoundedCleanup(async () => { await sleep(MAX_CLEANUP_MS + 120); f.client.write("use_item"); }, { packets: ["use_item"], deadlineMs: 10_000 });
        return "sent";
      } catch (e) { return (e as { code?: string }).code ?? String(e); }
    });
    expect(out).toBe(LATE_WRITE_REFUSED);
  });

  it("a deadline of 0, negative, NaN, Infinity or undefined is rejected before the callback runs", () => {
    let ran = 0;
    for (const deadlineMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(() => runBoundedCleanup(() => { ran += 1; }, { packets: ["use_item"], deadlineMs })).toThrow(/explicit positive deadline/);
    }
    expect(ran).toBe(0);
  });

  it("a permit for use_item does not permit use_item for a DIFFERENT client's inactive owner in a parallel boundary", async () => {
    const a = fishBot(); const b = fishBot();
    const ba = createActionBoundary(() => a.client); const bb = createActionBoundary(() => b.client);
    const abortA = new AbortController(); const abortB = new AbortController();
    let bOut = "";
    const runA = ba.run("a", async (signal) => {
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      runBoundedCleanup(() => a.client.write("use_item"), { packets: ["use_item"], deadlineMs: 250 });
      await sleep(40);
      return CANCELLED;
    }, { signal: abortA.signal, timeoutMs: 5_000, graceMs: 500 });
    const runB = bb.run("b", async (signal) => {
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      await sleep(10);
      bOut = code(() => b.client.write("use_item"));
      return CANCELLED;
    }, { signal: abortB.signal, timeoutMs: 5_000, graceMs: 500 });
    await sleep(5); abortA.abort(); abortB.abort(); await Promise.all([runA, runB]);
    expect(a.useItems()).toBe(1);
    expect(bOut).toBe(LATE_WRITE_REFUSED);
    expect(b.useItems()).toBe(0);
  });
});
