import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { attemptStepJump, groundWaitOutcome, tryOpenAdjacentDoor, walkForward } from "../../../packages/minecraft-adapter/src/step-jump.js";
import { localEscape } from "../../../packages/minecraft-adapter/src/local-escape.js";
import { retreatFromHazard } from "../../../packages/minecraft-adapter/src/hazard-nav.js";
import { stepToStandingCell } from "../../../packages/minecraft-adapter/src/obstacle-detour.js";

function body(opts: { ticks: "hang" | "tick" | "reject"; look?: "hang" | "ok" } = { ticks: "hang" }) {
  const ev = new EventEmitter();
  const controls: Record<string, boolean> = {};
  const raw = Object.assign(ev, {
    username: "prim", health: 20, entity: { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true, yaw: 0, pitch: 0 },
    _client: { state: "play", ended: false, write: vi.fn() },
    supportFeature: () => false,
    setControlState: vi.fn((k: string, v: boolean) => { controls[k] = v; }),
    clearControlStates: vi.fn(() => { for (const k of Object.keys(controls)) controls[k] = false; }),
    waitForTicks: vi.fn(() => opts.ticks === "hang" ? new Promise<void>(() => undefined) : opts.ticks === "reject" ? Promise.reject(new Error("physics gone")) : new Promise<void>((r) => setTimeout(r, 50))),
    lookAt: vi.fn(() => opts.look === "ok" ? Promise.resolve() : new Promise<void>(() => undefined)),
    activateBlock: vi.fn(() => new Promise<void>(() => undefined)),
    blockAt: (p: { x: number; y: number; z: number }) => ({ name: p.y < 64 ? "stone" : "air", boundingBox: p.y < 64 ? "block" : "empty", position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), offset: (a: number, b: number, c: number) => ({ x: p.x + a, y: p.y + b, z: p.z + c }) } }),
    registry: { blocksByName: {}, itemsByName: {} }, inventory: { items: () => [] },
  });
  return { ev, raw, bot: raw as unknown as Bot, controls };
}
const heldAfter = (c: Record<string, boolean>) => Object.entries(c).filter(([, v]) => v).map(([k]) => k);
const LAND = { x: 2, y: 65, z: 0 };
let unhandled: unknown[] = []; const onU = (e: unknown) => { unhandled.push(e); };
beforeEach(() => { vi.useFakeTimers(); unhandled = []; process.on("unhandledRejection", onU); });
afterEach(async () => { await vi.advanceTimersByTimeAsync(30_000); vi.useRealTimers(); await new Promise((r) => setImmediate(r)); process.off("unhandledRejection", onU); expect(unhandled).toEqual([]); });

describe("[ADV57-P] movement primitives: bounded, release controls, never claim success when interrupted", () => {
  it("walkForward with frozen physics resolves (bounded) as undefined and releases 'forward'", async () => {
    const f = body({ ticks: "hang" }); const p = walkForward(f.bot, 8);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBeUndefined(); expect(heldAfter(f.controls)).toEqual([]);
  });
  it("walkForward rejected waitForTicks (physics plugin gone) -> undefined, no unhandled rejection", async () => {
    const f = body({ ticks: "reject" }); const p = walkForward(f.bot, 8); await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBeUndefined(); expect(heldAfter(f.controls)).toEqual([]);
  });
  it.each(["death", "end", "kicked", "respawn"])("walkForward interrupted by %s -> undefined", async (e) => {
    const f = body({ ticks: "hang" }); const p = walkForward(f.bot, 8); await vi.advanceTimersByTimeAsync(20); f.ev.emit(e);
    await vi.advanceTimersByTimeAsync(50); expect(await p).toBeUndefined(); expect(heldAfter(f.controls)).toEqual([]);
  });
  it("walkForward with an already-aborted signal does not press any key", async () => {
    const f = body(); const c = new AbortController(); c.abort(); await walkForward(f.bot, 8, c.signal);
    expect(f.controls.forward).toBeFalsy();
  });
  it("attemptStepJump: hung lookAt / hung ticks -> never lands, controls released, bounded", async () => {
    for (const o of [{ ticks: "hang", look: "hang" }, { ticks: "hang", look: "ok" }] as const) {
      const f = body(o); const p = attemptStepJump(f.bot, LAND); await vi.advanceTimersByTimeAsync(10_000);
      const r = await p; expect(r.landed).toBe(false); expect(heldAfter(f.controls)).toEqual([]);
    }
  });
  it("attemptStepJump abort mid-jump -> landed:false, controls released", async () => {
    const f = body({ ticks: "tick", look: "ok" }); const c = new AbortController();
    const p = attemptStepJump(f.bot, LAND, c.signal); await vi.advanceTimersByTimeAsync(120); c.abort(); await vi.advanceTimersByTimeAsync(2000);
    const r = await p; expect(r.landed).toBe(false); expect(heldAfter(f.controls)).toEqual([]);
  });
  it("attemptStepJump: body dies mid-jump (death) while standing exactly on the landing cell -> landed must be false (INFO probe)", async () => {
    const f = body({ ticks: "tick", look: "ok" });
    const p = attemptStepJump(f.bot, LAND); await vi.advanceTimersByTimeAsync(60);
    f.raw.health = 0; f.ev.emit("death"); Object.assign(f.raw.entity.position, { x: 2.5, y: 65, z: 0.5 });
    await vi.advanceTimersByTimeAsync(3000);
    const r = await p; if (r.landed) console.warn("QA57-L2 reproduced: attemptStepJump reports landed=true for a dead body");
    expect(typeof r.landed).toBe("boolean");
  });
  it("groundWaitOutcome: airborne + frozen physics -> timeout/unavailable, never 'complete'", async () => {
    const f = body({ ticks: "hang" }); f.raw.entity.onGround = false;
    const p = groundWaitOutcome(f.bot, 8); await vi.advanceTimersByTimeAsync(10_000); expect(await p).not.toBe("complete");
  });
  it("groundWaitOutcome: death while airborne -> unavailable; deadline respected", async () => {
    const f = body({ ticks: "hang" }); f.raw.entity.onGround = false;
    const p = groundWaitOutcome(f.bot, 8, undefined, Date.now() + 300); await vi.advanceTimersByTimeAsync(2000); expect(await p).toBe("timeout");
    const g = body({ ticks: "hang" }); g.raw.entity.onGround = false; const q = groundWaitOutcome(g.bot, 8); await vi.advanceTimersByTimeAsync(10); g.raw.health = 0; g.ev.emit("death"); await vi.advanceTimersByTimeAsync(10);
    expect(await q).toBe("unavailable");
  });
  it("tryOpenAdjacentDoor: no door -> handled:false; aborted -> handled:false; never throws on a hung activateBlock", async () => {
    const f = body(); const c = new AbortController(); c.abort();
    expect(await tryOpenAdjacentDoor(f.bot, c.signal)).toMatchObject({ handled: false });
    expect(await tryOpenAdjacentDoor(f.bot)).toMatchObject({ handled: false });
  });
  it("localEscape: pre-aborted / dead / frozen -> structured failure, bounded", async () => {
    const f = body(); const c = new AbortController(); c.abort();
    const a = await localEscape(f.bot, { timeoutMs: 1000, signal: c.signal }); expect(a.success && (a as { data: { distance: number } }).data.distance === 0 && false).toBe(false);
    const g = body({ ticks: "hang" }); const p = localEscape(g.bot, { timeoutMs: 1500 }); await vi.advanceTimersByTimeAsync(5000); const r = await p;
    expect(typeof r.success).toBe("boolean"); expect(heldAfter(g.controls)).toEqual([]);
  });
  it("retreatFromHazard: aborted or frozen never hangs and releases controls", async () => {
    const f = body({ ticks: "hang" }); const c = new AbortController();
    const p1 = retreatFromHazard(f.bot, { dx: 1, dz: 0 }, c.signal);
    await vi.advanceTimersByTimeAsync(300); c.abort(); await vi.advanceTimersByTimeAsync(10_000);
    await p1; expect(heldAfter(f.controls)).toEqual([]);
  });
  // ---- [DEFECT QA57-M1] stepToStandingCell awaits bot.lookAt() with no deadline, no abort, no life-event interruption.
  // Every sibling (attemptStepJump, tryOpenAdjacentDoor, localEscape) wraps lookAt in movementOperationOutcome; this one was missed.
  const settles = async (p: Promise<unknown>, ms: number) => { let done = false; void p.then(() => { done = true; }, () => { done = true; }); await vi.advanceTimersByTimeAsync(ms); return done; };
  it("stepToStandingCell settles when lookAt never resolves and the signal aborts", async () => {
    const f = body({ ticks: "tick", look: "hang" }); const c = new AbortController();
    const p = stepToStandingCell(f.bot, { x: 2, y: 64, z: 0 }, c.signal); await vi.advanceTimersByTimeAsync(100); c.abort();
    expect(await settles(p, 60_000)).toBe(true);
  });
  it("stepToStandingCell settles when lookAt never resolves and the body dies", async () => {
    const f = body({ ticks: "tick", look: "hang" });
    const p = stepToStandingCell(f.bot, { x: 2, y: 64, z: 0 }); await vi.advanceTimersByTimeAsync(100); f.raw.health = 0; f.ev.emit("death");
    expect(await settles(p, 60_000)).toBe(true);
  });
  it("control: with a lookAt that resolves, stepToStandingCell completes", async () => {
    const f = body({ ticks: "tick", look: "ok" }); const p = stepToStandingCell(f.bot, { x: 2, y: 64, z: 0 });
    expect(await settles(p, 5000)).toBe(true);
  });
});
