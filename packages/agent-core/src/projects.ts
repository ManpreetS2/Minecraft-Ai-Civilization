import type { Vec3 } from "@civ/shared";
import { materialList, starterHut, type Blueprint, type BlueprintBlock } from "./blueprint.js";

export type ProjectStatus =
  | "PLANNED"
  | "PROCURING"
  | "READY_TO_BUILD"
  | "BUILDING"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED";

export type BuildStage = "site" | "floor" | "walls" | "door" | "roof" | "interior" | "verify";

export type SettlementProject = {
  id: string;
  type: "STARTER_SHELTER";
  status: ProjectStatus;
  stage: BuildStage;
  blueprintId: string;
  site?: Vec3;
  requiredResources: Record<string, number>;
  reservedResources: Record<string, number>;
  blocked: Vec3[];
  placed: number;
  total: number;
  verified: number;
  startedAt: string;
  completedAt?: string;
};

export const STAGE_ORDER: BuildStage[] = ["site", "floor", "walls", "door", "roof", "interior", "verify"];

export function createShelterProject(now = new Date().toISOString()): SettlementProject {
  const hut = starterHut();
  return {
    id: "project_starter_shelter",
    type: "STARTER_SHELTER",
    status: "PLANNED",
    stage: "site",
    blueprintId: hut.id,
    requiredResources: materialList(hut),
    reservedResources: {},
    blocked: [],
    placed: 0,
    total: hut.blocks.length,
    verified: 0,
    startedAt: now,
  };
}

export function stageForBlock(block: BlueprintBlock): Exclude<BuildStage, "site" | "verify"> {
  if (block.dy === 0) return "floor";
  if (block.block === "oak_door") return "door";
  if (block.block === "chest" || block.block === "crafting_table" || block.block === "torch") return "interior";
  const hut = starterHut();
  const maxY = Math.max(...hut.blocks.map((b) => b.dy));
  if (block.dy === maxY) return "roof";
  return "walls";
}

export function blocksForStage(blueprint: Blueprint, stage: BuildStage): BlueprintBlock[] {
  if (stage === "site" || stage === "verify") return [];
  return blueprint.blocks.filter((block) => stageForBlock(block) === stage);
}

export function nextStage(stage: BuildStage): BuildStage | undefined {
  const index = STAGE_ORDER.indexOf(stage);
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
  const next = { ...project, blocked: [...project.blocked], reservedResources: { ...project.reservedResources } };
  switch (event.type) {
    case "site_chosen":
      next.site = event.site;
      next.status = "PROCURING";
      next.stage = "floor";
      break;
    case "materials_missing":
      next.status = "PROCURING";
      break;
    case "materials_ready":
      next.status = next.stage === "floor" || next.stage === "site" ? "READY_TO_BUILD" : "BUILDING";
      if (next.stage === "site") next.stage = "floor";
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
        next.stage = "verify";
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
    else if (actual === block.block || (block.block === "oak_door" && actual.endsWith("_door"))) correct += 1;
    else incorrect += 1;
  }
  return { expected: blueprint.blocks.length, correct, missing, incorrect };
}

export function materialsReady(
  required: Record<string, number>,
  available: Record<string, number>,
): boolean {
  const planksNeeded = required.oak_planks ?? 0;
  const planksHave = (available.oak_planks ?? 0) + (available.planks ?? 0);
  if (planksHave < Math.min(12, planksNeeded)) return false;
  return true;
}
