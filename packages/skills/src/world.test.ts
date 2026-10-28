import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { ok, type Vec3 } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { sleep } from "./world.js";
import type { SkillContext } from "./context.js";

const closer: Vec3 = { x: 0, y: 64, z: 0 };
const designated: Vec3 = { x: 10, y: 64, z: 10 };

function cellKey(pos: { x: number; y: number; z: number }): string {
  return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function stubNav(navigated: Vec3[]): NavigationBackend {
  const done = (target: Vec3) => Promise.resolve(ok({ position: target, distance: 1 }, 1));
  return {
    name: "test-nav",
    navigateToPosition: (_bot, target) => {
      navigated.push(target);
      return done(target);
    },
    navigateNear: (_bot, target) => done(target),
    navigateToInteractWithBlock: (_bot, block) => {
      navigated.push(block);
      return done(block);
    },
    navigateToPlaceBlock: (_bot, target) => done(target),
    followEntity: async () => ok({ username: "x", position: closer }, 1),
    escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };
}

function fakeSleepCtx(over: { timeOfDay?: number; missingDesignated?: boolean } = {}): {
  ctx: SkillContext;
  slept: Array<{ name: string; position: Vec3 }>;
} {
  const slept: Array<{ name: string; position: Vec3 }> = [];
  const blocks: Record<string, { name: string; position: Vec3 }> = {
    [cellKey(closer)]: { name: "white_bed", position: closer },
  };
  if (!over.missingDesignated) {
    blocks[cellKey(designated)] = { name: "red_bed", position: designated };
  }
  const bot = {
    time: { timeOfDay: over.timeOfDay ?? 14_000 },
    isRaining: false,
    isSleeping: false,
    thunderState: 0,
    entity: { position: { x: 0.5, y: 64, z: 0.5 } },
    blockAt(pos: { x: number; y: number; z: number }) {
      return blocks[cellKey(pos)] ?? { name: "air", position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
    },
    findBlock() {
      return { name: "white_bed", position: closer };
    },
    lookAt: async () => undefined,
    async sleep(block: { name: string; position: Vec3 }) {
      slept.push({ name: block.name, position: block.position });
      this.isSleeping = true;
    },
    async wake() {
      this.isSleeping = false;
    },
  };
  const ctx = {
    bot: bot as unknown as Bot,
    body: {
      nearbyEntities: () => [],
    },
  } as unknown as SkillContext;
  return { ctx, slept };
}

describe("sleep uses a designated home bed", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("navigates to the claimed bed even when another usable bed is closer", async () => {
    const navigated: Vec3[] = [];
    setNavigationBackend(stubNav(navigated));
    const { ctx, slept } = fakeSleepCtx();
    const result = await sleep(ctx, designated);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("designated sleep should succeed");
    expect(result.data.position).toEqual(designated);
    expect(result.data.name).toBe("red_bed");
    expect(navigated.some((pos) => Math.floor(pos.x) === designated.x && Math.floor(pos.z) === designated.z)).toBe(true);
    expect(navigated.some((pos) => Math.floor(pos.x) === closer.x && Math.floor(pos.z) === closer.z)).toBe(false);
    expect(slept).toHaveLength(1);
    expect(slept[0]?.name).toBe("red_bed");
    expect(slept[0]?.position).toEqual(designated);
  });

  it("does not fall back to the nearest bed when the designated bed is missing", async () => {
    const navigated: Vec3[] = [];
    setNavigationBackend(stubNav(navigated));
    const { ctx, slept } = fakeSleepCtx({ missingDesignated: true });
    const result = await sleep(ctx, designated);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("missing designated bed should fail");
    expect(result.code).toBe("BED_MISSING");
    expect(slept).toHaveLength(0);
    expect(navigated).toHaveLength(0);
  });

  it("reports daytime instead of swapping beds", async () => {
    setNavigationBackend(stubNav([]));
    const { ctx, slept } = fakeSleepCtx({ timeOfDay: 1000 });
    const result = await sleep(ctx, designated);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("daytime should fail");
    expect(result.code).toBe("NOT_SLEEP_TIME");
    expect(slept).toHaveLength(0);
  });

  it("fails when the designated bed block is unloaded", async () => {
    setNavigationBackend(stubNav([]));
    const { ctx, slept } = fakeSleepCtx();
    ctx.bot.blockAt = () => null;
    const result = await sleep(ctx, designated);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unloaded bed should fail");
    expect(result.code).toBe("BED_MISSING");
    expect(slept).toHaveLength(0);
  });
});
