import { createEvent, type ActionResult, type EventBus } from "@civ/shared";
import {
  advanceBlueprintBuild,
  createBuildSession,
  knownFromSession,
  obtainItem,
  scanRecognizedStructures,
  type BuildSession,
  type KnownStructureRecord,
  type SkillContext,
} from "@civ/skills";
import {
  BASIC_SHELTER_ID,
  expandBlueprint,
  getBlueprint,
  resolveMaterials,
  worldPosition,
} from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import { starterHut } from "./blueprint.js";
import { materialsReady, scanBlueprint, transitionProject, type SettlementProject } from "./projects.js";
import { bagFromItems, PLANKS } from "./recipes.js";
import type { SettlementRuntime } from "./settlement-runtime.js";
import type { CivilizationStore } from "./store.js";
import { rememberWorkstation } from "./workstations.js";

/** True when feet or head cell is water-like — building here drowned Atlas on Day 1. */
export function standingInWater(bot: SkillContext["bot"]): boolean {
  const pos = bot.entity?.position;
  if (!pos) return false;
  const base = new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  const feet = bot.blockAt(base);
  const head = bot.blockAt(base.offset(0, 1, 0));
  const names = [feet?.name, head?.name].filter(Boolean) as string[];
  return names.some((name) => name === "water" || name === "bubble_column" || name.endsWith("_water"));
}

export async function buildShelter(
  ctx: SkillContext,
  store: CivilizationStore,
  runtime: SettlementRuntime,
  events: EventBus,
): Promise<ActionResult> {
  const project = loadProject(store, runtime);
  const hut = starterHut();
  const settlement = store.getSettlement();

  // Day-1: build_shelter while feet/head in water ended in drowning. Refuse and let planner change strategy.
  if (standingInWater(ctx.bot)) {
    return {
      success: false,
      code: "HAZARD_BLOCKED",
      error: "Cannot build shelter while standing in water",
      durationMs: 0,
      retryable: true,
      details: { hazard: "water", nextTask: "seek_housing" },
    };
  }

  if (project.status === "COMPLETED" || settlement.shelterComplete) {
    if (!store.isOpen()) {
      return { success: true, data: { complete: true, persisted: false, persistReason: "closed" }, durationMs: 0 };
    }
    if (store.hasCommunities()) {
      return { success: true, data: { complete: true, persisted: false, persistReason: "community_scoped" }, durationMs: 0 };
    }
    settlement.shelterComplete = true;
    settlement.housingCapacity = Math.max(settlement.housingCapacity, 4);
    const write = store.safeWrite("saveSettlement:shelterAlreadyComplete", () => store.saveSettlement(settlement));
    return {
      success: true,
      data: { complete: true, persisted: write.ok, persistReason: write.ok ? undefined : write.reason },
      durationMs: 0,
    };
  }

  const known = mergeKnown(settlement.knownStructures, scanRecognizedStructures(ctx, toKnown(settlement.knownStructures), 24));
  let session =
    project.session ??
    createBuildSession({
      blueprintId: project.blueprintId || BASIC_SHELTER_ID,
      facing: project.facing ?? "south",
      origin: project.site,
    });
  if (project.site && !session.origin) session.origin = project.site;

  const inv = bagFromItems(ctx.bot.inventory.items().map((item) => ({ name: item.name, count: item.count })));
  const plankCount = PLANKS.reduce((sum, name) => sum + (inv[name] ?? 0), 0);
  const logCount = Object.entries(inv)
    .filter(([name]) => name.endsWith("_log"))
    .reduce((sum, [, count]) => sum + count, 0);
  if (
    !materialsReady(project.requiredResources, {
      oak_planks: plankCount + logCount * 4,
      spruce_planks: inv.spruce_planks ?? 0,
      birch_planks: inv.birch_planks ?? 0,
      planks: plankCount,
    })
  ) {
    const want = session.materials.WALL_MATERIAL ?? "oak_planks";
    const planks = await obtainItem(ctx, want, 8);
    if (!planks.success) {
      runtime.project = transitionProject(project, { type: "materials_missing" });
      runtime.project.session = session;
      persistProject(store, runtime);
      return planks;
    }
  }

  if (project.status === "PROCURING" || project.status === "PLANNED") {
    runtime.project = transitionProject(project, { type: "materials_ready" });
    runtime.project.session = session;
    persistProject(store, runtime);
  }

  const liveValidate = session.stage === "FINAL_VALIDATION";
  const result = await advanceBlueprintBuild(ctx, session, {
    maxPlacements: 1,
    known,
    liveValidate,
    forceNew: false,
  });
  session = result.success ? result.data.session : ((result.details?.session as BuildSession | undefined) ?? session);

  const current = runtime.project ?? project;
  current.session = session;
  current.stage = session.stage;
  current.site = session.origin ?? current.site;
  current.placed = session.placed;
  current.total = session.total;
  current.facing = session.facing;
  current.blueprintId = session.blueprintId;
  current.blueprintVersion = session.blueprintVersion;
  runtime.project = current;

  if (result.success && result.data.reused) {
    current.status = "COMPLETED";
    current.stage = "FINAL_VALIDATION";
    settlement.shelterComplete = true;
    settlement.housingCapacity = Math.max(settlement.housingCapacity, 4);
    rememberKnown(store, result.data.reused);
    const persisted = persistProject(store, runtime);
    if (persisted) {
      events.emit(
        createEvent("ConstructionCompleted", { blueprint: session.blueprintId, reused: true, persisted: true }, ctx.citizenId),
      );
    }
    return {
      success: true,
      data: { reused: true, complete: true, structure: result.data.reused, persisted },
      durationMs: result.durationMs,
    };
  }

  if (session.origin && settlement.construction === undefined) {
    events.emit(createEvent("ConstructionStarted", { origin: session.origin, blueprint: session.blueprintId }, ctx.citizenId));
  }

  if (!result.success) {
    persistProject(store, runtime);
    if (result.code === "SITE_UNSUITABLE" || result.code === "INTERRUPTED") {
      events.emit(createEvent("SettlementProjectBlocked", { reason: result.error, code: result.code }, ctx.citizenId));
      return result;
    }
    events.emit(
      createEvent(
        "ConstructionBlockFailed",
        { block: result.details?.block, position: result.details?.position, error: result.error, code: result.code },
        ctx.citizenId,
      ),
    );
    return result;
  }

  if (session.status === "COMPLETE") {
    return completeShelter(ctx, store, runtime, events, session, hut);
  }

  persistProject(store, runtime);
  events.emit(createEvent("ConstructionProgress", { placed: session.placed, total: session.total, stage: session.stage }, ctx.citizenId));
  return result;
}

function completeShelter(
  ctx: SkillContext,
  store: CivilizationStore,
  runtime: SettlementRuntime,
  events: EventBus,
  session: BuildSession,
  hut: ReturnType<typeof starterHut>,
): ActionResult {
  const settlement = store.getSettlement();
  const origin = session.origin;
  if (!origin) {
    return { success: false, code: "UNKNOWN", error: "No site to verify", durationMs: 0, retryable: true };
  }
  const scan = scanBlueprint(hut, origin, (pos) => ctx.bot.blockAt(new Vec3Class(pos.x, pos.y, pos.z))?.name);
  runtime.project = transitionProject(runtime.project!, { type: "verified", verified: session.total, total: session.total });
  runtime.project.session = session;
  settlement.shelterComplete = true;
  settlement.housingCapacity = Math.max(settlement.housingCapacity, 4);
  rememberWorkstations(store, session);
  const recorded = knownFromSession(session, "usable");
  if (recorded) rememberKnown(store, recorded);
  const persisted = persistProject(store, runtime);
  runtime.reservations.releasePurpose("construction");
  if (persisted) {
    events.emit(
      createEvent(
        "SettlementProjectCompleted",
        { expected: scan.expected, correct: scan.correct, missing: scan.missing, incorrect: scan.incorrect, persisted: true },
        ctx.citizenId,
      ),
    );
    events.emit(createEvent("ConstructionCompleted", { blueprint: session.blueprintId, persisted: true }, ctx.citizenId));
  }
  return { success: true, data: { ...scan, complete: true, persisted }, durationMs: 0 };
}

function rememberWorkstations(store: CivilizationStore, session: BuildSession): void {
  if (!session.origin) return;
  const blueprint = getBlueprint(session.blueprintId);
  if (!blueprint) return;
  const expanded = expandBlueprint(blueprint, resolveMaterials(blueprint, {}, session.materials), session.facing, session.extras);
  for (const work of expanded.workstationLocal) {
    const pos = worldPosition(session.origin, work.dx, work.dy, work.dz, blueprint.footprint, session.facing);
    if (work.role === "chest") rememberWorkstation(store, "chest", pos);
    if (work.role === "crafting_table") rememberWorkstation(store, "crafting_table", pos);
    if (work.role === "furnace") rememberWorkstation(store, "furnace", pos);
  }
}

function toKnown(
  records: NonNullable<ReturnType<CivilizationStore["getSettlement"]>["knownStructures"]> | undefined,
): KnownStructureRecord[] {
  return (records ?? []).map((entry) => ({
    id: entry.id,
    blueprintId: entry.blueprintId,
    blueprintVersion: entry.blueprintVersion,
    structureType: entry.structureType as KnownStructureRecord["structureType"],
    origin: entry.origin,
    facing: (entry.facing as KnownStructureRecord["facing"]) ?? "south",
    quality: entry.quality,
  }));
}

function mergeKnown(
  stored: ReturnType<CivilizationStore["getSettlement"]>["knownStructures"],
  scanned: KnownStructureRecord[],
): KnownStructureRecord[] {
  const merged = [...toKnown(stored)];
  for (const entry of scanned) {
    if (!merged.some((existing) => existing.id === entry.id)) merged.push(entry);
  }
  return merged;
}

function rememberKnown(store: CivilizationStore, record: KnownStructureRecord): void {
  if (store.hasCommunities()) return; // shared settlement row; not a per-community record
  const settlement = store.getSettlement();
  const list = settlement.knownStructures ?? [];
  if (!list.some((entry) => entry.id === record.id)) {
    list.push({
      id: record.id,
      blueprintId: record.blueprintId,
      blueprintVersion: record.blueprintVersion,
      structureType: record.structureType,
      origin: record.origin,
      facing: record.facing,
      quality: record.quality,
    });
  }
  settlement.knownStructures = list;
  store.saveSettlement(settlement);
}

function loadProject(store: CivilizationStore, runtime: SettlementRuntime): SettlementProject {
  if (runtime.project) return runtime.project;
  const settlement = store.getSettlement();
  if (settlement.projectJson && !store.hasCommunities()) {
    try {
      runtime.project = JSON.parse(settlement.projectJson) as SettlementProject;
      return runtime.project;
    } catch {
      // fall through
    }
  }
  runtime.project = runtime.ensureShelterProject();
  persistProject(store, runtime);
  return runtime.project;
}

/** Returns true only when the settlement write succeeded while the store was open. */
function persistProject(store: CivilizationStore, runtime: SettlementRuntime): boolean {
  if (!store.isOpen()) return false;
  // Community mode: never publish a project/site/shelter flag into the shared settlement row.
  if (store.hasCommunities()) return true;
  const write = store.safeWrite("saveSettlement:project", () => {
    const settlement = store.getSettlement();
    settlement.projectJson = runtime.project ? JSON.stringify(runtime.project) : undefined;
    if (runtime.project?.site) settlement.origin = runtime.project.site;
    if (runtime.project?.session) {
      settlement.construction = {
        blueprintId: runtime.project.session.blueprintId,
        blueprintVersion: runtime.project.session.blueprintVersion,
        stage: runtime.project.session.stage,
        facing: runtime.project.session.facing,
        startedAt: runtime.project.startedAt,
        totalBlocks: runtime.project.session.total,
        placedBlocks: runtime.project.session.placed,
        complete: runtime.project.session.status === "COMPLETE",
      };
    }
    if (runtime.project?.status === "COMPLETED") {
      settlement.shelterComplete = true;
    }
    store.saveSettlement(settlement);
  });
  return write.ok;
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
