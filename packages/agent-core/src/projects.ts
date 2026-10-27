import type { Vec3 } from "@civ/shared";
import {
  BUILD_STAGES,
  migrateLegacyStage,
  type BuildStage,
} from "@civ/minecraft-knowledge";
import { materialList, starterHut, type Blueprint, type BlueprintBlock } from "./blueprint.js";
import type { BuildSession } from "@civ/skills";

export type ProjectStatus =
  | "PLANNED"
  | "PROCURING"
  | "READY_TO_BUILD"
  | "BUILDING"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED";

export type { BuildStage };

export type SettlementProject = {
  id: string;
  type: "STARTER_SHELTER" | "STRUCTURE_BUILD";
  status: ProjectStatus;
  stage: BuildStage;
  blueprintId: string;
  blueprintVersion?: number;
  facing?: "south" | "north" | "east" | "west";
  site?: Vec3;
  requiredResources: Record<string, number>;
  reservedResources: Record<string, number>;
  blocked: Vec3[];
  placed: number;
  total: number;
  verified: number;
  startedAt: string;
  completedAt?: string;
  session?: BuildSession;
};

export const STAGE_ORDER: BuildStage[] = [...BUILD_STAGES];

export function createShelterProject(now = new Date().toISOString()): SettlementProject {
  const hut = starterHut();
  return {
    id: "project_starter_shelter",
    type: "STARTER_SHELTER",
    status: "PLANNED",
    stage: "SITE_SELECTION",
    blueprintId: hut.id,
    blueprintVersion: 1,
    facing: "south",
    requiredResources: materialList(hut),
    reservedResources: {},
    blocked: [],
    placed: 0,
    total: hut.blocks.length,
    verified: 0,
    startedAt: now,
  };
}

export function stageForBlock(block: BlueprintBlock): Exclude<BuildStage, "SITE_SELECTION" | "SITE_CLEARING" | "FINAL_VALIDATION"> {
  if (block.stage === "floor" || block.dy === 0) return "FLOOR";
  if (block.block.endsWith("_door") || block.stage === "door") return "DOOR_ACCESS";
  if (block.block === "chest" || block.block === "crafting_table" || block.block === "furnace") return "WORKSTATIONS";
  if (block.block === "torch" || block.block.endsWith("_bed") || block.stage === "interior") return "INTERIOR";
  if (block.stage === "roof") return "ROOF";
  const hut = starterHut();
  const maxY = Math.max(...hut.blocks.map((entry) => entry.dy));
  if (block.dy === maxY) return "ROOF";
  return "WALLS";
}

export function blocksForStage(blueprint: Blueprint, stage: BuildStage): BlueprintBlock[] {
  const canonical = migrateLegacyStage(stage);
  if (canonical === "SITE_SELECTION" || canonical === "SITE_CLEARING" || canonical === "FINAL_VALIDATION") return [];
  return blueprint.blocks.filter((block) => stageForBlock(block) === canonical);
}

export function nextStage(stage: BuildStage): BuildStage | undefined {
  const canonical = migrateLegacyStage(stage);
  const index = STAGE_ORDER.indexOf(canonical);
  return STAGE_ORDER[index + 1];
}

export function transitionProject(
  project: SettlementProject,
  event:
    | { type: "site_chosen"; site: Vec3 }
    | { type: "materials_ready" }
    | { type: "materials_missing" }
    | { type: "build_progress"; placed: number; verified: number }
    | { type: "block_blocked"; position: Vec3 }
    | { type: "verified"; verified: number; total: number }
    | { type: "failed"; reason?: string },
): SettlementProject {
  const next: SettlementProject = {
    ...project,
    stage: migrateLegacyStage(project.stage),
    blocked: [...project.blocked],
    reservedResources: { ...project.reservedResources },
  };
  switch (event.type) {
    case "site_chosen":
      next.site = event.site;
      next.status = "PROCURING";
      next.stage = "SITE_CLEARING";
      break;
    case "materials_missing":
      next.status = "PROCURING";
      break;
    case "materials_ready":
      next.status =
        next.stage === "FLOOR" ||
        next.stage === "SITE_SELECTION" ||
        next.stage === "SITE_CLEARING" ||
        next.stage === "FOUNDATION"
          ? "READY_TO_BUILD"
          : "BUILDING";
      if (next.stage === "SITE_SELECTION") next.stage = "SITE_CLEARING";
      break;
    case "build_progress":
      next.status = "BUILDING";
      next.placed = event.placed;
      next.verified = event.verified;
      break;
    case "block_blocked":
      if (!next.blocked.some((pos) => pos.x === event.position.x && pos.y === event.position.y && pos.z === event.position.z)) {
        next.blocked.push(event.position);
      }
      next.status = next.blocked.length > 12 ? "BLOCKED" : "BUILDING";
      break;
    case "verified":
      next.verified = event.verified;
      next.total = event.total;
      if (event.verified >= event.total && event.total > 0) {
        next.status = "COMPLETED";
        next.stage = "FINAL_VALIDATION";
        next.completedAt = new Date().toISOString();
      }
      break;
    case "failed":
      next.status = "FAILED";
      break;
  }
  return next;
}

export type ScanResult = {
  expected: number;
  correct: number;
  missing: number;
  incorrect: number;
};

export function scanBlueprint(
  blueprint: Blueprint,
  origin: Vec3,
  getBlock: (pos: Vec3) => string | undefined,
): ScanResult {
  let correct = 0;
  let missing = 0;
  let incorrect = 0;
  for (const block of blueprint.blocks) {
    const pos = { x: origin.x + block.dx, y: origin.y + block.dy, z: origin.z + block.dz };
    const actual = getBlock(pos);
    if (!actual || actual === "air" || actual === "cave_air") missing += 1;
    else if (
      actual === block.block ||
      (block.block.endsWith("_door") && actual.endsWith("_door")) ||
      (block.block.endsWith("_planks") && actual.endsWith("_planks"))
    ) {
      correct += 1;
    } else incorrect += 1;
  }
  return { expected: blueprint.blocks.length, correct, missing, incorrect };
}

export function materialsReady(
  required: Record<string, number>,
  available: Record<string, number>,
): boolean {
  const plankNeed =
    (required.oak_planks ?? 0) + (required.spruce_planks ?? 0) + (required.birch_planks ?? 0);
  const planksHave =
    (available.oak_planks ?? 0) +
    (available.spruce_planks ?? 0) +
    (available.birch_planks ?? 0) +
    (available.planks ?? 0);
  if (planksHave < Math.min(12, plankNeed || 12)) return false;
  return true;
}
