/**
 * Citizen-facing build_structure intention → existing project/session machinery.
 *
 * AI chooses WHAT/WHY/WHERE; this module + @civ/skills blueprint-build execute HOW.
 * Offline preflight never claims physical placement.
 */
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import {
  WORKSHOP_CABIN_ID,
  getBlueprint,
  preflightBuildStructure,
  remainingAfterPartialBuild,
  type BuildStructureIntention,
  type BuildStructurePreflight,
  type Cardinal,
} from "@civ/minecraft-knowledge";
import {
  advanceBlueprintBuild,
  createBuildSession,
  type BuildAdvance,
  type BuildSession,
  type SkillContext,
} from "@civ/skills";
import { Vec3 as Vec3Class } from "vec3";
import { cellClaimKey } from "./claims.js";
import { planConstructionProcurement } from "./construction-procurement.js";
import { selectConstructionSite } from "./construction-site-select.js";
import type { PlannedTask } from "./planner.js";
import { transitionProject, type ProjectStatus, type SettlementProject } from "./projects.js";
import type { SettlementRuntime } from "./settlement-runtime.js";

export type BuildStructureProject = SettlementProject & {
  type: "STARTER_SHELTER" | "STRUCTURE_BUILD";
  ownerCitizenId?: string;
  cancelled?: boolean;
  preflightBlockers?: string[];
  remainingResources?: Record<string, number>;
  /** Items still needed after inventory − foreign reservations. Not “free materials.” */
  materialShortfall?: Record<string, number>;
  lastPersistOk?: boolean;
  lastPersistReason?: string;
};

export type ConstructionDispatchPhase =
  | "REUSED"
  | "PLANNED"
  | "PROCURING"
  | "SITE_CLAIM_DENIED"
  | "BUILDING"
  | "PARTIAL"
  | "BLOCKED"
  | "FAILED"
  | "COMPLETED"
  | "CANCELLED"
  | "PERSIST_FAILED";

export type ConstructionDispatchResult = {
  phase: ConstructionDispatchPhase;
  project: BuildStructureProject;
  preflight?: BuildStructurePreflight;
  shortfall: Record<string, number>;
  actionResult?: ActionResult<BuildAdvance | { complete?: boolean; persisted?: boolean }>;
  /** True only after fresh world verification says nothing remains. */
  worldVerifiedComplete: boolean;
  reusedExisting: boolean;
};

export type AdvanceBuildFn = (
  ctx: SkillContext,
  session: BuildSession,
  opts?: { maxPlacements?: number; liveValidate?: boolean; forceNew?: boolean },
) => Promise<ActionResult<BuildAdvance>>;

export type PersistProjectFn = (project: BuildStructureProject) => { ok: boolean; reason?: string };

const SITE_CLAIM_KIND = "construction_site";

export function constructionProjectId(blueprintId: string, citizenId: string, origin: Vec3): string {
  return `project_${blueprintId}_${citizenId}_${Math.floor(origin.x)}_${Math.floor(origin.y)}_${Math.floor(origin.z)}`;
}

export function siteKeyFromOrigin(origin: Vec3): string {
  return cellClaimKey(origin.x, origin.y, origin.z);
}

export function projectsMatchIntention(
  project: SettlementProject | BuildStructureProject | undefined,
  intention: BuildStructureIntention,
): project is BuildStructureProject {
  if (!project) return false;
  const origin = intention.origin;
  if (!project.site) return false;
  if (project.blueprintId !== (intention.blueprintId ?? project.blueprintId)) return false;
  if (
    Math.floor(project.site.x) !== Math.floor(origin.x) ||
    Math.floor(project.site.y) !== Math.floor(origin.y) ||
    Math.floor(project.site.z) !== Math.floor(origin.z)
  ) {
    return false;
  }
  const owned = project as BuildStructureProject;
  if (owned.ownerCitizenId && owned.ownerCitizenId !== intention.citizenId) return false;
  return true;
}

/** Inventory the citizen may spend: physical counts minus holds owned by others. */
export function authorizedInventoryForCitizen(
  runtime: SettlementRuntime,
  citizenId: string,
  physical: Record<string, number>,
  now = Date.now(),
): Record<string, number> {
  const bag: Record<string, number> = { ...physical };
  for (const hold of runtime.reservations.list(now)) {
    if (hold.ownerId === citizenId) continue;
    bag[hold.item] = Math.max(0, (bag[hold.item] ?? 0) - hold.quantity);
  }
  return bag;
}

export function createStructureProjectFromPreflight(
  preflight: BuildStructurePreflight,
  now = new Date().toISOString(),
): BuildStructureProject {
  const session = createBuildSession({
    blueprintId: preflight.blueprint.id,
    structureType: preflight.blueprint.structureType,
    facing: preflight.facing,
    origin: preflight.intention.origin,
    materials: preflight.expanded.materials,
    extras: preflight.intention.extras ?? ["chest", "lighting", "crafting_table"],
  });
  session.total = preflight.cells.filter((cell) => !cell.skipIfSolid).length;
  session.placed = preflight.comparison?.correct ?? 0;

  let status: ProjectStatus = "PLANNED";
  if (preflight.status === "FAILED" || preflight.status === "BLOCKED") status = "BLOCKED";
  else if (preflight.status === "PROCURING") status = "PROCURING";
  else if (preflight.nextStatusHint === "READY_TO_BUILD") status = "READY_TO_BUILD";

  const project: BuildStructureProject = {
    id: constructionProjectId(preflight.blueprint.id, preflight.intention.citizenId, preflight.intention.origin),
    type: preflight.blueprint.structureType === "BASIC_SHELTER" ? "STARTER_SHELTER" : "STRUCTURE_BUILD",
    ownerCitizenId: preflight.intention.citizenId,
    status,
    stage: session.stage,
    blueprintId: preflight.blueprint.id,
    blueprintVersion: preflight.blueprint.version,
    facing: preflight.facing,
    site: preflight.intention.origin,
    requiredResources: preflight.billOfMaterials,
    reservedResources: {},
    blocked: [],
    placed: session.placed,
    total: session.total,
    verified: preflight.comparison?.correct ?? 0,
    startedAt: now,
    session,
    preflightBlockers: preflight.blockers,
    remainingResources: preflight.remainingMaterials,
    materialShortfall: preflight.inventoryShortfall,
    cancelled: false,
  };

  if (status === "READY_TO_BUILD" || status === "PROCURING") {
    return transitionProject(project, {
      type: status === "PROCURING" ? "materials_missing" : "materials_ready",
    }) as BuildStructureProject;
  }
  return project;
}

/**
 * Accept a citizen construction intention and produce an offline preflight + project shell.
 * Does not touch Mineflayer, Paper, or production SQLite.
 */
export function planBuildStructure(
  intention: BuildStructureIntention,
  getBlock?: (pos: Vec3) => string | undefined,
): { preflight: BuildStructurePreflight; project: BuildStructureProject } {
  const resolved: BuildStructureIntention = {
    extras: ["chest", "lighting", "crafting_table"],
    ...intention,
    blueprintId:
      intention.blueprintId ??
      (intention.structureType === "WORKSHOP" ? WORKSHOP_CABIN_ID : intention.blueprintId),
  };
  const preflight = preflightBuildStructure(resolved, getBlock);
  const project = createStructureProjectFromPreflight(preflight);
  return { preflight, project };
}

export function applyWorldReconcileToSession(
  session: BuildSession,
  origin: Vec3,
  facing: Cardinal,
  getBlock: (pos: Vec3) => string | undefined,
  getBlockProperties?: (
    pos: Vec3,
  ) => import("@civ/minecraft-knowledge").BlockProperties | undefined | null,
): { session: BuildSession; remaining: Record<string, number>; complete: boolean; unknown: number; unverified: number } {
  const remaining = remainingAfterPartialBuild(
    session.blueprintId,
    origin,
    facing,
    getBlock,
    {},
    getBlockProperties,
    session.extras ?? ["chest", "lighting", "crafting_table"],
  );
  session.placed = remaining.correct;
  session.total = Object.values(remaining.billOfMaterials).reduce((sum, n) => sum + n, 0);
  const complete =
    remaining.missing === 0 &&
    remaining.wrong === 0 &&
    remaining.unknown === 0 &&
    remaining.protectedConflicts === 0 &&
    (remaining.unverified ?? 0) === 0;
  if (complete) {
    session.status = "COMPLETE";
    session.stage = "FINAL_VALIDATION";
  } else {
    session.status = "IN_PROGRESS";
    if (session.stage === "FINAL_VALIDATION") {
      session.stage = "FLOOR";
    }
  }
  return {
    session,
    remaining: remaining.remaining,
    complete,
    unknown: remaining.unknown,
    unverified: remaining.unverified ?? 0,
  };
}

export function cancelConstructionProject(project: BuildStructureProject): BuildStructureProject {
  return {
    ...project,
    cancelled: true,
    status: project.status === "COMPLETED" ? "COMPLETED" : "BLOCKED",
    session: project.session
      ? { ...project.session, status: project.session.status === "COMPLETE" ? "COMPLETE" : "ABANDONED" }
      : project.session,
  };
}

/**
 * Planner helper: turn an owned active structure project into the next PlannedTask
 * without human task injection. Procurement is explicit (obtainItem), never fabricated stock.
 */
export function plannedTaskForConstructionProject(
  project: BuildStructureProject | undefined,
  citizenId: string,
): PlannedTask | undefined {
  if (!project) return undefined;
  if (project.ownerCitizenId && project.ownerCitizenId !== citizenId) return undefined;
  if (project.cancelled) return undefined;
  if (project.status === "COMPLETED" || project.status === "FAILED") return undefined;

  const shortfall = project.materialShortfall ?? {};
  const missingItem = Object.keys(shortfall).find((name) => (shortfall[name] ?? 0) > 0);
  if (project.status === "PROCURING" || (missingItem && project.status !== "BUILDING")) {
    if (!missingItem) {
      return {
        goal: "build_structure",
        task: "build_structure",
        action: "buildStructure",
        source: "planner",
        reason: "Construction waiting on materials but shortfall list empty — re-evaluate",
        priority: 0.65,
        occupation: "builder",
        item: project.blueprintId,
        target: project.site,
        blocked: { code: "MATERIALS_MISSING", missing: "unknown" },
      };
    }
    return {
      goal: "obtain_item",
      task: "obtain_item",
      action: "obtainItem",
      source: "planner",
      reason: `Construction shortfall: need ${shortfall[missingItem]} ${missingItem} (procurement, not free stock)`,
      priority: 0.7,
      occupation: "builder",
      item: missingItem,
      target: project.site,
      blocked: { code: "MATERIALS_MISSING", missing: missingItem },
      count: shortfall[missingItem],
    };
  }

  if (project.status === "BLOCKED" && (project.preflightBlockers?.length ?? 0) > 0) {
    return {
      goal: "build_structure",
      task: "build_structure",
      action: "blocked",
      source: "planner",
      reason: `Construction blocked: ${project.preflightBlockers?.join(",")}`,
      priority: 0.4,
      occupation: "builder",
      item: project.blueprintId,
      target: project.site,
      blocked: { code: project.preflightBlockers![0]!, missing: "" },
    };
  }

  return {
    goal: "build_structure",
    task: "build_structure",
    action: "buildStructure",
    source: "planner",
    reason: `Continue structure ${project.blueprintId}`,
    priority: 0.68,
    occupation: "builder",
    item: project.blueprintId,
    target: project.site,
  };
}

/**
 * Intention → reuse/create project → site claim → shortfall → optional advanceBlueprintBuild.
 * Physical advance only runs when ctx + advance are provided and materials/site allow it.
 */
export async function dispatchCitizenBuildIntention(args: {
  intention: BuildStructureIntention;
  runtime: SettlementRuntime;
  getBlock?: (pos: Vec3) => string | undefined;
  getBlockProperties?: (
    pos: Vec3,
  ) => import("@civ/minecraft-knowledge").BlockProperties | undefined | null;
  physicalInventory?: Record<string, number>;
  ctx?: SkillContext;
  advance?: AdvanceBuildFn;
  persist?: PersistProjectFn;
  maxPlacements?: number;
  now?: number;
}): Promise<ConstructionDispatchResult> {
  const now = args.now ?? Date.now();
  const intention: BuildStructureIntention = {
    extras: ["chest", "lighting", "crafting_table"],
    ...args.intention,
    blueprintId:
      args.intention.blueprintId ??
      (args.intention.structureType === "WORKSHOP" ? WORKSHOP_CABIN_ID : args.intention.blueprintId),
    inventory:
      args.intention.inventory ??
      authorizedInventoryForCitizen(
        args.runtime,
        args.intention.citizenId,
        args.physicalInventory ?? {},
        now,
      ),
  };

  const existing = args.runtime.project as BuildStructureProject | undefined;
  let reusedExisting = false;
  let project: BuildStructureProject;
  let preflight: BuildStructurePreflight | undefined;

  if (existing?.cancelled && projectsMatchIntention(existing, intention)) {
    return {
      phase: "CANCELLED",
      project: existing,
      shortfall: existing.materialShortfall ?? {},
      worldVerifiedComplete: false,
      reusedExisting: true,
    };
  }

  if (projectsMatchIntention(existing, intention) && existing!.status !== "FAILED") {
    reusedExisting = true;
    project = existing!;
    // Refresh shortfall / world reconcile without minting a new id/session.
    if (args.getBlock && project.site && project.session && project.facing) {
      const reconciled = applyWorldReconcileToSession(
        project.session,
        project.site,
        project.facing,
        args.getBlock,
        args.getBlockProperties,
      );
      project = {
        ...project,
        session: reconciled.session,
        placed: reconciled.session.placed,
        total: reconciled.session.total,
        verified: reconciled.session.placed,
        remainingResources: reconciled.remaining,
      };
      if (reconciled.complete) {
        project = {
          ...transitionProject(project, {
            type: "verified",
            verified: project.total,
            total: project.total,
          }) as BuildStructureProject,
          ownerCitizenId: project.ownerCitizenId,
          materialShortfall: {},
          remainingResources: {},
        };
        args.runtime.project = project;
        const persist = args.persist?.(project);
        if (persist && !persist.ok) {
          project = {
            ...project,
            status: "BUILDING",
            lastPersistOk: false,
            lastPersistReason: persist.reason ?? "persist_failed",
            completedAt: undefined,
          };
          args.runtime.project = project;
          return {
            phase: "PERSIST_FAILED",
            project,
            shortfall: {},
            worldVerifiedComplete: true,
            reusedExisting: true,
            actionResult: ok(
              { complete: true, persisted: false },
              0,
            ),
          };
        }
        project = { ...project, lastPersistOk: true };
        args.runtime.project = project;
        return {
          phase: "COMPLETED",
          project,
          shortfall: {},
          worldVerifiedComplete: true,
          reusedExisting: true,
          actionResult: ok({ complete: true, persisted: persist?.ok ?? true }, 0),
        };
      }
      if (reconciled.unknown > 0) {
        project = {
          ...project,
          status: "BLOCKED",
          preflightBlockers: [...new Set([...(project.preflightBlockers ?? []), "WORLD_UNKNOWN_BLOCKS"])],
        };
        args.runtime.project = project;
        return {
          phase: "BLOCKED",
          project,
          shortfall: project.materialShortfall ?? {},
          worldVerifiedComplete: false,
          reusedExisting: true,
        };
      }
    }
    const authInv = intention.inventory ?? {};
    const remaining = project.remainingResources ?? project.requiredResources;
    const shortfall: Record<string, number> = {};
    for (const [item, need] of Object.entries(remaining)) {
      const have = authInv[item] ?? 0;
      if (item.endsWith("_planks")) {
        const planks =
          (authInv.oak_planks ?? 0) + (authInv.spruce_planks ?? 0) + (authInv.birch_planks ?? 0);
        if (planks < need) shortfall[item] = need - planks;
        continue;
      }
      if (have < need) shortfall[item] = need - have;
    }
    project = { ...project, materialShortfall: shortfall };
    if (Object.keys(shortfall).length > 0) {
      project = transitionProject(project, { type: "materials_missing" }) as BuildStructureProject;
      project.materialShortfall = shortfall;
      args.runtime.project = project;
      return {
        phase: "PROCURING",
        project,
        shortfall,
        worldVerifiedComplete: false,
        reusedExisting: true,
      };
    }
  } else {
    const planned = planBuildStructure(intention, args.getBlock);
    preflight = planned.preflight;
    project = planned.project;
    // Another citizen already owns this site?
    const key = siteKeyFromOrigin(intention.origin);
    const siteOwner = args.runtime.claims.ownerOf(SITE_CLAIM_KIND, key, now);
    if (siteOwner && siteOwner !== intention.citizenId) {
      project = {
        ...project,
        status: "BLOCKED",
        preflightBlockers: [...(project.preflightBlockers ?? []), "SITE_CLAIM_DENIED"],
      };
      return {
        phase: "SITE_CLAIM_DENIED",
        project,
        preflight,
        shortfall: project.materialShortfall ?? {},
        worldVerifiedComplete: false,
        reusedExisting: false,
        actionResult: fail(
          "ACCESS_DENIED",
          `Construction site claimed by ${siteOwner}; refusing takeover`,
          0,
          false,
          { siteOwner, workComplete: false },
        ),
      };
    }
    if (!args.runtime.claims.tryClaim(SITE_CLAIM_KIND, key, intention.citizenId, 30 * 60_000, now)) {
      project = {
        ...project,
        status: "BLOCKED",
        preflightBlockers: [...(project.preflightBlockers ?? []), "SITE_CLAIM_DENIED"],
      };
      return {
        phase: "SITE_CLAIM_DENIED",
        project,
        preflight,
        shortfall: project.materialShortfall ?? {},
        worldVerifiedComplete: false,
        reusedExisting: false,
      };
    }
    args.runtime.project = project;
    if (project.status === "BLOCKED" || project.status === "FAILED") {
      return {
        phase: project.status === "FAILED" ? "FAILED" : "BLOCKED",
        project,
        preflight,
        shortfall: project.materialShortfall ?? {},
        worldVerifiedComplete: false,
        reusedExisting: false,
      };
    }
    if (project.status === "PROCURING" || Object.keys(project.materialShortfall ?? {}).length > 0) {
      // Reserve only what this citizen still needs — never invent stock.
      for (const [item, qty] of Object.entries(project.materialShortfall ?? {})) {
        args.runtime.reservations.reserve(intention.citizenId, "construction", item, qty, 10 * 60_000, now);
      }
      return {
        phase: "PROCURING",
        project,
        preflight,
        shortfall: project.materialShortfall ?? {},
        worldVerifiedComplete: false,
        reusedExisting: false,
      };
    }
  }

  if (project.cancelled) {
    args.runtime.project = project;
    return {
      phase: "CANCELLED",
      project,
      preflight,
      shortfall: {},
      worldVerifiedComplete: false,
      reusedExisting,
    };
  }

  // Ready path: optional physical advance (skipped in pure offline tests without ctx).
  if (!args.ctx || !project.session) {
    project = transitionProject(project, { type: "materials_ready" }) as BuildStructureProject;
    args.runtime.project = project;
    return {
      phase: reusedExisting ? "REUSED" : "PLANNED",
      project,
      preflight,
      shortfall: {},
      worldVerifiedComplete: false,
      reusedExisting,
    };
  }

  const advance = args.advance ?? advanceBlueprintBuild;
  const beforePlaced = project.session.placed;
  // Live validation must run on the real placer path; offline mocks inject advance().
  const result = await advance(args.ctx, project.session, {
    maxPlacements: args.maxPlacements ?? 1,
    liveValidate: true,
    forceNew: false,
  });

  const session =
    result.success
      ? result.data.session
      : ((result.details?.session as BuildSession | undefined) ?? project.session);

  // Failed placement must not silently inflate progress beyond world truth.
  if (!result.success) {
    if (args.getBlock && project.site && project.facing) {
      const reconciled = applyWorldReconcileToSession(
        session,
        project.site,
        project.facing,
        args.getBlock,
        args.getBlockProperties,
      );
      project = {
        ...project,
        session: reconciled.session,
        placed: reconciled.session.placed,
        verified: reconciled.session.placed,
        status: "BLOCKED",
        remainingResources: reconciled.remaining,
      };
    } else {
      project = {
        ...project,
        session: { ...session, placed: Math.min(session.placed, beforePlaced) },
        placed: Math.min(session.placed, beforePlaced),
        status: "BLOCKED",
      };
    }
    args.runtime.project = project;
    const persist = args.persist?.(project);
    if (persist && !persist.ok) {
      project = { ...project, lastPersistOk: false, lastPersistReason: persist.reason };
      args.runtime.project = project;
    }
    return {
      phase: "BLOCKED",
      project,
      preflight,
      shortfall: project.materialShortfall ?? {},
      worldVerifiedComplete: false,
      reusedExisting,
      actionResult: result,
    };
  }

  project = {
    ...transitionProject(project, {
      type: "build_progress",
      placed: session.placed,
      verified: session.placed,
    }) as BuildStructureProject,
    session,
    ownerCitizenId: project.ownerCitizenId,
  };

  let worldVerifiedComplete = false;
  if (session.status === "COMPLETE" && args.getBlock && project.site && project.facing) {
    const reconciled = applyWorldReconcileToSession(
      session,
      project.site,
      project.facing,
      args.getBlock,
      args.getBlockProperties,
    );
    project.session = reconciled.session;
    project.placed = reconciled.session.placed;
    project.verified = reconciled.session.placed;
    worldVerifiedComplete = reconciled.complete;
    if (!reconciled.complete) {
      project.status = "BUILDING";
      project.remainingResources = reconciled.remaining;
      args.runtime.project = project;
      return {
        phase: "PARTIAL",
        project,
        preflight,
        shortfall: reconciled.remaining,
        worldVerifiedComplete: false,
        reusedExisting,
        actionResult: result,
      };
    }
    project = transitionProject(project, {
      type: "verified",
      verified: project.total,
      total: project.total,
    }) as BuildStructureProject;
  } else if (session.status === "COMPLETE" && !args.getBlock) {
    // Cannot claim COMPLETED without world verification.
    project.status = "BUILDING";
    args.runtime.project = project;
    return {
      phase: "PARTIAL",
      project,
      preflight,
      shortfall: {},
      worldVerifiedComplete: false,
      reusedExisting,
      actionResult: result,
    };
  }

  const persist = args.persist?.(project);
  if (persist && !persist.ok) {
    project = {
      ...project,
      status: worldVerifiedComplete ? "BUILDING" : project.status,
      completedAt: undefined,
      lastPersistOk: false,
      lastPersistReason: persist.reason ?? "persist_failed",
    };
    args.runtime.project = project;
    return {
      phase: "PERSIST_FAILED",
      project,
      preflight,
      shortfall: {},
      worldVerifiedComplete,
      reusedExisting,
      actionResult: ok({ complete: worldVerifiedComplete, persisted: false }, result.durationMs),
    };
  }

  project = { ...project, lastPersistOk: true };
  args.runtime.project = project;

  const phase: ConstructionDispatchPhase = worldVerifiedComplete
    ? "COMPLETED"
    : result.data.placedThisCall > 0
      ? "BUILDING"
      : "PARTIAL";

  return {
    phase,
    project,
    preflight,
    shortfall: project.materialShortfall ?? {},
    worldVerifiedComplete,
    reusedExisting,
    actionResult: result,
  };
}

/**
 * Executor entry: derive intention from PlannedTask + inventory.
 * When no plan.target / project.site exists, Phase-C site selection chooses origin
 * (never silently default to body feet next to H9 / settlement furniture).
 */
export async function executeBuildStructurePlan(args: {
  ctx: SkillContext;
  plan: PlannedTask;
  runtime: SettlementRuntime;
  getBlock?: (pos: Vec3) => string | undefined;
  persist?: PersistProjectFn;
  advance?: AdvanceBuildFn;
  cancelled?: boolean;
}): Promise<ActionResult> {
  const citizenId = args.ctx.citizenId;
  if (!citizenId) {
    return fail("NOT_CONNECTED", "Cannot build_structure without citizenId", 0, true);
  }

  const physical: Record<string, number> = {};
  for (const item of args.ctx.bot.inventory.items()) {
    physical[item.name] = (physical[item.name] ?? 0) + item.count;
  }

  const getBlock =
    args.getBlock ??
    ((pos: Vec3) => {
      const block = args.ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
      return block?.name;
    });

  const body =
    args.ctx.body.position() ??
    (args.ctx.bot.entity?.position
      ? {
          x: args.ctx.bot.entity.position.x,
          y: args.ctx.bot.entity.position.y,
          z: args.ctx.bot.entity.position.z,
        }
      : undefined);

  let origin: Vec3 | undefined =
    args.plan.target ?? args.runtime.project?.site ?? undefined;
  let facing: Cardinal =
    (args.runtime.project as BuildStructureProject | undefined)?.facing ?? "south";

  if (!origin) {
    if (!body) {
      return fail("NOT_CONNECTED", "Cannot build_structure without a site or body position", 0, true);
    }
    const blueprintId = args.plan.item ?? WORKSHOP_CABIN_ID;
    const blueprint = getBlueprint(blueprintId);
    if (!blueprint?.implemented) {
      return fail(
        "INVALID_ARGUMENT",
        `No implemented blueprint for ${blueprintId}`,
        0,
        false,
        { workComplete: false },
      );
    }
    const selected = selectConstructionSite({
      blueprint,
      from: { x: body.x, y: body.y, z: body.z },
      citizenId,
      runtime: args.runtime,
      getBlock,
      facing,
    });
    if (!selected.ok) {
      return fail(
        "SITE_UNSUITABLE",
        `No safe construction site near body: ${selected.reason}`,
        0,
        true,
        {
          workComplete: false,
          phase: "BLOCKED",
          blockers: selected.blockers,
        },
      );
    }
    origin = selected.site.origin;
    facing = selected.site.facing;
  }

  if (args.cancelled || (args.runtime.project as BuildStructureProject | undefined)?.cancelled) {
    const cancelled = cancelConstructionProject(
      (args.runtime.project as BuildStructureProject) ??
        createStructureProjectFromPreflight(
          preflightBuildStructure({
            citizenId,
            blueprintId: args.plan.item ?? WORKSHOP_CABIN_ID,
            origin,
            requireSiteOk: false,
          }),
        ),
    );
    args.runtime.project = cancelled;
    return fail("CANCELLED", "Construction cancelled; no further placement dispatch", 0, false, {
      workComplete: false,
      phase: "CANCELLED",
    });
  }

  const dispatched = await dispatchCitizenBuildIntention({
    intention: {
      citizenId,
      blueprintId: args.plan.item,
      structureType: args.plan.item ? undefined : "WORKSHOP",
      origin: { x: origin.x, y: origin.y, z: origin.z },
      facing,
      inventory: authorizedInventoryForCitizen(args.runtime, citizenId, physical),
    },
    runtime: args.runtime,
    getBlock,
    physicalInventory: physical,
    ctx: args.ctx,
    advance: args.advance,
    persist: args.persist,
    maxPlacements: 1,
  });

  if (dispatched.phase === "PROCURING") {
    const proc = planConstructionProcurement({
      citizenId,
      runtime: args.runtime,
      remainingBill: dispatched.shortfall,
      physicalInventory: physical,
    });
    const missing =
      proc.nextObtainItem ?? Object.keys(dispatched.shortfall)[0] ?? "materials";
    return fail(
      "ITEM_NOT_FOUND",
      `Construction procurement required: missing ${missing}`,
      0,
      true,
      {
        phase: "PROCURING",
        shortfall: dispatched.shortfall,
        procurement: proc,
        nextTask: "obtain_item",
        nextAction: "obtainItem",
        item: missing,
        count: proc.nextObtainCount || undefined,
        workComplete: false,
        projectId: dispatched.project.id,
      },
    );
  }
  if (dispatched.phase === "SITE_CLAIM_DENIED") {
    return (
      dispatched.actionResult ??
      fail("ACCESS_DENIED", "Construction site owned by another citizen", 0, false, {
        workComplete: false,
        phase: dispatched.phase,
      })
    );
  }
  if (dispatched.phase === "CANCELLED") {
    return fail("CANCELLED", "Construction cancelled", 0, false, { workComplete: false });
  }
  if (dispatched.phase === "PERSIST_FAILED") {
    return ok(
      {
        complete: false,
        persisted: false,
        phase: "PERSIST_FAILED",
        projectId: dispatched.project.id,
        worldVerifiedComplete: dispatched.worldVerifiedComplete,
      },
      dispatched.actionResult?.durationMs ?? 0,
    );
  }
  if (dispatched.phase === "COMPLETED" && dispatched.worldVerifiedComplete) {
    return ok(
      {
        complete: true,
        persisted: dispatched.project.lastPersistOk !== false,
        phase: "COMPLETED",
        projectId: dispatched.project.id,
      },
      dispatched.actionResult?.durationMs ?? 0,
    );
  }
  if (dispatched.actionResult) return dispatched.actionResult;
  return ok(
    {
      complete: false,
      phase: dispatched.phase,
      projectId: dispatched.project.id,
      reusedExisting: dispatched.reusedExisting,
    },
    0,
  );
}

export type { BuildStructureIntention, BuildStructurePreflight };
