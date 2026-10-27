import { fail, ok, type ActionResult, type ErrorCode, type Vec3 } from "@civ/shared";
import {
  BASIC_SHELTER_ID,
  blockMatchesPlan,
  blocksForStage,
  chooseExistingStructure,
  concreteBlock,
  defaultBlueprintFor,
  evaluateBlueprintSite,
  expandBlueprint,
  getBlueprint,
  isProtectedFurnitureName,
  isReplaceableName,
  isShelterType,
  migrateLegacyStage,
  nextBuildStage,
  resolveMaterials,
  rotatedFootprint,
  validateExpandedStructure,
  worldPosition,
  type BuildStage,
  type Cardinal,
  type ExpandedBlueprint,
  type KnownStructureRecord,
  type PlannedBlock,
  type ResolvedMaterials,
  type StructureType,
  type StructureValidationCode,
} from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { depositItem, pickupDroppedItem } from "./inventory-service.js";
import { inventoryCount } from "./inventory.js";
import { moveTo } from "./movement.js";
import { openDoor } from "./doors.js";
import { equipForBlock } from "./tools.js";
import { placeBlock } from "./world.js";
import { lookAtPosition } from "./look.js";
import type { PlacementIntent } from "./placement.js";

export type BuildSession = {
  instanceId: string;
  blueprintId: string;
  blueprintVersion: number;
  structureType: StructureType;
  facing: Cardinal;
  origin?: Vec3;
  materials: ResolvedMaterials;
  extras: Array<"chest" | "lighting" | "crafting_table" | "bed" | "furnace">;
  stage: BuildStage;
  status: "IN_PROGRESS" | "BLOCKED" | "COMPLETE" | "ABANDONED";
  placed: number;
  total: number;
  failures: StructureValidationCode[];
};

export type BuildAdvance = {
  session: BuildSession;
  stage: BuildStage;
  placedThisCall: number;
  reused?: KnownStructureRecord;
};

const CLEARABLE = new Set([
  "short_grass",
  "grass",
  "tall_grass",
  "fern",
  "dead_bush",
  "snow",
  "dandelion",
  "poppy",
  "blue_orchid",
  "azure_bluet",
  "oxeye_daisy",
  "cornflower",
  "lily_of_the_valley",
]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blockName(ctx: SkillContext, pos: Vec3): string | undefined {
  return ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)))?.name;
}

function inventoryBag(ctx: SkillContext): Record<string, number> {
  const bag: Record<string, number> = {};
  for (const item of ctx.bot.inventory.items()) {
    bag[item.name] = (bag[item.name] ?? 0) + item.count;
  }
  return bag;
}

function purposeFor(block: PlannedBlock): PlacementIntent {
  if (block.role === "door") return { purpose: "shelter_blueprint", structureId: "door" };
  if (block.role === "chest") return { purpose: "shelter_blueprint", structureId: "chest" };
  if (block.role === "crafting_table" || block.role === "furnace") {
    return { purpose: "shelter_blueprint", structureId: block.role };
  }
  if (block.role === "bed") return { purpose: "shelter_blueprint", structureId: "bed" };
  return { purpose: "shelter_blueprint", structureId: block.role };
}

export function createBuildSession(args: {
  blueprintId?: string;
  structureType?: StructureType;
  facing?: Cardinal;
  origin?: Vec3;
  materials?: ResolvedMaterials;
  extras?: BuildSession["extras"];
}): BuildSession {
  const blueprint =
    (args.blueprintId ? getBlueprint(args.blueprintId) : undefined) ??
    defaultBlueprintFor(args.structureType ?? "BASIC_SHELTER") ??
    getBlueprint(BASIC_SHELTER_ID)!;
  const extras = args.extras ?? (blueprint.structureType === "SMALL_HOUSE" ? ["chest", "lighting", "crafting_table"] : ["chest", "lighting"]);
  const materials = args.materials ?? resolveMaterials(blueprint, {});
  const expanded = expandBlueprint(blueprint, materials, args.facing ?? "south", extras);
  return {
    instanceId: `build_${blueprint.id}_${Date.now()}`,
    blueprintId: blueprint.id,
    blueprintVersion: blueprint.version,
    structureType: blueprint.structureType,
    facing: args.facing ?? "south",
    origin: args.origin,
    materials,
    extras,
    stage: args.origin ? "SITE_CLEARING" : "SITE_SELECTION",
    status: "IN_PROGRESS",
    placed: 0,
    total: expanded.blocks.filter((block) => !block.skipIfSolid && !block.impliedBySibling).length,
    failures: [],
  };
}

export function expandedFromSession(session: BuildSession): ExpandedBlueprint {
  const blueprint = getBlueprint(session.blueprintId) ?? defaultBlueprintFor(session.structureType)!;
  return expandBlueprint(blueprint, session.materials, session.facing, session.extras);
}

export function revalidateSession(ctx: SkillContext, session: BuildSession): BuildSession {
  if (!session.origin) return session;
  const expanded = expandedFromSession(session);
  let placed = 0;
  let firstIncomplete: BuildStage | undefined;
  for (const stage of expanded.blueprint.stages) {
    if (stage === "SITE_SELECTION" || stage === "SITE_CLEARING" || stage === "FINAL_VALIDATION") continue;
    const blocks = blocksForStage(expanded, stage);
    if (blocks.length === 0) continue;
    const incomplete = blocks.some((block) => {
      const pos = worldPosition(session.origin!, block.dx, block.dy, block.dz, expanded.blueprint.footprint, session.facing);
      const actual = blockName(ctx, pos);
      const okBlock = blockMatchesPlan(block, actual, session.materials);
      if (okBlock || (block.skipIfSolid && actual && !isReplaceableName(actual))) {
        placed += 1;
        return false;
      }
      if (block.optional) return false;
      return true;
    });
    if (incomplete && !firstIncomplete) firstIncomplete = stage;
  }
  session.placed = placed;
  session.total = expanded.blocks.filter((block) => !block.skipIfSolid).length;
  if (firstIncomplete) {
    if (session.stage === "FINAL_VALIDATION" || stageOrder(session.stage) > stageOrder(firstIncomplete)) {
      session.stage = firstIncomplete;
    }
    session.status = "IN_PROGRESS";
  }
  return session;
}

function stageOrder(stage: BuildStage | string): number {
  const migrated = migrateLegacyStage(String(stage));
  return ["SITE_SELECTION", "SITE_CLEARING", "FOUNDATION", "FLOOR", "WALLS", "DOOR_ACCESS", "ROOF", "INTERIOR", "WORKSTATIONS", "FINAL_VALIDATION"].indexOf(migrated);
}

export function selectBlueprintSite(
  ctx: SkillContext,
  session: BuildSession,
  known: KnownStructureRecord[] = [],
  radius = 32,
): ActionResult<{ origin: Vec3; score: number }> {
  const started = Date.now();
  const from = ctx.body.position();
  if (!from) return fail("NOT_CONNECTED", "No body position for site selection", Date.now() - started, true);
  const blueprint = getBlueprint(session.blueprintId) ?? defaultBlueprintFor(session.structureType)!;
  const getBlock = (pos: Vec3) => blockName(ctx, pos);
  const candidates: Vec3[] = [{ x: Math.floor(from.x) + 2, y: Math.floor(from.y), z: Math.floor(from.z) + 2 }];
  for (let ring = 4; ring <= radius; ring += 4) {
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      candidates.push({
        x: Math.floor(from.x + Math.cos(angle) * ring),
        y: Math.floor(from.y),
        z: Math.floor(from.z + Math.sin(angle) * ring),
      });
    }
  }
  const scored = candidates
    .map((origin) => ({ origin, check: evaluateBlueprintSite({ blueprint, origin, facing: session.facing, getBlock, knownStructures: known }) }))
    .filter((entry) => entry.check.ok)
    .sort((a, b) => b.check.score - a.check.score);
  const best = scored[0];
  if (!best) {
    return fail("SITE_UNSUITABLE", "No suitable footprint nearby; choose another site instead of terraforming", Date.now() - started, true, {
      radius,
    });
  }
  return ok({ origin: best.origin, score: best.check.score }, Date.now() - started);
}

export function decideStructureAction(
  need: StructureType,
  known: KnownStructureRecord[],
  from?: Vec3,
  forceNew = false,
): { kind: "USE_EXISTING" | "BUILD_NEW"; structure?: KnownStructureRecord } {
  if (!forceNew) {
    const existing = chooseExistingStructure(need, known, from);
    if (existing) return { kind: "USE_EXISTING", structure: existing };
  }
  return { kind: "BUILD_NEW" };
}

export function scanRecognizedStructures(
  ctx: SkillContext,
  known: KnownStructureRecord[] = [],
  maxDistance = 24,
): KnownStructureRecord[] {
  const from = ctx.body.position();
  const found: KnownStructureRecord[] = known.map((entry) => {
    const distance = from
      ? Math.hypot(entry.origin.x - from.x, entry.origin.y - from.y, entry.origin.z - from.z)
      : entry.distance ?? 0;
    return { ...entry, distance };
  });
  const bot = ctx.bot;
  const ids = ["oak_door", "spruce_door", "birch_door"]
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0 || !from) return found.filter((entry) => (entry.distance ?? 99) <= maxDistance);
  const doors = bot.findBlocks({ matching: ids, maxDistance, count: 12 });
  for (const pos of doors) {
    const origin = { x: pos.x - 1, y: pos.y - 1, z: pos.z };
    if (found.some((entry) => Math.abs(entry.origin.x - origin.x) < 3 && Math.abs(entry.origin.z - origin.z) < 3)) continue;
    const interior = blockName(ctx, { x: pos.x, y: pos.y, z: pos.z + 1 });
    const roof = blockName(ctx, { x: pos.x, y: pos.y + 2, z: pos.z + 1 });
    const usable = isReplaceableName(interior) && roof && !isReplaceableName(roof);
    found.push({
      id: `door_${pos.x}_${pos.y}_${pos.z}`,
      blueprintId: BASIC_SHELTER_ID,
      blueprintVersion: 1,
      structureType: "BASIC_SHELTER",
      origin,
      facing: "south",
      quality: usable ? "usable" : "incomplete",
      distance: Math.hypot(origin.x - from.x, origin.y - from.y, origin.z - from.z),
    });
  }
  return found.filter((entry) => (entry.distance ?? 99) <= maxDistance);
}

async function collectNearbyDrops(ctx: SkillContext): Promise<void> {
  const picked = await pickupDroppedItem(ctx, undefined, 5);
  if (!picked.success && picked.code === "ITEM_NOT_FOUND") return;
  if (picked.success) await wait(200);
}

async function clearCell(ctx: SkillContext, pos: Vec3): Promise<ActionResult> {
  const started = Date.now();
  const block = ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
  if (!block || block.name === "air" || block.name === "cave_air") return ok({ skipped: true }, 0);
  // Never dig house furniture / doors / beds — discovering them is not permission to clear.
  if (isProtectedFurnitureName(block.name)) {
    return fail(
      "ACCESS_DENIED",
      `Refusing clearSite dig of protected furniture ${block.name} at ${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`,
      Date.now() - started,
      false,
    );
  }
  if (!CLEARABLE.has(block.name) && !block.name.endsWith("_leaves")) {
    return fail("SITE_UNSUITABLE", `Will not terraform ${block.name} at site`, Date.now() - started, true);
  }
  const tool = await equipForBlock(ctx, block.name);
  if (!tool.success && tool.code === "MISSING_TOOL") return tool;
  const moved = await moveTo(ctx, { x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 }, 3);
  if (!moved.success && moved.code !== "PATH_BLOCKED") {
    // still try from here
  }
  await lookAtPosition(ctx, pos);
  try {
    await ctx.bot.dig(block, true);
  } catch (error) {
    return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  await wait(250);
  await collectNearbyDrops(ctx);
  return ok({ cleared: block.name }, Date.now() - started);
}

async function clearSite(ctx: SkillContext, session: BuildSession): Promise<ActionResult> {
  const started = Date.now();
  if (!session.origin) return fail("SITE_UNSUITABLE", "No origin to clear", 0, true);
  const blueprint = getBlueprint(session.blueprintId)!;
  const size = rotatedFootprint(blueprint.footprint, session.facing);
  for (let dx = 0; dx < size.width; dx += 1) {
    for (let dz = 0; dz < size.depth; dz += 1) {
      for (let dy = 0; dy <= blueprint.footprint.wallHeight + 1; dy += 1) {
        const pos = { x: session.origin.x + dx, y: session.origin.y + dy, z: session.origin.z + dz };
        const name = blockName(ctx, pos);
        if (!name || name === "air" || name === "cave_air") continue;
        if (isProtectedFurnitureName(name)) {
          return fail(
            "ACCESS_DENIED",
            `Construction volume contains protected furniture ${name}; refusing clearSite`,
            Date.now() - started,
            false,
          );
        }
        if (CLEARABLE.has(name) || name.endsWith("_leaves")) {
          const cleared = await clearCell(ctx, pos);
          if (!cleared.success) return cleared;
        } else if (!isReplaceableName(name)) {
          return fail("SITE_UNSUITABLE", `Site blocked by ${name}; choose another site`, Date.now() - started, true);
        }
      }
    }
  }
  await collectNearbyDrops(ctx);
  return ok({ cleared: true }, Date.now() - started);
}

function nextUnplacedBlock(ctx: SkillContext, session: BuildSession): { block: PlannedBlock; position: Vec3; item: string } | undefined {
  if (!session.origin) return undefined;
  const expanded = expandedFromSession(session);
  const stageBlocks = blocksForStage(expanded, session.stage);
  for (const block of stageBlocks) {
    if (block.impliedBySibling) continue;
    const position = worldPosition(session.origin, block.dx, block.dy, block.dz, expanded.blueprint.footprint, session.facing);
    const actual = blockName(ctx, position);
    if (blockMatchesPlan(block, actual, session.materials)) continue;
    if (block.skipIfSolid && actual && !isReplaceableName(actual)) continue;
    return { block, position, item: concreteBlock(block, session.materials) };
  }
  return undefined;
}

export async function advanceBlueprintBuild(
  ctx: SkillContext,
  session: BuildSession,
  opts?: { maxPlacements?: number; known?: KnownStructureRecord[]; liveValidate?: boolean; forceNew?: boolean },
): Promise<ActionResult<BuildAdvance>> {
  const started = Date.now();
  session.stage = migrateLegacyStage(session.stage);
  const blueprint = getBlueprint(session.blueprintId) ?? defaultBlueprintFor(session.structureType);
  if (!blueprint?.implemented) {
    return fail("INVALID_ARGUMENT", `${session.structureType} has no live blueprint yet`, Date.now() - started, false);
  }
  const from = ctx.body.position();
  const known = opts?.known ?? scanRecognizedStructures(ctx, [], 24);
  if (session.stage === "SITE_SELECTION" && !opts?.forceNew) {
    const decision = decideStructureAction(session.structureType, known, from);
    if (decision.kind === "USE_EXISTING" && decision.structure) {
      session.status = "COMPLETE";
      session.origin = decision.structure.origin;
      session.stage = "FINAL_VALIDATION";
      return ok({ session, stage: session.stage, placedThisCall: 0, reused: decision.structure }, Date.now() - started);
    }
  }

  session.materials = resolveMaterials(blueprint, inventoryBag(ctx), session.materials);
  revalidateSession(ctx, session);
  let placedThisCall = 0;
  const maxPlacements = opts?.maxPlacements ?? 1;

  while (session.status === "IN_PROGRESS") {
    if (ctx.signal?.aborted) {
      return fail("INTERRUPTED", "Build interrupted; progress is persisted", Date.now() - started, true, { session });
    }
    if (session.stage === "SITE_SELECTION") {
      const site = await Promise.resolve(selectBlueprintSite(ctx, session, known));
      if (!site.success) {
        session.status = "BLOCKED";
        session.failures = ["SITE_UNSUITABLE"];
        return site as ActionResult<BuildAdvance>;
      }
      session.origin = site.data.origin;
      session.stage = "SITE_CLEARING";
      continue;
    }
    if (session.stage === "SITE_CLEARING") {
      const cleared = await clearSite(ctx, session);
      if (!cleared.success) {
        session.status = "BLOCKED";
        session.failures = ["SITE_UNSUITABLE"];
        return cleared as ActionResult<BuildAdvance>;
      }
      session.stage = "FOUNDATION";
      continue;
    }
    if (session.stage === "FINAL_VALIDATION") {
      const report = await validateBuiltStructure(ctx, session, opts?.liveValidate !== false);
      session.failures = report.failures;
      if (!report.ok) {
        session.status = "BLOCKED";
        const code = (report.failures[0] ?? "STRUCTURE_INCOMPLETE") as ErrorCode;
        return fail(code, `Structure validation failed: ${report.failures.join(",")}`, Date.now() - started, true, {
          session,
          failures: report.failures,
        });
      }
      session.status = "COMPLETE";
      return ok({ session, stage: session.stage, placedThisCall }, Date.now() - started);
    }

    const next = nextUnplacedBlock(ctx, session);
    if (!next) {
      const advanced = nextBuildStage(session.stage);
      session.stage = advanced ?? "FINAL_VALIDATION";
      continue;
    }
    if (placedThisCall >= maxPlacements) {
      return ok({ session, stage: session.stage, placedThisCall }, Date.now() - started);
    }
    if (!ctx.bot.inventory.items().some((item) => item.name === next.item || (next.item.endsWith("_door") && item.name.endsWith("_door")))) {
      return fail("ITEM_NOT_FOUND", `Need ${next.item} to continue ${session.stage}`, Date.now() - started, true, { item: next.item, session });
    }
    const placed = await placeBlock(ctx, next.item, next.position, {
      ...purposeFor(next.block),
      projectId: session.instanceId,
      structureId: session.blueprintId,
    });
    if (!placed.success) {
      session.status = "BLOCKED";
      return fail(placed.code === "PURPOSELESS_PLACEMENT" ? placed.code : "BUILD_BLOCKED", placed.error, Date.now() - started, true, {
        block: next.item,
        position: next.position,
        session,
      });
    }
    placedThisCall += 1;
    session.placed += 1;
    session.status = "IN_PROGRESS";
  }
  return ok({ session, stage: session.stage, placedThisCall }, Date.now() - started);
}

export async function resumeBlueprintBuild(
  ctx: SkillContext,
  session: BuildSession,
  opts?: { maxPlacements?: number; liveValidate?: boolean },
): Promise<ActionResult<BuildAdvance>> {
  session.status = "IN_PROGRESS";
  revalidateSession(ctx, session);
  return advanceBlueprintBuild(ctx, session, opts);
}

export async function validateBuiltStructure(
  ctx: SkillContext,
  session: BuildSession,
  live = true,
): Promise<{ ok: boolean; failures: StructureValidationCode[]; entered?: boolean; exited?: boolean; usedWorkstation?: boolean }> {
  const failures: StructureValidationCode[] = [];
  if (!session.origin) return { ok: false, failures: ["STRUCTURE_INCOMPLETE"] };
  const expanded = expandedFromSession(session);
  const staticReport = validateExpandedStructure(expanded, session.origin, (pos) => blockName(ctx, pos));
  failures.push(...staticReport.failures);
  if (!live) return { ok: failures.length === 0, failures: [...new Set(failures)] };

  const origin = session.origin;
  const entrance = worldPosition(origin, expanded.entranceLocal.dx, expanded.entranceLocal.dy, expanded.entranceLocal.dz, expanded.blueprint.footprint, session.facing);
  const approach = worldPosition(origin, expanded.entranceLocal.dx, 0, expanded.entranceLocal.dz - 1, expanded.blueprint.footprint, session.facing);
  const standing = expanded.interiorLocal.find((cell) => {
    const occupied = expanded.workstationLocal.some((work) => work.dx === cell.dx && work.dz === cell.dz && work.dy === 1);
    return !occupied;
  }) ?? expanded.interiorLocal[0];
  if (!standing) failures.push("INTERIOR_UNREACHABLE");

  const toApproach = await moveTo(ctx, { x: approach.x + 0.5, y: approach.y, z: approach.z + 0.5 }, 1.6);
  if (!toApproach.success) failures.push("ENTRANCE_BLOCKED");
  const door = await openDoor(ctx, entrance);
  if (!door.success) failures.push("ENTRANCE_BLOCKED");

  let entered = false;
  if (standing) {
    const inside = worldPosition(origin, standing.dx, standing.dy, standing.dz, expanded.blueprint.footprint, session.facing);
    const movedIn = await moveTo(ctx, { x: inside.x + 0.5, y: inside.y, z: inside.z + 0.5 }, 1.2);
    if (!movedIn.success) failures.push("INTERIOR_UNREACHABLE");
    else entered = true;
    const head = blockName(ctx, { x: inside.x, y: inside.y + 1, z: inside.z });
    if (head && !isReplaceableName(head) && !head.includes("torch")) failures.push("INTERIOR_UNREACHABLE");
  }

  let usedWorkstation = false;
  const chest = expanded.workstationLocal.find((entry) => entry.role === "chest");
  if (chest) {
    const chestPos = worldPosition(origin, chest.dx, chest.dy, chest.dz, expanded.blueprint.footprint, session.facing);
    const have = ["oak_planks", "spruce_planks", "birch_planks"].find((name) => inventoryCount(ctx, name) > 0);
    if (!have) failures.push("WORKSTATION_UNREACHABLE");
    else {
      const deposited = await depositItem(ctx, have, 1, chestPos);
      if (!deposited.success) failures.push("WORKSTATION_UNREACHABLE");
      else usedWorkstation = true;
    }
  }

  const movedOut = await moveTo(ctx, { x: approach.x + 0.5, y: approach.y, z: approach.z + 0.5 }, 1.6);
  const exited = movedOut.success;
  if (!exited) failures.push("ENTRANCE_BLOCKED");

  return {
    ok: failures.length === 0,
    failures: [...new Set(failures)],
    entered,
    exited,
    usedWorkstation,
  };
}

export function knownFromSession(session: BuildSession, quality: KnownStructureRecord["quality"] = "usable"): KnownStructureRecord | undefined {
  if (!session.origin) return undefined;
  return {
    id: session.instanceId,
    blueprintId: session.blueprintId,
    blueprintVersion: session.blueprintVersion,
    structureType: session.structureType,
    origin: session.origin,
    facing: session.facing,
    quality,
  };
}

export { isShelterType };
