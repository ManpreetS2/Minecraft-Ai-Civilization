import { describe, expect, it } from "vitest";
import { evaluateFunctionalPlacement, isFunctionalItem, type WorldCell } from "./placement.js";

function grid(cells: Record<string, string>): (x: number, y: number, z: number) => WorldCell | undefined {
  return (x, y, z) => {
    const name = cells[`${x},${y},${z}`];
    if (!name) return { name: "air", boundingBox: "empty" };
    return { name, boundingBox: name === "air" || name === "short_grass" ? "empty" : "block" };
  };
}

describe("semantic functional placement", () => {
  it("rejects a bed in an open field even with a sleeping purpose", () => {
    const getBlock = grid({
      "0,63,0": "grass_block",
      "1,63,0": "grass_block",
    });
    const decision = evaluateFunctionalPlacement({
      item: "red_bed",
      purpose: "sleeping_berth",
      position: { x: 0, y: 64, z: 0 },
      getBlock,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("PURPOSELESS_PLACEMENT");
    expect(decision.reason).toMatch(/roof/i);
  });

  it("rejects a freestanding door in open terrain", () => {
    const getBlock = grid({
      "4,63,4": "grass_block",
    });
    const decision = evaluateFunctionalPlacement({
      item: "oak_door",
      purpose: "doorway",
      position: { x: 4, y: 64, z: 4 },
      getBlock,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("PURPOSELESS_PLACEMENT");
    expect(decision.reason).toMatch(/freestanding|doorway/i);
  });

  it("rejects a crafting table without worksite or building purpose", () => {
    const getBlock = grid({
      "2,63,2": "dirt",
    });
    const decision = evaluateFunctionalPlacement({
      item: "crafting_table",
      position: { x: 2, y: 64, z: 2 },
      getBlock,
    });
    expect(decision.ok).toBe(false);
    expect(isFunctionalItem("crafting_table")).toBe(true);
    expect(decision.code).toBe("PURPOSELESS_PLACEMENT");
  });

  it("allows a temporary worksite table on support away from a doorway", () => {
    const getBlock = grid({
      "8,63,8": "grass_block",
    });
    const decision = evaluateFunctionalPlacement({
      item: "crafting_table",
      purpose: "temporary_worksite",
      position: { x: 8, y: 64, z: 8 },
      getBlock,
    });
    expect(decision.ok).toBe(true);
  });

  it("allows a door only in a two-block wall opening", () => {
    const getBlock = grid({
      "5,63,10": "oak_planks",
      "4,64,10": "oak_planks",
      "4,65,10": "oak_planks",
      "6,64,10": "oak_planks",
      "6,65,10": "oak_planks",
    });
    const decision = evaluateFunctionalPlacement({
      item: "oak_door",
      purpose: "shelter_blueprint",
      position: { x: 5, y: 64, z: 10 },
      getBlock,
    });
    expect(decision.ok).toBe(true);
  });

  it("allows a bed under a roof with head support", () => {
    const getBlock = grid({
      "3,63,3": "oak_planks",
      "3,63,4": "oak_planks",
      "3,66,3": "oak_planks",
      "3,66,4": "oak_planks",
    });
    const decision = evaluateFunctionalPlacement({
      item: "white_bed",
      purpose: "sleeping_berth",
      position: { x: 3, y: 64, z: 3 },
      getBlock,
    });
    expect(decision.ok).toBe(true);
  });

  it("rejects a chest sitting unsheltered on a path", () => {
    const getBlock = grid({
      "12,63,12": "dirt",
    });
    const decision = evaluateFunctionalPlacement({
      item: "chest",
      purpose: "household_storage",
      position: { x: 12, y: 64, z: 12 },
      getBlock,
    });
    expect(decision.ok).toBe(false);
  });

  it("rejects a crafting table dumped on a village path even with worksite intent", () => {
    const getBlock = grid({
      "9,63,9": "dirt_path",
    });
    const decision = evaluateFunctionalPlacement({
      item: "crafting_table",
      purpose: "temporary_worksite",
      position: { x: 9, y: 64, z: 9 },
      getBlock,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/path/i);
  });
});
