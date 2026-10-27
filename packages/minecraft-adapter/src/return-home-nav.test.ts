import { afterEach, describe, expect, it } from "vitest";
import { fail, ok } from "@civ/shared";
import {
  createNavigationBackend,
  evaluateReturnHome,
  executeReturnHome,
  setNavigationBackend,
  type NavigationBackend,
} from "./index.js";
import type { Bot } from "mineflayer";

const pond = { x: -1043, y: 63, z: 980 };
const h7 = { x: -1088.5, y: 68, z: 817.5 };
const h4 = { x: -1054.5, y: 65, z: 779.5 };

function fakeBot(position: { x: number; y: number; z: number }, timeOfDay = 11_990): Bot {
  return {
    entity: { position: { ...position }, yaw: 0, pitch: 0, onGround: true },
    time: { timeOfDay, age: timeOfDay },
  } as unknown as Bot;
}

function stubNav(options: {
  failCode?: "PATH_BLOCKED" | "HAZARD_BLOCKED";
  retryable?: boolean;
  moveOnFail?: boolean;
}): NavigationBackend {
  return {
    name: "test-nav",
    navigateToPosition: (bot, target) => {
      if (options.failCode) {
        if (options.moveOnFail && bot.entity?.position) {
          bot.entity.position.x += 2;
        }
        return Promise.resolve(fail(options.failCode, `${options.failCode} on long return`, 40, options.retryable ?? true));
      }
      if (bot.entity?.position) {
        bot.entity.position.x = Math.floor(target.x) + 0.5;
        bot.entity.position.y = target.y;
        bot.entity.position.z = Math.floor(target.z) + 0.5;
      }
      return Promise.resolve(ok({ position: { ...bot.entity!.position }, distance: 1 }, 8));
    },
    navigateNear: (bot, target) => Promise.resolve(ok({ position: target, distance: 1 }, 1)),
    navigateToInteractWithBlock: (bot, block) => Promise.resolve(ok({ position: block, distance: 1 }, 1)),
    navigateToPlaceBlock: (bot, target) => Promise.resolve(ok({ position: target, distance: 1 }, 1)),
    followEntity: async () => ok({ username: "x", position: pond }, 1),
    escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };
}

describe("executeReturnHome long routes and truthful failure", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("treats a pond-to-home ETA as a straight-line estimate, not a guaranteed path", () => {
    const plan = evaluateReturnHome({ position: pond, home: h7, timeOfDay: 11_990 });
    expect(plan.distanceBlocks).toBeGreaterThan(150);
    expect(plan.shouldStopOptionalWork).toBe(true);
    expect(plan.routeGuaranteed).toBe(false);
    expect(plan.etaKind).toBe("straight_line_plus_recovery_buffer");
  });

  it("does not report arrival or completed work when the long route is HAZARD_BLOCKED", async () => {
    const bot = fakeBot(pond);
    setNavigationBackend(stubNav({ failCode: "HAZARD_BLOCKED", retryable: false }));
    const result = await executeReturnHome(bot, { home: h7, bed: { x: -1089, y: 68, z: 817 } });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected hazard");
    expect(result.code).toBe("HAZARD_BLOCKED");
    expect(result.details?.arrived).toBe(false);
    expect(result.details?.teleported).toBe(false);
    expect(result.details?.workComplete).toBe(false);
    expect(bot.entity?.position).toEqual(pond);
  });

  it("does not teleport a disconnected body home", async () => {
    const bot = { time: { timeOfDay: 11_990 } } as unknown as Bot;
    const result = await executeReturnHome(bot, { home: h7 });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected disconnect");
    expect(result.code).toBe("NOT_CONNECTED");
  });

  it("isolates cancellation to one returning citizen", async () => {
    const atlas = new AbortController();
    const maya = new AbortController();
    atlas.abort();
    setNavigationBackend(stubNav({}));
    const atlasBot = fakeBot(pond);
    const mayaBot = fakeBot({ x: -1043, y: 63, z: 980 });
    const atlasResult = await executeReturnHome(atlasBot, { home: h7, signal: atlas.signal });
    const mayaResult = await executeReturnHome(mayaBot, { home: h4, signal: maya.signal });
    expect(atlasResult.success).toBe(false);
    if (atlasResult.success) throw new Error("atlas should cancel");
    expect(atlasResult.code).toBe("CANCELLED");
    expect(maya.signal.aborted).toBe(false);
    expect(mayaResult.success).toBe(true);
    if (!mayaResult.success) throw new Error(mayaResult.error);
    expect(mayaResult.data.home).toEqual(h4);
    expect(mayaResult.data.home).not.toEqual(h7);
  });

  it("retries a retryable PATH_BLOCKED once after real progress, still without claiming arrival", async () => {
    const bot = fakeBot(pond);
    let calls = 0;
    const inner = stubNav({ failCode: "PATH_BLOCKED", retryable: true, moveOnFail: true });
    setNavigationBackend({
      ...inner,
      navigateToPosition: (current, target, options) => {
        calls += 1;
        return inner.navigateToPosition(current, target, options);
      },
    });
    const result = await executeReturnHome(bot, { home: h7, bed: { x: -1089, y: 68, z: 817 } });
    expect(calls).toBe(2);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected path blocked");
    expect(result.code).toBe("PATH_BLOCKED");
    expect(result.details?.arrived).toBe(false);
    expect(result.details?.teleported).toBe(false);
    expect(result.details?.workComplete).toBe(false);
  });

  it("counts already being inside the claimed home as arrival without a teleport", async () => {
    const bot = fakeBot(h7);
    let calls = 0;
    const inner = stubNav({});
    setNavigationBackend({
      ...inner,
      navigateToPosition: (current, target, options) => {
        calls += 1;
        return inner.navigateToPosition(current, target, options);
      },
    });
    const result = await executeReturnHome(bot, { home: h7, bed: { x: -1089, y: 68, z: 817 } });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(calls).toBe(0);
    expect(result.data.arrival.position).toEqual(h7);
    expect(result.data.departure.position).toEqual(h7);
    expect(bot.entity?.position).toEqual(h7);
  });
});
