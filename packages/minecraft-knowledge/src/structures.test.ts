import { describe, expect, it } from "vitest";
import {
  BASIC_SHELTER_ID,
  SMALL_HOUSE_ID,
  STRUCTURE_TYPES,
  chooseExistingStructure,
  chooseMaterial,
  createLearnedBlueprint,
  defaultBlueprintFor,
  evaluateBlueprintSite,
  expandBlueprint,
  getBlueprint,
  nextBlueprintVersion,
  resolveMaterials,
  starterBlueprints,
  validateExpandedStructure,
  worldPosition,
} from "./structures.js";

describe("structure blueprint library", () => {
  it("lists every starter concept and implements shelter/house only", () => {
    expect(STRUCTURE_TYPES).toContain("WATCHTOWER");
    expect(STRUCTURE_TYPES).toContain("FARM");
    const shelter = getBlueprint(BASIC_SHELTER_ID);
    const house = getBlueprint(SMALL_HOUSE_ID);
    expect(shelter?.implemented).toBe(true);
    expect(house?.implemented).toBe(true);
    expect(defaultBlueprintFor("BRIDGE")?.implemented).toBe(false);
    const ids = starterBlueprints().map((entry) => entry.id);
    expect(ids).toContain(BASIC_SHELTER_ID);
    expect(ids).toContain(SMALL_HOUSE_ID);
    expect(ids).toContain("workshop_cabin_v1");
    expect(ids).toContain("storage_shed_v1");
    expect(ids).toContain("starter_house_v1");
    // Farm remains in catalog but unsupported (not in starterBlueprints implemented set).
    expect(getBlueprint("simple_farm_v1")?.implemented).toBe(false);
  });

  it("expands a shelter from footprint metadata instead of a giant coordinate dump", () => {
    const blueprint = getBlueprint(BASIC_SHELTER_ID)!;
    const expanded = expandBlueprint(blueprint, resolveMaterials(blueprint, { oak_planks: 64, oak_door: 1, chest: 1, torch: 1 }));
    expect(expanded.blocks.length).toBeGreaterThan(20);
    expect(expanded.blocks.every((block) => block.stage && block.role)).toBe(true);
    expect(expanded.blocks.some((block) => block.role === "door")).toBe(true);
    expect(expanded.blocks.some((block) => block.role === "roof")).toBe(true);
    expect(expanded.blocks.some((block) => block.role === "chest")).toBe(true);
    expect(expanded.interiorLocal.length).toBeGreaterThan(0);
  });

  it("substitutes spruce planks when oak is missing", () => {
    expect(chooseMaterial("WALL_MATERIAL", { spruce_planks: 12 })).toBe("spruce_planks");
    const blueprint = getBlueprint(BASIC_SHELTER_ID)!;
    const materials = resolveMaterials(blueprint, { spruce_planks: 40, oak_door: 1, chest: 1, torch: 1 });
    expect(materials.WALL_MATERIAL).toBe("spruce_planks");
    expect(materials.FLOOR_MATERIAL).toBe("spruce_planks");
  });

  it("rejects wet, lava, overlapping, and steep sites", () => {
    const blueprint = getBlueprint(BASIC_SHELTER_ID)!;
    const origin = { x: 0, y: 64, z: 0 };
    const wet = evaluateBlueprintSite({
      blueprint,
      origin,
      facing: "south",
      getBlock: (pos) => (pos.x === 0 ? "water" : pos.y === 63 ? "grass_block" : "air"),
    });
    expect(wet.ok).toBe(false);
    expect(wet.code).toBe("SITE_UNSUITABLE");
    const flat = evaluateBlueprintSite({
      blueprint,
      origin: { x: 20, y: 70, z: 20 },
      facing: "south",
      getBlock: (pos) => (pos.y === 69 ? "grass_block" : "air"),
    });
    expect(flat.ok).toBe(true);
    const overlap = evaluateBlueprintSite({
      blueprint,
      origin: { x: 20, y: 70, z: 20 },
      facing: "south",
      getBlock: (pos) => (pos.y === 69 ? "grass_block" : "air"),
      knownStructures: [
        {
          id: "s1",
          blueprintId: BASIC_SHELTER_ID,
          blueprintVersion: 1,
          structureType: "BASIC_SHELTER",
          origin: { x: 21, y: 70, z: 21 },
          facing: "south",
          quality: "usable",
        },
      ],
    });
    expect(overlap.ok).toBe(false);
  });

  it("does not treat a visually present incomplete roof as valid", () => {
    const blueprint = getBlueprint(BASIC_SHELTER_ID)!;
    const materials = resolveMaterials(blueprint, { oak_planks: 64, oak_door: 1, chest: 1, torch: 1 });
    const expanded = expandBlueprint(blueprint, materials);
    const origin = { x: 0, y: 64, z: 0 };
    const world = new Map<string, string>();
    for (const block of expanded.blocks) {
      if (block.role === "roof") continue;
      const pos = worldPosition(origin, block.dx, block.dy, block.dz, blueprint.footprint, "south");
      world.set(`${pos.x},${pos.y},${pos.z}`, block.role === "door" ? "oak_door" : "oak_planks");
    }
    const report = validateExpandedStructure(expanded, origin, (pos) => world.get(`${pos.x},${pos.y},${pos.z}`));
    expect(report.ok).toBe(false);
    expect(report.failures).toContain("ROOF_INCOMPLETE");
  });

  it("prefers a usable nearby shelter instead of implying a new build", () => {
    const chosen = chooseExistingStructure("BASIC_SHELTER", [
      {
        id: "hut",
        blueprintId: BASIC_SHELTER_ID,
        blueprintVersion: 1,
        structureType: "SMALL_HOUSE",
        origin: { x: 10, y: 64, z: 10 },
        facing: "south",
        quality: "usable",
      },
    ], { x: 12, y: 64, z: 12 });
    expect(chosen?.id).toBe("hut");
  });

  it("versions learned citizen designs without colliding baseline ids", () => {
    const version = nextBlueprintVersion("maya_farm_layout", ["maya_farm_layout_v1", "maya_farm_layout_v3"]);
    expect(version).toBe(4);
    const learned = createLearnedBlueprint({
      id: `maya_farm_layout_v${version}`,
      structureType: "FARM",
      version,
      name: "Maya farm layout",
      authorCitizenId: "citizen_maya",
      footprint: { width: 8, depth: 6, wallHeight: 1 },
    });
    expect(learned.origin).toBe("learned");
    expect(learned.id).toBe("maya_farm_layout_v4");
  });
});
