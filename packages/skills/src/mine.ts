/**
 * Bounded mine-known-ore skill.
 *
 * Reuses Blue's SAFE navigation (`navigateToInteractWithBlock` / `navigateNear`),
 * mineflayer-tool `equipToolForBlock` (requireHarvest, no chest pull), and existing
 * deposit/pickup skills. Does not load collectblock. Does not enable pathfinder canDig.
 *
 * Hidden / unexposed ore is never selected. Search elevations live in
 * `@civ/minecraft-knowledge` ores.ts and do not reveal world-file coordinates.
 */
import { fail, ok, type ActionResult, type ErrorCode, type Vec3 } from "@civ/shared";
import {
  equipToolForBlock,
  evaluateReturnHome,
  isWithinBlockReach,
  navigationBackend,
  shouldBlacklistTarget,
  type ReturnHomePlan,
} from "@civ/minecraft-adapter";
import {
  getOreProfile,
  minecraftKnowledge,
  oreDropsFor,
  pickaxeMeetsTier,
  pickaxeTierRank,
  recommendedPickaxeItem,
  refuseAccidentalPropertyBreak,
  resolveOreResource,
  type OreProfile,
} from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { classifyStaleTarget } from "./gather.js";
import { canFitDrop, inventorySpace, snapshotInventory } from "./inventory.js";
import { depositItems } from "./inventory.js";
import { pickupDroppedItem, countItem } from "./inventory-service.js";
import { lookAtPosition } from "./look.js";
import { obtainItem } from "./obtain.js";
import { cancelledThisCitizen, optionalWorkInterrupted } from "./optional-work.js";
import { equipForBlock } from "./tools.js";

export const MINING_RADIUS_CAP = 32;
export const MINING_ACTION_CAP = 48;
export const MINING_AMOUNT_CAP = 8;
export const MINING_TIMEOUT_CAP_MS = 120_000;

const SEE_THROUGH = new Set([
  "air",
  "cave_air",
  "void_air",
  "water",
  "bubble_column",
  "lava",
  "light",
  "torch",
  "wall_torch",
  "soul_torch",
  "lantern",
  "soul_lantern",
  "short_grass",
  "tall_grass",
  "grass",
  "fern",
  "snow",
  "vine",
  "glow_lichen",
]);

const FALLING = new Set(["gravel", "sand", "red_sand", "suspicious_sand", "suspicious_gravel"]);
const LAVA = new Set(["lava"]);
const SOLIDISH = new Set(["block"]);

export type WorldBlock = { name: string; boundingBox?: string } | null | undefined;
export type WorldGetter = (pos: Vec3) => WorldBlock;

export type OreSightingStatus = "hidden" | "obstructed" | "reachable";

export type OreSighting = {
  name: string;
  position: Vec3;
  exposed: boolean;
  lineOfSight: boolean;
  status: OreSightingStatus;
};

export type MiningRequest = {
  resource: string;
  searchOrigin: Vec3;
  searchRadius?: number;
  minY?: number;
  maxY?: number;
  amount?: number;
  maxActions?: number;
  timeoutMs?: number;
  destinationStorage?: Vec3;
  permittedStorage?: Vec3;
  biome?: string;
  returnHome?: Vec3;
};

export type MiningDecision =
  | {
      ok: true;
      resource: NonNullable<ReturnType<typeof resolveOreResource>>;
      profile: OreProfile;
      obtainTool?: string;
      chosen?: OreSighting;
      visible: OreSighting[];
      reachable: OreSighting[];
      hiddenIgnored: number;
    }
  | { ok: false; code: ErrorCode; error: string };

export type ExcavationIntent = {
  target: Vec3;
  feet: Vec3;
  targetName?: string;
  aboveName?: string;
  neighborNames: string[];
  inBounds: boolean;
};

const FACE_OFFSETS: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export function floorCell(pos: Vec3): Vec3 {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

export function sameCell(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

export function isSeeThrough(name: string | undefined): boolean {
  if (!name) return true;
  return SEE_THROUGH.has(name) || name.endsWith("_carpet") || name.includes("glass");
}

export function isWithinMiningBounds(pos: Vec3, origin: Vec3, radius: number, minY?: number, maxY?: number): boolean {
  const dx = Math.floor(pos.x) - Math.floor(origin.x);
  const dz = Math.floor(pos.z) - Math.floor(origin.z);
  if (Math.hypot(dx, dz) > radius) return false;
  const y = Math.floor(pos.y);
  if (minY !== undefined && y < minY) return false;
  if (maxY !== undefined && y > maxY) return false;
  return true;
}

export function isOreExposed(neighborNames: string[]): boolean {
  return neighborNames.some((name) => isSeeThrough(name));
}

export function hasLineOfSight(from: Vec3, to: Vec3, getBlock: WorldGetter, maxSteps = 32): boolean {
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  const tz = Math.floor(to.z);
  const dx = tx + 0.5 - from.x;
  const dy = ty + 0.5 - from.y;
  const dz = tz + 0.5 - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.2) return true;
  const steps = Math.min(maxSteps, Math.max(2, Math.ceil(dist * 2)));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const cell = { x: Math.floor(from.x + dx * t), y: Math.floor(from.y + dy * t), z: Math.floor(from.z + dz * t) };
    if (cell.x === tx && cell.y === ty && cell.z === tz) return true;
    const block = getBlock(cell);
    if (block && !isSeeThrough(block.name)) return false;
  }
  return true;
}

export function neighborNames(pos: Vec3, getBlock: WorldGetter): string[] {
  const cell = floorCell(pos);
  return FACE_OFFSETS.map((offset) => getBlock({ x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z + offset.z })?.name ?? "air");
}

function isHazardName(name: string | undefined): boolean {
  return Boolean(name && (LAVA.has(name) || name === "fire" || name === "soul_fire" || name === "magma_block" || name === "cactus"));
}

export function isWalkableCell(pos: Vec3, getBlock: WorldGetter): boolean {
  const feet = getBlock(pos);
  const head = getBlock({ x: pos.x, y: pos.y + 1, z: pos.z });
  const below = getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
  if (isHazardName(feet?.name) || isHazardName(head?.name) || isHazardName(below?.name)) return false;
  if (feet && !isSeeThrough(feet.name) && feet.boundingBox === "block") return false;
  if (head && !isSeeThrough(head.name) && head.boundingBox === "block") return false;
  if (!below || below.name === "air" || below.name === "cave_air" || below.name === "water") return false;
  if (below.boundingBox && below.boundingBox !== "block" && !below.name.endsWith("_slab") && !below.name.includes("stairs")) {
    return false;
  }
  return below.boundingBox === "block" || below.boundingBox === undefined || SOLIDISH.has(below.boundingBox);
}

export function standingCellsNear(ore: Vec3, getBlock: WorldGetter, radius = 2): Vec3[] {
  const bx = Math.floor(ore.x);
  const by = Math.floor(ore.y);
  const bz = Math.floor(ore.z);
  const spots: Vec3[] = [];
  for (const dy of [0, 1, -1]) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (dx === 0 && dz === 0 && dy === 0) continue;
        const pos = { x: bx + dx, y: by + dy, z: bz + dz };
        if (!isWalkableCell(pos, getBlock)) continue;
        const reach = Math.hypot(pos.x + 0.5 - (bx + 0.5), pos.y + 1.62 - (by + 0.5), pos.z + 0.5 - (bz + 0.5));
        if (reach > 4.5) continue;
        spots.push(pos);
      }
    }
  }
  return spots;
}

export function classifyOreTarget(
  blockName: string,
  position: Vec3,
  getBlock: WorldGetter,
  eye: Vec3,
): OreSighting {
  const neighbors = neighborNames(position, getBlock);
  const exposed = isOreExposed(neighbors);
  const lineOfSight = exposed && hasLineOfSight(eye, position, getBlock);
  if (!exposed) {
    return { name: blockName, position: floorCell(position), exposed: false, lineOfSight: false, status: "hidden" };
  }
  if (!lineOfSight) {
    return { name: blockName, position: floorCell(position), exposed: true, lineOfSight: false, status: "hidden" };
  }
  const standing = standingCellsNear(position, getBlock);
  const status: OreSightingStatus = standing.length > 0 ? "reachable" : "obstructed";
  return { name: blockName, position: floorCell(position), exposed: true, lineOfSight: true, status };
}

export function evaluateExcavation(intent: ExcavationIntent): { ok: true } | { ok: false; code: ErrorCode; error: string } {
  const property = refuseAccidentalPropertyBreak(intent.targetName);
  if (!property.ok) {
    return { ok: false, code: property.code, error: property.error };
  }
  if (!intent.inBounds) {
    return { ok: false, code: "UNSAFE_EXCAVATION", error: "Target is outside the permitted excavation boundary" };
  }
  const feet = floorCell(intent.feet);
  const target = floorCell(intent.target);
  if (target.x === feet.x && target.z === feet.z && target.y === feet.y - 1) {
    return { ok: false, code: "UNSAFE_EXCAVATION", error: "Refusing to dig the block directly underfoot (no straight-down mining)" };
  }
  if (intent.neighborNames.some((name) => LAVA.has(name))) {
    return { ok: false, code: "UNSAFE_EXCAVATION", error: "Lava is adjacent to that ore" };
  }
  if (intent.aboveName && FALLING.has(intent.aboveName) && target.x === feet.x && target.z === feet.z) {
    return { ok: false, code: "UNSAFE_EXCAVATION", error: "Falling block would land on the miner" };
  }
  return { ok: true };
}

export function assertPermittedStorage(
  destination?: Vec3,
  permitted?: Vec3,
): { ok: true; position?: Vec3 } | { ok: false; code: ErrorCode; error: string } {
  if (!destination && !permitted) return { ok: true };
  if (destination && permitted && !sameCell(destination, permitted)) {
    return { ok: false, code: "ACCESS_DENIED", error: "That chest is not the permitted mining storage" };
  }
  return { ok: true, position: destination ?? permitted };
}

export function inventoryCountOf(items: Array<{ name: string; count: number }>, names: string[]): number {
  const set = new Set(names);
  return items.filter((item) => set.has(item.name)).reduce((sum, item) => sum + item.count, 0);
}

export function clampMiningBounds(request: MiningRequest): {
  radius: number;
  amount: number;
  maxActions: number;
  timeoutMs: number;
} {
  return {
    radius: Math.min(MINING_RADIUS_CAP, Math.max(1, Math.floor(request.searchRadius ?? 16))),
    amount: Math.min(MINING_AMOUNT_CAP, Math.max(1, Math.floor(request.amount ?? 1))),
    maxActions: Math.min(MINING_ACTION_CAP, Math.max(1, Math.floor(request.maxActions ?? 24))),
    timeoutMs: Math.min(MINING_TIMEOUT_CAP_MS, Math.max(1_000, Math.floor(request.timeoutMs ?? 45_000))),
  };
}

function bestHeldPickaxe(
  inventory: Array<{ name: string; count: number }>,
  profile: OreProfile,
  canHarvest: (block: string, tool?: string) => boolean,
): string | undefined {
  const picks = inventory.filter((item) => item.count > 0 && item.name.includes("pickaxe"));
  const usable = picks.filter((item) => canHarvest(profile.blocks[0] ?? "stone", item.name) && pickaxeMeetsTier(item.name, profile.requiredPickaxeTier));
  usable.sort((a, b) => pickaxeTierRank(b.name) - pickaxeTierRank(a.name));
  return usable[0]?.name;
}

export function evaluateMiningRequest(input: {
  request: MiningRequest;
  inventory: Array<{ name: string; count: number }>;
  candidates: Array<{ name: string; position: Vec3 }>;
  getBlock: WorldGetter;
  botPosition: Vec3;
  hostilesNearby?: boolean;
  inventoryFull?: boolean;
  signalAborted?: boolean;
  deferSearch?: boolean;
  canHarvest: (block: string, tool?: string) => boolean;
}): MiningDecision {
  if (input.signalAborted) return { ok: false, code: "CANCELLED", error: "Mining task cancelled" };
  if (input.hostilesNearby) return { ok: false, code: "HOSTILE_NEARBY", error: "Hostiles are too close to mine" };
  if (input.inventoryFull) return { ok: false, code: "INVENTORY_FULL", error: "Inventory is full; store items before mining" };

  const resource = resolveOreResource(input.request.resource);
  const profile = resource ? getOreProfile(resource) : undefined;
  if (!resource || !profile) {
    return { ok: false, code: "INVALID_ARGUMENT", error: `Unknown mining resource ${input.request.resource}` };
  }
  const storage = assertPermittedStorage(input.request.destinationStorage, input.request.permittedStorage);
  if (!storage.ok) return storage;

  const bounds = clampMiningBounds(input.request);
  const held = bestHeldPickaxe(input.inventory, profile, input.canHarvest);
  let obtainTool: string | undefined;
  if (!held) {
    if (profile.requiredPickaxeTier === "wooden") obtainTool = recommendedPickaxeItem("wooden");
    else if (profile.requiredPickaxeTier === "stone" && input.inventory.some((item) => item.name === "cobblestone" && item.count >= 3)) {
      obtainTool = recommendedPickaxeItem("stone");
    } else {
      return {
        ok: false,
        code: "MISSING_TOOL",
        error: `Need a ${profile.requiredPickaxeTier} pickaxe or better to harvest ${profile.displayName}`,
      };
    }
  }

  if (input.deferSearch) {
    return { ok: true, resource, profile, obtainTool, visible: [], reachable: [], hiddenIgnored: 0 };
  }

  const eye = { x: input.botPosition.x, y: input.botPosition.y + 1.62, z: input.botPosition.z };
  const minY = input.request.minY ?? profile.totalMinY;
  const maxY = input.request.maxY ?? profile.totalMaxY;
  const classified = input.candidates
    .filter((candidate) => profile.blocks.includes(candidate.name))
    .filter((candidate) => isWithinMiningBounds(candidate.position, input.request.searchOrigin, bounds.radius, minY, maxY))
    .map((candidate) => classifyOreTarget(candidate.name, candidate.position, input.getBlock, eye));
  const hiddenIgnored = classified.filter((entry) => entry.status === "hidden").length;
  const visible = classified.filter((entry) => entry.status === "obstructed" || entry.status === "reachable");
  const reachable = classified.filter((entry) => entry.status === "reachable");
  const obstructed = classified.filter((entry) => entry.status === "obstructed");

  if (reachable.length === 0 && obstructed.length > 0) {
    return { ok: false, code: "TARGET_UNREACHABLE", error: `Visible ${profile.displayName} is obstructed` };
  }
  if (reachable.length === 0) {
    return {
      ok: false,
      code: "SEARCH_EXHAUSTED",
      error: `No visible reachable ${profile.displayName} in the permitted search area`,
    };
  }

  const origin = input.botPosition;
  const chosen = [...reachable].sort((a, b) => {
    const da = Math.hypot(a.position.x - origin.x, a.position.y - origin.y, a.position.z - origin.z);
    const db = Math.hypot(b.position.x - origin.x, b.position.y - origin.y, b.position.z - origin.z);
    return da - db;
  })[0];

  return {
    ok: true,
    resource,
    profile,
    obtainTool,
    chosen,
    visible,
    reachable,
    hiddenIgnored,
  };
}

function worldGetterFromCtx(ctx: SkillContext): WorldGetter {
  return (pos) => ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
}

function listOreCandidates(ctx: SkillContext, names: string[], origin: Vec3, radius: number): Array<{ name: string; position: Vec3 }> {
  const bot = ctx.bot;
  const ids = names
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0 || typeof bot.findBlocks !== "function") return [];
  const positions = bot.findBlocks({ matching: ids, maxDistance: Math.min(48, Math.max(radius + 4, 8)), count: 40 });
  const out: Array<{ name: string; position: Vec3 }> = [];
  for (const pos of positions) {
    const block = bot.blockAt(pos);
    if (!block) continue;
    const position = { x: block.position.x, y: block.position.y, z: block.position.z };
    if (ctx.body.unreachable.has(position)) continue;
    if (ctx.skipBlock?.(position)) continue;
    if (!isWithinMiningBounds(position, origin, radius)) continue;
    out.push({ name: block.name, position });
  }
  return out;
}

export async function mineKnownOre(
  ctx: SkillContext,
  request: MiningRequest,
): Promise<
  ActionResult<{
    resource: string;
    mined: Array<{ name: string; position: Vec3 }>;
    collected: Record<string, number>;
    deposited: number;
    hiddenIgnored: number;
    notFound: boolean;
  }>
> {
  const started = Date.now();
  const bounds = clampMiningBounds(request);
  const knowledge = minecraftKnowledge();
  const pos = ctx.body.position() ?? ctx.bot.entity?.position;
  if (!pos) return fail("NOT_CONNECTED", "Not spawned", 0);

  const inventory = ctx.bot.inventory.items().map((item) => ({ name: item.name, count: item.count }));
  const dropNames = oreDropsFor(request.resource);
  const full = !canFitDrop(ctx, dropNames.length ? dropNames : ["cobblestone"]) && inventorySpace(ctx) <= 0;
  const hostiles = ctx.body.nearbyEntities(8).some((entity) => entity.hostile);
  const getBlock = worldGetterFromCtx(ctx);
  const prereq = evaluateMiningRequest({
    request,
    inventory,
    candidates: [],
    getBlock,
    botPosition: { x: pos.x, y: pos.y, z: pos.z },
    hostilesNearby: hostiles,
    inventoryFull: full,
    signalAborted: Boolean(ctx.signal?.aborted),
    deferSearch: true,
    canHarvest: (block, tool) => knowledge.canHarvest(block, tool),
  });
  if (!prereq.ok) {
    const retryable = prereq.code !== "INVALID_ARGUMENT" && prereq.code !== "ACCESS_DENIED";
    return fail(prereq.code, prereq.error, Date.now() - started, retryable, { notFound: false });
  }
  if (ctx.signal?.aborted) {
    return cancelledThisCitizen({
      durationMs: Date.now() - started,
      inventory: snapshotInventory(ctx).counts,
      extra: { mined: [], collected: {} },
      error: "Mining task cancelled for this citizen",
    });
  }

  if (prereq.obtainTool) {
    const made = await obtainItem(ctx, prereq.obtainTool, 1);
    if (!made.success) return made;
  }

  const here = ctx.bot.entity?.position;
  const originDist = here
    ? Math.hypot(here.x - request.searchOrigin.x, here.y - request.searchOrigin.y, here.z - request.searchOrigin.z)
    : 99;
  if (originDist > 4) {
    const moved = await navigationBackend().navigateNear(ctx.bot, request.searchOrigin, 3, {
      timeoutMs: Math.min(bounds.timeoutMs, ctx.timeoutMs ?? 18_000),
      signal: ctx.signal,
    });
    if (!moved.success && originDist > bounds.radius + 4) return moved;
  }

  const before = Object.fromEntries(prereq.profile.drops.map((name) => [name, countItem(ctx, name)]));
  const mined: Array<{ name: string; position: Vec3 }> = [];
  let actions = 0;
  let hiddenIgnored = 0;
  let curfewPlan: ReturnHomePlan | undefined;
  const profile = prereq.profile;

  while (mined.length < bounds.amount && actions < bounds.maxActions) {
    if (ctx.signal?.aborted) {
      return cancelledThisCitizen({
        durationMs: Date.now() - started,
        inventory: snapshotInventory(ctx).counts,
        extra: { mined, hiddenIgnored, quotaProgress: `${mined.length}/${bounds.amount}` },
        error: "Mining task cancelled for this citizen",
      });
    }
    if (Date.now() - started > bounds.timeoutMs) {
      return fail("TIMEOUT", "Mining search budget timed out", Date.now() - started, true, { mined, hiddenIgnored });
    }
    const freshPos = ctx.body.position() ?? ctx.bot.entity?.position;
    if (!freshPos) return fail("NOT_CONNECTED", "Lost body while mining", Date.now() - started);
    if (request.returnHome) {
      const homePlan = evaluateReturnHome({
        position: { x: freshPos.x, y: freshPos.y, z: freshPos.z },
        home: request.returnHome,
        timeOfDay: ctx.bot.time?.timeOfDay ?? 0,
      });
      if (homePlan.shouldStopOptionalWork) {
        curfewPlan = homePlan;
        break;
      }
    }
    if (ctx.body.nearbyEntities(8).some((entity) => entity.hostile)) {
      return fail("HOSTILE_NEARBY", "Hostiles are too close to mine", Date.now() - started, true, { mined });
    }
    if (!canFitDrop(ctx, profile.drops) && inventorySpace(ctx) <= 0) {
      return fail("INVENTORY_FULL", "Inventory is full; store items before mining more", Date.now() - started, true, { mined });
    }
    actions += 1;

    const nextCandidates = listOreCandidates(ctx, profile.blocks, request.searchOrigin, bounds.radius);
    const next = evaluateMiningRequest({
      request,
      inventory: ctx.bot.inventory.items().map((item) => ({ name: item.name, count: item.count })),
      candidates: nextCandidates,
      getBlock,
      botPosition: { x: freshPos.x, y: freshPos.y, z: freshPos.z },
      canHarvest: (block, tool) => knowledge.canHarvest(block, tool),
    });
    if (!next.ok) {
      if (mined.length > 0) break;
      return fail(next.code, next.error, Date.now() - started, true, { notFound: next.code === "SEARCH_EXHAUSTED", hiddenIgnored });
    }
    hiddenIgnored = next.hiddenIgnored;
    const target = next.chosen;
    if (!target) break;

    const neighbors = neighborNames(target.position, getBlock);
    const above = getBlock({ x: target.position.x, y: target.position.y + 1, z: target.position.z })?.name;
    const safety = evaluateExcavation({
      target: target.position,
      feet: freshPos,
      targetName: target.name,
      aboveName: above,
      neighborNames: neighbors,
      inBounds: isWithinMiningBounds(target.position, request.searchOrigin, bounds.radius, request.minY, request.maxY),
    });
    if (!safety.ok) {
      ctx.body.unreachable.mark(target.position, 20_000);
      if (mined.length > 0) break;
      return fail(safety.code, safety.error, Date.now() - started, true);
    }

    const block = ctx.bot.blockAt(new Vec3Class(target.position.x, target.position.y, target.position.z));
    const stale = classifyStaleTarget(target.name, block?.name);
    if (stale || !block) {
      ctx.body.unreachable.mark(target.position, 8_000);
      continue;
    }

    const pluginEquip = await equipToolForBlock(ctx.bot, block);
    if (!pluginEquip.equipped && pluginEquip.error?.includes("NoItem")) {
      return fail("MISSING_TOOL", `Need a suitable tool to harvest ${block.name}`, Date.now() - started, true);
    }
    if (!pluginEquip.equipped) {
      const equipped = await equipForBlock(ctx, block.name);
      if (!equipped.success && equipped.code === "MISSING_TOOL") return equipped;
    }
    const held = ctx.bot.heldItem?.name;
    if (!knowledge.canHarvest(block.name, held)) {
      return fail("MISSING_TOOL", `Need a suitable tool to harvest ${block.name}`, Date.now() - started, true);
    }

    if (!isWithinBlockReach(ctx.bot, target.position)) {
      const approach = await navigationBackend().navigateToInteractWithBlock(ctx.bot, target.position, {
        timeoutMs: Math.min(18_000, bounds.timeoutMs - (Date.now() - started)),
        signal: ctx.signal,
      });
      if (!approach.success && !isWithinBlockReach(ctx.bot, target.position)) {
        if (shouldBlacklistTarget(approach.code)) ctx.body.unreachable.mark(target.position, 25_000);
        if (request.returnHome) {
          const hereNow = ctx.body.position() ?? ctx.bot.entity?.position ?? freshPos;
          const homePlan = evaluateReturnHome({
            position: { x: hereNow.x, y: hereNow.y, z: hereNow.z },
            home: request.returnHome,
            timeOfDay: ctx.bot.time?.timeOfDay ?? 0,
            routeImpassable: approach.code === "HAZARD_BLOCKED" || approach.code === "STUCK" || approach.code === "PATH_BLOCKED",
          });
          if (homePlan.shouldStopOptionalWork) {
            curfewPlan = homePlan;
            break;
          }
        }
        continue;
      }
    }

    const current = ctx.bot.blockAt(new Vec3Class(target.position.x, target.position.y, target.position.z));
    if (!current || current.name !== block.name) continue;
    await lookAtPosition(ctx, target.position);
    try {
      await ctx.bot.dig(current, true);
    } catch (error) {
      ctx.body.unreachable.mark(target.position, 20_000);
      return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
    }
    const after = ctx.bot.blockAt(new Vec3Class(target.position.x, target.position.y, target.position.z));
    if (after && after.name === current.name) {
      return fail("VERIFY_FAILED", `Block ${current.name} still present after dig`, Date.now() - started, true);
    }
    mined.push({ name: current.name, position: target.position });
    await pickupDroppedItem(ctx, undefined, 8);
  }

  const collected: Record<string, number> = {};
  for (const name of profile.drops) {
    collected[name] = countItem(ctx, name) - (before[name] ?? 0);
  }
  const gained = Object.values(collected).reduce((sum, n) => sum + n, 0);

  let deposited = 0;
  const storage = assertPermittedStorage(request.destinationStorage, request.permittedStorage);
  if (storage.ok && storage.position && gained > 0) {
    for (const name of profile.drops) {
      if (countItem(ctx, name) <= 0) continue;
      const stored = await depositItems(ctx, name, storage.position);
      if (stored.success) deposited += stored.data.deposited;
      else if (deposited === 0 && mined.length === 0) return stored;
    }
  }

  if (curfewPlan) {
    return optionalWorkInterrupted({
      plan: curfewPlan,
      durationMs: Date.now() - started,
      inventory: snapshotInventory(ctx).counts,
      extra: {
        resource: prereq.resource,
        mined,
        collected,
        deposited,
        hiddenIgnored,
        quotaProgress: `${mined.length}/${bounds.amount}`,
      },
    });
  }

  if (mined.length === 0 && gained <= 0) {
    return fail(
      "SEARCH_EXHAUSTED",
      `No visible reachable ${profile.displayName} in the permitted search area`,
      Date.now() - started,
      true,
      { notFound: true, hiddenIgnored, inventory: snapshotInventory(ctx).counts },
    );
  }

  return ok(
    {
      resource: prereq.resource,
      mined,
      collected,
      deposited,
      hiddenIgnored,
      notFound: false,
    },
    Date.now() - started,
  );
}
