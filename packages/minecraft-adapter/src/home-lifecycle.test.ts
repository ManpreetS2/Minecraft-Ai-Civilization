import { EventEmitter, getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { fail, ok, type ActionResult } from "@civ/shared";
const nav = vi.hoisted(() => ({ move: vi.fn() }));
vi.mock("./navigation.js", () => ({ navigationBackend: () => ({ navigateToPosition: nav.move }) }));
import { enterClaimedHouse } from "./enter-home.js";
import { executeReturnHome } from "./return-home-nav.js";
const home = { x: 10.5, y: 64, z: 0.5 };
function fixture(frozen = false) {
  const controls: Record<string, boolean> = {};
  const bot = Object.assign(new EventEmitter(), {
    username: "HomeLifecycle", health: 20,
    entity: { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true, yaw: 0, pitch: 0 },
    blockAt: () => ({ name: "air", boundingBox: "empty" }), supportFeature: () => false,
    waitForTicks: () => frozen ? new Promise<void>(() => undefined) : Promise.resolve(),
    setControlState: (key: string, value: boolean) => { controls[key] = value; },
    clearControlStates: () => { for (const key of Object.keys(controls)) controls[key] = false; },
  });
  return { raw: bot, bot: bot as unknown as Bot, controls };
}
const actions = [
  { name: "enter", run: (bot: Bot, timeoutMs: number, signal?: AbortSignal) => enterClaimedHouse(bot, { interior: home, timeoutMs, signal }) },
  { name: "return", run: (bot: Bot, timeoutMs: number, signal?: AbortSignal) => executeReturnHome(bot, { home, timeoutMs, signal }) },
];
async function expectSettled(pending: Promise<ActionResult<unknown>>, code: string, controls: Record<string, boolean>, elapsed = 150) {
  let settled = false;
  void pending.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(elapsed);
  expect(settled).toBe(true);
  const result = await pending;
  if (result.success) throw new Error("interrupted home action succeeded");
  expect(result.code).toBe(code);
  expect(Object.values(controls).some(Boolean)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
}
describe("whole home-action lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); nav.move.mockReset(); nav.move.mockImplementation(() => new Promise(() => undefined)); });
  afterEach(async () => { await vi.advanceTimersByTimeAsync(30_000); vi.useRealTimers(); });
  it.each(actions)("$name bounds frozen phases by the whole action timeout", async action => {
    const f = fixture(true);
    await expectSettled(action.run(f.bot, 1000), "TIMEOUT", f.controls, 1050);
  });
  it.each(actions)("$name invalidates the old life during a frozen phase", async action => {
    const f = fixture(true);
    const pending = action.run(f.bot, 10000);
    f.raw.emit("respawn");
    await expectSettled(pending, "NOT_CONNECTED", f.controls);
  });
  it.each(actions)("$name settles cancellation even if the backend never settles", async action => {
    const f = fixture();
    const controller = new AbortController();
    const pending = action.run(f.bot, 10000, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.move).toHaveBeenCalledOnce();
    controller.abort();
    await expectSettled(pending, "CANCELLED", f.controls);
  });
  it.each(actions)("$name removes its deadline and abort listener on success", async action => {
    const f = fixture();
    const controller = new AbortController();
    nav.move.mockImplementation(async () => {
      Object.assign(f.raw.entity.position, home);
      return ok({ position: home, distance: 0 }, 1);
    });
    expect((await action.run(f.bot, 1000, controller.signal)).success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it("does not issue another furniture bypass after a cancelled backend settles late", async () => {
    const f = fixture();
    let finish!: (result: ActionResult<{ position: typeof home; distance: number }>) => void;
    nav.move.mockResolvedValueOnce(fail("PATH_BLOCKED", "obstacle=crafting_table", 1, false));
    nav.move.mockImplementationOnce(() => new Promise<ActionResult<{ position: typeof home; distance: number }>>(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = executeReturnHome(f.bot, { home, timeoutMs: 10000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.move).toHaveBeenCalledTimes(2);
    controller.abort();
    await expectSettled(pending, "CANCELLED", f.controls);
    finish(fail("PATH_BLOCKED", "late bypass failure", 1, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.move).toHaveBeenCalledTimes(2);
  });

});
