/**
 * Phase A — blueprint schema / size / supported-block rules for the construction engine.
 */
import {
  BLUEPRINT_MAX_CELLS,
  BLUEPRINT_MAX_DEPTH,
  BLUEPRINT_MAX_WALL_HEIGHT,
  BLUEPRINT_MAX_WIDTH,
  concreteBlock,
  expandBlueprint,
  materialRequirementsMatchExpanded,
  resolveMaterials,
  sanitizeBlueprintExtras,
  type ExpandedBlueprint,
  type StructureBlueprint,
} from "./structures.js";
import { validateExpandedCells, type BlueprintCellIssue } from "./build-preflight.js";

/** Items the offline engine is willing to schedule for survival placement. */
export const SUPPORTED_CONSTRUCTION_ITEMS = new Set([
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "oak_log",
  "spruce_log",
  "birch_log",
  "cobblestone",
  "stone_bricks",
  "glass",
  "oak_stairs",
  "spruce_stairs",
  "cobblestone_stairs",
  "oak_slab",
  "cobblestone_slab",
  "oak_door",
  "spruce_door",
  "birch_door",
  "oak_trapdoor",
  "oak_fence",
  "oak_fence_gate",
  "chest",
  "barrel",
  "crafting_table",
  "furnace",
  "torch",
  "red_bed",
  "white_bed",
  "dirt",
  "dirt_path",
  "farmland",
]);

export type BlueprintSchemaIssue =
  | {
      code:
        | "MISSING_ID"
        | "MISSING_VERSION"
        | "NOT_IMPLEMENTED"
        | "FOOTPRINT_TOO_LARGE"
        | "TOO_MANY_CELLS"
        | "UNSUPPORTED_ITEM"
        | "BOM_DRIFT";
      detail: string;
    }
  | BlueprintCellIssue;

export function validateBlueprintFootprint(blueprint: StructureBlueprint): BlueprintSchemaIssue[] {
  const issues: BlueprintSchemaIssue[] = [];
  if (!blueprint.id?.trim()) issues.push({ code: "MISSING_ID", detail: "Blueprint id required" });
  if (!Number.isFinite(blueprint.version) || blueprint.version < 1) {
    issues.push({ code: "MISSING_VERSION", detail: "Blueprint version must be >= 1" });
  }
  if (!blueprint.implemented) {
    issues.push({ code: "NOT_IMPLEMENTED", detail: `${blueprint.id} is not implemented` });
  }
  const { width, depth, wallHeight } = blueprint.footprint;
  if (width > BLUEPRINT_MAX_WIDTH || depth > BLUEPRINT_MAX_DEPTH || wallHeight > BLUEPRINT_MAX_WALL_HEIGHT) {
    issues.push({
      code: "FOOTPRINT_TOO_LARGE",
      detail: `Footprint ${width}x${depth}x${wallHeight} exceeds ${BLUEPRINT_MAX_WIDTH}x${BLUEPRINT_MAX_DEPTH}x${BLUEPRINT_MAX_WALL_HEIGHT}`,
    });
  }
  return issues;
}

export function validateSupportedItems(expanded: ExpandedBlueprint): BlueprintSchemaIssue[] {
  const issues: BlueprintSchemaIssue[] = [];
  for (const block of expanded.blocks) {
    if (block.skipIfSolid || block.impliedBySibling) continue;
    const item = concreteBlock(block, expanded.materials);
    if (!SUPPORTED_CONSTRUCTION_ITEMS.has(item)) {
      issues.push({
        code: "UNSUPPORTED_ITEM",
        detail: `Unsupported construction item '${item}' at ${block.dx},${block.dy},${block.dz} — refusing silent incorrect build`,
      });
    }
  }
  return issues;
}

/**
 * Full offline blueprint validation: schema, size, cells, supported items.
 */
export function validateBlueprintPipeline(
  blueprint: StructureBlueprint,
  inventory: Record<string, number> = { oak_planks: 64 },
): { ok: boolean; issues: BlueprintSchemaIssue[]; expanded: ExpandedBlueprint } {
  const schema = validateBlueprintFootprint(blueprint);
  const materials = resolveMaterials(blueprint, inventory);
  const extras = sanitizeBlueprintExtras(blueprint, [
    "chest",
    "lighting",
    "crafting_table",
    "bed",
    "furnace",
  ]);
  const expanded = expandBlueprint(blueprint, materials, "south", extras);
  const cellIssues = validateExpandedCells(expanded);
  const itemIssues = validateSupportedItems(expanded);
  const cellCount = expanded.blocks.filter((b) => !b.skipIfSolid && !b.impliedBySibling).length;
  const sizeIssues: BlueprintSchemaIssue[] =
    cellCount > BLUEPRINT_MAX_CELLS
      ? [{ code: "TOO_MANY_CELLS", detail: `${cellCount} cells exceeds cap ${BLUEPRINT_MAX_CELLS}` }]
      : [];
  const bom = materialRequirementsMatchExpanded(blueprint, expanded);
  const bomIssues: BlueprintSchemaIssue[] = bom.ok
    ? []
    : [{ code: "BOM_DRIFT", detail: `materialRequirements drift: ${bom.drift.join("; ")}` }];
  const issues = [...schema, ...cellIssues, ...itemIssues, ...sizeIssues, ...bomIssues];
  return { ok: issues.length === 0, issues, expanded };
}

/** Stage dependency order for survival placement (floor before walls before roof…). */
export const PLACEMENT_STAGE_ORDER = [
  "FOUNDATION",
  "FLOOR",
  "WALLS",
  "DOOR_ACCESS",
  "ROOF",
  "INTERIOR",
  "WORKSTATIONS",
] as const;

export function nextBuildableBlocks(
  expanded: ExpandedBlueprint,
  isSatisfied: (blockIndex: number) => boolean,
): Array<{ index: number; block: ExpandedBlueprint["blocks"][number] }> {
  const out: Array<{ index: number; block: ExpandedBlueprint["blocks"][number] }> = [];
  for (const stage of PLACEMENT_STAGE_ORDER) {
    expanded.blocks.forEach((block, index) => {
      if (block.stage !== stage) return;
      if (block.skipIfSolid) return;
      if (block.impliedBySibling) return; // placed by sibling item (door upper / bed head)
      if (isSatisfied(index)) return;
      out.push({ index, block });
    });
    if (out.length > 0) break; // finish current stage before next
  }
  return out;
}
