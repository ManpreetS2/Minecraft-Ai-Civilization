import { describe, expect, it } from "vitest";
import { materialList, nextUnplaced, starterHut } from "./blueprint.js";

describe("starter hut blueprint", () => {
  it("has a floor, walls, roof, door, chest and crafting table", () => {
    const hut = starterHut();
    const materials = materialList(hut);
    expect(hut.blocks.length).toBeGreaterThan(40);
    expect(materials.oak_planks).toBeGreaterThan(20);
    expect(materials.chest).toBe(1);
    expect(materials.crafting_table).toBe(1);
    expect(materials.oak_door).toBe(1);
  });

  it("returns the next unplaced block", () => {
    const hut = starterHut();
    const origin = { x: 10, y: 64, z: 10 };
    const next = nextUnplaced(hut, origin, () => false);
    expect(next?.block).toBe("oak_planks");
  });
});
