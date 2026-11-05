import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";

const path = vi.hoisted(() => ({ move: vi.fn(), look: vi.fn(), get: vi.fn(), cells: [] as Array<{ x: number; y: number; z: number }> }));
vi.mock("./pathing.js", () => ({ moveToPosition: path.move, moveToLookAtBlock: path.look, moveToGetToBlock: path.get, followPlayer: vi.fn() }));
vi.mock("./interaction.js", async (original) => ({
  ...await original<typeof import("./interaction.js")>(),
  rankedInteractionPositions: () => path.cells,
  findReachablePlacementPosition: () => path.cells[0],
}));
import { MineflayerPathfinderBackend } from "./navigation.js";
import { blockInteractDistance } from "./interaction.js";

describe("interaction arrival verification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    path.cells = [{ x: 1.5, y: 64, z: 0.5 }];
    const waypoint = ok({ position: { x: 1.5, y: 64, z: 0.5 }, distance: 0 }, 1);
    path.move.mockResolvedValue(waypoint);
    path.look.mockResolvedValue(waypoint);
    path.get.mockResolvedValue(waypoint);
  });
  const target = { x: 0, y: 64, z: 0 };
  function botAt(y: number): Bot {
    return { username: "arrival-fixture", entity: { position: { x: 2.5, y, z: 0.5 }, eyeHeight: 1.62 } } as unknown as Bot;
  }
  it("does not turn standing-cell success into interaction success outside eye reach", async () => {
    const bot = botAt(55);
    const result = await new MineflayerPathfinderBackend().navigateToInteractWithBlock(bot, target);
    expect(result.success).toBe(false);
    expect(blockInteractDistance(bot, target)).toBeGreaterThan(4.5);
  });
  it("verifies the final get-to-block fallback even when horizontal distance is close", async () => {
    path.cells = [];
    const result = await new MineflayerPathfinderBackend().navigateToInteractWithBlock(botAt(55), target);
    expect(path.get).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
  });
  it("reports actual block distance and position after arriving, rather than waypoint metadata", async () => {
    const bot = botAt(55);
    path.move.mockImplementation(async () => {
      bot.entity.position.y = 64;
      return ok({ position: { x: 99, y: 99, z: 99 }, distance: 0 }, 5);
    });
    const result = await new MineflayerPathfinderBackend().navigateToInteractWithBlock(bot, target);
    if (!result.success) throw new Error(result.error);
    expect(result.data.position).toEqual({ x: 2.5, y: 64, z: 0.5 });
    expect(result.data.distance).toBe(blockInteractDistance(bot, target));
  });
  it("honors cancellation even when already within reach", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new MineflayerPathfinderBackend().navigateToInteractWithBlock(botAt(64), target, { signal: controller.signal });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("cancelled interaction arrived");
    expect(result.code).toBe("CANCELLED");
    expect(path.move).not.toHaveBeenCalled();
  });
  it("does not replace a cancelled movement with reach success", async () => {
    const controller = new AbortController();
    const bot = botAt(55);
    path.move.mockImplementation(async () => {
      bot.entity.position.y = 64;
      controller.abort();
      return ok({ position: bot.entity.position, distance: 0 }, 5);
    });
    const result = await new MineflayerPathfinderBackend().navigateToInteractWithBlock(bot, target, { signal: controller.signal });
    expect(result.success).toBe(false);
  });
  it("clears both the path goal and movement controls on stop", () => {
    const bot = Object.assign(botAt(64), { pathfinder: { stop: vi.fn(), setGoal: vi.fn() }, clearControlStates: vi.fn() });
    new MineflayerPathfinderBackend().stop(bot);
    expect(bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
    expect(bot.clearControlStates).toHaveBeenCalled();
  });
  it.each([
    { health: 0 },
    { _client: { state: "configuration" } },
    { _client: { state: "play", ended: true } },
  ])("never reports arrival for an unavailable body: %j", async (state) => {
    const bot = Object.assign(botAt(64), state);
    const result = await new MineflayerPathfinderBackend().navigateToInteractWithBlock(bot, target);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unavailable body arrived");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(path.move).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity])("refuses a non-finite body coordinate %s without starting movement", async (x) => {
    const bot = botAt(64);
    bot.entity.position.x = x;
    const result = await new MineflayerPathfinderBackend().navigateToInteractWithBlock(bot, target);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("invalid body arrived");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(path.move).not.toHaveBeenCalled();
  });
  it("does not report placement arrival outside actual block reach", async () => {
    const result = await new MineflayerPathfinderBackend().navigateToPlaceBlock(botAt(55), target);
    if (result.success) throw new Error("unreachable placement reported success");
    expect(result.code).toBe("VERIFY_FAILED");
  });
  it("reports observed placement reach rather than waypoint metadata", async () => {
    const bot = botAt(55);
    path.move.mockImplementation(async () => {
      bot.entity.position.y = 64;
      return ok({ position: { x: 99, y: 99, z: 99 }, distance: 0 }, 5);
    });
    const result = await new MineflayerPathfinderBackend().navigateToPlaceBlock(bot, target);
    if (!result.success) throw new Error(result.error);
    expect(result.data.position).toEqual({ x: 2.5, y: 64, z: 0.5 });
    expect(result.data.distance).toBe(blockInteractDistance(bot, target));
  });
  it("does not report cancelled placement movement as success", async () => {
    const controller = new AbortController();
    path.move.mockImplementation(async () => {
      controller.abort();
      return ok({ position: target, distance: 0 }, 1);
    });
    const result = await new MineflayerPathfinderBackend().navigateToPlaceBlock(botAt(64), target, { signal: controller.signal });
    if (result.success) throw new Error("cancelled placement succeeded");
    expect(result.code).toBe("CANCELLED");
  });
  it("refuses pre-cancelled placement without invoking movement", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new MineflayerPathfinderBackend().navigateToPlaceBlock(botAt(64), target, { signal: controller.signal });
    if (result.success) throw new Error("cancelled placement succeeded");
    expect(result.code).toBe("CANCELLED");
    expect(path.move).not.toHaveBeenCalled();
  });
  it("refuses placement navigation for a retained dead body", async () => {
    const result = await new MineflayerPathfinderBackend().navigateToPlaceBlock(Object.assign(botAt(64), { health: 0 }), target);
    if (result.success) throw new Error("dead placement succeeded");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(path.move).not.toHaveBeenCalled();
  });
  it("validates the placement target before waypoint selection", async () => {
    const result = await new MineflayerPathfinderBackend().navigateToPlaceBlock(botAt(64), { ...target, x: NaN });
    if (result.success) throw new Error("invalid placement succeeded");
    expect(result.code).toBe("INVALID_ARGUMENT");
    expect(path.move).not.toHaveBeenCalled();
  });

});
