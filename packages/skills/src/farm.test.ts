import { afterEach, describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { fail } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import {
  CROP_BLOCKS,
  cropKindFromBlock,
  evaluateFarmPreconditions,
  inspectFarm,
  isMatureCrop,
  plotCells,
  plotHydrated,
  selectHydratedPlot,
  soilHydratedByWater,
  TILLABLE_SOIL,
  workFarmPlot,
} from "./farm.js";
import type { SkillContext } from "./context.js";

describe("farm geometry and crop maturity", () => {
  it("treats wheat age 7 as mature and age 3 as immature", () => {
    expect(CROP_BLOCKS.wheat.matureAge).toBe(7);
    expect(isMatureCrop({ name: "wheat", getProperties: () => ({ age: 7 }) }, "wheat")).toBe(true);
    expect(isMatureCrop({ name: "wheat", getProperties: () => ({ age: 3 }) }, "wheat")).toBe(false);
    expect(isMatureCrop({ name: "dirt", getProperties: () => ({ age: 7 }) }, "wheat")).toBe(false);
  });

  it("maps crop blocks to kinds", () => {
    expect(cropKindFromBlock("wheat")).toBe("wheat");
    expect(cropKindFromBlock("beetroots")).toBe("beetroots");
    expect(cropKindFromBlock("farmland")).toBeUndefined();
  });

  it("lists dirt and grass as tillable soil", () => {
    expect(TILLABLE_SOIL.has("dirt")).toBe(true);
    expect(TILLABLE_SOIL.has("grass_block")).toBe(true);
    expect(TILLABLE_SOIL.has("stone")).toBe(false);
  });

  it("builds a 3x3 plot from an origin", () => {
    const cells = plotCells({ x: 10, y: 64, z: 20 }, 3);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toEqual({ x: 10, y: 64, z: 20 });
    expect(cells.at(-1)).toEqual({ x: 12, y: 64, z: 22 });
  });

  it("hydrates farmland within 4 Chebyshev at same Y or one above", () => {
    const soil = { x: 0, y: 64, z: 0 };
    expect(soilHydratedByWater(soil, { x: 4, y: 64, z: 0 })).toBe(true);
    expect(soilHydratedByWater(soil, { x: 5, y: 64, z: 0 })).toBe(false);
    expect(soilHydratedByWater(soil, { x: 0, y: 65, z: 0 })).toBe(true);
    expect(soilHydratedByWater(soil, { x: 0, y: 63, z: 0 })).toBe(false);
  });

  it("does not treat water one block below farmland as a hydrator", () => {
    expect(soilHydratedByWater({ x: 20, y: 68, z: 240 }, { x: 23, y: 67, z: 241 })).toBe(false);
    expect(soilHydratedByWater({ x: 20, y: 68, z: 240 }, { x: 23, y: 68, z: 241 })).toBe(true);
  });

  it("selects a hydrated 3x3 and rejects dry or incomplete plots", () => {
    const soils = plotCells({ x: 0, y: 64, z: 0 }, 3);
    const water = { x: 3, y: 64, z: 1 };
    const hit = selectHydratedPlot(soils, [water], 3);
    expect(hit?.origin).toEqual({ x: 0, y: 64, z: 0 });
    expect(hit?.cells).toHaveLength(9);
    expect(plotHydrated(soils, [water])).toBe(true);

    expect(selectHydratedPlot(soils, [{ x: 20, y: 64, z: 20 }], 3)).toBeUndefined();
    expect(selectHydratedPlot(soils.slice(0, 8), [water], 3)).toBeUndefined();
  });

  it("inspects a known plot and fails closed without water, hoe, seeds, or designated storage", () => {
    const cells: Record<string, { name: string; getProperties?: () => { age?: number } }> = {};
    for (const soil of plotCells({ x: 20, y: 68, z: 240 }, 3)) {
      cells[`${soil.x},${soil.y},${soil.z}`] = { name: "farmland" };
      cells[`${soil.x},${soil.y + 1},${soil.z}`] = { name: "wheat", getProperties: () => ({ age: 7 }) };
    }
    cells["23,68,241"] = { name: "dirt" };
    const bot = {
      blockAt(pos: { x: number; y: number; z: number }) {
        return cells[`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`];
      },
    };
    const dry = inspectFarm(bot as never, { x: 20, y: 68, z: 240 }, 3, "wheat", { x: 23, y: 68, z: 241 });
    expect(dry.hydrated).toBe(false);
    expect(dry.mature).toBe(9);
    expect(evaluateFarmPreconditions(dry, { hoe: true, seeds: 9 }).ok).toBe(false);

    cells["23,68,241"] = { name: "water" };
    const wet = inspectFarm(bot as never, { x: 20, y: 68, z: 240 }, 3, "wheat", { x: 23, y: 68, z: 241 });
    expect(wet.hydrated).toBe(true);
    expect(wet.water).toEqual({ x: 23, y: 68, z: 241 });
    expect(evaluateFarmPreconditions(wet, { hoe: true, seeds: 9 }).ok).toBe(true);
    const missingStore = evaluateFarmPreconditions(wet, {
      hoe: false,
      seeds: 0,
      seedStorage: { x: 23, y: 69, z: 238 },
      storagePresent: false,
    });
    expect(missingStore.ok).toBe(false);
    if (missingStore.ok) throw new Error("missing seed storage should fail");
    expect(missingStore.code).toBe("CONTAINER_NOT_FOUND");
  });

  it("does not treat an arbitrary nearby chest as the farm store", () => {
    const inspection = inspectFarm(
      {
        blockAt() {
          return { name: "air" };
        },
      } as never,
      { x: 20, y: 68, z: 240 },
      3,
      "wheat",
    );
    const gate = evaluateFarmPreconditions(
      { ...inspection, hydrated: true, water: { x: 23, y: 68, z: 241 }, untilled: 9, empty: 9, blocked: 0 },
      { hoe: true, seeds: 0 },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("ITEM_NOT_FOUND");
  });
});

function failingNav(): NavigationBackend {
  const blocked = () => Promise.resolve(fail("PATH_BLOCKED", "blocked", 1, true));
  return {
    name: "test-nav-blocked",
    navigateToPosition: blocked,
    navigateNear: blocked,
    navigateToInteractWithBlock: blocked,
    navigateToPlaceBlock: blocked,
    followEntity: async () => fail("PATH_BLOCKED", "blocked", 1, true),
    escapeFrom: blocked,
    probeReachability: () => ({ reachable: false, cost: 99 }),
    stop: () => undefined,
  };
}

function farmWorld(kind: "untilled" | "immature"): {
  ctx: SkillContext;
  cells: Record<string, { name: string; getProperties?: () => { age?: number } }>;
} {
  const origin = { x: 20, y: 68, z: 240 };
  const cells: Record<string, { name: string; getProperties?: () => { age?: number } }> = {};
  for (const soil of plotCells(origin, 3)) {
    cells[`${soil.x},${soil.y},${soil.z}`] = { name: kind === "untilled" ? "dirt" : "farmland" };
    cells[`${soil.x},${soil.y + 1},${soil.z}`] =
      kind === "untilled"
        ? { name: "air" }
        : { name: "wheat", getProperties: () => ({ age: 3 }) };
  }
  cells["23,68,241"] = { name: "water" };
  const hoe = { name: "wooden_hoe", count: 1 };
  const seeds = { name: "wheat_seeds", count: 9 };
  const items = [hoe, seeds];
  const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
  slots[9] = { ...hoe, slot: 9 };
  slots[10] = { ...seeds, slot: 10 };
  const bot = {
    food: 18,
    heldItem: hoe,
    entities: {},
    entity: { position: { x: 0.5, y: 64, z: 0.5 }, eyeHeight: 1.62 },
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    async equip(item: { name: string; count?: number }) {
      bot.heldItem = { name: item.name, count: item.count ?? 1 };
    },
    blockAt(pos: { x: number; y: number; z: number }) {
      return cells[`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`] ?? { name: "air" };
    },
    async activateBlock() {
      return undefined;
    },
  };
  const ctx = {
    bot: bot as unknown as Bot,
    timeoutMs: 1_000,
    body: { nearbyEntities: () => [] },
  } as unknown as SkillContext;
  return { ctx, cells };
}

describe("workFarmPlot verified progress", () => {
  afterEach(() => {
    setNavigationBackend(createNavigationBackend("pathfinder"));
  });

  it("does not report success when tilling cannot reach the plot", async () => {
    setNavigationBackend(failingNav());
    const { ctx } = farmWorld("untilled");
    const result = await workFarmPlot(ctx, {
      origin: { x: 20, y: 68, z: 240 },
      water: { x: 23, y: 68, z: 241 },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable farm work should fail");
    expect(result.code).toBe("PATH_BLOCKED");
    expect(result.details?.workComplete).toBe(false);
  });

  it("treats an already-planted immature plot as idle success", async () => {
    setNavigationBackend(failingNav());
    const { ctx } = farmWorld("immature");
    const result = await workFarmPlot(ctx, {
      origin: { x: 20, y: 68, z: 240 },
      water: { x: 23, y: 68, z: 241 },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.tilled).toHaveLength(0);
    expect(result.data.harvested).toHaveLength(0);
    expect(result.data.inspected.immature).toBe(9);
  });
});
