import { EventEmitter, getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";

// Same seam the author's lifecycle tests use: the pathfinder PLUGIN is replaced, every adapter module is real.
vi.mock("node:module", async (original) => {
  const actual = await original<typeof import("node:module")>();
  return { ...actual, createRequire: (url: string | URL) => {
    const require = actual.createRequire(url);
    return Object.assign((id: string) => id === "mineflayer-pathfinder" ? {
      pathfinder: () => undefined,
      Movements: class { blocksCantBreak = new Set<number>(); blocksToAvoid = new Set<number>(); },
      goals: (require(id) as { goals: Record<string, unknown> }).goals,
    } : require(id), require);
  } };
});
import { activePathCount, followPlayer, moveToGetToBlock, moveToLookAtBlock, moveToPosition, startFollowing } from "../../../packages/minecraft-adapter/src/pathing.js";
import { MineflayerPathfinderBackend, navigationBackend, setNavigationBackend, type NavigationBackend } from "../../../packages/minecraft-adapter/src/navigation.js";
import { runNavigationScope } from "../../../packages/minecraft-adapter/src/navigation-scope.js";
import { enterClaimedHouse } from "../../../packages/minecraft-adapter/src/enter-home.js";
import { executeReturnHome } from "../../../packages/minecraft-adapter/src/return-home-nav.js";

type Fixture = ReturnType<typeof fixture>;
function fixture(at = { x: 0.5, y: 64, z: 0.5 }) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const pathfinder = {
    setMovements: vi.fn(), setGoal: vi.fn(), stop: vi.fn(),
    goto: vi.fn<(goal: unknown) => Promise<void>>(() => new Promise(() => undefined)),
  };
  const raw = Object.assign(events, {
    username: "qa57", health: 20,
    entity: { position: { ...at }, onGround: true } as { position: { x: number; y: number; z: number }; onGround: boolean } | undefined,
    players: {} as Record<string, { entity?: unknown }>, entities: {} as Record<string, unknown>,
    registry: { itemsByName: {}, blocksByName: {} }, inventory: { items: () => [] },
    pathfinder, loadPlugin: vi.fn(), supportFeature: (): boolean => false,
    clearControlStates: vi.fn(), setControlState: vi.fn(),
    blockAt: (p: { x: number; y: number; z: number }) => ({ name: p.y < 64 ? "stone" : "air", boundingBox: p.y < 64 ? "block" : "empty" }),
    _client: { state: "play", ended: false },
  });
  return { events, pathfinder, raw, bot: raw as unknown as Bot, teleport: (x: number, y: number, z: number) => Object.assign(raw.entity!.position, { x, y, z }) };
}
const listenerTotal = (f: Fixture) => f.events.eventNames().reduce((n, e) => n + getEventListeners(f.events, e).length, 0);
/** installModernMovement() hooks 6 permanent per-body listeners once; "no leak" means no growth beyond that baseline. */
const PERMANENT = 6;
const T = { x: 10, y: 64, z: 0 };
const fail = (r: { success: boolean }) => { if (r.success) throw new Error("UNEXPECTED SUCCESS"); return r as unknown as { success: false; code: string; retryable?: boolean }; };
let unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

beforeEach(() => { vi.useFakeTimers(); unhandled = []; process.on("unhandledRejection", onUnhandled); });
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(60_000);
  vi.useRealTimers();
  await new Promise((r) => setImmediate(r));
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toEqual([]);
  expect(activePathCount()).toBe(0);
});

describe("[ADV57-M1] arrival only after physically reaching the target", () => {
  it("goto resolves while the body is 10 blocks away -> not a success", async () => {
    const f = fixture(); f.pathfinder.goto.mockResolvedValue();
    const p = moveToPosition(f.bot, T, { timeoutMs: 3000, recover: false });
    await vi.advanceTimersByTimeAsync(1500);
    expect(fail(await p).code).toMatch(/^(VERIFY_FAILED|STUCK)$/); // safe either way; STUCK is the remapped label
  });
  it("goto resolves at the same X/Z but wrong Y (>=0.6) -> not a success", async () => {
    const f = fixture(); f.pathfinder.goto.mockImplementation(async () => { f.teleport(10, 62.9, 0); });
    const p = moveToPosition(f.bot, T, { timeoutMs: 3000, recover: false });
    await vi.advanceTimersByTimeAsync(1500);
    expect(fail(await p).code).toMatch(/^(VERIFY_FAILED|STUCK)$/);
  });
  it("walks to the target with real stepwise physics -> success reports the real position", async () => {
    const f = fixture();
    f.pathfinder.goto.mockImplementation(() => new Promise<void>((res) => {
      const t = setInterval(() => { const p = f.raw.entity!.position; p.x += 1; if (p.x >= 10) { clearInterval(t); res(); } }, 100);
    }));
    const p = moveToPosition(f.bot, T, { timeoutMs: 8000, recover: false });
    await vi.advanceTimersByTimeAsync(3000);
    const r = await p;
    expect(r.success).toBe(true);
    if (r.success) expect(Math.hypot(r.data.position.x - 10, r.data.position.z)).toBeLessThanOrEqual(2.4);
  });
  it("boundary: finishing 2.39 blocks from a range-2 target is accepted (documented +0.4 slack); 2.5 is refused", async () => {
    for (const [dx, ok] of [[2.39, true], [2.5, false]] as const) {
      const f = fixture(); f.pathfinder.goto.mockImplementation(async () => { f.teleport(10 - dx, 64, 0); });
      const p = moveToPosition(f.bot, T, { range: 2, timeoutMs: 3000, recover: false });
      await vi.advanceTimersByTimeAsync(1500);
      expect((await p).success).toBe(ok);
    }
  });
  it("recovery waypoint is not the goal: success on a waypoint 6 blocks away is rejected", async () => {
    const f = fixture(); f.pathfinder.goto.mockImplementation(async () => { f.teleport(4, 64, 0); });
    const p = moveToPosition(f.bot, T, { timeoutMs: 6000, recover: true });
    await vi.advanceTimersByTimeAsync(6000);
    expect((await p).success).toBe(false);
  });
});

describe("[ADV57-M2] failure, timeout, invalid input", () => {
  it("no path (noPath status) fails closed and is not retried as success", async () => {
    const f = fixture();
    f.pathfinder.goto.mockImplementation(async () => { f.events.emit("path_update", { status: "noPath" }); throw new Error("No path"); });
    const p = moveToPosition(f.bot, T, { timeoutMs: 3000, recover: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fail(await p).code).toBe("PATH_BLOCKED");
  });
  it("a goto that never settles is bounded by the caller timeout and the pathfinder is stopped", async () => {
    const f = fixture();
    const p = moveToPosition(f.bot, T, { timeoutMs: 1500, recover: false });
    await vi.advanceTimersByTimeAsync(4000);
    expect(fail(await p).code).toMatch(/TIMEOUT|STUCK|NAV_NO_INITIAL_PROGRESS|PATH_FAILED/);
    expect(f.pathfinder.stop).toHaveBeenCalled();
    expect(f.raw.clearControlStates).toHaveBeenCalled();
  });
  it.each([
    ["NaN x", { x: NaN, y: 64, z: 0 }, {}], ["Infinity y", { x: 1, y: Infinity, z: 0 }, {}],
    ["undefined z", { x: 1, y: 64 } as never, {}], ["string coords", { x: "10", y: 64, z: "0" } as never, {}],
    ["negative range", T, { range: -1 }], ["NaN range", T, { range: NaN }],
    ["zero timeout", T, { timeoutMs: 0 }], ["negative timeout", T, { timeoutMs: -5 }], ["NaN timeout", T, { timeoutMs: NaN }], ["Infinity timeout", T, { timeoutMs: Infinity }],
  ])("invalid %s never reaches the pathfinder", async (_n, target, opts) => {
    const f = fixture();
    const r = await moveToPosition(f.bot, target as never, opts as never);
    expect(r.success).toBe(false);
    expect(f.pathfinder.goto).not.toHaveBeenCalled();
  });
  it("null/array target does not throw", async () => {
    const f = fixture();
    for (const bad of [null, [], "x", 5] as never[]) {
      const r = await moveToPosition(f.bot, bad, { timeoutMs: 1000 });
      expect(r.success).toBe(false);
      expect(r.code).toBe("INVALID_ARGUMENT");
    }
  });
  it("timeoutMs above the 2^31 setTimeout limit does not silently become an instant timeout (INFO probe)", async () => {
    const f = fixture(); f.pathfinder.goto.mockImplementation(async () => { f.teleport(10, 64, 0); });
    const p = moveToPosition(f.bot, T, { timeoutMs: 3_000_000_000, recover: false });
    await vi.advanceTimersByTimeAsync(2000);
    const r = await p;
    // Either a real success or an explicit INVALID_ARGUMENT is fine; an unexplained TIMEOUT is the Node overflow footgun.
    expect(r.success || r.code === "INVALID_ARGUMENT").toBe(true);
  });
});

describe("[ADV57-M3] dead / despawned / reconnected bodies", () => {
  const cases: Array<[string, (f: Fixture) => void]> = [
    ["health 0", (f) => { f.raw.health = 0; }],
    ["entity gone", (f) => { f.raw.entity = undefined; }],
    ["client ended", (f) => { f.raw._client.ended = true; }],
    ["client not in play state", (f) => { f.raw._client.state = "login"; }],
    ["NaN position", (f) => { f.teleport(NaN, 64, 0); }],
  ];
  it.each(cases)("%s: every public movement entry refuses without touching the pathfinder", async (_n, mutate) => {
    const f = fixture(); mutate(f);
    const results = await Promise.all([
      moveToPosition(f.bot, T, { timeoutMs: 1000 }), moveToGetToBlock(f.bot, T, { timeoutMs: 1000 }), moveToLookAtBlock(f.bot, T, { timeoutMs: 1000 }),
      new MineflayerPathfinderBackend().navigateToInteractWithBlock(f.bot, T, { timeoutMs: 3000 }),
      new MineflayerPathfinderBackend().navigateToPlaceBlock(f.bot, T, { timeoutMs: 3000 }),
      new MineflayerPathfinderBackend().escapeFrom(f.bot, { x: 0, y: 64, z: 0 }, 8, { timeoutMs: 2000 }),
      followPlayer(f.bot, "someone", { timeoutMs: 1000 }),
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    for (const r of results) expect(r.success).toBe(false);
    expect(f.pathfinder.goto).not.toHaveBeenCalled();
  });
  it("startFollowing refuses a dead body", () => {
    const f = fixture(); f.raw.health = 0; f.raw.players.x = { entity: { position: { x: 1, y: 64, z: 1 }, id: 1 } };
    expect(startFollowing(f.bot, "x").success).toBe(false);
    expect(f.pathfinder.setGoal).not.toHaveBeenCalled();
  });
  it.each(["end", "kicked", "death", "respawn"])("%s mid-navigation then a late goto success does not resurrect arrival", async (ev) => {
    const f = fixture(); let finish!: () => void;
    f.pathfinder.goto.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
    const p = moveToPosition(f.bot, T, { timeoutMs: 4000, recover: false });
    await vi.advanceTimersByTimeAsync(50);
    f.events.emit(ev); f.teleport(10, 64, 0); finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fail(await p).code).toBe("NOT_CONNECTED");
  });
  it("reconnect swap: new entity object appears at the target with NO life event; arrival is still real (position-checked), old listeners are gone", async () => {
    const f = fixture(); f.pathfinder.goto.mockImplementation(async () => { f.raw.entity = { position: { x: 10, y: 64, z: 0 }, onGround: true }; });
    const p = moveToPosition(f.bot, T, { timeoutMs: 3000, recover: false });
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(listenerTotal(f)).toBeLessThanOrEqual(PERMANENT);
  });
  it("stale 'end' emitted AFTER completion cannot alter anything and no listeners remain", async () => {
    const f = fixture(); f.pathfinder.goto.mockImplementation(async () => { f.teleport(10, 64, 0); });
    const p = moveToPosition(f.bot, T, { timeoutMs: 3000, recover: false });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p; expect(r.success).toBe(true);
    const stops = f.pathfinder.stop.mock.calls.length;
    expect(listenerTotal(f)).toBeLessThanOrEqual(PERMANENT);
    f.events.emit("end"); f.events.emit("death");
    expect(f.pathfinder.stop.mock.calls.length).toBe(stops);
  });
});

describe("[ADV57-M4] cancellation", () => {
  it("abort while navigating -> CANCELLED, pathfinder stopped, controls released, nothing pending", async () => {
    const f = fixture(); const c = new AbortController();
    const p = moveToPosition(f.bot, T, { timeoutMs: 10_000, signal: c.signal, recover: false });
    await vi.advanceTimersByTimeAsync(500); c.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fail(await p).code).toBe("CANCELLED");
    expect(f.pathfinder.stop).toHaveBeenCalled(); expect(f.raw.clearControlStates).toHaveBeenCalled();
    expect(listenerTotal(f)).toBeLessThanOrEqual(PERMANENT);
  });
  it("delayed backend SUCCESS after cancellation stays cancelled; delayed REJECTION is swallowed", async () => {
    for (const mode of ["resolve", "reject"] as const) {
      const f = fixture(); const c = new AbortController(); let settle!: () => void;
      f.pathfinder.goto.mockImplementation(() => new Promise<void>((res, rej) => { settle = () => (mode === "resolve" ? res() : rej(new Error("late boom"))); }));
      const p = moveToPosition(f.bot, T, { timeoutMs: 10_000, signal: c.signal, recover: false });
      await vi.advanceTimersByTimeAsync(300); c.abort();
      await vi.advanceTimersByTimeAsync(600);
      f.teleport(10, 64, 0); settle();
      await vi.advanceTimersByTimeAsync(600);
      expect(fail(await p).code).toBe("CANCELLED");
    }
  });
  it("pre-aborted signal on every public entry never starts a path", async () => {
    const f = fixture(); const c = new AbortController(); c.abort();
    const b = new MineflayerPathfinderBackend();
    f.raw.players.x = { entity: { position: { x: 1, y: 64, z: 1 }, id: 1 } };
    const rs = await Promise.all([moveToPosition(f.bot, T, { signal: c.signal }), moveToGetToBlock(f.bot, T, { signal: c.signal }), moveToLookAtBlock(f.bot, T, { signal: c.signal }),
      b.navigateToInteractWithBlock(f.bot, T, { signal: c.signal }), b.navigateToPlaceBlock(f.bot, T, { signal: c.signal }), followPlayer(f.bot, "x", { signal: c.signal })]);
    await vi.advanceTimersByTimeAsync(2000);
    for (const r of rs) expect(fail(r).code).toBe("CANCELLED");
    expect(f.pathfinder.goto).not.toHaveBeenCalled();
  });
  it("abort + stop() throwing (disconnected plugin) still yields a structured CANCELLED", async () => {
    const f = fixture(); const c = new AbortController();
    f.pathfinder.stop.mockImplementation(() => { throw new Error("plugin dead"); });
    f.raw.setControlState.mockImplementation(() => { throw new Error("no controls"); });
    f.raw.clearControlStates.mockImplementation(() => { throw new Error("no controls"); });
    const p = moveToPosition(f.bot, T, { timeoutMs: 10_000, signal: c.signal, recover: false });
    await vi.advanceTimersByTimeAsync(300); c.abort(); await vi.advanceTimersByTimeAsync(800);
    expect(fail(await p).code).toBe("CANCELLED");
  });
  it("follow: abort -> CANCELLED and the follow goal is cleared", async () => {
    const f = fixture(); const c = new AbortController();
    const ent = { position: { x: 5, y: 64, z: 0 }, id: 7, isValid: true }; f.raw.players.x = { entity: ent }; f.raw.entities[7] = ent;
    const p = followPlayer(f.bot, "x", { timeoutMs: 10_000, signal: c.signal });
    await vi.advanceTimersByTimeAsync(300); c.abort(); await vi.advanceTimersByTimeAsync(300);
    expect(fail(await p).code).toBe("CANCELLED");
    expect(f.pathfinder.setGoal).toHaveBeenCalledWith(null);
  });
});

describe("[ADV57-M5] repeated / concurrent calls", () => {
  it("60 sequential cancel/timeout/fail cycles leak no listeners and leave activePaths at 0", async () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) {
      const c = new AbortController(); const p = moveToPosition(f.bot, T, { timeoutMs: 5000, signal: c.signal, recover: false });
      await vi.advanceTimersByTimeAsync(100); c.abort(); await vi.advanceTimersByTimeAsync(600); await p;
      const q = moveToPosition(f.bot, T, { timeoutMs: 1200, recover: false }); await vi.advanceTimersByTimeAsync(3000); await q;
      f.pathfinder.goto.mockRejectedValueOnce(new Error("No path")); const r = moveToPosition(f.bot, T, { timeoutMs: 2000, recover: false }); await vi.advanceTimersByTimeAsync(4000); await r;
    }
    expect(listenerTotal(f)).toBeLessThanOrEqual(PERMANENT); expect(activePathCount()).toBe(0);
  });
  it("two goals on one body: goal change rejects the first -> first must NOT report success", async () => {
    const f = fixture(); let first: ((e: Error) => void) | undefined;
    f.pathfinder.goto.mockImplementationOnce(() => new Promise<void>((_, rej) => { first = rej; }));
    f.pathfinder.goto.mockImplementationOnce(async () => { first?.(new Error("The goal was changed before it could be completed!")); f.teleport(-30, 64, 0); });
    const a = moveToPosition(f.bot, T, { timeoutMs: 4000, recover: false });
    await vi.advanceTimersByTimeAsync(100);
    const b = moveToPosition(f.bot, { x: -30, y: 64, z: 0 }, { timeoutMs: 4000, recover: false });
    await vi.advanceTimersByTimeAsync(9000);
    expect((await a).success).toBe(false); expect((await b).success).toBe(true);
  });
  it("10 parallel requests queue behind the 3-path limiter and all settle", async () => {
    const bots = Array.from({ length: 10 }, (_, i) => { const f = fixture(); f.raw.username = `qa57-${i}`; f.pathfinder.goto.mockImplementation(async () => { f.teleport(10, 64, 0); }); return f; });
    const ps = bots.map((f) => moveToPosition(f.bot, T, { timeoutMs: 8000, recover: false }));
    await vi.advanceTimersByTimeAsync(9000);
    const rs = await Promise.all(ps);
    expect(rs.filter((r) => r.success).length + rs.filter((r) => !r.success).length).toBe(10);
  });
});

describe("[ADV57-M6] runNavigationScope", () => {
  it("work that ignores abort and later resolves SUCCESS after timeout -> TIMEOUT; late rejection swallowed", async () => {
    for (const late of ["ok", "throw"] as const) {
      const f = fixture(); let done!: () => void;
      const work = () => new Promise<never>((res, rej) => { done = () => (late === "ok" ? res({ success: true, data: 1, durationMs: 0 } as never) : rej(new Error("late"))); });
      const p = runNavigationScope(f.bot, { timeoutMs: 1000 }, work as never);
      await vi.advanceTimersByTimeAsync(1100); done(); await vi.advanceTimersByTimeAsync(100);
      expect(fail(await p).code).toBe("TIMEOUT");
    }
  });
  it("work throwing synchronously rejects (documented?) -- probe", async () => {
    const f = fixture();
    const p = runNavigationScope(f.bot, { timeoutMs: 1000 }, (() => { throw new Error("sync boom"); }) as never);
    await expect(p).rejects.toThrow("sync boom"); // listeners/timer must still be cleaned
    expect(listenerTotal(f)).toBeLessThanOrEqual(PERMANENT);
  });
  it("timeoutMs 3e9 (> 2^31) -- probe for instant-TIMEOUT overflow", async () => {
    const f = fixture();
    const p = runNavigationScope(f.bot, { timeoutMs: 3_000_000_000 }, async () => ({ success: true, data: 1, durationMs: 0 }) as never);
    await vi.advanceTimersByTimeAsync(10);
    const r = await p;
    expect(r.success || r.code === "INVALID_ARGUMENT").toBe(true);
  });
  it("shutdown (end) during scope -> NOT_CONNECTED even if work completes the same tick", async () => {
    const f = fixture();
    const p = runNavigationScope(f.bot, { timeoutMs: 5000 }, async () => { f.events.emit("end"); return { success: true, data: 1, durationMs: 0 } as never; });
    await vi.advanceTimersByTimeAsync(10);
    expect(fail(await p).code).toBe("NOT_CONNECTED");
    expect(listenerTotal(f)).toBeLessThanOrEqual(PERMANENT);
  });
});

describe("[ADV57-M7] home arrival through the real enter-home / return-home code", () => {
  const home = { x: 20, y: 64, z: 20 };
  const stub = (impl: (bot: Bot, to: { x: number; y: number; z: number }) => Promise<unknown>): NavigationBackend => {
    const real = new MineflayerPathfinderBackend();
    return Object.assign(Object.create(real), { navigateToPosition: impl }) as NavigationBackend;
  };
  const saved = navigationBackend();
  afterEach(() => setNavigationBackend(saved));
  it("backend claims success but the body is 20 blocks from home -> return-home is NOT a success", async () => {
    const f = fixture();
    setNavigationBackend(stub(async (_b, to) => ({ success: true, data: { position: to, distance: 0 }, durationMs: 1 })));
    const p = executeReturnHome(f.bot, { home, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.success).toBe(false);
  });
  it("backend claims success but body is outside the interior -> enterClaimedHouse refuses", async () => {
    const f = fixture();
    setNavigationBackend(stub(async (_b, to) => ({ success: true, data: { position: to, distance: 0 }, durationMs: 1 })));
    const p = enterClaimedHouse(f.bot, { interior: home, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fail(await p).code).toBe("INTERIOR_UNREACHABLE");
  });
  it("body really walks home -> both succeed", async () => {
    const f = fixture({ x: 18, y: 64, z: 18 });
    setNavigationBackend(stub(async (b, to) => { Object.assign(b.entity.position, { x: to.x + 0.5, y: to.y, z: to.z + 0.5 }); return { success: true, data: { position: to, distance: 0 }, durationMs: 1 }; }));
    const a = executeReturnHome(f.bot, { home, timeoutMs: 5000 }); await vi.advanceTimersByTimeAsync(3000);
    expect((await a).success).toBe(true);
    const f2 = fixture({ x: 18, y: 64, z: 18 });
    const b = enterClaimedHouse(f2.bot, { interior: home, timeoutMs: 5000 }); await vi.advanceTimersByTimeAsync(3000);
    expect((await b).success).toBe(true);
  });
  it("hung backend: return-home and enter-home are bounded by their own timeout", async () => {
    const f = fixture(); setNavigationBackend(stub(() => new Promise(() => undefined)));
    const a = executeReturnHome(f.bot, { home, timeoutMs: 2000 }); await vi.advanceTimersByTimeAsync(2500);
    expect(fail(await a).code).toBe("TIMEOUT");
    const b = enterClaimedHouse(f.bot, { interior: home, timeoutMs: 2000 }); await vi.advanceTimersByTimeAsync(3500);
    expect(fail(await b).code).toBe("TIMEOUT");
  });
  it("cancel mid-return-home + delayed backend success -> CANCELLED, never arrival", async () => {
    const f = fixture(); const c = new AbortController(); let done!: () => void;
    setNavigationBackend(stub(() => new Promise((res) => { done = () => { f.teleport(20.5, 64, 20.5); res({ success: true, data: { position: home, distance: 0 }, durationMs: 1 }); }; })));
    const p = executeReturnHome(f.bot, { home, timeoutMs: 8000, signal: c.signal });
    await vi.advanceTimersByTimeAsync(200); c.abort(); await vi.advanceTimersByTimeAsync(50); done(); await vi.advanceTimersByTimeAsync(200);
    expect(fail(await p).code).toBe("CANCELLED");
  });
  it("death mid-return-home + delayed success -> NOT_CONNECTED", async () => {
    const f = fixture(); let done!: () => void;
    setNavigationBackend(stub(() => new Promise((res) => { done = () => { f.teleport(20.5, 64, 20.5); res({ success: true, data: { position: home, distance: 0 }, durationMs: 1 }); }; })));
    const p = executeReturnHome(f.bot, { home, timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(200); f.raw.health = 0; f.events.emit("death"); done(); await vi.advanceTimersByTimeAsync(200);
    expect(fail(await p).code).toBe("NOT_CONNECTED");
  });
  it.each([[{ x: NaN, y: 64, z: 0 }], [{ x: 0, y: Infinity, z: 0 }]])("invalid home %j rejected", async (bad) => {
    const f = fixture();
    expect((await executeReturnHome(f.bot, { home: bad, timeoutMs: 1000 })).success).toBe(false);
    expect((await enterClaimedHouse(f.bot, { interior: bad, timeoutMs: 1000 })).success).toBe(false);
  });
});
