import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { collectItem, mineBlock } from "./gather.js";
import type { SkillContext } from "./context.js";

function ctxWith(items: Array<{ name: string; count: number }>, entityCount = 0): SkillContext {
  const entities: Record<string, { name: string; position: { x: number; y: number; z: number } }> = {};
  for (let i = 0; i < entityCount; i += 1) {
    entities[`drop-${i}`] = { name: "item", position: { x: 1, y: 64, z: 1 } };
  }
  return {
    citizenId: "citizen_atlas",
    bot: {
      username: "Atlas",
      inventory: { items: () => items },
      entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 1 } },
      entities,
    },
    body: {
      position: () => ({ x: 0, y: 64, z: 0 }),
    },
  } as unknown as SkillContext;
}

describe("collectItem honesty", () => {
  it("does not report collected items when inventory did not increase", async () => {
    const items = [{ name: "oak_log", count: 2 }];
    const result = await collectItem(ctxWith(items, 0));
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected miss");
    expect(result.code).toBe("ITEM_NOT_FOUND");
    expect(result.details?.collected).toBe(0);
    expect(result.details?.workComplete).toBe(false);
    expect(items).toEqual([{ name: "oak_log", count: 2 }]);
  });
});

function inReachNav(): NavigationBackend {
  const done = (target: { x: number; y: number; z: number }) =>
    Promise.resolve(ok({ position: { x: target.x, y: target.y, z: target.z }, distance: 1 }, 1));
  return {
    name: "test-nav",
    navigateToPosition: (_bot, target) => done(target),
    navigateNear: (_bot, target) => done(target),
    navigateToInteractWithBlock: (_bot, block) => done(block),
    navigateToPlaceBlock: (_bot, target) => done(target),
    followEntity: async () => ok({ username: "x", position: { x: 5.5, y: 64, z: 5.5 } }, 1),
    escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };
}

function mineCtx(removeOnDig: boolean): SkillContext {
  const logPos = { x: 6, y: 64, z: 5 };
  let logName = "oak_log";
  const bot = {
    entity: { position: { x: 5.5, y: 64, z: 5.5 }, eyeHeight: 1.62 },
    registry: { blocksByName: { oak_log: { id: 17 } } },
    findBlocks() {
      return [logPos];
    },
    blockAt(pos: { x: number; y: number; z: number }) {
      if (Math.floor(pos.x) === logPos.x && Math.floor(pos.y) === logPos.y && Math.floor(pos.z) === logPos.z) {
        return { name: logName, position: logPos };
      }
      return { name: "air", position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
    },
    async lookAt() {
      return undefined;
    },
    async dig() {
      if (removeOnDig) logName = "air";
    },
  };
  return {
    bot: bot as unknown as Bot,
    timeoutMs: 2_000,
    body: {
      nearbyEntities: () => [],
      unreachable: { has: () => false, mark: () => undefined },
    },
  } as unknown as SkillContext;
}

describe("mineBlock verifies the world change", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("fails when the log is still present after dig", async () => {
    setNavigationBackend(inReachNav());
    const result = await mineBlock(mineCtx(false), ["oak_log"]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("undug log should fail");
    expect(result.code).toBe("VERIFY_FAILED");
  });

  it("succeeds only after the log block is gone", async () => {
    setNavigationBackend(inReachNav());
    const result = await mineBlock(mineCtx(true), ["oak_log"]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.name).toBe("oak_log");
    expect(result.data.position).toEqual({ x: 6, y: 64, z: 5 });
    expect(result.data.excavated).toBe(true);
    expect(result.data.resourceAcquired).toBe(false);
  });

  it("cancels before dig without inventing excavation", async () => {
    setNavigationBackend(inReachNav());
    const ac = new AbortController();
    ac.abort();
    const ctx = mineCtx(true);
    ctx.signal = ac.signal;
    const result = await mineBlock(ctx, ["oak_log"]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("cancelled mine should fail");
    expect(result.code).toBe("CANCELLED");
  });
});
