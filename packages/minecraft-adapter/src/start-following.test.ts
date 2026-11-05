import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
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
import { startFollowing } from "./pathing.js";

function fixture() {
  const target = { id: 42, username: "Other", position: { x: 20, y: 64, z: 0.5 }, health: 20, isValid: true };
  const pathfinder = { setMovements: vi.fn(), setGoal: vi.fn(), stop: vi.fn() };
  const bot = Object.assign(new EventEmitter(), {
    username: "follow-start-fixture", health: 20,
    entity: { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true },
    registry: { itemsByName: {}, blocksByName: {} }, inventory: { items: () => [] },
    pathfinder, loadPlugin: vi.fn(), supportFeature: (): boolean => false,
    clearControlStates: vi.fn(), setControlState: vi.fn(),
    players: { Other: { entity: target } }, entities: { 42: target },
    blockAt: () => ({ name: "air", boundingBox: "empty" }),
  });
  return { bot, pathfinder, target };
}

describe("startFollowing admission", () => {
  it("starts a dynamic follow goal for a live body", () => {
    const f = fixture();
    expect(startFollowing(f.bot as unknown as Bot, "Other").success).toBe(true);
    expect(f.pathfinder.setGoal).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["dead body", (f: ReturnType<typeof fixture>) => { f.bot.health = 0; }],
    ["ended client", (f: ReturnType<typeof fixture>) => { Object.assign(f.bot, { _client: { ended: true, state: "play" } }); }],
    ["missing body entity", (f: ReturnType<typeof fixture>) => { (f.bot as { entity?: unknown }).entity = undefined; }],
    ["non-finite body position", (f: ReturnType<typeof fixture>) => { f.bot.entity.position.x = Number.NaN; }],
    ["despawned target", (f: ReturnType<typeof fixture>) => { f.target.isValid = false; delete (f.bot.entities as Record<number, unknown>)[42]; }],
  ])("refuses without arming the pathfinder: %s", (_name, mutate) => {
    const f = fixture();
    mutate(f);
    const result = startFollowing(f.bot as unknown as Bot, "Other");
    expect(result.success).toBe(false);
    expect(f.pathfinder.setGoal).not.toHaveBeenCalled();
  });
  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])("refuses invalid range %s", range => {
    const f = fixture();
    const result = startFollowing(f.bot as unknown as Bot, "Other", range);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("INVALID_ARGUMENT");
    expect(f.pathfinder.setGoal).not.toHaveBeenCalled();
  });
});
