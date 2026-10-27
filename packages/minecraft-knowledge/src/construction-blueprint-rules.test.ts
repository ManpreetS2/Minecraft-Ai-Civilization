import { describe, expect, it } from "vitest";
import {
  PATH_SEGMENT_ID,
  SIMPLE_FARM_ID,
  STARTER_HOUSE_ID,
  STORAGE_SHED_ID,
  SMALL_WAREHOUSE_ID,
  WORKSHOP_CABIN_ID,
  blockMatchesPlan,
  expandBlueprint,
  getBlueprint,
  resolveMaterials,
  recipeAwareMaterialNeeds,
  countMaterials,
} from "./structures.js";
import {
  nextBuildableBlocks,
  validateBlueprintPipeline,
  SUPPORTED_CONSTRUCTION_ITEMS,
} from "./construction-blueprint-rules.js";

describe("Phase A blueprint pipeline", () => {
  it("validates workshop cabin schema, cells, and supported items", () => {
    const bp = getBlueprint(WORKSHOP_CABIN_ID)!;
    const result = validateBlueprintPipeline(bp, { oak_planks: 64, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 });
    expect(result.ok).toBe(true);
    expect(result.expanded.blocks.length).toBeGreaterThan(20);
  });

  it("orders floor before walls before roof", () => {
    const bp = getBlueprint(WORKSHOP_CABIN_ID)!;
    const expanded = expandBlueprint(bp, resolveMaterials(bp, { oak_planks: 64 }), "south");
    const next = nextBuildableBlocks(expanded, () => false);
    expect(next[0]?.block.stage).toMatch(/FOUNDATION|FLOOR/);
  });

  it("recipe-aware shortfall accounts for logs→planks without inventing stock", () => {
    const { shortfall, craftHints } = recipeAwareMaterialNeeds(
      { oak_planks: 20, oak_door: 1 },
      { oak_log: 2 },
    );
    expect(shortfall.oak_door).toBe(1);
    expect(shortfall.oak_planks).toBe(12); // need 20, 2 logs → 8 craftable planks
    expect(craftHints.some((h) => h.from === "logs")).toBe(true);
  });
});

describe("Phase B catalog blueprints", () => {
  it.each([
    [STARTER_HOUSE_ID, "SMALL_HOUSE"],
    [STORAGE_SHED_ID, "STORAGE_SHED"],
    [SMALL_WAREHOUSE_ID, "STORAGE_SHED"],
    [PATH_SEGMENT_ID, "ROAD_SEGMENT"],
    [WORKSHOP_CABIN_ID, "WORKSHOP"],
  ] as const)("%s is implemented and expands", (id, type) => {
    const bp = getBlueprint(id)!;
    expect(bp.implemented).toBe(true);
    expect(bp.structureType).toBe(type);
    const expanded = expandBlueprint(bp, resolveMaterials(bp, { oak_planks: 128, oak_door: 1, chest: 4, torch: 2, crafting_table: 1 }), "east");
    expect(expanded.blocks.length).toBeGreaterThan(0);
    const bill = countMaterials(expanded);
    expect(Object.keys(bill).length).toBeGreaterThan(0);
    for (const item of Object.keys(bill)) {
      expect(SUPPORTED_CONSTRUCTION_ITEMS.has(item)).toBe(true);
    }
    expect(validateBlueprintPipeline(bp, { oak_planks: 128, oak_door: 1, chest: 4, torch: 2, crafting_table: 1 }).ok).toBe(true);
  });

  it("marks simple_farm_v1 unsupported (not an ornamental plank pad)", () => {
    const bp = getBlueprint(SIMPLE_FARM_ID)!;
    expect(bp.structureType).toBe("FARM");
    expect(bp.implemented).toBe(false);
    expect(bp.name.toLowerCase()).toContain("unsupported");
    expect(validateBlueprintPipeline(bp, { dirt: 64 }).ok).toBe(false);
    expect(validateBlueprintPipeline(bp, { dirt: 64 }).issues.some((i) => i.code === "NOT_IMPLEMENTED")).toBe(true);
  });

  it("rejects extras outside optionalFeatures", () => {
    const bp = getBlueprint(STORAGE_SHED_ID)!;
    const materials = resolveMaterials(bp, { oak_planks: 128, oak_door: 1, chest: 4, torch: 2 });
    const expanded = expandBlueprint(bp, materials, "south", ["bed", "furnace", "crafting_table"]);
    expect(expanded.blocks.some((b) => b.role === "bed")).toBe(false);
    expect(expanded.blocks.some((b) => b.role === "furnace")).toBe(false);
    expect(expanded.blocks.some((b) => b.role === "crafting_table")).toBe(false);
  });

  it("requires exact door identity (no soft *_door match)", () => {
    const bp = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(bp, { oak_planks: 128, oak_door: 1 });
    const expanded = expandBlueprint(bp, materials, "south", ["chest", "lighting", "crafting_table"]);
    const door = expanded.blocks.find((b) => b.multiblockPart === "door_lower")!;
    expect(blockMatchesPlan(door, "oak_door", materials)).toBe(true);
    expect(blockMatchesPlan(door, "spruce_door", materials)).toBe(false);
  });
});
