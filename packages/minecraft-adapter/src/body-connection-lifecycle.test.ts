import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";

const createBot = vi.hoisted(() => vi.fn());
vi.mock("mineflayer", () => ({ default: { createBot } }));
vi.mock("node:module", async original => {
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
import { activePathCount, moveToGetToBlock } from "./pathing.js";
import { MinecraftBody } from "./minecraft-body.js";

const bodies: MinecraftBody[] = [];
const directories: string[] = [];
function createMockBot() {
  const controls: Record<string, boolean> = {};
  const client = Object.assign(new EventEmitter(), { state: "play", write: vi.fn(), end: vi.fn() });
  const bot = Object.assign(new EventEmitter(), {
    username: "ConnectionFixture", health: 20, _client: client,
    entity: { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true },
    pathfinder: { stop: vi.fn(), setGoal: vi.fn(), setMovements: vi.fn(), goto: vi.fn(() => new Promise<void>(() => undefined)) },
    registry: { itemsByName: {}, blocksByName: {} }, inventory: { items: () => [] }, loadPlugin: vi.fn(),
    blockAt: (p: { y: number }) => ({ name: p.y < 64 ? "stone" : "air", boundingBox: p.y < 64 ? "block" : "empty" }),
    supportFeature: () => false,
    setControlState: (name: string, value: boolean) => { controls[name] = value; },
    clearControlStates: vi.fn(() => { for (const name of Object.keys(controls)) controls[name] = false; }),
    quit: vi.fn(), end: vi.fn(),
  });
  return { bot, client, controls };
}
function fixture(reconnect = false) {
  const { bot, client, controls } = createMockBot();
  createBot.mockReturnValue(bot);
  const lockDir = mkdtempSync(join(tmpdir(), "movement-body-"));
  directories.push(lockDir);
  const body = new MinecraftBody({ username: bot.username, config: loadConfig({}), lockDir, reconnect });
  bodies.push(body);
  return { body, bot, client, controls, lockDir };
}

describe("body connection lifecycle (mocked createBot, no network)", () => {
  beforeEach(() => { vi.useFakeTimers(); createBot.mockReset(); });
  afterEach(async () => {
    for (const body of bodies.splice(0)) await body.disconnect();
    await vi.advanceTimersByTimeAsync(46_000);
    vi.useRealTimers();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  it("settles a pending connection immediately when disconnected", async () => {
    const f = fixture();
    let settled = false;
    const pending = f.body.connect();
    void pending.then(() => { settled = true; });
    await f.body.disconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("shutdown connected");
    expect(result.code).toBe("CANCELLED");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops the old path and clears held controls before retiring the bot", async () => {
    const f = fixture();
    const pending = f.body.connect();
    f.bot.emit("spawn");
    expect((await pending).success).toBe(true);
    f.bot.setControlState("forward", true);
    await f.body.disconnect();
    expect(f.bot.pathfinder.stop).toHaveBeenCalledOnce();
    expect(f.bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
    expect(f.bot.clearControlStates).toHaveBeenCalled();
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
    expect(f.body.getBot()).toBeNull();
  });
  it("returns a failed action and clears timers when bot creation throws", async () => {
    const f = fixture();
    createBot.mockImplementation(() => { throw new Error("unsupported mocked protocol"); });
    const outcome = await f.body.connect().then(result => ({ result }), error => ({ error }));
    expect(outcome).toHaveProperty("result");
    if (!("result" in outcome)) throw new Error("connect rejected instead of returning an action");
    if (outcome.result.success) throw new Error("failed creation connected");
    expect(outcome.result.code).toBe("UNKNOWN");
    expect(vi.getTimerCount()).toBe(0);
    expect(MinecraftBody.getActive(f.bot.username)).toBeUndefined();
  });
  it.each(["stop", "setGoal"] as const)("clears controls even when pathfinder %s throws", async method => {
    const f = fixture();
    const pending = f.body.connect();
    f.bot.emit("spawn");
    await pending;
    f.bot.setControlState("forward", true);
    f.bot.pathfinder[method].mockImplementation(() => { throw new Error("retired pathfinder"); });
    expect(() => f.body.stopPathfinding()).not.toThrow();
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });

  it("shares one bot creation across concurrent connection requests", async () => {
    const f = fixture();
    const first = f.body.connect();
    const second = f.body.connect();
    expect(createBot).toHaveBeenCalledOnce();
    f.bot.emit("spawn");
    expect((await first).success).toBe(true);
    expect((await second).success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("can retry after a synchronous creation failure", async () => {
    const f = fixture();
    createBot.mockImplementationOnce(() => { throw new Error("mocked startup failure"); });
    expect((await f.body.connect()).success).toBe(false);
    const pending = f.body.connect();
    f.bot.emit("spawn");
    expect((await pending).success).toBe(true);
    expect(createBot).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves TIMEOUT for a bot that never spawns", async () => {
    const f = fixture();
    const pending = f.body.connect();
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pending;
    if (result.success) throw new Error("unspawned bot connected");
    expect(result.code).toBe("TIMEOUT");
    expect(f.body.getBot()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not consider an entity available before spawn", async () => {
    const f = fixture();
    const pending = f.body.connect();
    expect(f.body.connected).toBe(false);
    f.bot.emit("spawn");
    await pending;
    expect(f.body.connected).toBe(true);
  });
  it.each(["end", "configuration", "dead"])("does not call a retained %s body connected", async state => {
    const f = fixture();
    const pending = f.body.connect();
    f.bot.emit("spawn");
    await pending;
    expect(f.body.connected).toBe(true);
    if (state === "end") f.bot.emit("end", "offline test");
    else if (state === "configuration") f.client.state = "configuration";
    else f.bot.health = 0;
    expect(f.body.connected).toBe(false);
  });
  it("invalidates an active navigation request when retiring the body", async () => {
    const f = fixture();
    const connected = f.body.connect();
    f.bot.emit("spawn");
    await connected;
    let settled = false;
    const pending = moveToGetToBlock(f.body.requireBot(), { x: 10, y: 64, z: 0 }, { timeoutMs: 6000 });
    void pending.then(() => { settled = true; });
    await f.body.disconnect();
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("retired navigation succeeded");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(activePathCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reserves the identity while the first body is still connecting", async () => {
    const f = fixture();
    Reflect.deleteProperty(f.bot, "entity");
    const first = f.body.connect();
    void first.then(() => undefined);
    const second = new MinecraftBody({ username: f.bot.username, config: loadConfig({}), lockDir: f.lockDir, reconnect: false });
    bodies.push(second);
    let settled = false;
    const pending = second.connect();
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("duplicate connecting body admitted");
    expect(result.code).toBe("DUPLICATE_BODY");
    expect(createBot).toHaveBeenCalledOnce();
  });

  it("does not let a refused duplicate disconnect release the active identity", async () => {
    const f = fixture();
    const first = f.body.connect();
    f.bot.emit("spawn");
    await first;
    const second = new MinecraftBody({ username: f.bot.username, config: loadConfig({}), lockDir: f.lockDir, reconnect: false });
    bodies.push(second);
    const refused = await second.connect();
    if (refused.success) throw new Error("duplicate body admitted");
    expect(refused.code).toBe("DUPLICATE_BODY");
    await second.disconnect();
    expect(MinecraftBody.getActive(f.bot.username)).toBe(f.body);
    expect(existsSync(join(f.lockDir, `${f.bot.username.toLowerCase()}.lock`))).toBe(true);
    expect(f.body.connected).toBe(true);
  });

  it("binds client telemetry and physics observation once across spawn", async () => {
    const f = fixture();
    const pending = f.body.connect();
    f.bot.emit("spawn");
    await pending;
    expect(f.client.listenerCount("error")).toBe(1);
    expect(f.client.listenerCount("packet")).toBe(1);
    expect(f.client.listenerCount("keep_alive")).toBe(1);
    // One movement writer plus one telemetry observer.
    expect(f.bot.listenerCount("physicsTick")).toBe(2);
  });
  it("records one disconnection for one transport reset after spawn", async () => {
    const f = fixture();
    const pending = f.body.connect();
    f.bot.emit("spawn");
    await pending;
    f.client.emit("error", Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }));
    expect(f.body.connectionTelemetry().disconnects).toBe(1);
    expect(f.body.connected).toBe(false);
  });

  it("absorbs late bot and client errors after explicit shutdown", async () => {
    const f = fixture();
    const pending = f.body.connect();
    f.bot.emit("spawn");
    await pending;
    await f.body.disconnect();
    expect(() => f.bot.emit("error", new Error("late retired plugin failure"))).not.toThrow();
    expect(() => f.client.emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(f.body.connected).toBe(false);
  });
  it("clears reconnecting state and its timer on explicit shutdown", async () => {
    const f = fixture(true);
    const pending = f.body.connect();
    f.bot.emit("spawn");
    await pending;
    f.bot.emit("end", "offline reconnect test");
    expect(f.body.connectionTelemetry().health).toBe("RECONNECTING");
    await f.body.disconnect();
    expect(f.body.connectionTelemetry().health).toBe("OFFLINE");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(createBot).toHaveBeenCalledOnce();
  });

  it("retries a timed-out connection when reconnect is enabled", async () => {
    const f = fixture(true);
    const replacement = createMockBot();
    createBot.mockReturnValueOnce(f.bot).mockReturnValue(replacement.bot);
    const first = f.body.connect();
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await first;
    if (result.success) throw new Error("unspawned connection succeeded");
    expect(result.code).toBe("TIMEOUT");
    await vi.advanceTimersByTimeAsync(3000);
    expect(createBot).toHaveBeenCalledTimes(2);
    replacement.bot.emit("spawn");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.body.connected).toBe(true);
    expect(f.body.getBot()).toBe(replacement.bot);
  });
  it("reconnects with a fresh bot and ignores late retired-bot events", async () => {
    const f = fixture(true);
    const replacement = createMockBot();
    createBot.mockReturnValueOnce(f.bot).mockReturnValue(replacement.bot);
    const first = f.body.connect();
    f.bot.emit("spawn");
    await first;
    f.bot.emit("end", "offline transport loss");
    await vi.advanceTimersByTimeAsync(3000);
    expect(createBot).toHaveBeenCalledTimes(2);
    replacement.bot.emit("spawn");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.body.connected).toBe(true);
    f.bot.emit("end", "late old end");
    f.bot.emit("error", new Error("late old plugin"));
    expect(f.body.connected).toBe(true);
    expect(f.body.getBot()).toBe(replacement.bot);
    expect(vi.getTimerCount()).toBe(0);
  });

});
