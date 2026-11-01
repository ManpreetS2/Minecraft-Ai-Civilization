/**
 * Phase E–F — offline construction execution simulation.
 *
 * Clearly labels simulated placements. Does not call Mineflayer.
 * Physical compatibility with live placeBlock remains UNVERIFIED until World-Lab auth.
 */
import type { Vec3 } from "@civ/shared";
import {
  WORKSHOP_CABIN_ID,
  concreteBlock,
  expandBlueprint,
  getBlueprint,
  nextBuildableBlocks,
  propertiesForPlannedBlock,
  resolveMaterials,
  sanitizeBlueprintExtras,
  validateBlueprintPipeline,
  worldPosition,
  type BlockProperties,
  type Cardinal,
  type ExpandedBlueprint,
} from "@civ/minecraft-knowledge";
// nextBuildableBlocks + validateBlueprintPipeline exported from knowledge index
import { SettlementRuntime } from "./settlement-runtime.js";
import {
  applyWorldReconcileToSession,
  cancelConstructionProject,
  dispatchCitizenBuildIntention,
  type BuildStructureProject,
} from "./build-structure.js";
import { planConstructionProcurement, releaseConstructionReservations } from "./construction-procurement.js";
import { selectConstructionSite } from "./construction-site-select.js";
import { createBuildSession } from "@civ/skills";

export type SimWorld = Map<string, string>;
export type SimProps = Map<string, BlockProperties>;

export function worldKey(pos: Vec3): string {
  return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

export function simGetBlock(world: SimWorld): (pos: Vec3) => string | undefined {
  // Missing key → undefined (unloaded), never silently treated as air by site selection.
  return (pos) => (world.has(worldKey(pos)) ? world.get(worldKey(pos)) : undefined);
}

export function simGetBlockProperties(props: SimProps): (pos: Vec3) => BlockProperties | undefined {
  return (pos) => props.get(worldKey(pos));
}

/** Fill a flat grass pad so site selection sees loaded solid ground. */
export function seedFlatPad(world: SimWorld, origin: Vec3, width: number, depth: number, y = 70): void {
  for (let dx = -2; dx < width + 2; dx += 1) {
    for (let dz = -2; dz < depth + 2; dz += 1) {
      world.set(worldKey({ x: origin.x + dx, y: y - 1, z: origin.z + dz }), "grass_block");
      world.set(worldKey({ x: origin.x + dx, y: y, z: origin.z + dz }), "air");
      world.set(worldKey({ x: origin.x + dx, y: y + 1, z: origin.z + dz }), "air");
      world.set(worldKey({ x: origin.x + dx, y: y + 2, z: origin.z + dz }), "air");
      world.set(worldKey({ x: origin.x + dx, y: y + 3, z: origin.z + dz }), "air");
      world.set(worldKey({ x: origin.x + dx, y: y + 4, z: origin.z + dz }), "air");
    }
  }
}

export type OfflinePlacementResult = {
  ok: boolean;
  placedIndex?: number;
  item?: string;
  position?: Vec3;
  error?: string;
  /** Explicit: this was a simulated world map write, not Mineflayer. */
  simulated: true;
};

/**
 * Simulate one survival placement into a world map + consume inventory.
 */
export function simulatePlaceNext(args: {
  expanded: ExpandedBlueprint;
  origin: Vec3;
  facing: Cardinal;
  world: SimWorld;
  inventory: Record<string, number>;
  satisfied: Set<number>;
  /** Optional property map — required for door/bed COMPLETE verification. */
  props?: SimProps;
}): OfflinePlacementResult {
  const next = nextBuildableBlocks(args.expanded, (index) => args.satisfied.has(index));
  const pick = next[0];
  if (!pick) return { ok: false, error: "nothing_left", simulated: true };
  const item = concreteBlock(pick.block, args.expanded.materials);
  const have = args.inventory[item] ?? 0;
  // plank family soft check
  let canPay = have > 0;
  if (item.endsWith("_planks")) {
    const planks =
      (args.inventory.oak_planks ?? 0) +
      (args.inventory.spruce_planks ?? 0) +
      (args.inventory.birch_planks ?? 0);
    canPay = planks > 0;
  }
  if (!canPay) {
    return { ok: false, error: `missing_${item}`, item, simulated: true };
  }
  const pos = worldPosition(
    args.origin,
    pick.block.dx,
    pick.block.dy,
    pick.block.dz,
    args.expanded.blueprint.footprint,
    args.facing,
  );
  const existing = args.world.get(worldKey(pos));
  if (existing === undefined) {
    return { ok: false, error: "WORLD_UNKNOWN_BLOCKS", position: pos, simulated: true };
  }
  if (existing !== "air" && existing !== "cave_air" && existing !== item) {
    return { ok: false, error: `obstructed_${existing}`, position: pos, simulated: true };
  }
  // consume
  if (item.endsWith("_planks")) {
    for (const name of ["oak_planks", "spruce_planks", "birch_planks"]) {
      if ((args.inventory[name] ?? 0) > 0) {
        args.inventory[name]! -= 1;
        break;
      }
    }
  } else {
    args.inventory[item] = have - 1;
  }
  args.world.set(worldKey(pos), item);
  const primaryProps = propertiesForPlannedBlock(pick.block, args.facing);
  if (args.props && primaryProps) args.props.set(worldKey(pos), primaryProps);
  args.satisfied.add(pick.index);

  // Multiblock: write implied siblings into the simulated world (one inventory item).
  args.expanded.blocks.forEach((block, index) => {
    if (!block.impliedBySibling) return;
    if (pick.block.role === "door" && block.role === "door" && block.dx === pick.block.dx && block.dz === pick.block.dz) {
      const up = worldPosition(
        args.origin,
        block.dx,
        block.dy,
        block.dz,
        args.expanded.blueprint.footprint,
        args.facing,
      );
      args.world.set(worldKey(up), item);
      const props = propertiesForPlannedBlock(block, args.facing);
      if (args.props && props) args.props.set(worldKey(up), props);
      args.satisfied.add(index);
    }
    if (pick.block.role === "bed" && block.role === "bed" && block.multiblockPart === "bed_head") {
      const head = worldPosition(
        args.origin,
        block.dx,
        block.dy,
        block.dz,
        args.expanded.blueprint.footprint,
        args.facing,
      );
      args.world.set(worldKey(head), item);
      const props = propertiesForPlannedBlock(block, args.facing);
      if (args.props && props) args.props.set(worldKey(head), props);
      args.satisfied.add(index);
    }
  });

  return { ok: true, placedIndex: pick.index, item, position: pos, simulated: true };
}

export type EndToEndOfflineResult = {
  phase: string;
  projectStatus: string;
  worldVerifiedComplete: boolean;
  placedSimulated: number;
  interruptedAt?: number;
  resumedSkipped: number;
  blockers: string[];
  blueprintOk: boolean;
  /** All placement steps were offline simulations. */
  simulatedOnly: true;
};

/**
 * Mission 003 acceptance scenario (offline fixtures only).
 */
export async function runWorkshopCabinOfflineAcceptance(args?: {
  interruptAfter?: number;
  failPersist?: boolean;
  starveMaterials?: boolean;
}): Promise<EndToEndOfflineResult> {
  const interruptAfter = args?.interruptAfter ?? 8;
  const blueprint = getBlueprint(WORKSHOP_CABIN_ID)!;
  const pipeline = validateBlueprintPipeline(blueprint, { oak_planks: 64 });
  if (!pipeline.ok) {
    return {
      phase: "FAILED",
      projectStatus: "FAILED",
      worldVerifiedComplete: false,
      placedSimulated: 0,
      resumedSkipped: 0,
      blockers: pipeline.issues.map((i) => i.code),
      blueprintOk: false,
      simulatedOnly: true,
    };
  }

  const runtime = new SettlementRuntime();
  const world: SimWorld = new Map();
  const props: SimProps = new Map();
  const from = { x: 300, y: 70, z: 300 };
  seedFlatPad(world, from, 16, 16, 70);
  const getBlock = simGetBlock(world);
  const getBlockProperties = simGetBlockProperties(props);

  const site = selectConstructionSite({
    blueprint,
    from,
    citizenId: "citizen_atlas",
    runtime,
    getBlock,
    facing: "south",
  });
  if (!site.ok) {
    return {
      phase: "BLOCKED",
      projectStatus: "BLOCKED",
      worldVerifiedComplete: false,
      placedSimulated: 0,
      resumedSkipped: 0,
      blockers: site.blockers,
      blueprintOk: true,
      simulatedOnly: true,
    };
  }

  const inventory: Record<string, number> = args?.starveMaterials
    ? { oak_planks: 2 }
    : { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 };

  const dispatched = await dispatchCitizenBuildIntention({
    intention: {
      citizenId: "citizen_atlas",
      blueprintId: WORKSHOP_CABIN_ID,
      origin: site.site.origin,
      facing: site.site.facing,
      inventory,
    },
    runtime,
    getBlock,
    physicalInventory: inventory,
  });

  if (dispatched.phase === "PROCURING") {
    if (args?.starveMaterials) {
      return {
        phase: "PROCURING",
        projectStatus: dispatched.project.status,
        worldVerifiedComplete: false,
        placedSimulated: 0,
        resumedSkipped: 0,
        blockers: ["MATERIALS_MISSING"],
        blueprintOk: true,
        simulatedOnly: true,
      };
    }
  }

  const materials = resolveMaterials(blueprint, inventory);
  const extras = sanitizeBlueprintExtras(blueprint, ["chest", "lighting", "crafting_table"]);
  const expanded = expandBlueprint(blueprint, materials, site.site.facing, extras);
  const satisfied = new Set<number>();
  let placed = 0;

  // Place until interrupt
  while (placed < interruptAfter) {
    const step = simulatePlaceNext({
      expanded,
      origin: site.site.origin,
      facing: site.site.facing,
      world,
      inventory,
      satisfied,
      props,
    });
    if (!step.ok) break;
    placed += 1;
  }
  const interruptedAt = placed;

  // Persist project checkpoint (stale high placed count) then reload
  let project = dispatched.project;
  const session = createBuildSession({
    blueprintId: WORKSHOP_CABIN_ID,
    facing: site.site.facing,
    origin: site.site.origin,
    materials,
  });
  session.placed = placed + 50; // dishonest checkpoint
  session.status = "IN_PROGRESS";
  project = {
    ...project,
    site: site.site.origin,
    facing: site.site.facing,
    session,
    placed: session.placed,
    status: "BUILDING",
    ownerCitizenId: "citizen_atlas",
  };
  runtime.project = project;

  // Resume: reconcile world (door/bed state via props — unavailable props block COMPLETE)
  const reconciled = applyWorldReconcileToSession(
    project.session!,
    site.site.origin,
    site.site.facing,
    getBlock,
    getBlockProperties,
  );
  const resumedSkipped = reconciled.session.placed;
  project.session = reconciled.session;
  project.placed = reconciled.session.placed;

  // Finish remaining simulated placements — re-derive satisfied from world
  satisfied.clear();
  expanded.blocks.forEach((block, index) => {
    if (block.skipIfSolid) {
      satisfied.add(index);
      return;
    }
    const pos = worldPosition(
      site.site.origin,
      block.dx,
      block.dy,
      block.dz,
      blueprint.footprint,
      site.site.facing,
    );
    const actual = world.get(worldKey(pos));
    const expected = concreteBlock(block, materials);
    if (actual === expected) satisfied.add(index);
  });

  let guard = 0;
  while (guard < 200) {
    guard += 1;
    const step = simulatePlaceNext({
      expanded,
      origin: site.site.origin,
      facing: site.site.facing,
      world,
      inventory,
      satisfied,
      props,
    });
    if (!step.ok) {
      if (step.error?.startsWith("missing_")) {
        const proc = planConstructionProcurement({
          citizenId: "citizen_atlas",
          runtime,
          remainingBill: { [step.item ?? "oak_planks"]: 1 },
          physicalInventory: inventory,
        });
        if (proc.status !== "SATISFIED") {
          return {
            phase: "PROCURING",
            projectStatus: "PROCURING",
            worldVerifiedComplete: false,
            placedSimulated: placed,
            interruptedAt,
            resumedSkipped,
            blockers: ["MATERIALS_MISSING"],
            blueprintOk: true,
            simulatedOnly: true,
          };
        }
      }
      break;
    }
    placed += 1;
  }

  const finalReconcile = applyWorldReconcileToSession(
    project.session!,
    site.site.origin,
    site.site.facing,
    getBlock,
    getBlockProperties,
  );
  const complete = finalReconcile.complete;
  if (args?.failPersist && complete) {
    project = {
      ...project,
      status: "BUILDING",
      lastPersistOk: false,
      lastPersistReason: "sqlite_locked",
      completedAt: undefined,
    };
    runtime.project = project;
    return {
      phase: "PERSIST_FAILED",
      projectStatus: project.status,
      worldVerifiedComplete: true,
      placedSimulated: placed,
      interruptedAt,
      resumedSkipped,
      blockers: ["PERSIST_FAILED"],
      blueprintOk: true,
      simulatedOnly: true,
    };
  }

  if (complete) {
    project.status = "COMPLETED";
    project.lastPersistOk = true;
    releaseConstructionReservations(runtime, "citizen_atlas");
  }
  runtime.project = project;

  return {
    phase: complete ? "COMPLETED" : "PARTIAL",
    projectStatus: project.status,
    worldVerifiedComplete: complete,
    placedSimulated: placed,
    interruptedAt,
    resumedSkipped,
    blockers: complete ? [] : ["STRUCTURE_INCOMPLETE"],
    blueprintOk: true,
    simulatedOnly: true,
  };
}

export function cancelAndCleanup(runtime: SettlementRuntime, project: BuildStructureProject): void {
  runtime.project = cancelConstructionProject(project);
  if (project.ownerCitizenId) releaseConstructionReservations(runtime, project.ownerCitizenId);
}
