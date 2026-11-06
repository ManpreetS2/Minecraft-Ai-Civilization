import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
vi.mock("node:module", async (original) => {
  const actual = await original<typeof import("node:module")>();
  return { ...actual, createRequire: (url: string | URL) => {
    const require = actual.createRequire(url);
    return Object.assign((id: string) => id === "mineflayer-pathfinder" ? {
      pathfinder: () => undefined, Movements: class { blocksCantBreak = new Set<number>(); blocksToAvoid = new Set<number>(); },
      goals: (require(id) as { goals: Record<string, unknown> }).goals } : require(id), require);
  } };
});
import { moveToPosition } from "../../../packages/minecraft-adapter/src/pathing.js";

// Flat stone floor (y<64), a 2-high stone wall in the column x=1 for z in [-0, 0] only (side columns open) -> two-block detour recovery.
function walled(lookAt: () => Promise<void>) {
  const ev = new EventEmitter(); ev.setMaxListeners(0);
  const controls: Record<string, boolean> = {};
  const pathfinder = { setMovements: vi.fn(), setGoal: vi.fn(), stop: vi.fn(), goto: vi.fn<() => Promise<void>>(async () => { throw new Error("STUCK"); }) };
  const solid = (x: number, y: number, z: number) => y < 64 || (Math.floor(x) === 1 && Math.floor(z) === 0 && (Math.floor(y) === 64 || Math.floor(y) === 65));
  const raw = Object.assign(ev, {
    username: "qa57-recovery", health: 20, food: 20, entity: { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true, yaw: 0, pitch: 0, height: 1.8 },
    registry: { itemsByName: {}, blocksByName: {} }, inventory: { items: () => [] }, pathfinder, loadPlugin: vi.fn(), supportFeature: () => false,
    setControlState: (k: string, v: boolean) => { controls[k] = v; }, getControlState: (k: string) => Boolean(controls[k]),
    clearControlStates: () => { for (const k of Object.keys(controls)) controls[k] = false; },
    waitForTicks: () => new Promise<void>((r) => setTimeout(r, 50)), look: async () => undefined, lookAt,
    blockAt: (p: { x: number; y: number; z: number }) => ({ name: solid(p.x, p.y, p.z) ? "stone" : "air", boundingBox: solid(p.x, p.y, p.z) ? "block" : "empty", position: p }),
    _client: { state: "play", ended: false },
  });
  return { raw, bot: raw as unknown as Bot, pathfinder, ev };
}
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());

describe("[ADV57-M1 end-to-end] a hung lookAt in detour recovery escapes the whole-action deadline", () => {
  it("control: with a resolving lookAt, moveToPosition returns before its budget", async () => {
    const f = walled(async () => undefined);
    const p = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000 });
    let done = false; void p.then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    console.warn(`QA57 control: lookAt resolves -> settled=${done}, goto calls=${f.pathfinder.goto.mock.calls.length}`);
    expect(done).toBe(true);
  });
  // The defect: obstacle-detour.ts stepToStandingCell() awaits bot.lookAt() raw. runGoto() awaits the recovery scope directly,
  // so its timer/abort/life-event only flips a flag and cannot release the awaiting caller. Identical on base #56 (file unchanged by #57).
  it("moveToPosition(timeoutMs=8000) settles within a bounded time when lookAt hangs in detour recovery", async () => {
    const f = walled(() => new Promise<void>(() => undefined));
    const p = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000 });
    let done = false; void p.then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(done).toBe(true);
  });
  it("a caller AbortSignal releases a detour whose lookAt never resolves", async () => {
    const f = walled(() => new Promise<void>(() => undefined)); const c = new AbortController();
    const p = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000, signal: c.signal });
    let done = false; void p.then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(500); c.abort(); await vi.advanceTimersByTimeAsync(600_000);
    expect(done).toBe(true);
  });
  it("a death event releases a detour whose lookAt never resolves", async () => {
    const f = walled(() => new Promise<void>(() => undefined));
    const p = moveToPosition(f.bot, { x: 10, y: 64, z: 0 }, { timeoutMs: 8000 });
    let done = false; void p.then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(500); f.raw.health = 0; f.ev.emit("death"); await vi.advanceTimersByTimeAsync(600_000);
    expect(done).toBe(true);
  });
});
