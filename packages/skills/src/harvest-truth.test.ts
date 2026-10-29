import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { harvestCropAt, harvestPlot, plotCells } from "./farm.js";
import type { SkillContext } from "./context.js";

function inReachNav(): NavigationBackend {
  const done = (target: { x: number; y: number; z: number }) =>
    Promise.resolve(ok({ position: { x: target.x, y: target.y, z: target.z }, distance: 1 }, 1));
  return {
    name: "test-nav",
    navigateToPosition: (_bot, target) => done(target),
    navigateNear: (_bot, target) => done(target),
    navigateToInteractWithBlock: (_bot, block) => done(block),
    navigateToPlaceBlock: (_bot, target) => done(target),
    followEntity: async () => ok({ username: "x", position: { x: 20.5, y: 69, z: 240.5 } }, 1),
    escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };
}

function harvestWorld(opts: {
  mature?: boolean;
  grantYield?: boolean;
  existingWheat?: number;
  existingSeeds?: number;
  replantOk?: boolean;
  signal?: AbortSignal;
  unloadCrop?: boolean;
}): SkillContext {
  const origin = { x: 20, y: 68, z: 240 };
  const cropPos = { x: 20, y: 69, z: 240 };
  const cells: Record<string, { name: string; position?: { x: number; y: number; z: number }; getProperties?: () => { age?: number } }> =
    {};
  for (const soil of plotCells(origin, 1)) {
    cells[`${soil.x},${soil.y},${soil.z}`] = { name: "farmland" };
    if (!opts.unloadCrop) {
      cells[`${soil.x},${soil.y + 1},${soil.z}`] = {
        name: "wheat",
        position: { x: soil.x, y: soil.y + 1, z: soil.z },
        getProperties: () => ({ age: opts.mature === false ? 3 : 7 }),
      };
    }
  }
  const items: Array<{ name: string; count: number; slot: number }> = [];
  const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
  const pushItem = (name: string, count: number) => {
    const existing = items.find((item) => item.name === name);
    if (existing) {
      existing.count += count;
      return;
    }
    const next = { name, count, slot: 9 + items.length };
    items.push(next);
    slots[next.slot] = next;
  };
  if ((opts.existingWheat ?? 0) > 0) pushItem("wheat", opts.existingWheat!);
  if ((opts.existingSeeds ?? 0) > 0) pushItem("wheat_seeds", opts.existingSeeds!);
  else if (opts.replantOk !== false) pushItem("wheat_seeds", 1);

  const bot = {
    food: 18,
    heldItem: undefined as { name: string; count: number } | undefined,
    entities: {},
    entity: { position: { x: 20.5, y: 69, z: 240.5 }, eyeHeight: 1.62 },
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    async equip(item: { name: string; count?: number }) {
      bot.heldItem = { name: item.name, count: item.count ?? 1 };
    },
    blockAt(pos: { x: number; y: number; z: number }) {
      return cells[`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`] ?? { name: "air" };
    },
    async dig(block: { position: { x: number; y: number; z: number } }) {
      const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
      cells[key] = { name: "air" };
      if (opts.grantYield) {
        pushItem("wheat", 1);
        pushItem("wheat_seeds", 1);
      }
    },
    async activateBlock() {
      if (opts.replantOk === false) return;
      cells[`${cropPos.x},${cropPos.y},${cropPos.z}`] = {
        name: "wheat",
        position: cropPos,
        getProperties: () => ({ age: 0 }),
      };
      const seed = items.find((item) => item.name === "wheat_seeds");
      if (seed && seed.count > 0) seed.count -= 1;
    },
    async lookAt() {
      return undefined;
    },
  };

  return {
    bot: bot as unknown as Bot,
    signal: opts.signal,
    timeoutMs: 2_000,
    body: { nearbyEntities: () => [] },
  } as unknown as SkillContext;
}

describe("harvestCropAt / harvestPlot yield truthfulness", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("reports verified yield only from inventory deltas", async () => {
    setNavigationBackend(inReachNav());
    const ctx = harvestWorld({ mature: true, grantYield: true, existingWheat: 0, existingSeeds: 2 });
    const result = await harvestCropAt(ctx, { x: 20, y: 69, z: 240 }, "wheat", { replant: false });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.cropBroken).toBe(true);
    expect(result.data.acquisitionVerified).toBe(true);
    expect(result.data.collected).toBeGreaterThan(0);
  });

  it("keeps cropBroken true when drops are not collected", async () => {
    setNavigationBackend(inReachNav());
    const ctx = harvestWorld({ mature: true, grantYield: false, existingWheat: 0, existingSeeds: 1 });
    const result = await harvestCropAt(ctx, { x: 20, y: 69, z: 240 }, "wheat", { replant: false });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.cropBroken).toBe(true);
    expect(result.data.collected).toBe(0);
    expect(result.data.acquisitionVerified).toBe(false);
  });

  it("does not count existing inventory wheat as new yield", async () => {
    setNavigationBackend(inReachNav());
    const ctx = harvestWorld({ mature: true, grantYield: false, existingWheat: 12, existingSeeds: 3 });
    const plot = await harvestPlot(ctx, { x: 20, y: 68, z: 240 }, 1, "wheat", { replant: false });
    expect(plot.success).toBe(true);
    if (!plot.success) throw new Error(plot.error);
    expect(plot.data.collected).toBe(0);
    expect(plot.data.harvested).toHaveLength(1);
  });

  it("reports replant success after verified harvest", async () => {
    setNavigationBackend(inReachNav());
    const ctx = harvestWorld({ mature: true, grantYield: true, existingSeeds: 2, replantOk: true });
    const result = await harvestCropAt(ctx, { x: 20, y: 69, z: 240 }, "wheat", { replant: true });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.replanted).toBe(true);
    expect(result.data.cropBroken).toBe(true);
  });

  it("keeps harvest success when replant fails after crop break", async () => {
    setNavigationBackend(inReachNav());
    const ctx = harvestWorld({ mature: true, grantYield: true, existingSeeds: 2, replantOk: false });
    const result = await harvestCropAt(ctx, { x: 20, y: 69, z: 240 }, "wheat", { replant: true });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.cropBroken).toBe(true);
    expect(result.data.replanted).toBe(false);
  });

  it("fails CROP_IMMATURE when wheat is not mature", async () => {
    setNavigationBackend(inReachNav());
    const result = await harvestCropAt(
      harvestWorld({ mature: false, existingSeeds: 1 }),
      { x: 20, y: 69, z: 240 },
      "wheat",
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("immature crop should fail");
    expect(result.code).toBe("CROP_IMMATURE");
  });

  it("fails BLOCK_NOT_FOUND for unloaded crop cells", async () => {
    setNavigationBackend(inReachNav());
    const result = await harvestCropAt(
      harvestWorld({ unloadCrop: true, existingSeeds: 1 }),
      { x: 20, y: 69, z: 240 },
      "wheat",
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("missing crop should fail");
    expect(result.code).toBe("BLOCK_NOT_FOUND");
  });

  it("cancels before dig when already aborted", async () => {
    setNavigationBackend(inReachNav());
    const ac = new AbortController();
    ac.abort();
    const result = await harvestCropAt(
      harvestWorld({ mature: true, grantYield: true, signal: ac.signal }),
      { x: 20, y: 69, z: 240 },
      "wheat",
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("aborted harvest should fail");
    expect(result.code).toBe("CANCELLED");
    expect(result.details?.cropBroken).toBe(false);
  });
});
