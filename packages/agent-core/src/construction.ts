import { createEvent, type ActionResult, type EventBus, type Vec3 } from "@civ/shared";
import { obtainItem, placeBlock, type SkillContext } from "@civ/skills";
import { Vec3 as Vec3Class } from "vec3";
import { nextUnplaced, starterHut, starterHutSize } from "./blueprint.js";
import { cellClaimKey } from "./claims.js";
import {
  blocksForStage,
  materialsReady,
  nextStage,
  scanBlueprint,
  transitionProject,
  type BuildStage,
  type SettlementProject,
} from "./projects.js";
import { bagFromItems, PLANKS } from "./recipes.js";
import type { SettlementRuntime } from "./settlement-runtime.js";
import { candidateOrigins, evaluateSite, isProtectedBlock, pickBestSite } from "./site.js";
import type { CivilizationStore } from "./store.js";
import { rememberWorkstation } from "./workstations.js";

export async function buildShelter(
  ctx: SkillContext,
  store: CivilizationStore,
  runtime: SettlementRuntime,
  events: EventBus,
): Promise<ActionResult> {
  const project = loadProject(store, runtime);
  const hut = starterHut();

  if (project.status === "COMPLETED") {
    const settlement = store.getSettlement();
    settlement.shelterComplete = true;
    settlement.housingCapacity = Math.max(settlement.housingCapacity, 5);
    store.saveSettlement(settlement);
    return { success: true, data: { complete: true }, durationMs: 0 };
  }

  if (!project.site) {
    const site = chooseSite(ctx);
    if (!site) {
      runtime.project = transitionProject(project, { type: "failed", reason: "no viable site" });
      persistProject(store, runtime);
      events.emit(createEvent("SettlementProjectBlocked", { reason: "no viable site" }, ctx.citizenId));
      return { success: false, code: "PATH_BLOCKED", error: "No viable shelter site", durationMs: 0, retryable: true };
    }
    runtime.project = transitionProject(project, { type: "site_chosen", site });
    const settlement = store.getSettlement();
    settlement.origin = site;
    settlement.construction = {
      blueprintId: hut.id,
      startedAt: runtime.project.startedAt,
      totalBlocks: hut.blocks.length,
      placedBlocks: 0,
      complete: false,
    };
    store.saveSettlement(settlement);
    persistProject(store, runtime);
    events.emit(createEvent("ConstructionStarted", { origin: site, blueprint: hut.id }, ctx.citizenId));
    return { success: true, data: { site }, durationMs: 0 };
  }

  const inv = bagFromItems(ctx.bot.inventory.items().map((i) => ({ name: i.name, count: i.count })));
  const plankCount = PLANKS.reduce((sum, name) => sum + (inv[name] ?? 0), 0);
  const logCount = Object.entries(inv)
    .filter(([name]) => name.endsWith("_log"))
    .reduce((sum, [, count]) => sum + count, 0);
  if (!materialsReady(project.requiredResources, { oak_planks: plankCount + logCount * 4, planks: plankCount })) {
    const planks = await obtainItem(ctx, "oak_planks", 8);
    if (!planks.success) {
      runtime.project = transitionProject(project, { type: "materials_missing" });
      persistProject(store, runtime);
      return planks;
    }
  }

  if (project.status === "PROCURING" || project.status === "PLANNED") {
    runtime.project = transitionProject(project, { type: "materials_ready" });
    persistProject(store, runtime);
  }

  const origin = project.site;
  const stage: BuildStage = project.stage === "site" ? "floor" : project.stage;
  const stageBlocks = new Set(
    blocksForStage(hut, stage).map((block) => `${block.dx},${block.dy},${block.dz}`),
  );

  const next = nextUnplaced(
    hut,
    origin,
    (position, block) => {
      const found = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
      if (!found) return false;
      if (block === "oak_door") return found.name.endsWith("_door");
      return found.name === block;
    },
    (position) => {
      const blocked = project.blocked.some((pos) => same(pos, position));
      if (blocked) return true;
      const rel = `${position.x - origin.x},${position.y - origin.y},${position.z - origin.z}`;
      if (stage !== "verify" && stageBlocks.size > 0 && !stageBlocks.has(rel)) return true;
      const owner = runtime.claims.ownerOf("block", cellClaimKey(position.x, position.y, position.z));
      return Boolean(owner && owner !== ctx.citizenId);
    },
  );

  if (!next) {
    const advanced = nextStage(stage);
    if (advanced && advanced !== "verify") {
      runtime.project = { ...project, stage: advanced, status: "BUILDING" };
      persistProject(store, runtime);
      return { success: true, data: { stage: advanced }, durationMs: 0 };
    }
    return verifyProject(ctx, store, runtime, events);
  }

  const claimKey = cellClaimKey(next.position.x, next.position.y, next.position.z);
  if (ctx.citizenId && !runtime.claims.tryClaim("block", claimKey, ctx.citizenId, 45_000)) {
    return { success: false, code: "CONTAINER_BUSY", error: "Another citizen is placing this block", durationMs: 0, retryable: true };
  }

  const itemName = next.block === "oak_door" ? "oak_door" : next.block;
  if (!ctx.bot.inventory.items().some((i) => i.name === itemName || (itemName === "oak_door" && i.name.endsWith("_door")))) {
    const obtained = await obtainItem(ctx, itemName, 1);
    if (!obtained.success) {
      runtime.claims.release("block", claimKey, ctx.citizenId);
      if (itemName === "torch") {
        return placeOrSkip(ctx, "oak_planks", next.position, store, runtime, events);
      }
      return obtained;
    }
  }

  const placed = await placeBlock(ctx, itemName, next.position, {
    purpose: "shelter_blueprint",
    projectId: project.id,
    structureId: hut.id,
  });
  runtime.claims.release("block", claimKey, ctx.citizenId);
  if (!placed.success) {
    runtime.project = transitionProject(project, { type: "block_blocked", position: next.position });
    persistProject(store, runtime);
    events.emit(
      createEvent(
        "ConstructionBlockFailed",
        { block: itemName, position: next.position, error: placed.error, code: placed.code },
        ctx.citizenId,
      ),
    );
    ctx.body.unreachable.mark(next.position, 25_000);
    return placed;
  }

  events.emit(
    createEvent("ConstructionBlockPlaced", { block: placed.data.name, position: next.position }, ctx.citizenId),
  );
  if (itemName === "chest") rememberWorkstation(store, "chest", next.position);
  if (itemName === "crafting_table") rememberWorkstation(store, "crafting_table", next.position);

  const scan = scanBlueprint(hut, origin, (pos) => ctx.bot.blockAt(new Vec3Class(pos.x, pos.y, pos.z))?.name);
  runtime.project = transitionProject(project, { type: "build_progress", placed: scan.correct, verified: scan.correct });
  const settlement = store.getSettlement();
  if (settlement.construction) {
    settlement.construction.placedBlocks = scan.correct;
    settlement.construction.totalBlocks = scan.expected;
  }
  store.saveSettlement(settlement);
  persistProject(store, runtime);
  events.emit(createEvent("ConstructionProgress", { placed: scan.correct, total: scan.expected }, ctx.citizenId));
  return placed;
}

async function placeOrSkip(
  ctx: SkillContext,
  itemName: string,
  position: Vec3,
  store: CivilizationStore,
  runtime: SettlementRuntime,
  events: EventBus,
): Promise<ActionResult> {
  if (!ctx.bot.inventory.items().some((i) => i.name === itemName)) {
    return { success: false, code: "ITEM_NOT_FOUND", error: `Need ${itemName}`, durationMs: 0, retryable: true };
  }
  const placed = await placeBlock(ctx, itemName, position, { purpose: "shelter_blueprint" });
  if (!placed.success) {
    events.emit(createEvent("ConstructionBlockFailed", { block: itemName, position, error: placed.error }, ctx.citizenId));
  }
  persistProject(store, runtime);
  return placed;
}

function verifyProject(
  ctx: SkillContext,
  store: CivilizationStore,
  runtime: SettlementRuntime,
  events: EventBus,
): ActionResult {
  const project = runtime.project;
  if (!project?.site) {
    return { success: false, code: "UNKNOWN", error: "No site to verify", durationMs: 0, retryable: true };
  }
  const hut = starterHut();
  const scan = scanBlueprint(hut, project.site, (pos) => ctx.bot.blockAt(new Vec3Class(pos.x, pos.y, pos.z))?.name);
  runtime.project = transitionProject(project, { type: "verified", verified: scan.correct, total: scan.expected });
  persistProject(store, runtime);
  if (runtime.project.status === "COMPLETED") {
    const settlement = store.getSettlement();
    settlement.shelterComplete = true;
    settlement.housingCapacity = 5;
    if (settlement.construction) settlement.construction.complete = true;
    store.saveSettlement(settlement);
    runtime.reservations.releasePurpose("construction");
    events.emit(
      createEvent(
        "SettlementProjectCompleted",
        { expected: scan.expected, correct: scan.correct, missing: scan.missing, incorrect: scan.incorrect },
        ctx.citizenId,
      ),
    );
    events.emit(createEvent("ConstructionCompleted", { blueprint: hut.id }, ctx.citizenId));
    return { success: true, data: scan, durationMs: 0 };
  }
  events.emit(createEvent("SettlementProjectBlocked", { ...scan }, ctx.citizenId));
  return {
    success: false,
    code: "VERIFY_FAILED",
    error: `Shelter incomplete: ${scan.correct}/${scan.expected} correct`,
    durationMs: 0,
    retryable: true,
  };
}

function chooseSite(ctx: SkillContext): Vec3 | undefined {
  const from = ctx.body.position();
  if (!from) return undefined;
  const getBlock = (pos: Vec3) => ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)))?.name;
  const size = starterHutSize();
  const best = pickBestSite(from, size.width, size.depth, getBlock, 40);
  if (best && !isProtectedBlock(getBlock(best.origin))) return best.origin;
  const scored = candidateOrigins(from, 40)
    .map((origin) => ({ origin, evaluation: evaluateSite(origin, size.width, size.depth, getBlock) }))
    .filter((entry) => entry.evaluation.ok)
    .sort((a, b) => b.evaluation.score - a.evaluation.score);
  for (const entry of scored) {
    const standing = getBlock(entry.origin);
    if (standing && isProtectedBlock(standing)) continue;
    return entry.origin;
  }
  return undefined;
}

function loadProject(store: CivilizationStore, runtime: SettlementRuntime): SettlementProject {
  if (runtime.project) return runtime.project;
  const settlement = store.getSettlement();
  if (settlement.projectJson) {
    try {
      runtime.project = JSON.parse(settlement.projectJson) as SettlementProject;
      return runtime.project;
    } catch {
      // fall through
    }
  }
  runtime.project = runtime.ensureShelterProject();
  eventsCreated(store, runtime);
  return runtime.project;
}

function eventsCreated(store: CivilizationStore, runtime: SettlementRuntime): void {
  persistProject(store, runtime);
}

function persistProject(store: CivilizationStore, runtime: SettlementRuntime): void {
  const settlement = store.getSettlement();
  settlement.projectJson = runtime.project ? JSON.stringify(runtime.project) : undefined;
  if (runtime.project?.site) settlement.origin = runtime.project.site;
  store.saveSettlement(settlement);
}

function same(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

export function emitProjectCreated(events: EventBus, project: SettlementProject, citizenId?: string): void {
  events.emit(
    createEvent(
      "SettlementProjectCreated",
      { id: project.id, type: project.type, required: project.requiredResources },
      citizenId,
    ),
  );
}
