import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vec3 as Vec3Class } from "vec3";
import type { Bot } from "mineflayer";
import { installModernMovement } from "./movement-sync.js";
import { waitForMovementTicks } from "./movement-wait.js";
import { stepToStandingCell } from "./obstacle-detour.js";
import { attemptStepJump, tryOpenAdjacentDoor, walkForward } from "./step-jump.js";
import { retreatFromHazard } from "./hazard-nav.js";
import { localEscape } from "./local-escape.js";

function fixture(pit = false) {
  const events = new EventEmitter();
  const controls: Record<string, boolean> = {};
  const bot = Object.assign(events, {
    username: "recovery-wait", health: 20, food: 20,
    entity: { position: { x: 5.5, y: 64, z: 5.5 }, onGround: true, yaw: 0, pitch: 0 },
    supportFeature: () => false,
    setControlState: (name: string, value: boolean) => { controls[name] = value; },
    getControlState: (name: string) => Boolean(controls[name]),
    clearControlStates: () => { for (const name of Object.keys(controls)) controls[name] = false; },
    waitForTicks: () => new Promise<void>(() => undefined),
    look: async () => undefined, lookAt: async () => undefined,
    blockAt: (p: { x: number; y: number; z: number }) => {
      const solid = p.y < 64 || pit && p.y === 64 && (Math.floor(p.x) !== 5 || Math.floor(p.z) !== 5);
      return { name: solid ? "stone" : "air", boundingBox: solid ? "block" : "empty" };
    },
  });
  return { bot: bot as unknown as Bot, raw: bot, controls, events };
}
describe("recovery with a frozen physics loop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("cancels a walking recovery and releases held movement", async () => {
    const f = fixture();
    const controller = new AbortController();
    let settled = false;
    const request = walkForward(f.bot, 8, controller.signal);
    void request.then(() => { settled = true; });
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    expect(await request).toBeUndefined();
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });
  it("bounds a frozen walking recovery even without cancellation", async () => {
    const f = fixture();
    let settled = false;
    const request = walkForward(f.bot, 8);
    void request.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1500);
    expect(settled).toBe(true);
    expect(await request).toBeUndefined();
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });
  it("cancels hazard retreat without leaving back held", async () => {
    const f = fixture();
    const controller = new AbortController();
    let settled = false;
    const request = retreatFromHazard(f.bot, { dx: 1, dz: 0 }, controller.signal);
    void request.then(() => { settled = true; });
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    const result = await request;
    if (result.success) throw new Error("cancelled retreat succeeded");
    expect(result.code).toBe("CANCELLED");
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });
  it("cancels local escape while waiting for its initial physics ticks", async () => {
    const f = fixture(true);
    const controller = new AbortController();
    let settled = false;
    const request = localEscape(f.bot, { signal: controller.signal });
    void request.then(() => { settled = true; });
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    const result = await request;
    if (result.success) throw new Error("cancelled escape succeeded");
    expect(result.code).toBe("CANCELLED");
  });
  it.each(["end", "kicked", "death", "respawn"])("interrupts walking on %s and removes temporary listeners", async (event) => {
    const f = fixture();
    installModernMovement(f.bot);
    const baseline = Object.fromEntries(["end", "kicked", "death", "respawn"].map(name => [name, f.events.listenerCount(name)]));
    const first = walkForward(f.bot, 1);
    f.events.emit(event);
    expect(await first).toBeUndefined();
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    for (const name of Object.keys(baseline)) expect(f.events.listenerCount(name)).toBe(event === "end" || event === "kicked" ? 0 : baseline[name]);
  });
  it("removes its own timer and listeners after completed ticks", async () => {
    const f = fixture();
    f.bot.waitForTicks = async () => undefined;
    expect(await waitForMovementTicks(f.bot, 2)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    for (const event of ["end", "kicked", "death", "respawn"]) expect(f.events.listenerCount(event)).toBe(0);
  });
  it("observes late physics rejection after cancellation", async () => {
    const f = fixture();
    let rejectTicks!: (error: Error) => void;
    f.bot.waitForTicks = () => new Promise<void>((_, reject) => { rejectTicks = reject; });
    const controller = new AbortController();
    const pending = waitForMovementTicks(f.bot, 2, controller.signal);
    controller.abort();
    expect(await pending).toBe(false);
    rejectTicks(new Error("physics stopped"));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors the overall escape deadline while physics is frozen", async () => {
    const f = fixture(true);
    const pending = localEscape(f.bot, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    if (result.success) throw new Error("frozen escape succeeded");
    expect(result.code).toBe("TIMEOUT");
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });

  it("cancels a step jump while lookAt remains pending", async () => {
    const f = fixture();
    let finishLook!: () => void;
    f.bot.lookAt = () => new Promise<void>(resolve => { finishLook = resolve; });
    const controller = new AbortController();
    let settled = false;
    const pending = attemptStepJump(f.bot, { x: 6, y: 65, z: 5 }, controller.signal);
    void pending.then(() => { settled = true; });
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({ hopped: false, landed: false });
    finishLook();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });
  it("cancels local escape while its look promise remains pending", async () => {
    const f = fixture(true);
    f.bot.waitForTicks = async () => undefined;
    f.bot.look = () => new Promise<void>(() => undefined);
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    const controller = new AbortController();
    let settled = false;
    const pending = localEscape(f.bot, { signal: controller.signal });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    const result = await pending;
    if (result.success) throw new Error("cancelled look succeeded");
    expect(result.code).toBe("CANCELLED");
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
  });

  it("bounds an unresponsive look even without cancellation", async () => {
    const f = fixture();
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    const pending = attemptStepJump(f.bot, { x: 6, y: 65, z: 5 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ hopped: false, landed: false });
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("includes local escape looking in its overall deadline", async () => {
    const f = fixture(true);
    f.bot.waitForTicks = async () => undefined;
    f.bot.look = () => new Promise<void>(() => undefined);
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    const pending = localEscape(f.bot, { timeoutMs: 600 });
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    if (result.success) throw new Error("frozen look succeeded");
    expect(result.code).toBe("TIMEOUT");
    expect(Object.values(f.controls).some(Boolean)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a fallback look after escape cancellation", async () => {
    const f = fixture(true);
    f.bot.waitForTicks = async () => undefined;
    let rejectLook!: (error: Error) => void;
    f.bot.look = () => new Promise<void>((_, reject) => { rejectLook = reject; });
    const fallback = vi.fn(async () => undefined);
    f.bot.lookAt = fallback;
    const controller = new AbortController();
    const pending = localEscape(f.bot, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    const result = await pending;
    if (result.success) throw new Error("cancelled escape succeeded");
    rejectLook(new Error("late look failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(["look", "activation"])("cancels door recovery during pending %s", async phase => {
    const f = fixture();
    const original = f.raw.blockAt;
    f.raw.blockAt = p => Math.floor(p.x) === 6 && Math.floor(p.y) === 64 && Math.floor(p.z) === 5
      ? { ...original(p), name: "oak_door", position: new Vec3Class(6, 64, 5), getProperties: () => ({ open: false }) }
      : original(p);
    let finish!: () => void;
    const pendingOperation = () => new Promise<void>(resolve => { finish = resolve; });
    const activate = vi.fn(phase === "activation" ? pendingOperation : async () => undefined);
    Object.assign(f.raw, { activateBlock: activate });
    if (phase === "look") f.bot.lookAt = pendingOperation;
    const controller = new AbortController();
    let settled = false;
    const pending = tryOpenAdjacentDoor(f.bot, controller.signal);
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(activate).toHaveBeenCalledTimes(phase === "activation" ? 1 : 0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    expect((await pending).handled).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(activate).toHaveBeenCalledTimes(phase === "activation" ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a hanging detour lookAt when the caller aborts", async () => {
    const f = fixture();
    let finishLook!: () => void;
    f.bot.lookAt = () => new Promise<void>(resolve => { finishLook = resolve; });
    const controller = new AbortController();
    let settled = false;
    const pending = stepToStandingCell(f.bot, { x: 6, y: 64, z: 5 }, controller.signal);
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({ moved: false });
    finishLook();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.controls.forward).not.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ends a hanging detour lookAt when the movement deadline expires", async () => {
    const f = fixture();
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    const pending = stepToStandingCell(f.bot, { x: 6, y: 64, z: 5 }, undefined, { deadline: Date.now() + 400 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ moved: false });
    expect(f.controls.forward).not.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ends a hanging detour lookAt when the body dies", async () => {
    const f = fixture();
    f.bot.lookAt = () => new Promise<void>(() => undefined);
    let settled = false;
    const pending = stepToStandingCell(f.bot, { x: 6, y: 64, z: 5 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(40);
    f.raw.health = 0;
    f.events.emit("death");
    await vi.advanceTimersByTimeAsync(40);
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({ moved: false });
    expect(f.controls.forward).not.toBe(true);
  });

});
