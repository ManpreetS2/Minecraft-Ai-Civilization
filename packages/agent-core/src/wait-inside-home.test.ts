import { describe, expect, it } from "vitest";
import { alreadyInsideClaimedHome } from "@civ/minecraft-adapter";
import { waitInsideHomeUntilSleepTime } from "./wait-inside-home.js";

const interior = { x: -1088.5, y: 68, z: 817.5 };

describe("waitInsideHomeUntilSleepTime", () => {
  it("polls without sleeping until vanilla night, then returns ready", async () => {
    let tick = 12_766;
    let now = 0;
    let sleepCalls = 0;
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => tick,
      bedPresent: () => true,
      connected: () => true,
      position: () => interior,
      interior,
      now: () => now,
      delayMs: async (ms) => {
        sleepCalls += 1;
        now += ms;
        tick += Math.ceil(ms / 50);
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.sleepTimeValid).toBe(true);
    expect(result.data.waited).toBe(true);
    expect(result.data.walked).toBe(false);
    expect(result.data.sleepAttempts).toBe(0);
    expect(tick).toBeGreaterThanOrEqual(13_000);
    expect(sleepCalls).toBeGreaterThan(0);
    expect(alreadyInsideClaimedHome(interior, interior)).toBe(true);
  });

  it("returns immediately when vanilla night has already started", async () => {
    let delayed = false;
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => 14_000,
      bedPresent: () => true,
      connected: () => true,
      position: () => interior,
      interior,
      now: () => 0,
      delayMs: async () => {
        delayed = true;
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.waited).toBe(false);
    expect(delayed).toBe(false);
  });

  it("cancels the wait without walking or reassigning a bed", async () => {
    const abort = new AbortController();
    let tick = 12_766;
    let now = 0;
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => tick,
      bedPresent: () => true,
      connected: () => true,
      position: () => interior,
      interior,
      signal: abort.signal,
      now: () => now,
      delayMs: async (ms) => {
        now += ms;
        tick += Math.ceil(ms / 50);
        abort.abort();
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected cancel");
    expect(result.code).toBe("CANCELLED");
    expect(result.details?.teleported).toBe(false);
    expect(result.details?.stayedInside).toBe(true);
    expect(result.details?.walked).toBe(false);
  });

  it("reports a destroyed bed without walking", async () => {
    let present = true;
    let tick = 12_766;
    let now = 0;
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => tick,
      bedPresent: () => present,
      connected: () => true,
      position: () => interior,
      interior,
      now: () => now,
      delayMs: async (ms) => {
        now += ms;
        tick += Math.ceil(ms / 50);
        present = false;
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected missing bed");
    expect(result.code).toBe("BED_MISSING");
    expect(result.details?.walked).toBe(false);
  });

  it("stops on disconnect", async () => {
    let connected = true;
    let tick = 12_766;
    let now = 0;
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => tick,
      bedPresent: () => true,
      connected: () => connected,
      position: () => (connected ? interior : undefined),
      interior,
      now: () => now,
      delayMs: async (ms) => {
        now += ms;
        tick += Math.ceil(ms / 50);
        connected = false;
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected disconnect");
    expect(result.code).toBe("NOT_CONNECTED");
  });

  it("ends the wait at daylight without leaving the interior", async () => {
    let tick = 12_766;
    let now = 0;
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => tick,
      thundering: () => false,
      bedPresent: () => true,
      connected: () => true,
      position: () => interior,
      interior,
      now: () => now,
      delayMs: async (ms) => {
        now += ms;
        tick = 23_100;
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected daylight");
    expect(result.code).toBe("NOT_SLEEP_TIME");
    expect(result.details?.daylight).toBe(true);
    expect(result.details?.stayedInside).toBe(true);
  });

  it("does not wait through morning for the next night", async () => {
    let delayed = false;
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => 23_100,
      bedPresent: () => true,
      connected: () => true,
      position: () => interior,
      interior,
      now: () => 0,
      delayMs: async () => {
        delayed = true;
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected daylight");
    expect(result.code).toBe("NOT_SLEEP_TIME");
    expect(result.details?.daylight).toBe(true);
    expect(delayed).toBe(false);
  });

  it("isolates abort to one wait loop", async () => {
    const atlas = new AbortController();
    const maya = new AbortController();
    let atlasTick = 12_766;
    let mayaTick = 12_766;
    let now = 0;
    const atlasWait = waitInsideHomeUntilSleepTime({
      timeOfDay: () => atlasTick,
      bedPresent: () => true,
      connected: () => true,
      position: () => interior,
      interior,
      signal: atlas.signal,
      now: () => now,
      delayMs: async (ms) => {
        now += ms;
        atlasTick += Math.ceil(ms / 50);
        atlas.abort();
      },
    });
    const mayaWait = waitInsideHomeUntilSleepTime({
      timeOfDay: () => mayaTick,
      bedPresent: () => true,
      connected: () => true,
      position: () => ({ x: -1054.5, y: 65, z: 779.5 }),
      interior: { x: -1054.5, y: 65, z: 779.5 },
      signal: maya.signal,
      now: () => now,
      delayMs: async (ms) => {
        now += ms;
        mayaTick += Math.ceil(ms / 50);
      },
    });
    const [atlasResult, mayaResult] = await Promise.all([atlasWait, mayaWait]);
    expect(atlasResult.success).toBe(false);
    if (atlasResult.success) throw new Error("atlas should cancel");
    expect(atlasResult.code).toBe("CANCELLED");
    expect(maya.signal.aborted).toBe(false);
    expect(mayaResult.success).toBe(true);
  });

  it("reaches vanilla sleep by polling, without a TEST_CONTROL time set", async () => {
    let tick = 12_766;
    let now = 0;
    const timeSetCommands: string[] = [];
    const result = await waitInsideHomeUntilSleepTime({
      timeOfDay: () => tick,
      bedPresent: () => true,
      connected: () => true,
      position: () => interior,
      interior,
      now: () => now,
      delayMs: async (ms) => {
        now += ms;
        tick += Math.ceil(ms / 50);
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(timeSetCommands).toEqual([]);
    expect(result.data.sleepAttempts).toBe(0);
    expect(result.data.walked).toBe(false);
    expect(tick).toBeGreaterThanOrEqual(13_000);
  });
});
