import { describe, expect, it } from "vitest";
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
} from "./farm.js";

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
