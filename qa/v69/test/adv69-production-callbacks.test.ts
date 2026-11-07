// Can a PRODUCTION callback exploit "no owner => write allowed"? Uses production runMineflayerFishCycle and the real
// mineflayer digging plugin (child process) under the production boundary. The bot itself is a controlled double.
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createActionBoundary, LATE_WRITE_REFUSED } from "../../../packages/agent-core/src/action-boundary.js";
import { runBoundedCleanup } from "../../../packages/shared/src/action-cleanup.js";
import { runMineflayerFishCycle, type FishableBot } from "../../../packages/skills/src/mineflayer-fish-cycle.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fishBot() {
  const reached: Array<{ name: string; at: number }> = [];
  const client = Object.assign(new EventEmitter(), {
    write(name: string) { reached.push({ name, at: Date.now() }); },
  });
  const entities: FishableBot["entities"] = {};
  const bot: FishableBot & { _client: EventEmitter & { write(n: string): void }; activations: number } = {
    username: "Atlas",
    entity: { id: 1, position: { x: 0, y: 64, z: 0 } },
    entities,
    activations: 0,
    // mineflayer's activateItem sends use_item through bot._client
    activateItem() { bot.activations += 1; client.write("use_item"); },
    registry: { entitiesByName: { fishing_bobber: { id: 90, metadataKeys: ["biting"] } } },
    _client: client,
  } as never;
  const spawnBobber = (id = 500) => {
    entities[id] = { id, name: "fishing_bobber", position: { x: 1, y: 64, z: 1 }, ownerEntityId: 1 };
    client.emit("spawn_entity", { type: 90, entityId: id, objectData: 1, x: 1, y: 64, z: 1 });
  };
  return { bot, client, reached, spawnBobber };
}

describe("production fishing under the production boundary", () => {
  it("control: a normal cycle casts (use_item), binds the bobber and is cancelled with a retrieve (use_item) while the owner is ACTIVE", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    const abort = new AbortController();
    const run = boundary.run("fish", (signal) => runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal }).then(() => ({ success: true, data: {}, durationMs: 1 }) as never), { signal: abort.signal, timeoutMs: 10_000 });
    await sleep(30); f.spawnBobber(); await sleep(120);
    expect(f.reached.map((w) => w.name)).toEqual(["use_item"]); // the cast
    abort.abort(); await run;
    console.log("FISH_CANCEL wire=", f.reached.map((w) => w.name).join(","), "activations=", f.bot.activations);
    expect(f.bot.activations).toBeGreaterThanOrEqual(1);
  });

  it("[QA69-M2] cancellation retrieves the bobber with one authorized use_item and does not leave the rod cast", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    const abort = new AbortController();
    let cycleError = "";
    const run = boundary.run("fish", async (signal) => {
      try { await runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal }); } catch (e) { cycleError = (e as { code?: string }).code ?? String(e); }
      return { success: false, code: "CANCELLED", error: "x", retryable: false, durationMs: 1 } as never;
    }, { signal: abort.signal, timeoutMs: 10_000, graceMs: 300 });
    await sleep(30); f.spawnBobber(); await sleep(120);
    const castWrites = f.reached.length;
    abort.abort(); await run; await sleep(100);
    const after = f.reached.length - castWrites;
    console.log("FISH_RETRIEVE_AFTER_ABORT retrieveWritesReachedWire=", after, "cycleError=", cycleError);
    // Desired: the cancelled citizen retrieves its own bobber (1 use_item) rather than leaving the rod cast.
    expect(after).toBe(1);
  });

  it("[QA69-M3] a bite emitted after abort does not cast, and the only later use_item is the cleanup retrieve", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      const f = fishBot();
      const boundary = createActionBoundary(() => f.client);
      const abort = new AbortController();
      const run = boundary.run("fish", async (signal) => {
        try { await runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal }); } catch { /* retrieve refused */ }
        return { success: false, code: "CANCELLED", error: "x", retryable: false, durationMs: 1 } as never;
      }, { signal: abort.signal, timeoutMs: 10_000, graceMs: 300 });
      await vi.advanceTimersByTimeAsync(30); f.spawnBobber(); await vi.advanceTimersByTimeAsync(120);
      const before = f.reached.length;
      abort.abort();
      expect(f.client.listenerCount("entity_metadata")).toBe(0);
      await vi.advanceTimersByTimeAsync(5);
      const atBite = f.reached.length;
      f.client.emit("entity_metadata", { entityId: 500, metadata: [{ key: 0, value: true }] });
      expect(f.reached.length).toBe(atBite);
      await vi.advanceTimersByTimeAsync(400); await run;
      const late = f.reached.slice(before).filter((w) => w.name === "use_item").length;
      console.log("FISH_BITE_AFTER_OWNER_INACTIVE lateUseItemOnWire=", late);
      expect(late).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("a delayed external bite and a second cycle after cancel do not cast", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    const abort = new AbortController();
    const run = boundary.run("fish", async (signal) => {
      const first = await runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal });
      const second = await runMineflayerFishCycle(f.bot, { timeoutMs: 1_000, signal });
      return { success: false, code: "CANCELLED", error: `${first.result}/${second.result}/${second.activations}`, retryable: false, durationMs: 1 } as never;
    }, { signal: abort.signal, timeoutMs: 10_000, graceMs: 500 });
    await sleep(30); f.spawnBobber(); await sleep(80);
    const delayed = setTimeout(() => f.client.emit("entity_metadata", { entityId: 500, metadata: [{ key: 0, value: true }] }), 40);
    abort.abort();
    const result = await run;
    clearTimeout(delayed);
    await sleep(80);
    expect(result.success).toBe(false);
    expect(f.reached.filter((w) => w.name === "use_item")).toHaveLength(2);
    expect(f.client.listenerCount("entity_metadata")).toBe(0);
  });

  it("an expired cleanup permit and any packet other than use_item stay refused", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.client);
    const abort = new AbortController();
    const run = boundary.run("fish", async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await sleep(20);
      let otherRefused = false;
      try {
        runBoundedCleanup(() => f.client.write("block_place"), { packets: ["use_item"], deadlineMs: 200 });
      } catch (error) {
        otherRefused = (error as { code?: string }).code === LATE_WRITE_REFUSED;
      }
      const start = Date.now();
      let expired = false;
      try {
        runBoundedCleanup(() => {
          const realNow = Date.now;
          Date.now = () => start + 10_000;
          try { f.client.write("use_item"); }
          finally { Date.now = realNow; }
        }, { packets: ["use_item"], deadlineMs: 50 });
      } catch (error) {
        expired = (error as { code?: string }).code === LATE_WRITE_REFUSED;
      }
      expect(otherRefused).toBe(true);
      expect(expired).toBe(true);
      expect(f.reached.map((w) => w.name)).not.toContain("block_place");
      expect(f.reached.map((w) => w.name)).not.toContain("use_item");
      return { success: false, code: "CANCELLED", error: "x", retryable: false, durationMs: 1 } as never;
    }, { signal: abort.signal, timeoutMs: 2_000, graceMs: 500 });
    await sleep(5); abort.abort(); await run;
  });

  it("a listener from an older action cannot write after that action is inactive", async () => {
    const f = fishBot();
    const first = createActionBoundary(() => f.client);
    const second = createActionBoundary(() => f.client);
    const abort = new AbortController();
    let emitStale: (() => void) | undefined;
    const run1 = first.run("old", async (signal) => {
      f.client.on("stale", () => { f.client.write("use_item"); });
      emitStale = () => f.client.emit("stale");
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await sleep(20);
      return { success: false, code: "CANCELLED", error: "x", retryable: false, durationMs: 1 } as never;
    }, { signal: abort.signal, timeoutMs: 2_000, graceMs: 100 });
    await sleep(10); abort.abort(); await run1;
    await second.run("new", async () => {
      f.client.write("block_place");
      return { success: true, data: {}, durationMs: 1 } as never;
    }, { timeoutMs: 500 });
    const before = f.reached.length;
    expect(() => emitStale?.()).toThrow(/late use_item refused/);
    expect(f.reached.slice(before).map((w) => w.name)).not.toContain("use_item");
  });

  it("a fishing callback captured before reconnect cannot write on the new client", async () => {
    const f = fishBot();
    const boundary = createActionBoundary(() => f.bot._client);
    const abort = new AbortController();
    const run = boundary.run("fish", (signal) => runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal }).then(() => (
      { success: false, code: "CANCELLED", error: "x", retryable: false, durationMs: 1 } as never
    )), { signal: abort.signal, timeoutMs: 5_000, graceMs: 400 });
    await sleep(30); f.spawnBobber(); await sleep(80);
    abort.abort(); await run;
    const nextWrites: string[] = [];
    const next = Object.assign(new EventEmitter(), { write(name: string) { nextWrites.push(name); } });
    f.bot._client = next as never;
    f.client.emit("entity_metadata", { entityId: 500, metadata: [{ key: 0, value: true }] });
    f.client.emit("spawn_entity", { type: 90, entityId: 900, objectData: 1 });
    expect(nextWrites).toEqual([]);
  });
});

describe("real mineflayer digging plugin under the production guard (child process, stub bot)", () => {
  const run = (mode: string) => {
    const p = spawnSync("pnpm", ["exec", "tsx", "qa/v69/scripts/dig-timer-child.ts", mode], { encoding: "utf8", cwd: process.cwd(), timeout: 60_000 });
    return { code: p.status, out: p.stdout, err: p.stderr };
  };
  it("production dig path (abort => stopDigging) survives", () => {
    const r = run("abandon-with-stop");
    console.log("DIG_WITH_STOP exit=", r.code, r.out.trim().slice(0, 160));
    expect(r.code).toBe(0);
  });
  it("[QA69-L3] an abandoned dig that is NOT stopped refuses the late swing without an uncaught exception", () => {
    const r = run("abandon-no-stop");
    console.log("DIG_NO_STOP exit=", r.code, r.out.trim().slice(0, 160));
    expect(r.code).toBe(0);
    expect(r.out).toContain("\"survived\":true");
    expect(r.err).not.toMatch(/late arm_animation refused/);
  });
});
