/**
 * Bounded shore fishing.
 *
 * Uses Mineflayer activateItem + existing BLUE SAFE navigation, equipItem,
 * pickupDroppedItem, and depositItems. Does not load a fishing plugin, does
 * not swim, and does not copy Mindcraft (upstream has no dedicated fish skill).
 */
import { fail, ok, type ActionResult, type ErrorCode, type Vec3 } from "@civ/shared";
import { evaluateReturnHome, navigationBackend, type ReturnHomePlan } from "@civ/minecraft-adapter";
import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { lookAtPosition } from "./look.js";
import { canFitDrop, countItem, inventorySpace, pickupDroppedItem } from "./inventory-service.js";
import { depositItems, equipItem } from "./inventory.js";
import { assertPermittedStorage } from "./mine.js";

export const FISHING_RADIUS_CAP = 16;
export const FISHING_CAST_CAP = 4;
export const FISHING_TIMEOUT_CAP_MS = 90_000;
export const FISHING_CAST_TIMEOUT_MS = 45_000;

const WATER = new Set(["water", "bubble_column"]);
const AIRISH = new Set(["air", "cave_air", "void_air", "short_grass", "tall_grass", "grass", "fern", "snow"]);

const FACE_XZ: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/** Vanilla fishing loot that counts as a successful catch (fish, junk, or treasure). */
export const FISHING_CATCH_ITEMS = [
  "cod",
  "salmon",
  "tropical_fish",
  "pufferfish",
  "lily_pad",
  "bowl",
  "leather",
  "leather_boots",
  "rotten_flesh",
  "stick",
  "string",
  "bone",
  "ink_sac",
  "tripwire_hook",
  "bamboo",
  "cocoa_beans",
  "bow",
  "enchanted_book",
  "fishing_rod",
  "name_tag",
  "nautilus_shell",
  "saddle",
] as const;

export type WorldBlock = { name: string; boundingBox?: string } | null | undefined;
export type WorldGetter = (pos: Vec3) => WorldBlock;

export type ShoreCast = {
  stand: Vec3;
  water: Vec3;
};

export type FishingRequest = {
  searchOrigin: Vec3;
  searchRadius?: number;
  casts?: number;
  timeoutMs?: number;
  destinationStorage?: Vec3;
  permittedStorage?: Vec3;
  returnHome?: Vec3;
};

export type FishingDecision =
  | {
      ok: true;
      shore: ShoreCast;
      rod: string;
    }
  | { ok: false; code: ErrorCode; error: string };

type ActivatableBot = Bot & {
  activateItem?: (offHand?: boolean) => void;
  deactivateItem?: () => void;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function floorCell(pos: Vec3): Vec3 {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

export function isWaterName(name: string | undefined): boolean {
  return Boolean(name && WATER.has(name));
}

export function isAirishName(name: string | undefined): boolean {
  return !name || AIRISH.has(name);
}

export function clampFishingBounds(request: FishingRequest): { radius: number; casts: number; timeoutMs: number } {
  return {
    radius: Math.min(FISHING_RADIUS_CAP, Math.max(1, Math.floor(request.searchRadius ?? 8))),
    casts: Math.min(FISHING_CAST_CAP, Math.max(1, Math.floor(request.casts ?? 1))),
    timeoutMs: Math.min(FISHING_TIMEOUT_CAP_MS, Math.max(2_000, Math.floor(request.timeoutMs ?? 45_000))),
  };
}

export function isStandingInLiquid(pos: Vec3, getBlock: WorldGetter): boolean {
  const feet = getBlock(floorCell(pos));
  const below = getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) });
  return isWaterName(feet?.name) || below?.name === "lava" || feet?.name === "lava";
}

export function isWalkableShoreCell(pos: Vec3, getBlock: WorldGetter): boolean {
  const cell = floorCell(pos);
  const feet = getBlock(cell);
  const head = getBlock({ x: cell.x, y: cell.y + 1, z: cell.z });
  const below = getBlock({ x: cell.x, y: cell.y - 1, z: cell.z });
  if (isWaterName(feet?.name) || isWaterName(head?.name) || isWaterName(below?.name)) return false;
  if (feet?.name === "lava" || head?.name === "lava" || below?.name === "lava") return false;
  if (!isAirishName(feet?.name)) return false;
  if (!isAirishName(head?.name)) return false;
  if (!below || below.name === "air" || below.name === "cave_air") return false;
  if (below.boundingBox && below.boundingBox !== "block") return false;
  return true;
}

export function adjacentWater(stand: Vec3, getBlock: WorldGetter): Vec3 | undefined {
  const cell = floorCell(stand);
  for (const offset of FACE_XZ) {
    const same = { x: cell.x + offset.x, y: cell.y, z: cell.z + offset.z };
    if (isWaterName(getBlock(same)?.name)) return same;
    const down = { x: cell.x + offset.x, y: cell.y - 1, z: cell.z + offset.z };
    if (isWaterName(getBlock(down)?.name)) return down;
  }
  return undefined;
}

export function findShoreCasts(origin: Vec3, radius: number, getBlock: WorldGetter): ShoreCast[] {
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);
  const out: ShoreCast[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      if (Math.hypot(dx, dz) > radius) continue;
      for (const dy of [0, 1, -1]) {
        const stand = { x: ox + dx, y: oy + dy, z: oz + dz };
        if (!isWalkableShoreCell(stand, getBlock)) continue;
        const water = adjacentWater(stand, getBlock);
        if (!water) continue;
        out.push({ stand, water });
      }
    }
  }
  out.sort((a, b) => {
    const da = Math.hypot(a.stand.x - ox, a.stand.y - oy, a.stand.z - oz);
    const db = Math.hypot(b.stand.x - ox, b.stand.y - oy, b.stand.z - oz);
    return da - db;
  });
  return out;
}

export function snapshotCatchCounts(items: Array<{ name: string; count: number }>): Record<string, number> {
  const set = new Set<string>(FISHING_CATCH_ITEMS);
  const out: Record<string, number> = {};
  for (const item of items) {
    if (!set.has(item.name) || item.count <= 0) continue;
    out[item.name] = (out[item.name] ?? 0) + item.count;
  }
  return out;
}

export function fishingCatchCount(items: Array<{ name: string; count: number }>): number {
  return Object.values(snapshotCatchCounts(items)).reduce((sum, n) => sum + n, 0);
}

export function fishingHomeStop(input: {
  position: Vec3;
  home?: Vec3;
  timeOfDay: number;
  routeImpassable?: boolean;
}): ReturnHomePlan | undefined {
  if (!input.home) return undefined;
  return evaluateReturnHome({
    position: input.position,
    home: input.home,
    timeOfDay: input.timeOfDay,
    routeImpassable: input.routeImpassable,
  });
}

export function evaluateFishingRequest(input: {
  request: FishingRequest;
  inventory: Array<{ name: string; count: number }>;
  getBlock: WorldGetter;
  botPosition: Vec3;
  hostilesNearby?: boolean;
  inventoryFull?: boolean;
  signalAborted?: boolean;
}): FishingDecision {
  if (input.signalAborted) return { ok: false, code: "CANCELLED", error: "Fishing task cancelled" };
  if (input.hostilesNearby) return { ok: false, code: "HOSTILE_NEARBY", error: "Hostiles are too close to fish" };
  if (input.inventoryFull) return { ok: false, code: "INVENTORY_FULL", error: "Inventory is full; store items before fishing" };
  const storage = assertPermittedStorage(input.request.destinationStorage, input.request.permittedStorage);
  if (!storage.ok) return storage;
  if (!input.inventory.some((item) => item.name === "fishing_rod" && item.count > 0)) {
    return { ok: false, code: "MISSING_TOOL", error: "Need a fishing rod to fish from shore" };
  }
  if (isStandingInLiquid(input.botPosition, input.getBlock)) {
    return { ok: false, code: "HAZARD_BLOCKED", error: "Refusing to fish while standing in water or lava" };
  }
  const bounds = clampFishingBounds(input.request);
  const shores = findShoreCasts(input.request.searchOrigin, bounds.radius, input.getBlock);
  if (shores.length === 0) {
    return { ok: false, code: "SEARCH_EXHAUSTED", error: "No walkable shore next to water in the permitted radius" };
  }
  return { ok: true, shore: shores[0]!, rod: "fishing_rod" };
}

function worldGetterFromCtx(ctx: SkillContext): WorldGetter {
  return (pos) => {
    const block = ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
    if (!block) return undefined;
    return { name: block.name, boundingBox: block.boundingBox };
  };
}

function findBobber(bot: Bot): { position?: { x: number; y: number; z: number }; velocity?: { y: number } } | undefined {
  return Object.values(bot.entities).find((entity) => {
    const name = `${entity.name ?? ""} ${entity.displayName ?? ""}`.toLowerCase();
    return name.includes("fishing_bobber") || name.includes("fishing hook") || name.trim() === "bobber";
  });
}

async function waitForBite(
  ctx: SkillContext,
  timeoutMs: number,
  home?: Vec3,
): Promise<"bite" | "timeout" | "cancelled" | "return-home"> {
  const started = Date.now();
  let splash = false;
  const onSound = (...args: unknown[]) => {
    const text = args.map((value) => String(value)).join(" ").toLowerCase();
    if (text.includes("fishing") || text.includes("bobber") || text.includes("splash")) splash = true;
  };
  ctx.bot.on("soundEffectHeard", onSound);
  ctx.bot.on("hardcodedSoundEffectHeard", onSound);
  try {
    while (Date.now() - started < timeoutMs) {
      if (ctx.signal?.aborted) return "cancelled";
      const here = ctx.body.position() ?? ctx.bot.entity?.position;
      if (here && home) {
        const homePlan = fishingHomeStop({
          position: { x: here.x, y: here.y, z: here.z },
          home,
          timeOfDay: ctx.bot.time?.timeOfDay ?? 0,
        });
        if (homePlan?.shouldStopOptionalWork) return "return-home";
      }
      if (splash) return "bite";
      const bobber = findBobber(ctx.bot);
      if (bobber?.velocity && bobber.velocity.y < -0.15) return "bite";
      await wait(200);
    }
    return "timeout";
  } finally {
    ctx.bot.removeListener("soundEffectHeard", onSound);
    ctx.bot.removeListener("hardcodedSoundEffectHeard", onSound);
  }
}

function activateRod(bot: Bot): boolean {
  const body = bot as ActivatableBot;
  if (typeof body.activateItem !== "function") return false;
  body.activateItem();
  return true;
}

export async function fishAtShore(
  ctx: SkillContext,
  request: FishingRequest,
): Promise<
  ActionResult<{
    shore: Vec3;
    water: Vec3;
    casts: number;
    caught: Record<string, number>;
    deposited: number;
  }>
> {
  const started = Date.now();
  const bounds = clampFishingBounds(request);
  const pos = ctx.body.position() ?? ctx.bot.entity?.position;
  if (!pos) return fail("NOT_CONNECTED", "Not spawned", 0);
  const getBlock = worldGetterFromCtx(ctx);
  const inventory = ctx.bot.inventory.items().map((item) => ({ name: item.name, count: item.count }));
  const full = !canFitDrop(ctx, ["cod"]) && inventorySpace(ctx) <= 0;
  const decision = evaluateFishingRequest({
    request,
    inventory,
    getBlock,
    botPosition: { x: pos.x, y: pos.y, z: pos.z },
    hostilesNearby: ctx.body.nearbyEntities(8).some((entity) => entity.hostile),
    inventoryFull: full,
    signalAborted: Boolean(ctx.signal?.aborted),
  });
  if (!decision.ok) {
    return fail(decision.code, decision.error, Date.now() - started, decision.code !== "INVALID_ARGUMENT");
  }

  const here = ctx.bot.entity?.position;
  const dist = here
    ? Math.hypot(here.x - decision.shore.stand.x, here.y - decision.shore.stand.y, here.z - decision.shore.stand.z)
    : 99;
  if (dist > 2.5) {
    const moved = await navigationBackend().navigateNear(ctx.bot, decision.shore.stand, 1.5, {
      timeoutMs: Math.min(bounds.timeoutMs, ctx.timeoutMs ?? 18_000),
      signal: ctx.signal,
    });
    if (!moved.success) return moved;
  }

  const afterMove = ctx.body.position() ?? ctx.bot.entity?.position;
  if (!afterMove) return fail("NOT_CONNECTED", "Lost body on the way to shore", Date.now() - started);
  if (isStandingInLiquid(afterMove, getBlock)) {
    return fail("HAZARD_BLOCKED", "Navigation left the citizen in water; refusing to fish", Date.now() - started, true);
  }
  if (request.returnHome) {
    const homePlan = evaluateReturnHome({
      position: { x: afterMove.x, y: afterMove.y, z: afterMove.z },
      home: request.returnHome,
      timeOfDay: ctx.bot.time?.timeOfDay ?? 0,
    });
    if (homePlan.shouldStopOptionalWork) {
      return fail(
        "TIMEOUT",
        `stopped optional fishing to return home; estimate ${homePlan.estimateMs}ms remaining ${homePlan.remainingMs}ms; ${homePlan.reason}`,
        Date.now() - started,
        true,
        { estimateMs: homePlan.estimateMs, remainingMs: homePlan.remainingMs, delayMs: homePlan.delayMs },
      );
    }
  }

  const equipped = await equipItem(ctx, "fishing_rod");
  if (!equipped.success) return equipped;

  const before: Record<string, number> = {};
  for (const name of FISHING_CATCH_ITEMS) before[name] = countItem(ctx, name);

  let casts = 0;
  for (let i = 0; i < bounds.casts; i += 1) {
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "Fishing task cancelled", Date.now() - started, false, { casts });
    }
    if (Date.now() - started > bounds.timeoutMs) break;
    if (ctx.body.nearbyEntities(8).some((entity) => entity.hostile)) {
      if (casts > 0) break;
      return fail("HOSTILE_NEARBY", "Hostiles are too close to fish", Date.now() - started, true);
    }
    if (request.returnHome) {
      const now = ctx.body.position() ?? ctx.bot.entity?.position ?? afterMove;
      const homePlan = evaluateReturnHome({
        position: { x: now.x, y: now.y, z: now.z },
        home: request.returnHome,
        timeOfDay: ctx.bot.time?.timeOfDay ?? 0,
      });
      if (homePlan.shouldStopOptionalWork) {
        if (casts > 0) break;
        return fail(
          "TIMEOUT",
          `stopped optional fishing to return home; estimate ${homePlan.estimateMs}ms remaining ${homePlan.remainingMs}ms`,
          Date.now() - started,
          true,
        );
      }
    }
    await lookAtPosition(ctx, decision.shore.water);
    if (!activateRod(ctx.bot)) {
      return fail("INTERACTION_FAILED", "Mineflayer activateItem is unavailable", Date.now() - started, true);
    }
    casts += 1;
    await wait(400);
    if (!findBobber(ctx.bot)) {
      return fail("INTERACTION_FAILED", "Fishing rod did not cast a bobber", Date.now() - started, true);
    }
    const biteBudget = Math.min(FISHING_CAST_TIMEOUT_MS, bounds.timeoutMs - (Date.now() - started));
    const bite = await waitForBite(ctx, Math.max(1_000, biteBudget), request.returnHome);
    if (bite === "cancelled") {
      activateRod(ctx.bot);
      return fail("CANCELLED", "Fishing task cancelled", Date.now() - started, false, { casts });
    }
    if (bite === "return-home") {
      activateRod(ctx.bot);
      if (casts > 0) break;
      const now = ctx.body.position() ?? ctx.bot.entity?.position ?? afterMove;
      const homePlan = fishingHomeStop({
        position: { x: now.x, y: now.y, z: now.z },
        home: request.returnHome,
        timeOfDay: ctx.bot.time?.timeOfDay ?? 0,
      });
      return fail(
        "TIMEOUT",
        `stopped optional fishing to return home during cast; estimate ${homePlan?.estimateMs ?? 0}ms remaining ${homePlan?.remainingMs ?? 0}ms`,
        Date.now() - started,
        true,
        { casts, estimateMs: homePlan?.estimateMs, remainingMs: homePlan?.remainingMs },
      );
    }
    activateRod(ctx.bot);
    await wait(500);
    await pickupDroppedItem(ctx, undefined, 8);
    const gainedNow = FISHING_CATCH_ITEMS.reduce((sum, name) => sum + Math.max(0, countItem(ctx, name) - (before[name] ?? 0)), 0);
    if (gainedNow > 0) break;
  }

  const caught: Record<string, number> = {};
  for (const name of FISHING_CATCH_ITEMS) {
    const delta = countItem(ctx, name) - (before[name] ?? 0);
    if (delta > 0) caught[name] = delta;
  }
  const gained = Object.values(caught).reduce((sum, n) => sum + n, 0);

  let deposited = 0;
  const storage = assertPermittedStorage(request.destinationStorage, request.permittedStorage);
  if (storage.ok && storage.position && gained > 0) {
    for (const name of Object.keys(caught)) {
      if (countItem(ctx, name) <= 0) continue;
      const stored = await depositItems(ctx, name, storage.position);
      if (stored.success) deposited += stored.data.deposited;
    }
  }

  if (gained <= 0) {
    return fail("SEARCH_EXHAUSTED", "No fishing catch collected within the time budget", Date.now() - started, true, {
      casts,
      shore: decision.shore.stand,
      water: decision.shore.water,
    });
  }

  return ok(
    {
      shore: decision.shore.stand,
      water: decision.shore.water,
      casts,
      caught,
      deposited,
    },
    Date.now() - started,
  );
}
