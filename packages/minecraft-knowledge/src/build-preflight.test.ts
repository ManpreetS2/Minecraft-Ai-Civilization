import { describe, expect, it } from "vitest";
import {
  WORKSHOP_CABIN_ID,
  expandBlueprint,
  getBlueprint,
  resolveMaterials,
  worldPosition,
} from "./structures.js";
import {
  bedProperties,
  comparePlanToWorld,
  doorPropertiesForEntrance,
  facingFromRotation,
  inventoryShortfall,
  preflightBuildStructure,
  remainingAfterPartialBuild,
  rotateCardinal,
  rotateFacingProperty,
  rotateLocalOffset,
  slabProperties,
  stairProperties,
  transformBlockProperties,
  validateExpandedCells,
} from "./build-preflight.js";

function flatWorld(originY = 64): (pos: { x: number; y: number; z: number }) => string | undefined {
  return (pos) => (pos.y === originY - 1 ? "grass_block" : "air");
}

describe("directional state transforms", () => {
  it("rotates cardinals 90/180/270 from south", () => {
    expect(facingFromRotation(0)).toBe("south");
    expect(facingFromRotation(90)).toBe("west");
    expect(facingFromRotation(180)).toBe("north");
    expect(facingFromRotation(270)).toBe("east");
    expect(rotateCardinal("east", 90)).toBe("south");
  });

  it("transforms door, bed, stair, and slab properties without inventing blocks", () => {
    expect(doorPropertiesForEntrance("south")).toMatchObject({ facing: "south", half: "lower", hinge: "left" });
    expect(transformBlockProperties(doorPropertiesForEntrance("south"), 90)?.facing).toBe("west");
    expect(bedProperties("north", "head")).toMatchObject({ facing: "north", part: "head" });
    expect(stairProperties("east").facing).toBe("east");
    expect(slabProperties("top").type).toBe("top");
    expect(rotateFacingProperty("north", 180)).toBe("south");
  });

  it("rotates local offsets consistently with footprint facing", () => {
    const fp = { width: 5, depth: 4 };
    expect(rotateLocalOffset(0, 0, fp, 0)).toEqual({ dx: 0, dz: 0 });
    expect(rotateLocalOffset(0, 0, fp, 180)).toEqual({ dx: 4, dz: 3 });
  });
});

describe("workshop cabin catalog + cell validation", () => {
  it("registers an implemented workshop cabin blueprint", () => {
    const cabin = getBlueprint(WORKSHOP_CABIN_ID);
    expect(cabin?.implemented).toBe(true);
    expect(cabin?.structureType).toBe("WORKSHOP");
    const expanded = expandBlueprint(cabin!, resolveMaterials(cabin!, { oak_planks: 128, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 }), "south", [
      "chest",
      "lighting",
      "crafting_table",
    ]);
    expect(expanded.blocks.some((block) => block.role === "crafting_table")).toBe(true);
    expect(validateExpandedCells(expanded)).toEqual([]);
  });

  it("flags duplicate and out-of-bounds cells", () => {
    const cabin = getBlueprint(WORKSHOP_CABIN_ID)!;
    const expanded = expandBlueprint(cabin, resolveMaterials(cabin, { oak_planks: 64 }), "south");
    expanded.blocks.push({ ...expanded.blocks[0]!, role: "wall" });
    expanded.blocks.push({ dx: 99, dy: 0, dz: 0, stage: "FLOOR", role: "floor", category: "FLOOR_MATERIAL" });
    const issues = validateExpandedCells(expanded);
    expect(issues.some((issue) => issue.code === "DUPLICATE_CELL")).toBe(true);
    expect(issues.some((issue) => issue.code === "OUT_OF_BOUNDS")).toBe(true);
  });
});

describe("preflightBuildStructure", () => {
  it("computes exact BOM and remains PROCURING when inventory is short", () => {
    const origin = { x: 100, y: 70, z: 100 };
    const preflight = preflightBuildStructure(
      {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        facing: "south",
        inventory: { oak_planks: 2 },
      },
      flatWorld(70),
    );
    expect(preflight.siteOk).toBe(true);
    expect(Object.keys(preflight.billOfMaterials).length).toBeGreaterThan(0);
    expect(preflight.status).toBe("PROCURING");
    expect(Object.keys(preflight.inventoryShortfall).length).toBeGreaterThan(0);
    expect(preflight.cells.every((cell) => cell.item.length > 0)).toBe(true);
    expect(preflight.cells.some((cell) => cell.role === "door" && cell.properties?.facing === "south")).toBe(true);
  });

  it("rejects wet sites and protected furniture without claiming success", () => {
    const origin = { x: 0, y: 64, z: 0 };
    const wet = preflightBuildStructure(
      { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin, inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 } },
      (pos) => (pos.x === 0 && pos.y === 64 ? "water" : pos.y === 63 ? "grass_block" : "air"),
    );
    expect(wet.status).toBe("BLOCKED");
    expect(wet.blockers).toContain("SITE_UNSUITABLE");

    const protectedSite = preflightBuildStructure(
      { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin: { x: 50, y: 64, z: 50 }, inventory: { oak_planks: 200, oak_door: 1 } },
      (pos) => (pos.x === 51 && pos.y === 64 && pos.z === 51 ? "chest" : pos.y === 63 ? "grass_block" : "air"),
    );
    expect(protectedSite.status).toBe("BLOCKED");
    expect(protectedSite.blockers).toContain("PROTECTED_STRUCTURE");
  });

  it("does not treat unknown/unloaded cells as correct placements", () => {
    const cabin = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(cabin, { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 });
    const expanded = expandBlueprint(cabin, materials, "south", ["chest", "lighting", "crafting_table"]);
    const origin = { x: 10, y: 64, z: 10 };
    const compared = comparePlanToWorld(expanded, origin, () => undefined);
    expect(compared.remaining.unknown).toBeGreaterThan(0);
    expect(compared.remaining.correct).toBe(0);
  });

  it("computes remaining materials after a partial honest world snapshot", () => {
    const cabin = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(cabin, { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 });
    const expanded = expandBlueprint(cabin, materials, "east", ["chest", "lighting", "crafting_table"]);
    const origin = { x: 0, y: 64, z: 0 };
    const world = new Map<string, string>();
    for (const block of expanded.blocks) {
      if (block.role !== "floor") continue;
      const pos = worldPosition(origin, block.dx, block.dy, block.dz, cabin.footprint, "east");
      world.set(`${pos.x},${pos.y},${pos.z}`, "oak_planks");
    }
    const remaining = remainingAfterPartialBuild(
      WORKSHOP_CABIN_ID,
      origin,
      "east",
      (pos) => world.get(`${pos.x},${pos.y},${pos.z}`) ?? "air",
      { oak_planks: 200 },
    );
    expect(remaining.correct).toBeGreaterThan(0);
    expect(remaining.missing).toBeGreaterThan(0);
    expect(remaining.remaining.oak_planks ?? remaining.remaining.oak_door).toBeTruthy();
  });

  it("inventory shortfall accounts for plank substitutes", () => {
    expect(inventoryShortfall({ oak_planks: 10, oak_door: 1 }, { spruce_planks: 10 })).toEqual({ oak_door: 1 });
  });
});
