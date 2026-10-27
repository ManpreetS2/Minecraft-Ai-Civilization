/**
 * Offline blueprint preflight for the autonomous construction engine.
 *
 * Extends the existing StructureBlueprint catalog — does not invent a parallel
 * engine. Physical Mineflayer placement remains in @civ/skills blueprint-build.
 */
import type { Vec3 } from "@civ/shared";
import { isProtectedFurnitureName } from "./property.js";
import {
  BASIC_SHELTER_ID,
  SMALL_HOUSE_ID,
  WORKSHOP_CABIN_ID,
  blockMatchesPlan,
  concreteBlock,
  countMaterials,
  evaluateBlueprintSite,
  expandBlueprint,
  getBlueprint,
  isReplaceableName,
  resolveMaterials,
  rotateOffset,
  rotatedFootprint,
  sanitizeBlueprintExtras,
  worldPosition,
  type BuildStage,
  type Cardinal,
  type ExpandedBlueprint,
  type KnownStructureRecord,
  type PlannedBlock,
  type ResolvedMaterials,
  type StructureBlueprint,
  type StructureType,
} from "./structures.js";

export { WORKSHOP_CABIN_ID };

export type RotationDegrees = 0 | 90 | 180 | 270;

export type BlockProperties = Record<string, string>;

export type PlannedWorldCell = {
  local: { dx: number; dy: number; dz: number };
  world: Vec3;
  role: PlannedBlock["role"];
  stage: BuildStage;
  item: string;
  properties?: BlockProperties;
  optional?: boolean;
  skipIfSolid?: boolean;
};

export type BlueprintCellIssue =
  | { code: "OUT_OF_BOUNDS"; cell: string; detail: string }
  | { code: "DUPLICATE_CELL"; cell: string; detail: string }
  | { code: "INVALID_ROLE"; cell: string; detail: string }
  | { code: "BLUEPRINT_MISSING"; detail: string }
  | { code: "NOT_IMPLEMENTED"; detail: string };

export type WorldCellCompare = {
  world: Vec3;
  expected: string;
  actual: string | undefined;
  status: "CORRECT" | "MISSING" | "WRONG" | "UNKNOWN" | "PROTECTED_CONFLICT" | "SKIPPED_SOLID";
  properties?: BlockProperties;
};

export type RemainingMaterials = {
  billOfMaterials: Record<string, number>;
  alreadySatisfied: Record<string, number>;
  remaining: Record<string, number>;
  correct: number;
  missing: number;
  wrong: number;
  unknown: number;
  protectedConflicts: number;
  /** Door/bed directional state could not be observed — must block COMPLETED. */
  unverified: number;
};

export type BuildPreflightStatus = "PLANNED" | "PROCURING" | "BLOCKED" | "FAILED";

export type BuildStructureIntention = {
  citizenId: string;
  /** Preferred design / catalog id, or structure type to resolve. */
  blueprintId?: string;
  structureType?: StructureType;
  origin: Vec3;
  /** Absolute facing, or degrees relative to south. */
  facing?: Cardinal;
  rotationDegrees?: RotationDegrees;
  inventory?: Record<string, number>;
  extras?: Array<"chest" | "lighting" | "crafting_table" | "bed" | "furnace">;
  knownStructures?: KnownStructureRecord[];
  preferredMaterials?: ResolvedMaterials;
  /** When false, skip site checks (unit tests of BOM only). Default true. */
  requireSiteOk?: boolean;
};

export type BuildStructurePreflight = {
  status: BuildPreflightStatus;
  blockers: string[];
  intention: BuildStructureIntention;
  blueprint: StructureBlueprint;
  facing: Cardinal;
  expanded: ExpandedBlueprint;
  cells: PlannedWorldCell[];
  cellIssues: BlueprintCellIssue[];
  billOfMaterials: Record<string, number>;
  siteOk: boolean;
  siteReason?: string;
  siteScore: number;
  comparison?: RemainingMaterials;
  remainingMaterials: Record<string, number>;
  inventoryShortfall: Record<string, number>;
  nextStatusHint: "PLANNED" | "PROCURING" | "READY_TO_BUILD" | "BLOCKED";
};

const CARDINAL_ORDER: Cardinal[] = ["south", "west", "north", "east"];

export function facingFromRotation(degrees: RotationDegrees, base: Cardinal = "south"): Cardinal {
  const start = CARDINAL_ORDER.indexOf(base);
  const steps = ((degrees / 90) % 4 + 4) % 4;
  return CARDINAL_ORDER[(start + steps) % 4]!;
}

export function rotateCardinal(facing: Cardinal, degrees: RotationDegrees): Cardinal {
  return facingFromRotation(degrees, facing);
}

/** Rotate horizontal facing properties (doors, beds, stairs, furnaces, chests). */
export function rotateFacingProperty(facing: string, degrees: RotationDegrees): string {
  if (!CARDINAL_ORDER.includes(facing as Cardinal)) return facing;
  return rotateCardinal(facing as Cardinal, degrees);
}

/**
 * Transform directional block states under blueprint rotation.
 * Doors: facing + half + hinge. Beds: facing + part. Stairs: facing + half. Slabs: type.
 */
export function transformBlockProperties(
  properties: BlockProperties | undefined,
  degrees: RotationDegrees,
): BlockProperties | undefined {
  if (!properties || degrees === 0) return properties ? { ...properties } : undefined;
  const next: BlockProperties = { ...properties };
  if (next.facing) next.facing = rotateFacingProperty(next.facing, degrees);
  // hinge/half/part/type are rotation-invariant for our cabin catalog
  return next;
}

export function doorPropertiesForEntrance(entranceFacing: Cardinal): BlockProperties {
  // Lower half only in plan; upper half is implied by Minecraft door placement.
  return {
    facing: entranceFacing,
    half: "lower",
    hinge: "left",
    open: "false",
    powered: "false",
  };
}

export function bedProperties(facing: Cardinal, part: "foot" | "head"): BlockProperties {
  return {
    facing,
    part,
    occupied: "false",
  };
}

export function stairProperties(facing: Cardinal, half: "bottom" | "top" = "bottom"): BlockProperties {
  return {
    facing,
    half,
    shape: "straight",
    waterlogged: "false",
  };
}

export function slabProperties(type: "bottom" | "top" | "double" = "bottom"): BlockProperties {
  return { type, waterlogged: "false" };
}

export function propertiesForPlannedBlock(
  block: PlannedBlock,
  structureFacing: Cardinal,
  rotationDegrees: RotationDegrees = 0,
): BlockProperties | undefined {
  if (block.role === "door") {
    const base = doorPropertiesForEntrance(structureFacing);
    if (block.multiblockPart === "door_upper") {
      return transformBlockProperties({ ...base, half: "upper" }, rotationDegrees);
    }
    return transformBlockProperties({ ...base, half: "lower" }, rotationDegrees);
  }
  if (block.role === "bed") {
    // Bed foot against back corner; head faces west in local plan (see expandBoxShelter).
    const part = block.multiblockPart === "bed_head" ? "head" : "foot";
    return transformBlockProperties(bedProperties("west", part), rotationDegrees);
  }
  if (block.role === "chest" || block.role === "furnace" || block.role === "crafting_table") {
    return transformBlockProperties({ facing: structureFacing }, rotationDegrees);
  }
  return undefined;
}

/**
 * Compare expected directional state to observed Mineflayer properties.
 * If observation is missing, returns unverified (completion must not pass).
 */
export function matchBlockProperties(
  expected: BlockProperties | undefined,
  observed: BlockProperties | undefined | null,
): { ok: boolean; unverified: boolean; mismatches: string[] } {
  if (!expected || Object.keys(expected).length === 0) {
    return { ok: true, unverified: false, mismatches: [] };
  }
  if (observed == null) {
    return { ok: false, unverified: true, mismatches: ["properties_unavailable"] };
  }
  const mismatches: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    const actual = observed[key];
    if (actual === undefined) {
      mismatches.push(`${key}:missing`);
      continue;
    }
    if (String(actual) !== String(value)) {
      mismatches.push(`${key}: expected ${value} got ${actual}`);
    }
  }
  return { ok: mismatches.length === 0, unverified: false, mismatches };
}

export function validateExpandedCells(expanded: ExpandedBlueprint): BlueprintCellIssue[] {
  const issues: BlueprintCellIssue[] = [];
  if (!expanded.blueprint.implemented) {
    issues.push({
      code: "NOT_IMPLEMENTED",
      detail: `Blueprint ${expanded.blueprint.id} (${expanded.blueprint.structureType}) is not implemented`,
    });
    return issues;
  }
  const { width, depth, wallHeight } = expanded.blueprint.footprint;
  const maxY = wallHeight + 2;
  const seen = new Map<string, PlannedBlock>();
  for (const block of expanded.blocks) {
    const key = `${block.dx},${block.dy},${block.dz}`;
    if (block.dx < 0 || block.dz < 0 || block.dx >= width || block.dz >= depth || block.dy < -1 || block.dy > maxY) {
      issues.push({
        code: "OUT_OF_BOUNDS",
        cell: key,
        detail: `Cell ${key} outside footprint ${width}x${depth}x${maxY}`,
      });
    }
    const prior = seen.get(key);
    if (prior) {
      issues.push({
        code: "DUPLICATE_CELL",
        cell: key,
        detail: `Duplicate plan at ${key}: ${prior.role} and ${block.role}`,
      });
    }
    seen.set(key, block);
    if (!block.role) {
      issues.push({ code: "INVALID_ROLE", cell: key, detail: "Missing role" });
    }
  }
  return issues;
}

export function expandPlannedWorldCells(
  expanded: ExpandedBlueprint,
  origin: Vec3,
  rotationDegrees: RotationDegrees = 0,
): PlannedWorldCell[] {
  return expanded.blocks.map((block) => {
    const world = worldPosition(origin, block.dx, block.dy, block.dz, expanded.blueprint.footprint, expanded.facing);
    return {
      local: { dx: block.dx, dy: block.dy, dz: block.dz },
      world,
      role: block.role,
      stage: block.stage,
      item: concreteBlock(block, expanded.materials),
      properties: propertiesForPlannedBlock(block, expanded.facing, rotationDegrees),
      optional: block.optional,
      skipIfSolid: block.skipIfSolid,
    };
  });
}

export function comparePlanToWorld(
  expanded: ExpandedBlueprint,
  origin: Vec3,
  getBlock: (pos: Vec3) => string | undefined,
  rotationDegrees: RotationDegrees = 0,
  getBlockProperties?: (pos: Vec3) => BlockProperties | undefined | null,
): { cells: WorldCellCompare[]; remaining: RemainingMaterials } {
  const cells: WorldCellCompare[] = [];
  const bill = countMaterials(expanded);
  const already: Record<string, number> = {};
  let correct = 0;
  let missing = 0;
  let wrong = 0;
  let unknown = 0;
  let protectedConflicts = 0;
  let unverified = 0;

  for (const block of expanded.blocks) {
    if (block.skipIfSolid) continue;
    const world = worldPosition(origin, block.dx, block.dy, block.dz, expanded.blueprint.footprint, expanded.facing);
    const actual = getBlock(world);
    const expected = concreteBlock(block, expanded.materials);
    const properties = propertiesForPlannedBlock(block, expanded.facing, rotationDegrees);

    if (actual === undefined) {
      unknown += 1;
      cells.push({ world, expected, actual, status: "UNKNOWN", properties });
      continue;
    }
    if (blockMatchesPlan(block, actual, expanded.materials)) {
      // Directional multiblocks require observable properties when expected.
      if (properties && (block.role === "door" || block.role === "bed")) {
        if (!getBlockProperties) {
          unverified += 1;
          cells.push({ world, expected, actual, status: "WRONG", properties });
          continue;
        }
        const observed = getBlockProperties(world);
        const state = matchBlockProperties(properties, observed);
        if (state.unverified) {
          unverified += 1;
          cells.push({ world, expected, actual, status: "WRONG", properties });
          continue;
        }
        if (!state.ok) {
          wrong += 1;
          cells.push({ world, expected, actual, status: "WRONG", properties });
          continue;
        }
      }
      correct += 1;
      if (!block.impliedBySibling) {
        already[expected] = (already[expected] ?? 0) + 1;
      }
      cells.push({ world, expected, actual, status: "CORRECT", properties });
      continue;
    }
    if (isReplaceableName(actual)) {
      missing += 1;
      cells.push({ world, expected, actual, status: "MISSING", properties });
      continue;
    }
    if (isProtectedFurnitureName(actual) && actual !== expected) {
      protectedConflicts += 1;
      cells.push({ world, expected, actual, status: "PROTECTED_CONFLICT", properties });
      continue;
    }
    wrong += 1;
    cells.push({ world, expected, actual, status: "WRONG", properties });
  }

  const remaining: Record<string, number> = {};
  for (const [name, need] of Object.entries(bill)) {
    const have = already[name] ?? 0;
    const left = need - have;
    if (left > 0) remaining[name] = left;
  }

  return {
    cells,
    remaining: {
      billOfMaterials: bill,
      alreadySatisfied: already,
      remaining,
      correct,
      missing,
      wrong,
      unknown,
      protectedConflicts,
      unverified,
    },
  };
}

export function inventoryShortfall(
  remaining: Record<string, number>,
  inventory: Record<string, number>,
): Record<string, number> {
  const short: Record<string, number> = {};
  for (const [name, need] of Object.entries(remaining)) {
    const have = inventory[name] ?? 0;
    // Plank family soft substitute for BOM accounting only
    if (name.endsWith("_planks")) {
      const planks =
        (inventory.oak_planks ?? 0) + (inventory.spruce_planks ?? 0) + (inventory.birch_planks ?? 0);
      if (planks < need) short[name] = need - planks;
      continue;
    }
    if (have < need) short[name] = need - have;
  }
  return short;
}

export function resolveBlueprintForIntention(intention: BuildStructureIntention): StructureBlueprint | undefined {
  if (intention.blueprintId) {
    const byId = getBlueprint(intention.blueprintId);
    if (byId) return byId;
  }
  if (intention.structureType) {
    const match = getBlueprint(
      intention.structureType === "WORKSHOP"
        ? WORKSHOP_CABIN_ID
        : intention.structureType === "SMALL_HOUSE"
          ? SMALL_HOUSE_ID
          : intention.structureType === "BASIC_SHELTER"
            ? BASIC_SHELTER_ID
            : `${intention.structureType.toLowerCase()}_v1`,
    );
    if (match) return match;
  }
  return getBlueprint(intention.blueprintId ?? BASIC_SHELTER_ID) ?? getBlueprint(BASIC_SHELTER_ID);
}

/**
 * Offline preflight: catalog resolve → validate → rotate → BOM → site → world delta → shortfall.
 * Never claims Minecraft placement occurred.
 */
export function preflightBuildStructure(
  intention: BuildStructureIntention,
  getBlock?: (pos: Vec3) => string | undefined,
): BuildStructurePreflight {
  const blockers: string[] = [];
  const blueprint = resolveBlueprintForIntention(intention);
  if (!blueprint) {
    const emptyExpanded = expandBlueprint(
      {
        id: "missing",
        structureType: "BASIC_SHELTER",
        version: 0,
        name: "missing",
        origin: "baseline",
        implemented: false,
        footprint: { width: 1, depth: 1, wallHeight: 1 },
        minClearance: 2,
        anchorPoint: "south_west_corner",
        entranceDirection: "south",
        stages: [],
        requiredFeatures: [],
        optionalFeatures: [],
        materialRequirements: {},
        allowedMaterialSubstitutions: {},
        validationRules: [],
      },
      {},
    );
    return {
      status: "FAILED",
      blockers: ["BLUEPRINT_MISSING"],
      intention,
      blueprint: emptyExpanded.blueprint,
      facing: "south",
      expanded: emptyExpanded,
      cells: [],
      cellIssues: [{ code: "BLUEPRINT_MISSING", detail: "No blueprint resolved" }],
      billOfMaterials: {},
      siteOk: false,
      siteScore: 0,
      remainingMaterials: {},
      inventoryShortfall: {},
      nextStatusHint: "BLOCKED",
    };
  }

  const rotation = intention.rotationDegrees ?? 0;
  const facing =
    intention.facing ??
    (intention.rotationDegrees != null ? facingFromRotation(intention.rotationDegrees) : "south");
  const inventory = intention.inventory ?? {};
  const materials = resolveMaterials(blueprint, inventory, intention.preferredMaterials);
  const extras = intention.extras ?? ["chest", "lighting", "crafting_table"];
  const expanded = expandBlueprint(blueprint, materials, facing, extras);
  const cellIssues = validateExpandedCells(expanded);
  if (cellIssues.length) {
    blockers.push(...cellIssues.map((issue) => issue.code));
  }

  const cells = expandPlannedWorldCells(expanded, intention.origin, rotation);
  const billOfMaterials = countMaterials(expanded);

  let siteOk = true;
  let siteReason: string | undefined;
  let siteScore = 0;
  const requireSite = intention.requireSiteOk !== false;
  if (requireSite && getBlock) {
    const site = evaluateBlueprintSite({
      blueprint,
      origin: intention.origin,
      facing,
      getBlock,
      knownStructures: intention.knownStructures,
    });
    siteOk = site.ok;
    siteReason = site.reason;
    siteScore = site.score;
    if (!site.ok) blockers.push(site.code ?? "SITE_UNSUITABLE");

    // Extra: refuse footprints that would overwrite protected furniture.
    const size = rotatedFootprint(blueprint.footprint, facing);
    for (let dx = 0; dx < size.width; dx += 1) {
      for (let dz = 0; dz < size.depth; dz += 1) {
        for (let dy = 0; dy <= blueprint.footprint.wallHeight + 1; dy += 1) {
          const name = getBlock({ x: intention.origin.x + dx, y: intention.origin.y + dy, z: intention.origin.z + dz });
          if (isProtectedFurnitureName(name)) {
            siteOk = false;
            siteReason = `protected furniture ${name} in build volume`;
            blockers.push("PROTECTED_STRUCTURE");
            dy = blueprint.footprint.wallHeight + 2;
            dx = size.width;
            dz = size.depth;
          }
        }
      }
    }
  } else if (requireSite && !getBlock) {
    siteOk = false;
    siteReason = "world snapshot required for site feasibility";
    blockers.push("WORLD_UNLOADED");
  }

  let comparison: RemainingMaterials | undefined;
  let remainingMaterials = { ...billOfMaterials };
  if (getBlock) {
    const compared = comparePlanToWorld(expanded, intention.origin, getBlock, rotation);
    comparison = compared.remaining;
    remainingMaterials = compared.remaining.remaining;
    if (compared.remaining.unknown > 0) blockers.push("WORLD_UNKNOWN_BLOCKS");
    if (compared.remaining.protectedConflicts > 0) blockers.push("PROTECTED_STRUCTURE");
    if (compared.remaining.wrong > 0) blockers.push("WRONG_BLOCKS_PRESENT");
  }

  const shortfall = inventoryShortfall(remainingMaterials, inventory);
  const status: BuildPreflightStatus =
    blockers.includes("BLUEPRINT_MISSING") || blockers.includes("NOT_IMPLEMENTED")
      ? "FAILED"
      : !siteOk || blockers.includes("PROTECTED_STRUCTURE") || blockers.includes("SITE_UNSUITABLE")
        ? "BLOCKED"
        : Object.keys(shortfall).length > 0
          ? "PROCURING"
          : "PLANNED";

  const nextStatusHint =
    status === "BLOCKED" || status === "FAILED"
      ? "BLOCKED"
      : status === "PROCURING"
        ? "PROCURING"
        : "READY_TO_BUILD";

  return {
    status,
    blockers: [...new Set(blockers)],
    intention,
    blueprint,
    facing,
    expanded,
    cells,
    cellIssues,
    billOfMaterials,
    siteOk,
    siteReason,
    siteScore,
    comparison,
    remainingMaterials,
    inventoryShortfall: shortfall,
    nextStatusHint,
  };
}

/** Pure helper used by recovery tests: materials still needed after a partial world. */
export function remainingAfterPartialBuild(
  blueprintId: string,
  origin: Vec3,
  facing: Cardinal,
  getBlock: (pos: Vec3) => string | undefined,
  inventory: Record<string, number> = {},
  getBlockProperties?: (pos: Vec3) => BlockProperties | undefined | null,
  /** Must match the extras used when the structure was planned/built. */
  extras: Array<"chest" | "lighting" | "crafting_table" | "bed" | "furnace"> = [
    "chest",
    "lighting",
    "crafting_table",
  ],
): RemainingMaterials {
  const blueprint = getBlueprint(blueprintId) ?? getBlueprint(BASIC_SHELTER_ID)!;
  const materials = resolveMaterials(blueprint, inventory);
  const safeExtras = sanitizeBlueprintExtras(blueprint, extras);
  const expanded = expandBlueprint(blueprint, materials, facing, safeExtras);
  return comparePlanToWorld(expanded, origin, getBlock, 0, getBlockProperties).remaining;
}

export function rotateLocalOffset(
  dx: number,
  dz: number,
  footprint: { width: number; depth: number; wallHeight?: number },
  degrees: RotationDegrees,
): { dx: number; dz: number } {
  const facing = facingFromRotation(degrees);
  return rotateOffset(dx, dz, { width: footprint.width, depth: footprint.depth, wallHeight: footprint.wallHeight ?? 0 }, facing);
}
