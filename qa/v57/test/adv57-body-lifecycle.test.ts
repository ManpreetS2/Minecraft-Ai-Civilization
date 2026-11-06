import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";

const createBot = vi.hoisted(() => { const f = vi.fn(); (globalThis as unknown as { __qaCreateBot: unknown }).__qaCreateBot = f; return f; });
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
import { activePathCount, moveToPosition } from "../../../packages/minecraft-adapter/src/pathing.js";
import { MinecraftBody } from "../../../packages/minecraft-adapter/src/minecraft-body.js";

const bodies: MinecraftBody[] = []; const dirs: string[] = [];
let unhandled: unknown[] = []; const onU = (e: unknown) => { unhandled.push(e); };
function mockBot(name = "QaBody57") {
  const client = Object.assign(new EventEmitter(), { state: "play", write: vi.fn(), end: vi.fn() });
  const bot = Object.assign(new EventEmitter(), {
    username: name, health: 20, _client: client, entity: { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true },
    pathfinder: { stop: vi.fn(), setGoal: vi.fn(), setMovements: vi.fn(), goto: vi.fn<() => Promise<void>>(() => new Promise<void>(() => undefined)) },
    registry: { itemsByName: {}, blocksByName: {} }, inventory: { items: () => [] }, loadPlugin: vi.fn(),
    blockAt: (p: { y: number }) => ({ name: p.y < 64 ? "stone" : "air", boundingBox: p.y < 64 ? "block" : "empty" }),
    supportFeature: () => false, setControlState: vi.fn(), clearControlStates: vi.fn(), quit: vi.fn(), end: vi.fn(),
  });
  return { bot, client };
}
function make(reconnect: boolean, name = "QaBody57") {
  const lockDir = mkdtempSync(join(tmpdir(), "qa57-body-")); dirs.push(lockDir);
  const body = new MinecraftBody({ username: name, config: loadConfig({}), lockDir, reconnect }); bodies.push(body); return body;
}
const T = { x: 10, y: 64, z: 0 };
beforeEach(() => { vi.useFakeTimers(); createBot.mockReset(); unhandled = []; process.on("unhandledRejection", onU); });
afterEach(async () => {
  for (const b of bodies.splice(0)) await b.disconnect();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  await new Promise((r) => setImmediate(r));
  process.off("unhandledRejection", onU); expect(unhandled).toEqual([]); expect(activePathCount()).toBe(0);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

describe("[ADV57-B] real MinecraftBody + real pathing, mocked createBot (no network)", () => {
  it("transport loss mid-navigation, reconnect to a NEW bot, stale goto success on the old bot -> NOT_CONNECTED, new bot untouched", async () => {
    const a = mockBot(), b = mockBot(); createBot.mockReturnValueOnce(a.bot).mockReturnValue(b.bot);
    const body = make(true); const c = body.connect(); a.bot.emit("spawn"); const cr = await c; if (!cr.success) throw new Error(`connect failed: ${cr.code} ${cr.error}`);
    let finish!: () => void; a.bot.pathfinder.goto.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
    const nav = moveToPosition(body.getBot()!, T, { timeoutMs: 20_000, recover: false });
    await vi.advanceTimersByTimeAsync(200);
    a.bot.emit("end", "reset"); await vi.advanceTimersByTimeAsync(3100);
    b.bot.emit("spawn"); await vi.advanceTimersByTimeAsync(10);
    Object.assign(a.bot.entity.position, { x: 10, y: 64, z: 0 }); finish(); await vi.advanceTimersByTimeAsync(1000);
    const r = await nav; expect(r.success).toBe(false); if (!r.success) expect(r.code).toBe("NOT_CONNECTED");
    expect(b.bot.pathfinder.goto).not.toHaveBeenCalled(); expect(body.getBot()).toBe(b.bot); expect(body.connected).toBe(true);
  });
  it("disconnect() mid-navigation -> navigation ends NOT_CONNECTED/CANCELLED promptly, retired bot quit once", async () => {
    const a = mockBot(); createBot.mockReturnValue(a.bot);
    const body = make(false); const c = body.connect(); a.bot.emit("spawn"); await c;
    const nav = moveToPosition(body.getBot()!, T, { timeoutMs: 30_000, recover: false });
    await vi.advanceTimersByTimeAsync(100); await body.disconnect("qa"); await vi.advanceTimersByTimeAsync(1500);
    const r = await nav; expect(r.success).toBe(false); expect(a.bot.quit).toHaveBeenCalledTimes(1);
    expect(body.connected).toBe(false);
  });
  it("connect timeout schedules reconnect; disconnect() before the retry fires -> no further createBot, no timers", async () => {
    const a = mockBot(); createBot.mockReturnValue(a.bot);
    const body = make(true); const p = body.connect(); await vi.advanceTimersByTimeAsync(45_000);
    expect((await p).success).toBe(false); expect(createBot).toHaveBeenCalledTimes(1);
    await body.disconnect(); await vi.advanceTimersByTimeAsync(120_000);
    expect(createBot).toHaveBeenCalledTimes(1);
  });
  it("reconnect:false never reconnects after timeout or end", async () => {
    const a = mockBot(); createBot.mockReturnValue(a.bot);
    const body = make(false); const p = body.connect(); await vi.advanceTimersByTimeAsync(45_000); await p;
    await vi.advanceTimersByTimeAsync(120_000); expect(createBot).toHaveBeenCalledTimes(1);
  });
  it("unspawned timeouts back off and stay bounded: 10 failed attempts then disconnect leaves nothing running", async () => {
    createBot.mockImplementation(() => mockBot().bot);
    const body = make(true); void body.connect().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10 * 120_000);
    const n = createBot.mock.calls.length; expect(n).toBeGreaterThan(1); expect(n).toBeLessThan(40);
    await body.disconnect(); await vi.advanceTimersByTimeAsync(300_000); expect(createBot.mock.calls.length).toBe(n);
  });
  it("death then respawn event: body is not 'connected' while dead, nav refuses", async () => {
    const a = mockBot(); createBot.mockReturnValue(a.bot);
    const body = make(false); const c = body.connect(); a.bot.emit("spawn"); await c;
    a.bot.health = 0; a.bot.emit("death");
    expect(body.connected).toBe(false);
    const r = await moveToPosition(a.bot as never, T, { timeoutMs: 2000 }); expect(r.success).toBe(false); // retained reference to the dead bot
    expect(a.bot.pathfinder.goto).not.toHaveBeenCalled();
  });
  it("two bodies same username: second is refused while first connecting/connected/reconnecting", async () => {
    const a = mockBot(); createBot.mockReturnValue(a.bot);
    const one = make(false), two = make(false);
    const c = one.connect(); const r2 = await two.connect(); expect(r2.success).toBe(false); if (!r2.success) expect(r2.code).toBe("DUPLICATE_BODY");
    a.bot.emit("spawn"); await c; const r3 = await two.connect(); expect(r3.success).toBe(false);
  });
});
