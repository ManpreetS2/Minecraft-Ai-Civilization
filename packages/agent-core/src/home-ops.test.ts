import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fail, ok } from "@civ/shared";
import {
  createNavigationBackend,
  setNavigationBackend,
  type NavigationBackend,
} from "@civ/minecraft-adapter";
import { CivilizationStore } from "./store.js";
import { claimHome } from "./homes.js";
import { executeSleepAtHome } from "./home-ops.js";
import type { SkillContext } from "@civ/skills";

const h7 = {
  origin: { x: -1089, y: 68, z: 817 },
  entrance: { x: -1086, y: 68, z: 816 },
  bed: { x: -1089, y: 68, z: 817 },
  chest: { x: -1088, y: 68, z: 815 },
};
const h4 = {
  origin: { x: -1055, y: 65, z: 779 },
  entrance: { x: -1054, y: 65, z: 780 },
  bed: { x: -1055, y: 65, z: 779 },
  chest: { x: -1056, y: 65, z: 778 },
};
const work = { x: -1082.5, y: 68, z: 799.5 };

function tempStore(): CivilizationStore {
  return new CivilizationStore(join(mkdtempSync(join(tmpdir(), "civ-curfew-")), "homes.sqlite"));
}

function stubNav(bot: SkillContext["bot"], options: { failCode?: "PATH_BLOCKED" | "HAZARD_BLOCKED" } = {}): {
  backend: NavigationBackend;
  destinations: Array<{ x: number; y: number; z: number }>;
} {
  const destinations: Array<{ x: number; y: number; z: number }> = [];
  const done = (target: { x: number; y: number; z: number }) => {
    destinations.push(target);
    if (options.failCode) {
      return Promise.resolve(fail(options.failCode, `${options.failCode} on route`, 12, true));
    }
    const entity = bot.entity;
    if (entity?.position) {
      entity.position.x = Math.floor(target.x) + 0.5;
      entity.position.y = target.y;
      entity.position.z = Math.floor(target.z) + 0.5;
    }
    return Promise.resolve(ok({ position: { ...entity!.position }, distance: 1 }, 8));
  };
  return {
    destinations,
    backend: {
      name: "test-nav",
      navigateToPosition: (_bot, target) => done(target),
      navigateNear: (_bot, target) => done(target),
      navigateToInteractWithBlock: (_bot, block) => done(block),
      navigateToPlaceBlock: (_bot, target) => done(target),
      followEntity: async () => ok({ username: "x", position: work }, 1),
      escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
      probeReachability: () => ({ reachable: true, cost: 1 }),
      stop: () => undefined,
    },
  };
}

function fakeBedtimeCtx(input: {
  citizenId: string;
  position: { x: number; y: number; z: number };
  timeOfDay: number;
  beds: Record<string, string>;
  missingBed?: boolean;
  occupiedBed?: boolean;
  signal?: AbortSignal;
}): {
  ctx: SkillContext;
  slept: Array<{ name: string; position: { x: number; y: number; z: number } }>;
  activated: string[];
  inventory: Record<string, number>;
  bot: { time: { timeOfDay: number }; entity?: { position: { x: number; y: number; z: number }; yaw: number; pitch: number; onGround: boolean } };
  removeBed: () => void;
  disconnect: () => void;
} {
  const slept: Array<{ name: string; position: { x: number; y: number; z: number } }> = [];
  const activated: string[] = [];
  const inventory = { bread: 3, cobblestone: 8 };
  const position = { ...input.position };
  const bot: {
    time: { timeOfDay: number };
    isRaining: boolean;
    isSleeping: boolean;
    thunderState: number;
    entity?: { position: { x: number; y: number; z: number }; yaw: number; pitch: number; onGround: boolean };
    inventory: { items: () => Array<{ name: string; count: number }> };
    blockAt: (pos: { x: number; y: number; z: number }) => unknown;
    lookAt: () => Promise<void>;
    waitForTicks: () => Promise<void>;
    activateBlock: () => Promise<void>;
    sleep: (block: { name: string; position: { x: number; y: number; z: number } }) => Promise<void>;
    wake: () => Promise<void>;
  } = {
    time: { timeOfDay: input.timeOfDay },
    isRaining: false,
    isSleeping: false,
    thunderState: 0,
    entity: { position, yaw: 0, pitch: 0, onGround: true },
    inventory: {
      items: () => Object.entries(inventory).map(([name, count]) => ({ name, count })),
    },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      if (input.missingBed && (input.beds[key] || key === `${h7.bed.x},${h7.bed.y},${h7.bed.z}` || key === `${h4.bed.x},${h4.bed.y},${h4.bed.z}`)) {
        return { name: "air", position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
      }
      const bed = input.beds[key];
      if (bed) return { name: bed, position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
      if (Math.floor(pos.z) === h7.entrance.z || Math.floor(pos.z) === h4.entrance.z) {
        return {
          name: "oak_door",
          position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), offset: (x: number, y: number, z: number) => ({ x: Math.floor(pos.x) + x, y: Math.floor(pos.y) + y, z: Math.floor(pos.z) + z }) },
          getProperties: () => ({ open: true }),
        };
      }
      return { name: "air", position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
    },
    lookAt: async () => undefined,
    waitForTicks: async () => undefined,
    activateBlock: async () => {
      activated.push("door");
    },
    async sleep(block: { name: string; position: { x: number; y: number; z: number } }) {
      if (input.occupiedBed) {
        throw new Error("bed is occupied");
      }
      slept.push({ name: block.name, position: block.position });
      this.isSleeping = true;
    },
    async wake() {
      this.isSleeping = false;
    },
  };
  const ctx = {
    citizenId: input.citizenId,
    timeoutMs: 20_000,
    signal: input.signal,
    bot: bot as unknown as SkillContext["bot"],
    body: {
      position: () => (bot.entity ? { ...bot.entity.position } : undefined),
      nearbyEntities: () => [],
    },
  } as unknown as SkillContext;
  return {
    ctx,
    slept,
    activated,
    inventory,
    bot,
    removeBed: () => {
      input.missingBed = true;
    },
    disconnect: () => {
      bot.entity = undefined;
    },
  };
}

function fakeClock(bot: { time: { timeOfDay: number } }): {
  now: () => number;
  delayMs: (ms: number) => Promise<void>;
} {
  let now = 0;
  return {
    now: () => now,
    delayMs: async (ms: number) => {
      now += ms;
      bot.time.timeOfDay += Math.ceil(ms / 50);
    },
  };
}

describe("executeSleepAtHome claimed-home bedtime", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("walks from work, enters the claimed house, and sleeps in that citizen's bed", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_h4",
      origin: h4.origin,
      entrance: h4.entrance,
      bed: h4.bed,
      personalChest: h4.chest,
      storageAccess: "personal",
    });
    const { ctx, slept, activated, inventory } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: work,
      timeOfDay: 14_000,
      beds: {
        [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed",
        [`${h4.bed.x},${h4.bed.y},${h4.bed.z}`]: "white_bed",
      },
    });
    const { backend, destinations } = stubNav(ctx.bot);
    setNavigationBackend(backend);
    const result = await executeSleepAtHome(ctx, store);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const data = result.data as {
      homeId: string;
      sleptInOwnBed: boolean;
      enteredInterior: boolean;
      teleported: boolean;
    };
    expect(data.homeId).toBe("home_h7");
    expect(data.sleptInOwnBed).toBe(true);
    expect(data.enteredInterior).toBe(true);
    expect(data.teleported).toBe(false);
    expect(slept[0]?.position).toEqual(h7.bed);
    expect(slept[0]?.position).not.toEqual({ x: -1097, y: 69, z: 728 });
    expect(destinations.some((dest) => Math.floor(dest.x) === h7.origin.x && Math.floor(dest.z) === h7.origin.z)).toBe(true);
    expect(activated).toEqual([]);
    expect(inventory).toEqual({ bread: 3, cobblestone: 8 });
    store.close();
  });

  it("returns PATH_BLOCKED from the work site instead of teleporting home", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const { ctx, slept } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: work,
      timeOfDay: 14_000,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
    });
    const { backend } = stubNav(ctx.bot, { failCode: "PATH_BLOCKED" });
    setNavigationBackend(backend);
    const result = await executeSleepAtHome(ctx, store);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected path failure");
    expect(result.code).toBe("PATH_BLOCKED");
    expect(result.details?.teleported).toBe(false);
    expect(result.details?.workComplete).toBe(false);
    expect(result.details?.sleptInOwnBed).toBe(false);
    expect(result.details?.arrived).toBe(false);
    expect(ctx.body.position()).toEqual(work);
    expect(slept).toEqual([]);
    store.close();
  });

  it("marks a missing designated bed without reassigning the home", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const { ctx, slept } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: { x: -1088.5, y: 68, z: 817.5 },
      timeOfDay: 14_000,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
      missingBed: true,
    });
    const result = await executeSleepAtHome(ctx, store);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected missing bed");
    expect(result.code).toBe("BED_MISSING");
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h7");
    expect(store.getCitizenHome("citizen_atlas")?.status).toBe("displaced");
    expect(slept).toEqual([]);
    store.close();
  });

  it("skips extra interior navigation when already inside so it does not walk back out the door", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const inside = { x: h7.origin.x + 0.5, y: h7.origin.y, z: h7.origin.z + 0.5 };
    const { ctx, slept } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: inside,
      timeOfDay: 14_000,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
    });
    const { backend, destinations } = stubNav(ctx.bot);
    setNavigationBackend(backend);
    const result = await executeSleepAtHome(ctx, store);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const data = result.data as { enteredInterior: boolean };
    expect(data.enteredInterior).toBe(true);
    expect(destinations.every((dest) => Math.floor(dest.z) !== h7.entrance.z)).toBe(true);
    expect(slept[0]?.position).toEqual(h7.bed);
    store.close();
  });

  it("waits inside the claimed house until vanilla sleep, then sleeps that bed once", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_h4",
      origin: h4.origin,
      entrance: h4.entrance,
      bed: h4.bed,
      personalChest: h4.chest,
      storageAccess: "personal",
    });
    const inside = { x: h7.origin.x + 0.5, y: h7.origin.y, z: h7.origin.z + 0.5 };
    const { ctx, slept, bot, activated } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: inside,
      timeOfDay: 12_766,
      beds: {
        [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed",
        [`${h4.bed.x},${h4.bed.y},${h4.bed.z}`]: "white_bed",
      },
    });
    const { backend, destinations } = stubNav(ctx.bot);
    setNavigationBackend(backend);
    const result = await executeSleepAtHome(ctx, store, fakeClock(bot));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const data = result.data as { waitedInsideHome: boolean; sleepAttempts: number; sleptInOwnBed: boolean; teleported: boolean };
    expect(data.waitedInsideHome).toBe(true);
    expect(data.sleepAttempts).toBe(1);
    expect(data.sleptInOwnBed).toBe(true);
    expect(data.teleported).toBe(false);
    expect(bot.time.timeOfDay).toBeGreaterThanOrEqual(13_000);
    expect(slept).toHaveLength(1);
    expect(slept[0]?.position).toEqual(h7.bed);
    expect(slept[0]?.position).not.toEqual(h4.bed);
    expect(destinations.every((dest) => Math.floor(dest.z) !== h7.entrance.z)).toBe(true);
    expect(activated).toEqual([]);
    expect(store.getCitizenHome("citizen_maya")?.homeId).toBe("home_h4");
    expect(store.getCitizenHome("citizen_maya")?.status).toBe("active");
    store.close();
  });

  it("returns HAZARD_BLOCKED from a failed route without teleporting", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const { ctx, slept } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: work,
      timeOfDay: 14_000,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
    });
    const { backend } = stubNav(ctx.bot, { failCode: "HAZARD_BLOCKED" });
    setNavigationBackend(backend);
    const result = await executeSleepAtHome(ctx, store);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected hazard");
    expect(result.code).toBe("HAZARD_BLOCKED");
    expect(result.details?.teleported).toBe(false);
    expect(result.details?.workComplete).toBe(false);
    expect(result.details?.sleptInOwnBed).toBe(false);
    expect(ctx.body.position()).toEqual(work);
    expect(slept).toEqual([]);
    store.close();
  });

  it("aborts an early wait without sleeping or leaving the claimed interior", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const abort = new AbortController();
    const inside = { x: h7.origin.x + 0.5, y: h7.origin.y, z: h7.origin.z + 0.5 };
    const { ctx, slept, bot } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: inside,
      timeOfDay: 12_766,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
      signal: abort.signal,
    });
    const clock = fakeClock(bot);
    const result = await executeSleepAtHome(ctx, store, {
      now: clock.now,
      delayMs: async (ms) => {
        await clock.delayMs(ms);
        abort.abort();
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected abort");
    expect(result.code).toBe("CANCELLED");
    expect(result.details?.enteredInterior).toBe(true);
    expect(result.details?.sleepAttempts).toBe(0);
    expect(ctx.body.position()).toEqual(inside);
    expect(slept).toEqual([]);
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h7");
    store.close();
  });

  it("marks a bed destroyed during the wait without reassigning the claim", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const inside = { x: h7.origin.x + 0.5, y: h7.origin.y, z: h7.origin.z + 0.5 };
    const { ctx, slept, bot, removeBed } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: inside,
      timeOfDay: 12_766,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
    });
    const clock = fakeClock(bot);
    const result = await executeSleepAtHome(ctx, store, {
      now: clock.now,
      delayMs: async (ms) => {
        await clock.delayMs(ms);
        removeBed();
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected missing bed");
    expect(result.code).toBe("BED_MISSING");
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h7");
    expect(store.getCitizenHome("citizen_atlas")?.status).toBe("displaced");
    expect(slept).toEqual([]);
    store.close();
  });

  it("reports BED_OCCUPIED without claiming sleep or reassigning the home", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const inside = { x: h7.origin.x + 0.5, y: h7.origin.y, z: h7.origin.z + 0.5 };
    const { ctx, slept } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: inside,
      timeOfDay: 14_000,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
      occupiedBed: true,
    });
    const { backend } = stubNav(ctx.bot);
    setNavigationBackend(backend);
    const result = await executeSleepAtHome(ctx, store);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected occupied");
    expect(result.code).toBe("BED_OCCUPIED");
    expect(result.details?.sleptInOwnBed).toBe(false);
    expect(result.details?.workComplete).toBe(false);
    expect(store.getCitizenHome("citizen_atlas")?.status).toBe("active");
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h7");
    expect(slept).toEqual([]);
    store.close();
  });

  it("disconnects during the early wait without claiming sleep or moving the body", async () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: h7.origin,
      entrance: h7.entrance,
      bed: h7.bed,
      personalChest: h7.chest,
      storageAccess: "personal",
    });
    const inside = { x: h7.origin.x + 0.5, y: h7.origin.y, z: h7.origin.z + 0.5 };
    const { ctx, slept, bot, disconnect } = fakeBedtimeCtx({
      citizenId: "citizen_atlas",
      position: inside,
      timeOfDay: 12_766,
      beds: { [`${h7.bed.x},${h7.bed.y},${h7.bed.z}`]: "yellow_bed" },
    });
    const { backend } = stubNav(ctx.bot);
    setNavigationBackend(backend);
    const clock = fakeClock(bot);
    const result = await executeSleepAtHome(ctx, store, {
      now: clock.now,
      delayMs: async (ms) => {
        await clock.delayMs(ms);
        disconnect();
      },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected disconnect");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(result.details?.sleptInOwnBed).toBe(false);
    expect(result.details?.workComplete).toBe(false);
    expect(result.details?.teleported).toBe(false);
    expect(slept).toEqual([]);
    store.close();
  });
});
