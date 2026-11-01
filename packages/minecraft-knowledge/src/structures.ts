import type { Vec3 } from "@civ/shared";

export const STRUCTURE_TYPES = [
  "BASIC_SHELTER",
  "SMALL_HOUSE",
  "STORAGE_SHED",
  "FARM",
  "ANIMAL_PEN",
  "WORKSHOP",
  "MINE_ENTRANCE",
  "BRIDGE",
  "ROAD_SEGMENT",
  "BASIC_WALL",
  "WATCHTOWER",
] as const;

export type StructureType = (typeof STRUCTURE_TYPES)[number];

export const BUILD_STAGES = [
  "SITE_SELECTION",
  "SITE_CLEARING",
  "FOUNDATION",
  "FLOOR",
  "WALLS",
  "DOOR_ACCESS",
  "ROOF",
  "INTERIOR",
  "WORKSTATIONS",
  "FINAL_VALIDATION",
] as const;

export type BuildStage = (typeof BUILD_STAGES)[number];

export const CARDINALS = ["south", "north", "east", "west"] as const;
export type Cardinal = (typeof CARDINALS)[number];

export const MATERIAL_CATEGORIES = {
  WALL_MATERIAL: ["oak_planks", "spruce_planks", "birch_planks", "cobblestone", "stone_bricks"],
  FLOOR_MATERIAL: ["oak_planks", "spruce_planks", "birch_planks", "cobblestone", "stone_bricks"],
  ROOF_MATERIAL: ["oak_planks", "spruce_planks", "birch_planks", "cobblestone", "stone_bricks"],
  FOUNDATION_MATERIAL: ["cobblestone", "stone_bricks", "oak_planks", "spruce_planks", "birch_planks"],
  DOOR_MATERIAL: ["oak_door", "spruce_door", "birch_door"],
  LIGHT_MATERIAL: ["torch"],
  STORAGE_MATERIAL: ["chest"],
  WORKSTATION_MATERIAL: ["crafting_table"],
  BED_MATERIAL: ["red_bed", "white_bed"],
  FURNACE_MATERIAL: ["furnace"],
} as const;

export type MaterialCategory = keyof typeof MATERIAL_CATEGORIES;

export const STRUCTURE_FEATURES = [
  "enclosed_interior",
  "accessible_entrance",
  "roof",
  "floor",
  "min_head_clearance",
  "bed",
  "chest",
  "crafting_table",
  "furnace",
  "lighting",
] as const;

export type StructureFeature = (typeof STRUCTURE_FEATURES)[number];

export const STRUCTURE_VALIDATION_CODES = [
  "SITE_UNSUITABLE",
  "ENTRANCE_BLOCKED",
  "INTERIOR_UNREACHABLE",
  "ROOF_INCOMPLETE",
  "WORKSTATION_UNREACHABLE",
  "STRUCTURE_INCOMPLETE",
] as const;

export type StructureValidationCode = (typeof STRUCTURE_VALIDATION_CODES)[number];

export type BlueprintOrigin = "baseline" | "learned" | "copied" | "settlement_variant";

export type BlueprintFootprint = {
  width: number;
  depth: number;
  wallHeight: number;
};

export type StructureBlueprint = {
  id: string;
  structureType: StructureType;
  version: number;
  name: string;
  origin: BlueprintOrigin;
  implemented: boolean;
  footprint: BlueprintFootprint;
  minClearance: number;
  anchorPoint: "south_west_corner";
  entranceDirection: Cardinal;
  stages: BuildStage[];
  requiredFeatures: StructureFeature[];
  optionalFeatures: StructureFeature[];
  materialRequirements: Partial<Record<MaterialCategory, number>>;
  allowedMaterialSubstitutions: Partial<Record<MaterialCategory, readonly string[]>>;
  validationRules: StructureValidationCode[];
  permitsWater?: boolean;
  permitsLava?: boolean;
  maxSlope?: number;
  authorCitizenId?: string;
  sourceBlueprintId?: string;
  settlementStyleId?: string;
  abandoned?: boolean;
  successCount?: number;
};

export type PlannedBlockRole =
  | "foundation"
  | "floor"
  | "wall"
  | "door"
  | "roof"
  | "lighting"
  | "chest"
  | "crafting_table"
  | "furnace"
  | "bed";

export type MultiblockPart = "door_lower" | "door_upper" | "bed_foot" | "bed_head";

export type PlannedBlock = {
  dx: number;
  dy: number;
  dz: number;
  role: PlannedBlockRole;
  stage: BuildStage;
  category?: MaterialCategory;
  feature?: StructureFeature;
  optional?: boolean;
  skipIfSolid?: boolean;
  /**
   * Multiblock identity. Upper door / bed head are world-verified but not separately placed
   * or counted in inventory (one item creates both cells in Minecraft).
   */
  multiblockPart?: MultiblockPart;
  /** When true: verify in world, skip inventory + placement scheduling. */
  impliedBySibling?: boolean;
};

export type ResolvedMaterials = Partial<Record<MaterialCategory, string>>;

export type ExpandedBlueprint = {
  blueprint: StructureBlueprint;
  facing: Cardinal;
  materials: ResolvedMaterials;
  blocks: PlannedBlock[];
  footprint: { width: number; depth: number; height: number };
  entranceLocal: { dx: number; dy: number; dz: number };
  interiorLocal: Array<{ dx: number; dy: number; dz: number }>;
  workstationLocal: Array<{ dx: number; dy: number; dz: number; role: PlannedBlockRole }>;
};

export type KnownStructureRecord = {
  id: string;
  blueprintId: string;
  blueprintVersion: number;
  structureType: StructureType;
  origin: Vec3;
  facing: Cardinal;
  quality: "known" | "incomplete" | "usable" | "safe";
  distance?: number;
};

export const BASIC_SHELTER_ID = "basic_shelter_v1";
export const SMALL_HOUSE_ID = "small_house_v1";
/** Alias catalog id for the small house (Mission 003 starter_house_v1). */
export const STARTER_HOUSE_ID = "starter_house_v1";
/** Small workshop cabin — first Autonomous Construction Engine vertical-slice blueprint. */
export const WORKSHOP_CABIN_ID = "workshop_cabin_v1";
export const STORAGE_SHED_ID = "storage_shed_v1";
export const SIMPLE_FARM_ID = "simple_farm_v1";
export const SMALL_WAREHOUSE_ID = "small_warehouse_v1";
export const PATH_SEGMENT_ID = "path_segment_v1";

/** Soft limits for approved survival blueprints (reject oversized plans). */
export const BLUEPRINT_MAX_WIDTH = 12;
export const BLUEPRINT_MAX_DEPTH = 12;
export const BLUEPRINT_MAX_WALL_HEIGHT = 6;
export const BLUEPRINT_MAX_CELLS = 400;

const SHELTER_STAGES: BuildStage[] = [...BUILD_STAGES];

const SHELTER_VALIDATION: StructureValidationCode[] = [
  "SITE_UNSUITABLE",
  "ENTRANCE_BLOCKED",
  "INTERIOR_UNREACHABLE",
  "ROOF_INCOMPLETE",
  "WORKSTATION_UNREACHABLE",
  "STRUCTURE_INCOMPLETE",
];

function shelterBlueprint(partial: Omit<StructureBlueprint, "stages" | "validationRules" | "allowedMaterialSubstitutions" | "origin" | "anchorPoint" | "entranceDirection" | "minClearance"> & Partial<StructureBlueprint>): StructureBlueprint {
  return {
    origin: "baseline",
    anchorPoint: "south_west_corner",
    entranceDirection: "south",
    minClearance: 2,
    stages: SHELTER_STAGES,
    validationRules: SHELTER_VALIDATION,
    allowedMaterialSubstitutions: { ...MATERIAL_CATEGORIES },
    ...partial,
  };
}

const BASIC_SHELTER: StructureBlueprint = shelterBlueprint({
  id: BASIC_SHELTER_ID,
  structureType: "BASIC_SHELTER",
  version: 1,
  name: "Basic Shelter",
  implemented: true,
  footprint: { width: 4, depth: 3, wallHeight: 2 },
  requiredFeatures: ["enclosed_interior", "accessible_entrance", "roof", "floor", "min_head_clearance"],
  optionalFeatures: ["chest", "lighting", "crafting_table", "bed", "furnace"],
  materialRequirements: {
    WALL_MATERIAL: 18,
    FLOOR_MATERIAL: 12,
    ROOF_MATERIAL: 12,
    FOUNDATION_MATERIAL: 12,
    DOOR_MATERIAL: 1,
    LIGHT_MATERIAL: 1,
    STORAGE_MATERIAL: 1,
  },
  maxSlope: 1,
});

const SMALL_HOUSE: StructureBlueprint = shelterBlueprint({
  id: SMALL_HOUSE_ID,
  structureType: "SMALL_HOUSE",
  version: 1,
  name: "Small House",
  implemented: true,
  footprint: { width: 5, depth: 4, wallHeight: 2 },
  requiredFeatures: ["enclosed_interior", "accessible_entrance", "roof", "floor", "min_head_clearance"],
  optionalFeatures: ["chest", "crafting_table", "lighting", "bed", "furnace"],
  materialRequirements: {
    WALL_MATERIAL: 26,
    FLOOR_MATERIAL: 20,
    ROOF_MATERIAL: 20,
    FOUNDATION_MATERIAL: 20,
    DOOR_MATERIAL: 1,
    LIGHT_MATERIAL: 1,
    STORAGE_MATERIAL: 1,
    WORKSTATION_MATERIAL: 1,
  },
  maxSlope: 1,
});

const WORKSHOP_CABIN: StructureBlueprint = shelterBlueprint({
  id: WORKSHOP_CABIN_ID,
  structureType: "WORKSHOP",
  version: 1,
  name: "Workshop Cabin",
  implemented: true,
  footprint: { width: 5, depth: 4, wallHeight: 2 },
  requiredFeatures: ["enclosed_interior", "accessible_entrance", "roof", "floor", "min_head_clearance", "crafting_table"],
  optionalFeatures: ["chest", "lighting", "bed", "furnace"],
  materialRequirements: {
    WALL_MATERIAL: 26,
    FLOOR_MATERIAL: 20,
    ROOF_MATERIAL: 20,
    FOUNDATION_MATERIAL: 20,
    DOOR_MATERIAL: 1,
    LIGHT_MATERIAL: 1,
    STORAGE_MATERIAL: 1,
    WORKSTATION_MATERIAL: 1,
  },
  maxSlope: 1,
});

/** Mission 003 catalog alias — same footprint/features as small_house_v1. */
const STARTER_HOUSE: StructureBlueprint = shelterBlueprint({
  id: STARTER_HOUSE_ID,
  structureType: "SMALL_HOUSE",
  version: 1,
  name: "Starter House",
  implemented: true,
  footprint: { width: 5, depth: 4, wallHeight: 2 },
  requiredFeatures: ["enclosed_interior", "accessible_entrance", "roof", "floor", "min_head_clearance"],
  optionalFeatures: ["chest", "crafting_table", "lighting", "bed", "furnace"],
  materialRequirements: {
    WALL_MATERIAL: 26,
    FLOOR_MATERIAL: 20,
    ROOF_MATERIAL: 20,
    FOUNDATION_MATERIAL: 20,
    DOOR_MATERIAL: 1,
    LIGHT_MATERIAL: 1,
    STORAGE_MATERIAL: 1,
    WORKSTATION_MATERIAL: 1,
  },
  maxSlope: 1,
});

const STORAGE_SHED: StructureBlueprint = shelterBlueprint({
  id: STORAGE_SHED_ID,
  structureType: "STORAGE_SHED",
  version: 1,
  name: "Storage Shed",
  implemented: true,
  footprint: { width: 4, depth: 4, wallHeight: 2 },
  requiredFeatures: ["enclosed_interior", "accessible_entrance", "roof", "floor", "chest"],
  optionalFeatures: ["lighting"],
  materialRequirements: {
    WALL_MATERIAL: 20,
    FLOOR_MATERIAL: 16,
    ROOF_MATERIAL: 16,
    FOUNDATION_MATERIAL: 16,
    DOOR_MATERIAL: 1,
    LIGHT_MATERIAL: 1,
    STORAGE_MATERIAL: 2,
  },
  maxSlope: 1,
});

/**
 * Mission 005: previous "farm" expanded to an oak_planks pad — not a functional farm.
 * Marked unsupported until a hoe-till + water-bucket survival skill path exists.
 * expandFarmPlot retained for future enablement (dirt / farmland / water).
 */
const SIMPLE_FARM: StructureBlueprint = shelterBlueprint({
  id: SIMPLE_FARM_ID,
  structureType: "FARM",
  version: 2,
  name: "Simple Farm (unsupported)",
  implemented: false,
  footprint: { width: 5, depth: 5, wallHeight: 1 },
  requiredFeatures: ["floor"],
  optionalFeatures: [],
  materialRequirements: {
    FLOOR_MATERIAL: 16,
    FOUNDATION_MATERIAL: 8,
  },
  maxSlope: 1,
  permitsWater: true,
});

const SMALL_WAREHOUSE: StructureBlueprint = shelterBlueprint({
  id: SMALL_WAREHOUSE_ID,
  structureType: "STORAGE_SHED",
  version: 1,
  name: "Small Warehouse",
  implemented: true,
  footprint: { width: 6, depth: 5, wallHeight: 3 },
  requiredFeatures: ["enclosed_interior", "accessible_entrance", "roof", "floor", "chest"],
  optionalFeatures: ["lighting", "crafting_table"],
  materialRequirements: {
    WALL_MATERIAL: 40,
    FLOOR_MATERIAL: 30,
    ROOF_MATERIAL: 30,
    FOUNDATION_MATERIAL: 30,
    DOOR_MATERIAL: 1,
    LIGHT_MATERIAL: 2, // expand places this many torches; synced by authoritativeBomFromExpanded
    STORAGE_MATERIAL: 3,
  },
  maxSlope: 1,
});

const PATH_SEGMENT: StructureBlueprint = shelterBlueprint({
  id: PATH_SEGMENT_ID,
  structureType: "ROAD_SEGMENT",
  version: 1,
  name: "Path Segment",
  implemented: true,
  footprint: { width: 3, depth: 5, wallHeight: 0 },
  requiredFeatures: ["floor"],
  optionalFeatures: [],
  materialRequirements: {
    FLOOR_MATERIAL: 15,
  },
  maxSlope: 1,
});

function stub(structureType: StructureType, id: string, name: string, footprint: BlueprintFootprint): StructureBlueprint {
  return shelterBlueprint({
    id,
    structureType,
    version: 1,
    name,
    implemented: false,
    footprint,
    requiredFeatures: [],
    optionalFeatures: [],
    materialRequirements: {},
  });
}

const LIBRARY: StructureBlueprint[] = [
  BASIC_SHELTER,
  SMALL_HOUSE,
  STARTER_HOUSE,
  WORKSHOP_CABIN,
  STORAGE_SHED,
  SIMPLE_FARM,
  SMALL_WAREHOUSE,
  PATH_SEGMENT,
  stub("ANIMAL_PEN", "animal_pen_v1", "Animal Pen", { width: 6, depth: 6, wallHeight: 1 }),
  stub("MINE_ENTRANCE", "mine_entrance_v1", "Mine Entrance", { width: 3, depth: 3, wallHeight: 3 }),
  stub("BRIDGE", "bridge_v1", "Bridge Segment", { width: 3, depth: 6, wallHeight: 1 }),
  stub("BASIC_WALL", "basic_wall_v1", "Wall / Fence", { width: 1, depth: 6, wallHeight: 2 }),
  stub("WATCHTOWER", "watchtower_v1", "Watchtower", { width: 3, depth: 3, wallHeight: 6 }),
];

const BY_ID = new Map(LIBRARY.map((entry) => [entry.id, entry]));

/** Sync declared materialRequirements to expanded authoritative BOM (eliminates drift). */
function syncLibraryMaterialRequirements(): void {
  const plenty: Record<string, number> = {
    oak_planks: 500,
    oak_door: 8,
    chest: 8,
    torch: 8,
    crafting_table: 4,
    red_bed: 2,
    furnace: 2,
    cobblestone: 200,
    dirt: 200,
  };
  for (const bp of LIBRARY) {
    if (!bp.implemented) continue;
    const materials = resolveMaterials(bp, plenty);
    const extras = sanitizeBlueprintExtras(bp, [
      "chest",
      "lighting",
      "crafting_table",
      "bed",
      "furnace",
    ]);
    const expanded = expandBlueprint(bp, materials, "south", extras);
    bp.materialRequirements = authoritativeBomFromExpanded(expanded);
  }
}

// resolveMaterials / expandBlueprint are defined below — sync deferred via ensureBomSynced().
let bomSynced = false;
function ensureBomSynced(): void {
  if (bomSynced) return;
  bomSynced = true;
  syncLibraryMaterialRequirements();
}

/** Register or replace a blueprint in the in-memory catalog (tests / learned designs). */
export function registerBlueprint(blueprint: StructureBlueprint): void {
  ensureBomSynced();
  const index = LIBRARY.findIndex((entry) => entry.id === blueprint.id);
  if (index >= 0) LIBRARY[index] = blueprint;
  else LIBRARY.push(blueprint);
  BY_ID.set(blueprint.id, blueprint);
  bomSynced = false; // re-sync on next read so learned blueprints stay consistent
}

export function listBlueprints(): StructureBlueprint[] {
  ensureBomSynced();
  return [...LIBRARY];
}

export function getBlueprint(id: string): StructureBlueprint | undefined {
  ensureBomSynced();
  return BY_ID.get(id);
}

export function defaultBlueprintFor(type: StructureType): StructureBlueprint | undefined {
  ensureBomSynced();
  return LIBRARY.find((entry) => entry.structureType === type && entry.implemented) ?? LIBRARY.find((entry) => entry.structureType === type);
}

export function starterBlueprints(): StructureBlueprint[] {
  ensureBomSynced();
  return LIBRARY.filter((entry) => entry.origin === "baseline" && entry.implemented);
}

export function createLearnedBlueprint(args: {
  id: string;
  structureType: StructureType;
  version: number;
  name: string;
  authorCitizenId: string;
  sourceBlueprintId?: string;
  settlementStyleId?: string;
  footprint: BlueprintFootprint;
  origin?: Exclude<BlueprintOrigin, "baseline">;
}): StructureBlueprint {
  const source = args.sourceBlueprintId ? getBlueprint(args.sourceBlueprintId) : defaultBlueprintFor(args.structureType);
  return {
    id: args.id,
    structureType: args.structureType,
    version: args.version,
    name: args.name,
    origin: args.origin ?? "learned",
    implemented: false,
    footprint: args.footprint,
    minClearance: source?.minClearance ?? 2,
    anchorPoint: "south_west_corner",
    entranceDirection: source?.entranceDirection ?? "south",
    stages: [...SHELTER_STAGES],
    requiredFeatures: source?.requiredFeatures ?? ["enclosed_interior", "accessible_entrance", "roof", "floor"],
    optionalFeatures: source?.optionalFeatures ?? [],
    materialRequirements: { ...(source?.materialRequirements ?? {}) },
    allowedMaterialSubstitutions: { ...MATERIAL_CATEGORIES },
    validationRules: [...SHELTER_VALIDATION],
    authorCitizenId: args.authorCitizenId,
    sourceBlueprintId: args.sourceBlueprintId,
    settlementStyleId: args.settlementStyleId,
    successCount: 0,
  };
}

export function nextBlueprintVersion(idBase: string, existingIds: string[]): number {
  let version = 1;
  for (const id of existingIds) {
    if (!id.startsWith(`${idBase}_v`)) continue;
    const parsed = Number(id.slice(idBase.length + 2));
    if (Number.isFinite(parsed) && parsed >= version) version = parsed + 1;
  }
  return version;
}

export function stageIndex(stage: BuildStage): number {
  return BUILD_STAGES.indexOf(stage);
}

export function nextBuildStage(stage: BuildStage): BuildStage | undefined {
  return BUILD_STAGES[stageIndex(stage) + 1];
}

export function migrateLegacyStage(stage: string): BuildStage {
  const map: Record<string, BuildStage> = {
    site: "SITE_SELECTION",
    floor: "FLOOR",
    walls: "WALLS",
    door: "DOOR_ACCESS",
    roof: "ROOF",
    interior: "INTERIOR",
    verify: "FINAL_VALIDATION",
  };
  if ((BUILD_STAGES as readonly string[]).includes(stage)) return stage as BuildStage;
  return map[stage] ?? "SITE_SELECTION";
}

export function rotatedFootprint(footprint: BlueprintFootprint, facing: Cardinal): { width: number; depth: number } {
  if (facing === "east" || facing === "west") {
    return { width: footprint.depth, depth: footprint.width };
  }
  return { width: footprint.width, depth: footprint.depth };
}

export function rotateOffset(
  dx: number,
  dz: number,
  footprint: BlueprintFootprint,
  facing: Cardinal,
): { dx: number; dz: number } {
  const { width, depth } = footprint;
  if (facing === "south") return { dx, dz };
  if (facing === "north") return { dx: width - 1 - dx, dz: depth - 1 - dz };
  if (facing === "east") return { dx: dz, dz: width - 1 - dx };
  return { dx: depth - 1 - dz, dz: dx };
}

export function worldPosition(origin: Vec3, dx: number, dy: number, dz: number, footprint: BlueprintFootprint, facing: Cardinal): Vec3 {
  const rotated = rotateOffset(dx, dz, footprint, facing);
  return { x: origin.x + rotated.dx, y: origin.y + dy, z: origin.z + rotated.dz };
}

export function chooseMaterial(
  category: MaterialCategory,
  available: Record<string, number>,
  allowed: readonly string[] = MATERIAL_CATEGORIES[category],
): string | undefined {
  for (const name of allowed) {
    if ((available[name] ?? 0) > 0) return name;
  }
  return allowed[0];
}

export function resolveMaterials(
  blueprint: StructureBlueprint,
  available: Record<string, number>,
  preferred?: ResolvedMaterials,
): ResolvedMaterials {
  const resolved: ResolvedMaterials = {};
  for (const category of Object.keys(MATERIAL_CATEGORIES) as MaterialCategory[]) {
    if (preferred?.[category] && (available[preferred[category]!] ?? 0) > 0) {
      resolved[category] = preferred[category];
      continue;
    }
    const allowed = blueprint.allowedMaterialSubstitutions[category] ?? MATERIAL_CATEGORIES[category];
    resolved[category] = chooseMaterial(category, available, allowed);
  }
  return resolved;
}

export function concreteBlock(planned: PlannedBlock, materials: ResolvedMaterials): string {
  if (planned.category && materials[planned.category]) return materials[planned.category]!;
  if (planned.role === "door") return materials.DOOR_MATERIAL ?? "oak_door";
  if (planned.role === "lighting") return materials.LIGHT_MATERIAL ?? "torch";
  if (planned.role === "chest") return materials.STORAGE_MATERIAL ?? "chest";
  if (planned.role === "crafting_table") return materials.WORKSTATION_MATERIAL ?? "crafting_table";
  if (planned.role === "furnace") return materials.FURNACE_MATERIAL ?? "furnace";
  if (planned.role === "bed") return materials.BED_MATERIAL && materials.BED_MATERIAL.endsWith("_bed") ? materials.BED_MATERIAL : "red_bed";
  return materials.WALL_MATERIAL ?? "oak_planks";
}

function normalizeBlockId(name: string): string {
  return name.replace(/^minecraft:/, "");
}

/**
 * Exact identity match for planned cells.
 * Doors/beds require the concrete material name — no soft `*_door` / `*_bed` wildcard.
 * Category substitutes (plank family, etc.) still allowed when category is set.
 * Without observable block properties, callers must treat directional state as unverified separately.
 */
export function blockMatchesPlan(planned: PlannedBlock, actual: string | undefined, materials: ResolvedMaterials): boolean {
  if (!actual || actual === "air" || actual === "cave_air" || actual === "void_air") return false;
  const actualName = normalizeBlockId(actual);
  const expected = normalizeBlockId(concreteBlock(planned, materials));
  if (actualName === expected) return true;
  // Wall torch is an acceptable lighting form of torch placement.
  if (planned.role === "lighting" && expected === "torch" && actualName === "wall_torch") return true;
  if (planned.role === "chest" && (actualName === "chest" || actualName === "trapped_chest" || actualName === "barrel")) {
    return expected === "chest" || expected === actualName;
  }
  if (planned.skipIfSolid && actualName !== "air" && actualName !== "cave_air") return true;
  if (planned.category && planned.role !== "door" && planned.role !== "bed") {
    const allowed = MATERIAL_CATEGORIES[planned.category] as readonly string[];
    if (allowed.includes(actualName)) return true;
  }
  return false;
}

/** Opposite cardinal for bed head offset (pillow faces this direction). */
export function oppositeCardinal(facing: Cardinal): Cardinal {
  if (facing === "south") return "north";
  if (facing === "north") return "south";
  if (facing === "east") return "west";
  return "east";
}

export function bedHeadOffset(bedFacing: Cardinal): { dx: number; dz: number } {
  if (bedFacing === "south") return { dx: 0, dz: 1 };
  if (bedFacing === "north") return { dx: 0, dz: -1 };
  if (bedFacing === "east") return { dx: 1, dz: 0 };
  return { dx: -1, dz: 0 };
}

function pushRect(
  blocks: PlannedBlock[],
  width: number,
  depth: number,
  dy: number,
  stage: BuildStage,
  role: PlannedBlockRole,
  category: MaterialCategory,
  skip?: (dx: number, dz: number) => boolean,
): void {
  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      if (skip?.(dx, dz)) continue;
      blocks.push({ dx, dy, dz, stage, role, category });
    }
  }
}

function expandBoxShelter(blueprint: StructureBlueprint, include: Set<StructureFeature>): PlannedBlock[] {
  const { width, depth, wallHeight } = blueprint.footprint;
  const doorX = Math.floor(width / 2);
  const blocks: PlannedBlock[] = [];
  pushRect(blocks, width, depth, -1, "FOUNDATION", "foundation", "FOUNDATION_MATERIAL");
  for (const block of blocks) {
    if (block.stage === "FOUNDATION") block.skipIfSolid = true;
  }
  pushRect(blocks, width, depth, 0, "FLOOR", "floor", "FLOOR_MATERIAL");
  for (let y = 1; y <= wallHeight; y += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      for (let dz = 0; dz < depth; dz += 1) {
        const wall = dx === 0 || dz === 0 || dx === width - 1 || dz === depth - 1;
        const door = dx === doorX && dz === 0 && y <= 2;
        if (wall && !door) {
          blocks.push({ dx, dy: y, dz, stage: "WALLS", role: "wall", category: "WALL_MATERIAL" });
        }
      }
    }
  }
  blocks.push({
    dx: doorX,
    dy: 1,
    dz: 0,
    stage: "DOOR_ACCESS",
    role: "door",
    category: "DOOR_MATERIAL",
    feature: "accessible_entrance",
    multiblockPart: "door_lower",
  });
  // Upper half: world-verified, not separately placed / inventoried (one door item).
  blocks.push({
    dx: doorX,
    dy: 2,
    dz: 0,
    stage: "DOOR_ACCESS",
    role: "door",
    category: "DOOR_MATERIAL",
    feature: "accessible_entrance",
    multiblockPart: "door_upper",
    impliedBySibling: true,
  });
  pushRect(blocks, width, depth, wallHeight + 1, "ROOF", "roof", "ROOF_MATERIAL");

  const interiorX = doorX === 1 ? 2 : 1;
  const interiorZ = depth > 2 ? 1 : 1;
  if (include.has("lighting")) {
    const lightCount = Math.max(1, blueprint.materialRequirements.LIGHT_MATERIAL ?? 1);
    for (let i = 0; i < lightCount; i += 1) {
      const lx = i === 0 ? interiorX : Math.min(width - 2, interiorX + 1 + (i % 2));
      const lz = i === 0 ? interiorZ : Math.min(depth - 2, interiorZ + Math.floor(i / 2));
      blocks.push({
        dx: lx,
        dy: Math.min(2, wallHeight),
        dz: lz,
        stage: "INTERIOR",
        role: "lighting",
        category: "LIGHT_MATERIAL",
        feature: "lighting",
        optional: !blueprint.requiredFeatures.includes("lighting"),
      });
    }
  }
  if (include.has("bed")) {
    // Foot against the back-right corner; head faces west into the room (avoids crafting_table).
    const footX = width - 2;
    const footZ = depth - 2;
    const bedFacing: Cardinal = "west";
    const head = bedHeadOffset(bedFacing);
    blocks.push({
      dx: footX,
      dy: 1,
      dz: footZ,
      stage: "INTERIOR",
      role: "bed",
      category: "BED_MATERIAL",
      feature: "bed",
      optional: true,
      multiblockPart: "bed_foot",
    });
    blocks.push({
      dx: footX + head.dx,
      dy: 1,
      dz: footZ + head.dz,
      stage: "INTERIOR",
      role: "bed",
      category: "BED_MATERIAL",
      feature: "bed",
      optional: true,
      multiblockPart: "bed_head",
      impliedBySibling: true,
    });
  }
  if (include.has("chest")) {
    blocks.push({
      dx: 1,
      dy: 1,
      dz: interiorZ,
      stage: "WORKSTATIONS",
      role: "chest",
      category: "STORAGE_MATERIAL",
      feature: "chest",
      optional: !blueprint.requiredFeatures.includes("chest"),
    });
  }
  if (include.has("crafting_table")) {
    blocks.push({
      dx: width - 2,
      dy: 1,
      dz: interiorZ,
      stage: "WORKSTATIONS",
      role: "crafting_table",
      category: "WORKSTATION_MATERIAL",
      feature: "crafting_table",
      optional: true,
    });
  }
  if (include.has("furnace")) {
    // Keep clear of bed (width-2, depth-2) and crafting_table (width-2, interiorZ).
    blocks.push({
      dx: 1,
      dy: 1,
      dz: depth - 2,
      stage: "WORKSTATIONS",
      role: "furnace",
      category: "FURNACE_MATERIAL",
      feature: "furnace",
      optional: true,
    });
  }
  return blocks;
}

/**
 * Future farm layout (dirt plots + center water). Not used while SIMPLE_FARM is unimplemented.
 * Uses dirt / farmland categories — never oak_planks pads.
 */
function expandFarmPlot(blueprint: StructureBlueprint): PlannedBlock[] {
  const { width, depth } = blueprint.footprint;
  const blocks: PlannedBlock[] = [];
  const cx = Math.floor(width / 2);
  const cz = Math.floor(depth / 2);
  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      if (dx === cx && dz === cz) continue; // water reserved for survival water_bucket skill
      const edge = dx === 0 || dz === 0 || dx === width - 1 || dz === depth - 1;
      blocks.push({
        dx,
        dy: 0,
        dz,
        stage: "FLOOR",
        role: "floor",
        category: edge ? "FOUNDATION_MATERIAL" : "FLOOR_MATERIAL",
      });
    }
  }
  return blocks;
}

function expandPathSegment(blueprint: StructureBlueprint): PlannedBlock[] {
  const { width, depth } = blueprint.footprint;
  const blocks: PlannedBlock[] = [];
  for (let dx = 0; dx < width; dx += 1) {
    for (let dz = 0; dz < depth; dz += 1) {
      blocks.push({ dx, dy: 0, dz, stage: "FLOOR", role: "floor", category: "FLOOR_MATERIAL" });
    }
  }
  return blocks;
}

/** Reject extras not declared on the blueprint (required ∪ optional). */
export function sanitizeBlueprintExtras(
  blueprint: StructureBlueprint,
  extras: StructureFeature[],
): StructureFeature[] {
  const allowed = new Set<StructureFeature>([
    ...blueprint.requiredFeatures,
    ...blueprint.optionalFeatures,
  ]);
  return extras.filter((feature) => allowed.has(feature));
}

export function expandBlueprint(
  blueprint: StructureBlueprint,
  materials: ResolvedMaterials,
  facing: Cardinal = "south",
  extras: StructureFeature[] = ["chest", "lighting"],
): ExpandedBlueprint {
  if (!blueprint.implemented) {
    return {
      blueprint,
      facing,
      materials,
      blocks: [],
      footprint: { width: blueprint.footprint.width, depth: blueprint.footprint.depth, height: blueprint.footprint.wallHeight + 2 },
      entranceLocal: { dx: Math.floor(blueprint.footprint.width / 2), dy: 1, dz: 0 },
      interiorLocal: [],
      workstationLocal: [],
    };
  }
  const include = new Set<StructureFeature>([
    ...blueprint.requiredFeatures,
    ...sanitizeBlueprintExtras(blueprint, extras),
  ]);
  // Default comfort features only when the blueprint declares them.
  if (
    blueprint.structureType === "SMALL_HOUSE" ||
    blueprint.structureType === "WORKSHOP" ||
    blueprint.structureType === "STORAGE_SHED"
  ) {
    for (const auto of ["lighting", "chest"] as const) {
      if (blueprint.requiredFeatures.includes(auto) || blueprint.optionalFeatures.includes(auto)) {
        include.add(auto);
      }
    }
    if (blueprint.structureType === "SMALL_HOUSE" || blueprint.structureType === "WORKSHOP") {
      if (
        blueprint.requiredFeatures.includes("crafting_table") ||
        blueprint.optionalFeatures.includes("crafting_table")
      ) {
        include.add("crafting_table");
      }
    }
  }

  let blocks: PlannedBlock[];
  if (blueprint.structureType === "FARM") {
    blocks = expandFarmPlot(blueprint);
  } else if (blueprint.structureType === "ROAD_SEGMENT") {
    blocks = expandPathSegment(blueprint);
  } else {
    blocks = expandBoxShelter(blueprint, include);
    // Storage shed / warehouse: second chest when STORAGE_MATERIAL requirement ≥ 2
    const storageNeed = blueprint.materialRequirements.STORAGE_MATERIAL ?? 0;
    if (storageNeed >= 2 && blueprint.structureType === "STORAGE_SHED") {
      // Avoid bed cell (width-2, depth-2) and first chest (1, interiorZ≈1).
      const { depth } = blueprint.footprint;
      blocks.push({
        dx: 1,
        dy: 1,
        dz: depth - 2,
        stage: "WORKSTATIONS",
        role: "chest",
        category: "STORAGE_MATERIAL",
        feature: "chest",
        optional: false,
      });
    }
    if (storageNeed >= 3 && blueprint.structureType === "STORAGE_SHED") {
      const { width, depth } = blueprint.footprint;
      blocks.push({
        dx: Math.floor(width / 2),
        dy: 1,
        dz: depth - 2,
        stage: "WORKSTATIONS",
        role: "chest",
        category: "STORAGE_MATERIAL",
        feature: "chest",
        optional: true,
      });
    }
  }

  const { width, depth, wallHeight } = blueprint.footprint;
  const doorX = Math.floor(width / 2);
  const interior: Array<{ dx: number; dy: number; dz: number }> = [];
  for (let dx = 1; dx < width - 1; dx += 1) {
    for (let dz = 1; dz < depth - 1; dz += 1) {
      interior.push({ dx, dy: 1, dz });
    }
  }
  return {
    blueprint,
    facing,
    materials,
    blocks,
    footprint: { width, depth, height: Math.max(1, wallHeight + 2) },
    entranceLocal: { dx: doorX, dy: blueprint.structureType === "ROAD_SEGMENT" || blueprint.structureType === "FARM" ? 0 : 1, dz: 0 },
    interiorLocal: interior,
    workstationLocal: blocks
      .filter((block) => block.role === "chest" || block.role === "crafting_table" || block.role === "furnace" || block.role === "bed")
      .map((block) => ({ dx: block.dx, dy: block.dy, dz: block.dz, role: block.role })),
  };
}

export function blocksForStage(expanded: ExpandedBlueprint, stage: BuildStage): PlannedBlock[] {
  return expanded.blocks.filter((block) => block.stage === stage);
}

/**
 * Bill of materials for inventory/crafting.
 * Implied multiblock siblings (door upper, bed head) do not consume inventory.
 * Duplicate chest cells each require one chest item.
 */
export function countMaterials(expanded: ExpandedBlueprint): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const block of expanded.blocks) {
    if (block.skipIfSolid) continue;
    if (block.impliedBySibling) continue;
    if (block.optional && block.role === "floor" && expanded.blueprint.structureType === "FARM") continue;
    const name = concreteBlock(block, expanded.materials);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/**
 * Authoritative category counts from expanded blocks (single source of truth).
 * Includes skipIfSolid foundation cells for metadata sync; inventory BOM still uses countMaterials.
 */
export function authoritativeBomFromExpanded(
  expanded: ExpandedBlueprint,
): Partial<Record<MaterialCategory, number>> {
  const req: Partial<Record<MaterialCategory, number>> = {};
  for (const block of expanded.blocks) {
    if (block.impliedBySibling || !block.category) continue;
    req[block.category] = (req[block.category] ?? 0) + 1;
  }
  return req;
}

/** True when blueprint.materialRequirements matches expanded authoritative BOM. */
export function materialRequirementsMatchExpanded(
  blueprint: StructureBlueprint,
  expanded: ExpandedBlueprint,
): { ok: boolean; declared: Partial<Record<MaterialCategory, number>>; actual: Partial<Record<MaterialCategory, number>>; drift: string[] } {
  const actual = authoritativeBomFromExpanded(expanded);
  const declared = { ...blueprint.materialRequirements };
  const drift: string[] = [];
  const keys = new Set([...Object.keys(declared), ...Object.keys(actual)]) as Set<MaterialCategory>;
  for (const key of keys) {
    const d = declared[key] ?? 0;
    const a = actual[key] ?? 0;
    if (d !== a) drift.push(`${key}: declared ${d} vs actual ${a}`);
  }
  return { ok: drift.length === 0, declared, actual, drift };
}

/** Recipe-aware gather/craft needs: planks may be satisfied by logs×4 offline estimate. */
export function recipeAwareMaterialNeeds(
  bill: Record<string, number>,
  inventory: Record<string, number>,
): { shortfall: Record<string, number>; craftHints: Array<{ item: string; from: string; note: string }> } {
  const shortfall: Record<string, number> = {};
  const craftHints: Array<{ item: string; from: string; note: string }> = [];
  const bag = { ...inventory };
  for (const [item, need] of Object.entries(bill)) {
    let have = bag[item] ?? 0;
    if (item.endsWith("_planks")) {
      const plankFamily =
        (bag.oak_planks ?? 0) + (bag.spruce_planks ?? 0) + (bag.birch_planks ?? 0);
      const logs =
        (bag.oak_log ?? 0) + (bag.spruce_log ?? 0) + (bag.birch_log ?? 0) + (bag.jungle_log ?? 0);
      const fromLogs = logs * 4;
      have = plankFamily + fromLogs;
      if (plankFamily < need && fromLogs > 0) {
        craftHints.push({
          item,
          from: "logs",
          note: `Up to ${fromLogs} planks craftable from held logs (4 planks/log); not free materials`,
        });
      }
    }
    if (have < need) shortfall[item] = need - have;
  }
  return { shortfall, craftHints };
}

export function footprintsOverlap(
  a: { origin: Vec3; width: number; depth: number },
  b: { origin: Vec3; width: number; depth: number },
  padding = 1,
): boolean {
  const a0x = a.origin.x - padding;
  const a1x = a.origin.x + a.width + padding;
  const a0z = a.origin.z - padding;
  const a1z = a.origin.z + a.depth + padding;
  const b0x = b.origin.x;
  const b1x = b.origin.x + b.width;
  const b0z = b.origin.z;
  const b1z = b.origin.z + b.depth;
  return a0x < b1x && a1x > b0x && a0z < b1z && a1z > b0z;
}

export function isShelterType(type: StructureType): boolean {
  return type === "BASIC_SHELTER" || type === "SMALL_HOUSE" || type === "WORKSHOP";
}

export function chooseExistingStructure(
  need: StructureType,
  known: KnownStructureRecord[],
  from?: Vec3,
  maxDistance = 24,
): KnownStructureRecord | undefined {
  const matches = known.filter((entry) => {
    if (entry.quality !== "usable" && entry.quality !== "safe") return false;
    if (need === "BASIC_SHELTER" || need === "SMALL_HOUSE") return isShelterType(entry.structureType);
    return entry.structureType === need;
  });
  const scored = matches
    .map((entry) => {
      const distance =
        entry.distance ??
        (from
          ? Math.hypot(entry.origin.x - from.x, entry.origin.y - from.y, entry.origin.z - from.z)
          : 0);
      return { entry, distance };
    })
    .filter((row) => row.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
  return scored[0]?.entry;
}

export type SiteCheck = {
  ok: boolean;
  score: number;
  code?: "SITE_UNSUITABLE";
  reason?: string;
  waterHits: number;
  lavaHits: number;
  dropHits: number;
  slope: number;
  overlapHits: number;
  roadHits: number;
  approachOk: number;
  solidFloor: number;
};

const REPLACEABLE = new Set(["air", "cave_air", "void_air", "short_grass", "grass", "tall_grass", "fern", "dead_bush", "snow", "glow_lichen"]);

export function isReplaceableName(name: string | undefined): boolean {
  if (!name) return true;
  return REPLACEABLE.has(name) || name.endsWith("_carpet");
}

export function evaluateBlueprintSite(args: {
  blueprint: StructureBlueprint;
  origin: Vec3;
  facing: Cardinal;
  getBlock: (pos: Vec3) => string | undefined;
  knownStructures?: KnownStructureRecord[];
}): SiteCheck {
  const empty = (reason: string): SiteCheck => ({
    ok: false,
    score: 0,
    code: "SITE_UNSUITABLE",
    reason,
    waterHits: 0,
    lavaHits: 0,
    dropHits: 0,
    slope: 0,
    overlapHits: 0,
    roadHits: 0,
    approachOk: 0,
    solidFloor: 0,
  });
  const size = rotatedFootprint(args.blueprint.footprint, args.facing);
  const heights: number[] = [];
  let waterHits = 0;
  let lavaHits = 0;
  let dropHits = 0;
  let roadHits = 0;
  let solidFloor = 0;
  let plants = 0;
  let solids = 0;
  for (let dx = 0; dx < size.width; dx += 1) {
    for (let dz = 0; dz < size.depth; dz += 1) {
      const column = { x: args.origin.x + dx, y: args.origin.y, z: args.origin.z + dz };
      const here = args.getBlock(column);
      const below = args.getBlock({ ...column, y: column.y - 1 });
      const below2 = args.getBlock({ ...column, y: column.y - 2 });
      const below3 = args.getBlock({ ...column, y: column.y - 3 });
      if (here === "water" || below === "water") waterHits += 1;
      if (here === "lava" || below === "lava") lavaHits += 1;
      if (here?.endsWith("_door") || below?.endsWith("_door")) roadHits += 1;
      if (here === "dirt_path" || below === "dirt_path" || here?.endsWith("_path") || below?.endsWith("_path")) roadHits += 1;
      if (below && !isReplaceableName(below) && below !== "water") {
        solidFloor += 1;
        heights.push(column.y);
      } else if (!below || isReplaceableName(below)) {
        if (isReplaceableName(below2) && isReplaceableName(below3)) dropHits += 1;
      }
      if (here && !isReplaceableName(here)) solids += 1;
      if (here && (here.endsWith("_leaves") || here === "short_grass" || here === "tall_grass" || here === "fern")) plants += 1;
    }
  }
  const cells = size.width * size.depth;
  if (waterHits > 0 && !args.blueprint.permitsWater) {
    return { ...empty("site has water"), waterHits, lavaHits, dropHits };
  }
  if (lavaHits > 0 && !args.blueprint.permitsLava) {
    return { ...empty("site has lava"), waterHits, lavaHits, dropHits };
  }
  if (dropHits > 0) {
    return { ...empty("site has a dangerous drop"), waterHits, lavaHits, dropHits };
  }
  if (roadHits > 0) {
    return { ...empty("site would block a road or door"), waterHits, lavaHits, dropHits, roadHits };
  }
  if (solidFloor < cells * 0.75) {
    return { ...empty("footprint is not solid enough"), waterHits, lavaHits, dropHits, solidFloor };
  }
  const slope = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
  if (slope > (args.blueprint.maxSlope ?? 1)) {
    return { ...empty("terrain slope is too steep"), waterHits, lavaHits, dropHits, slope, solidFloor };
  }
  if (solids - plants > Math.max(4, Math.floor(cells * 0.35))) {
    return { ...empty("too many solid obstructions; pick another site"), waterHits, lavaHits, dropHits, slope, solidFloor };
  }
  let overlapHits = 0;
  for (const known of args.knownStructures ?? []) {
    const other = defaultBlueprintFor(known.structureType);
    const otherSize = other ? rotatedFootprint(other.footprint, known.facing) : { width: 4, depth: 4 };
    if (
      footprintsOverlap(
        { origin: args.origin, width: size.width, depth: size.depth },
        { origin: known.origin, width: otherSize.width, depth: otherSize.depth },
      )
    ) {
      overlapHits += 1;
    }
  }
  if (overlapHits > 0) {
    return { ...empty("site overlaps a known structure"), waterHits, lavaHits, dropHits, slope, overlapHits, solidFloor };
  }

  const approaches = [
    { x: args.origin.x + Math.floor(size.width / 2), y: args.origin.y, z: args.origin.z - 2 },
    { x: args.origin.x + Math.floor(size.width / 2), y: args.origin.y, z: args.origin.z + size.depth + 1 },
    { x: args.origin.x - 2, y: args.origin.y, z: args.origin.z + Math.floor(size.depth / 2) },
    { x: args.origin.x + size.width + 1, y: args.origin.y, z: args.origin.z + Math.floor(size.depth / 2) },
  ];
  let approachOk = 0;
  for (const pos of approaches) {
    const feet = args.getBlock(pos);
    const head = args.getBlock({ ...pos, y: pos.y + 1 });
    const below = args.getBlock({ ...pos, y: pos.y - 1 });
    if (isReplaceableName(feet) && isReplaceableName(head) && below && !isReplaceableName(below) && below !== "water") {
      approachOk += 1;
    }
  }
  if (approachOk < 2) {
    return { ...empty("construction approaches are blocked"), waterHits, lavaHits, dropHits, slope, approachOk, solidFloor };
  }
  const score = 70 + solidFloor + approachOk * 8 - plants - slope * 12 - solids;
  return {
    ok: true,
    score,
    waterHits,
    lavaHits,
    dropHits,
    slope,
    overlapHits,
    roadHits,
    approachOk,
    solidFloor,
  };
}

export type StaticValidation = {
  ok: boolean;
  failures: StructureValidationCode[];
  placed: number;
  missing: number;
  wrong: number;
};

export function validateExpandedStructure(
  expanded: ExpandedBlueprint,
  origin: Vec3,
  getBlock: (pos: Vec3) => string | undefined,
): StaticValidation {
  let placed = 0;
  let missing = 0;
  let wrong = 0;
  const failures: StructureValidationCode[] = [];
  for (const block of expanded.blocks) {
    if (block.optional && block.skipIfSolid) continue;
    const pos = worldPosition(origin, block.dx, block.dy, block.dz, expanded.blueprint.footprint, expanded.facing);
    const actual = getBlock(pos);
    if (block.skipIfSolid && actual && !isReplaceableName(actual)) {
      placed += 1;
      continue;
    }
    if (blockMatchesPlan(block, actual, expanded.materials)) placed += 1;
    else if (!actual || isReplaceableName(actual)) missing += 1;
    else wrong += 1;
  }
  if (missing > 0 || wrong > 0) failures.push("STRUCTURE_INCOMPLETE");
  const roofBlocks = expanded.blocks.filter((block) => block.role === "roof");
  const roofOk = roofBlocks.every((block) =>
    blockMatchesPlan(
      block,
      getBlock(worldPosition(origin, block.dx, block.dy, block.dz, expanded.blueprint.footprint, expanded.facing)),
      expanded.materials,
    ),
  );
  if (!roofOk) failures.push("ROOF_INCOMPLETE");
  const door = expanded.blocks.find((block) => block.role === "door");
  if (door) {
    const pos = worldPosition(origin, door.dx, door.dy, door.dz, expanded.blueprint.footprint, expanded.facing);
    if (!blockMatchesPlan(door, getBlock(pos), expanded.materials)) failures.push("ENTRANCE_BLOCKED");
  }
  const { wallHeight } = expanded.blueprint.footprint;
  for (const cell of expanded.interiorLocal) {
    const feet = getBlock(worldPosition(origin, cell.dx, 1, cell.dz, expanded.blueprint.footprint, expanded.facing));
    const head = getBlock(worldPosition(origin, cell.dx, 2, cell.dz, expanded.blueprint.footprint, expanded.facing));
    const occupied = expanded.blocks.some(
      (block) => block.dx === cell.dx && block.dz === cell.dz && block.dy === 1 && block.role !== "lighting",
    );
    if (occupied) continue;
    if (feet && !isReplaceableName(feet) && !feet.endsWith("_door") && !feet.includes("torch")) {
      failures.push("INTERIOR_UNREACHABLE");
      break;
    }
    if (expanded.blueprint.minClearance >= 2 && head && !isReplaceableName(head) && !head.includes("torch")) {
      failures.push("INTERIOR_UNREACHABLE");
      break;
    }
    if (wallHeight < expanded.blueprint.minClearance) failures.push("INTERIOR_UNREACHABLE");
  }
  return {
    ok: failures.length === 0 && missing === 0 && wrong === 0,
    failures: [...new Set(failures)],
    placed,
    missing,
    wrong,
  };
}
