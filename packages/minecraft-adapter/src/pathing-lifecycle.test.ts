import { EventEmitter, getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";

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
import { activePathCount, configureMovements, followPlayer, moveToGetToBlock, moveToPosition } from "./pathing.js";
import { probeReachability } from "./path-probe.js";

function fixture() {
  const events = new EventEmitter();
  const pathfinder = { setMovements: vi.fn(), setGoal: vi.fn(), stop: vi.fn(), goto: vi.fn<() => Promise<void>>(() => new Promise(() => undefined)) };
  const bot = Object.assign(events, {
    username: "path-lifecycle-fixture", health: 20,
    entity: { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true },
    registry: { itemsByName: {}, blocksByName: {} }, inventory: { items: () => [] },
    pathfinder, loadPlugin: vi.fn(), supportFeature: (): boolean => false,
    clearControlStates: vi.fn(), setControlState: vi.fn(),
    blockAt: (p: { x: number; y: number; z: number }) => ({ name: p.y < 64 ? "stone" : "air", boundingBox: p.y < 64 ? "block" : "empty" }),
  });
  return { events, pathfinder, raw: bot, bot: bot as unknown as Bot, clear: bot.clearControlStates };
}

describe("path request lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();
  });

  it("cancels airborne preflight before invoking the pathfinder", async () => {
    const f = fixture();
    f.bot.entity.onGround = false;
    f.bot.waitForTicks = () => new Promise<void>(() => undefined);
    const controller = new AbortController();
    let settled = false;
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000, signal: controller.signal });
    void pending.then(() => { settled = true; });
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("aborted preflight arrived");
    expect(result.code).toBe("CANCELLED");
    expect(f.pathfinder.goto).not.toHaveBeenCalled();
  });
  it("does not start pathfinding after an airborne life transition", async () => {
    const f = fixture();
    f.bot.entity.onGround = false;
    f.bot.waitForTicks = () => new Promise<void>(() => undefined);
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000 });
    f.events.emit("death");
    await vi.advanceTimersByTimeAsync(300);
    expect(f.pathfinder.goto).not.toHaveBeenCalled();
    const result = await pending;
    if (result.success) throw new Error("dead preflight arrived");
    expect(result.code).toBe("NOT_CONNECTED");
  });
  it("includes airborne preflight in the caller timeout", async () => {
    const f = fixture();
    f.bot.entity.onGround = false;
    f.bot.waitForTicks = () => new Promise<void>(() => undefined);
    let settled = false;
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 600 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(900);
    expect(settled).toBe(true);
    expect(f.pathfinder.goto).not.toHaveBeenCalled();
    const result = await pending;
    if (result.success) throw new Error("frozen preflight arrived");
    expect(result.code).toBe("TIMEOUT");
  });

  it("subtracts completed airborne preflight from the plugin timeout", async () => {
    const f = fixture();
    f.bot.entity.onGround = false;
    let ticks = 0;
    f.bot.waitForTicks = () => new Promise<void>(resolve => setTimeout(() => {
      ticks += 1;
      f.bot.entity.onGround = ticks >= 3;
      resolve();
    }, 100));
    let settled = false;
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 600 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(900);
    expect(f.pathfinder.goto).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("nonsettling path arrived");
    expect(result.code).toBe("TIMEOUT");
  });

  it.each(["end", "kicked", "death", "respawn"])("rejects same-turn goto success and %s", async event => {
    const f = fixture();
    f.pathfinder.goto.mockImplementation(async () => {
      Object.assign(f.bot.entity.position, { x: 10, y: 64, z: 0 });
      f.events.emit(event);
    });
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    if (result.success) throw new Error("life transition lost to goto success");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(f.clear).toHaveBeenCalled();
    expect(activePathCount()).toBe(0);
  });
  it("rejects same-turn goto success and cancellation", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.pathfinder.goto.mockImplementation(async () => {
      Object.assign(f.bot.entity.position, { x: 10, y: 64, z: 0 });
      controller.abort();
    });
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    if (result.success) throw new Error("cancellation lost to goto success");
    expect(result.code).toBe("CANCELLED");
  });
  it("verifies body readiness after the plugin resolves", async () => {
    const f = fixture();
    f.pathfinder.goto.mockImplementation(async () => {
      Object.assign(f.bot.entity.position, { x: 10, y: 64, z: 0 });
      f.bot.health = 0;
    });
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    if (result.success) throw new Error("dead body reported success");
    expect(result.code).toBe("NOT_CONNECTED");
  });

  function recoveryFixture() {
    const f = fixture();
    f.raw.blockAt = (p) => {
      const solid = p.y < 64 || Math.floor(p.x) === 1 && Math.floor(p.y) === 64;
      return { name: solid ? "stone" : "air", boundingBox: solid ? "block" : "empty" };
    };
    f.bot.waitForTicks = async () => undefined;
    f.bot.lookAt = vi.fn(() => new Promise<void>(() => undefined));
    f.pathfinder.goto.mockRejectedValue(new Error("no path"));
    return f;
  }
  it("bounds step-jump recovery within the whole navigation budget", async () => {
    const f = recoveryFixture();
    let settled = false;
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 65, z: 0 }, { timeoutMs: 1000 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1100);
    expect(f.bot.lookAt).toHaveBeenCalled();
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("frozen recovery arrived");
    expect(result.code).toBe("TIMEOUT");
    expect(f.clear).toHaveBeenCalled();
  });
  it("does not retry recovery after a retained body's life transition", async () => {
    const f = recoveryFixture();
    let settled = false;
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 65, z: 0 }, { timeoutMs: 3000 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(300);
    expect(f.bot.lookAt).toHaveBeenCalledOnce();
    f.events.emit("respawn");
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("old recovery arrived");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(f.bot.lookAt).toHaveBeenCalledOnce();
  });

  function twoBlockWall() {
    const f = fixture();
    f.raw.blockAt = (p) => {
      const solid = p.y < 64 || (Math.floor(p.x) === 1 && Math.floor(p.z) === 0 && (Math.floor(p.y) === 64 || Math.floor(p.y) === 65));
      return { name: solid ? "stone" : "air", boundingBox: solid ? "block" : "empty" };
    };
    f.bot.waitForTicks = async () => undefined;
    f.pathfinder.goto.mockRejectedValue(new Error("STUCK"));
    return f;
  }
  it("settles a hanging detour lookAt inside the caller's deadline", async () => {
    const f = twoBlockWall();
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    let settled = false;
    const pending = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(9000);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("hanging lookAt arrived");
    expect(result.code === "TIMEOUT" || result.code === "PATH_BLOCKED" || result.code === "STUCK").toBe(true);
    expect(f.clear).toHaveBeenCalled();
  });
  it("releases a hanging detour when the caller cancels, and a late lookAt does not resume it", async () => {
    const f = twoBlockWall();
    const setControl = vi.fn();
    f.raw.setControlState = setControl;
    let finishLook!: () => void;
    f.bot.lookAt = () => new Promise<void>(resolve => { finishLook = resolve; });
    const controller = new AbortController();
    let settled = false;
    const pending = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000, signal: controller.signal });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(300);
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("cancelled detour arrived");
    expect(result.code).toBe("CANCELLED");
    const gotoCalls = f.pathfinder.goto.mock.calls.length;
    finishLook();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.pathfinder.goto.mock.calls.length).toBe(gotoCalls);
    expect(setControl.mock.calls.some(([name, on]) => name === "forward" && on === true)).toBe(false);
  });
  it.each(["death", "end"])("releases a hanging detour on %s", async (event) => {
    const f = twoBlockWall();
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    let settled = false;
    const pending = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(300);
    if (event === "death") f.raw.health = 0;
    f.events.emit(event);
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("interrupted detour arrived");
    expect(result.code).toBe("NOT_CONNECTED");
  });
  it("clears the recovery lock so a later detour can still look", async () => {
    const f = twoBlockWall();
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    const controller = new AbortController();
    const first = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(300);
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);
    const cancelled = await first;
    if (cancelled.success) throw new Error("first detour arrived");
    expect(cancelled.code).toBe("CANCELLED");
    f.bot.lookAt = vi.fn(async () => undefined);
    const second = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(2000);
    const again = await second;
    if (again.success) throw new Error("blocked detour arrived");
    expect(f.bot.lookAt).toHaveBeenCalled();
  });
  it("still reports arrival when the body physically reaches the target", async () => {
    const f = fixture();
    f.pathfinder.goto.mockImplementation(async () => {
      Object.assign(f.bot.entity.position, { x: 10.1, y: 64, z: 0.1 });
    });
    const pending = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("arrival was not recorded");
    expect(result.data.position.x).toBeCloseTo(10.1);
  });
  it("returns INVALID_ARGUMENT for a null target instead of throwing", async () => {
    const f = fixture();
    const result = await moveToPosition(f.bot, null as never, { timeoutMs: 1000 });
    expect(result).toMatchObject({ success: false, code: "INVALID_ARGUMENT" });
    expect(f.pathfinder.goto).not.toHaveBeenCalled();
  });

  it("does not return a replaced pathfinder from the movement cache", () => {
    const f = fixture();
    expect(configureMovements(f.bot)).toBe(f.pathfinder);
    const replacement = { ...f.pathfinder, setMovements: vi.fn(), goto: vi.fn(async () => undefined) };
    f.raw.pathfinder = replacement;
    expect(configureMovements(f.bot)).toBe(replacement);
    expect(replacement.setMovements).toHaveBeenCalledOnce();
  });
  it("reinstalls packet synchronization on client replacement even with cached policy", () => {
    const f = fixture();
    const first = { state: "play", write: vi.fn<(name: string, payload?: unknown) => void>() };
    Object.assign(f.raw, { _client: first, controlState: { forward: true, jump: true } });
    f.raw.supportFeature = () => true;
    configureMovements(f.bot);
    const write = vi.fn<(name: string, payload?: unknown) => void>();
    const replacement = { state: "play", write };
    Object.assign(f.raw, { _client: replacement });
    configureMovements(f.bot);
    replacement.write("player_input", { inputs: { shift: true } });
    expect(write).toHaveBeenCalledWith("player_input", { inputs: expect.objectContaining({ forward: true, jump: true, shift: true }) });
  });
  it("settles cancellation even when pathfinder.stop does not settle goto", async () => {
    const f = fixture();
    const controller = new AbortController();
    let settled = false;
    const request = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000, signal: controller.signal });
    void request.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(true);
    const result = await request;
    expect(result.success).toBe(false);
    if (result.success) throw new Error("cancelled path arrived");
    expect(result.code).toBe("CANCELLED");
    expect(f.clear).toHaveBeenCalled();
    expect(activePathCount()).toBe(0);
    expect(f.events.listenerCount("path_update")).toBe(0);
  });
  it("settles transport loss while the pathfinder promise remains pending", async () => {
    const f = fixture();
    let settled = false;
    const request = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000 });
    void request.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    f.events.emit("end");
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(true);
    const result = await request;
    expect(result.success).toBe(false);
    if (result.success) throw new Error("lost transport arrived");
    expect(result.code).toBe("NOT_CONNECTED");
  });
  it.each(["death", "respawn"])("invalidates an old path on %s even when the entity remains present", async (event) => {
    const f = fixture();
    let settled = false;
    const request = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 2000 });
    void request.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    f.events.emit(event);
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(true);
    const result = await request;
    expect(result.success).toBe(false);
    if (result.success) throw new Error("old path survived life transition");
    expect(result.code).toBe("NOT_CONNECTED");
  });
  it("times out a non-settling plugin within its budget plus bounded teardown", async () => {
    const f = fixture();
    let settled = false;
    const request = moveToGetToBlock(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 600 });
    void request.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(900);
    expect(settled).toBe(true);
    const result = await request;
    if (result.success) throw new Error("nonsettling path arrived");
    expect(result.code).toBe("TIMEOUT");
  });
  it("does not wait in the global queue for an already-cancelled request", async () => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const pending = controllers.map((c) => moveToGetToBlock(fixture().bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 10000, signal: c.signal }));
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(activePathCount()).toBe(3);
      const cancelled = new AbortController();
      cancelled.abort();
      let settled = false;
      const request = moveToPosition(fixture().bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 1000, signal: cancelled.signal });
      void request.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      const result = await request;
      if (result.success) throw new Error("cancelled queue request arrived");
      expect(result.code).toBe("CANCELLED");
    } finally {
      controllers.forEach((c) => c.abort());
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.all(pending);
    }
  });
  it("bounds queue admission by the caller's total timeout", async () => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const pending = controllers.map((c) => moveToGetToBlock(fixture().bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 10000, signal: c.signal }));
    try {
      await vi.advanceTimersByTimeAsync(0);
      let settled = false;
      const request = moveToPosition(fixture().bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 600 });
      void request.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(650);
      expect(settled).toBe(true);
      const result = await request;
      if (result.success) throw new Error("queued path arrived");
      expect(result.code).toBe("TIMEOUT");
    } finally {
      controllers.forEach((c) => c.abort());
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.all(pending);
    }
  });
  it.each([
    { x: NaN, range: 2, timeoutMs: 600 },
    { x: Infinity, range: 2, timeoutMs: 600 },
    { x: 10, range: -1, timeoutMs: 600 },
    { x: 10, range: Infinity, timeoutMs: 600 },
    { x: 10, range: 2, timeoutMs: NaN },
    { x: 10, range: 2, timeoutMs: 0 },
  ])("refuses malformed position/range/budget before pathfinding: %j", async ({ x, range, timeoutMs }) => {
    const f = fixture();
    const controller = new AbortController();
    let result: Awaited<ReturnType<typeof moveToPosition>> | undefined;
    const request = moveToPosition(f.bot, { x, y: 64, z: 0 }, { range, timeoutMs, signal: controller.signal, recover: false });
    void request.then((r) => { result = r; });
    await vi.advanceTimersByTimeAsync(0);
    try {
      expect(result).toMatchObject({ success: false, code: "INVALID_ARGUMENT" });
      expect(f.pathfinder.goto).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      await request;
    }
  });
});

describe("resource reachability uses real pathfinder query contracts", () => {
  it.each(["noPath", "success"])("passes configured movements and an actual goal for %s", (status) => {
    const f = fixture();
    const query = vi.fn((movements: unknown, goal: unknown) => {
      if (!movements || !goal || typeof goal !== "object" || !("isEnd" in goal)) {
        throw new Error("Pathfinder requires Movements and a Goal, not undefined/plain coordinates");
      }
      return { status, cost: 7 };
    });
    Object.assign(f.pathfinder, { getPathTo: query });
    const result = probeReachability(f.bot, { x: 10, y: 64, z: 0 });
    expect(result.reachable).toBe(status === "success");
    if (status === "success") expect(result.cost).toBe(7);
    expect(query.mock.calls[0]?.[0]).toBe(f.pathfinder.setMovements.mock.calls[0]?.[0]);
  });
});

describe("follow request lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function following() {
    const f = fixture();
    const target = { id: 42, username: "Other", position: { x: 20, y: 64, z: 0.5 }, health: 20, isValid: true };
    Object.assign(f.bot, { players: { Other: { entity: target } }, entities: { 42: target } });
    return { ...f, target };
  }

  it.each(["end", "kicked", "death", "respawn"])("rejects same-turn follow success and %s", async event => {
    const f = following();
    f.pathfinder.goto.mockImplementation(async () => {
      Object.assign(f.bot.entity.position, f.target.position);
      f.events.emit(event);
    });
    const result = await followPlayer(f.bot, "Other", { timeoutMs: 1000 });
    if (result.success) throw new Error("life transition lost to follow success");
    expect(result.code).toBe("NOT_CONNECTED");
  });
  it("refuses an already cancelled follow before invoking the plugin", async () => {
    const f = following();
    const controller = new AbortController();
    controller.abort();
    const request = followPlayer(f.bot, "Other", { signal: controller.signal, timeoutMs: 1000 });
    try {
      expect(f.pathfinder.goto).not.toHaveBeenCalled();
    } finally {
      await vi.advanceTimersByTimeAsync(1100);
      await request;
    }
  });
  it("verifies the live target distance even if the plugin resolves", async () => {
    const f = following();
    f.pathfinder.goto.mockResolvedValue(undefined);
    const result = await followPlayer(f.bot, "Other", { timeoutMs: 1000 });
    expect(result.success).toBe(false);
  });
  it("actually stops and clears controls when following times out", async () => {
    const f = following();
    const request = followPlayer(f.bot, "Other", { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    const result = await request;
    if (result.success) throw new Error("follow timeout arrived");
    expect(result.code).toBe("TIMEOUT");
    expect(f.pathfinder.stop).toHaveBeenCalled();
    expect(f.clear).toHaveBeenCalled();
  });
  it("removes timers and every abort listener after a successful follow", async () => {
    const f = following();
    f.target.position.x = 1.5;
    f.pathfinder.goto.mockResolvedValue(undefined);
    const controller = new AbortController();
    const result = await followPlayer(f.bot, "Other", { timeoutMs: 1000, signal: controller.signal });
    expect(result.success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it.each(["end", "death", "respawn"])("settles a pending follow on %s", async (event) => {
    const f = following();
    let settled = false;
    const request = followPlayer(f.bot, "Other", { timeoutMs: 1000 });
    void request.then(() => { settled = true; });
    f.events.emit(event);
    await vi.advanceTimersByTimeAsync(300);
    try {
      expect(settled).toBe(true);
      const result = await request;
      if (result.success) throw new Error("lost follow arrived");
      expect(result.code).toBe("NOT_CONNECTED");
    } finally {
      await vi.advanceTimersByTimeAsync(1100);
      await request;
    }
  });
  it("notices a target removed while the plugin remains pending", async () => {
    const f = following();
    let settled = false;
    const request = followPlayer(f.bot, "Other", { timeoutMs: 1000 });
    void request.then(() => { settled = true; });
    delete f.bot.entities[42];
    delete f.bot.players.Other;
    await vi.advanceTimersByTimeAsync(500);
    try {
      expect(settled).toBe(true);
      const result = await request;
      if (result.success) throw new Error("removed target arrived");
      expect(result.code).toBe("ENTITY_REMOVED");
    } finally {
      await vi.advanceTimersByTimeAsync(1100);
      await request;
    }
  });
});
