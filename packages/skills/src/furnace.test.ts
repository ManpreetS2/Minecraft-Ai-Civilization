import { describe, expect, it } from "vitest";
import { fuelUnitsNeeded, smeltsPerFuelUnit } from "./furnace.js";

describe("furnace fuel accounting", () => {
  it("uses vanilla smelt counts per fuel unit", () => {
    expect(smeltsPerFuelUnit("coal")).toBe(8);
    expect(smeltsPerFuelUnit("charcoal")).toBe(8);
    expect(smeltsPerFuelUnit("blaze_rod")).toBe(12);
    expect(smeltsPerFuelUnit("oak_planks")).toBe(1.5);
    expect(smeltsPerFuelUnit("oak_log")).toBe(1.5);
    expect(smeltsPerFuelUnit("stick")).toBe(0.5);
    expect(smeltsPerFuelUnit("coal_block")).toBe(80);
    expect(smeltsPerFuelUnit("lava_bucket")).toBe(100);
    expect(smeltsPerFuelUnit("iron_ingot")).toBe(0);
  });

  it("asks for the ceiling number of fuel units for a batch", () => {
    expect(fuelUnitsNeeded("coal", 1)).toBe(1);
    expect(fuelUnitsNeeded("coal", 8)).toBe(1);
    expect(fuelUnitsNeeded("coal", 9)).toBe(2);
    expect(fuelUnitsNeeded("oak_planks", 2)).toBe(2);
    expect(fuelUnitsNeeded("stick", 1)).toBe(2);
  });
});
