import { fail, ok, type ActionResult, type ErrorCode, type Vec3 } from "@civ/shared";
import { isWithinBlockReach, navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { lookAtPosition } from "./look.js";
import { pickupDroppedItem, countItem, equipItem } from "./inventory-service.js";
import { depositItems, withdrawItems } from "./inventory.js";

export type CropKind = "wheat" | "carrots" | "potatoes" | "beetroots";

export const CROP_BLOCKS: Record<CropKind, { crop: string; seed: string; matureAge: number }> = {
  wheat: { crop: "wheat", seed: "wheat_seeds", matureAge: 7 },
  carrots: { crop: "carrots", seed: "carrot", matureAge: 7 },
  potatoes: { crop: "potatoes", seed: "potato", matureAge: 7 },
  beetroots: { crop: "beetroots", seed: "beetroot_seeds", matureAge: 3 },
};

export const TILLABLE_SOIL = new Set(["dirt", "grass_block", "dirt_path", "farmland"]);

const REPLACEABLE_ABOVE = new Set([
  "air",
  "cave_air",
  "void_air",
  "short_grass",
  "grass",
  "tall_grass",
  "fern",
  "snow",
]);

export function cropKindFromBlock(name: string): CropKind | undefined {
  for (const [kind, spec] of Object.entries(CROP_BLOCKS) as Array<[CropKind, (typeof CROP_BLOCKS)[CropKind]]>) {
    if (spec.crop === name) return kind;
  }
  return undefined;
}

export function cropAge(
  block: {
    name: string;
    metadata?: number;
    getProperties?: () => { age?: number | string };
    _properties?: { age?: number | string };
  } | null,
): number | undefined {
  if (!block) return undefined;
  const raw = block.getProperties?.()?.age ?? block._properties?.age ?? block.metadata;
  const age = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(age) ? age : undefined;
}

export function isMatureCrop(
  block: {
    name: string;
    metadata?: number;
    getProperties?: () => { age?: number | string };
    _properties?: { age?: number | string };
  } | null,
  kind: CropKind,
): boolean {
  if (!block || block.name !== CROP_BLOCKS[kind].crop) return false;
  const age = cropAge(block);
  return age === undefined ? false : age >= CROP_BLOCKS[kind].matureAge;
}

export function plotCells(origin: Vec3, size: number): Vec3[] {
  const cells: Vec3[] = [];
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);
  for (let dx = 0; dx < size; dx += 1) {
    for (let dz = 0; dz < size; dz += 1) {
      cells.push({ x: ox + dx, y: oy, z: oz + dz });
    }
  }
  return cells;
}

/** Vanilla hydration: water within 4 blocks Chebyshev, same Y or one above farmland. */
export function soilHydratedByWater(soil: Vec3, water: Vec3): boolean {
  const dy = Math.floor(water.y) - Math.floor(soil.y);
  if (dy !== 0 && dy !== 1) return false;
  const dx = Math.abs(Math.floor(water.x) - Math.floor(soil.x));
  const dz = Math.abs(Math.floor(water.z) - Math.floor(soil.z));
  return Math.max(dx, dz) <= 4;
}

export function plotHydrated(cells: Vec3[], waters: Vec3[]): boolean {
  if (cells.length === 0 || waters.length === 0) return false;
  return cells.every((cell) => waters.some((water) => soilHydratedByWater(cell, water)));
}

export function selectHydratedPlot(
  soils: Vec3[],
  waters: Vec3[],
  size = 3,
): { origin: Vec3; cells: Vec3[]; water: Vec3 } | undefined {
  if (size < 1 || soils.length === 0 || waters.length === 0) return undefined;
  const soilKeys = new Set(soils.map((s) => `${Math.floor(s.x)},${Math.floor(s.y)},${Math.floor(s.z)}`));
  for (const soil of soils) {
    const origin = { x: Math.floor(soil.x), y: Math.floor(soil.y), z: Math.floor(soil.z) };
    const cells = plotCells(origin, size);
    if (!cells.every((cell) => soilKeys.has(`${cell.x},${cell.y},${cell.z}`))) continue;
    if (!plotHydrated(cells, waters)) continue;
    const water = waters.find((w) => cells.some((cell) => soilHydratedByWater(cell, w)));
    if (!water) continue;
    return { origin, cells, water };
  }
  return undefined;
}

function vecAt(pos: Vec3): Vec3Class {
  return new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cropYieldItem(kind: CropKind): string {
  if (kind === "wheat") return "wheat";
  if (kind === "beetroots") return "beetroot";
  return CROP_BLOCKS[kind].seed;
}

async function approachFarmBlock(
  ctx: SkillContext,
  position: Vec3,
  timeoutMs?: number,
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  if (isWithinBlockReach(ctx.bot, position)) {
    const pos = ctx.bot.entity!.position;
    return ok({ position: { x: pos.x, y: pos.y, z: pos.z }, distance: 0 }, 0);
  }
  const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, position, {
    timeoutMs: timeoutMs ?? ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (move.success) return move;
  if (isWithinBlockReach(ctx.bot, position)) {
    const pos = ctx.bot.entity!.position;
    return ok({ position: { x: pos.x, y: pos.y, z: pos.z }, distance: 0 }, Date.now() - started);
  }
  return move;
}

function containerName(bot: SkillContext["bot"], pos: Vec3): string | undefined {
  return bot.blockAt(vecAt(pos))?.name;
}

function isDesignatedChest(bot: SkillContext["bot"], pos: Vec3): boolean {
  const name = containerName(bot, pos);
  return name === "chest" || name === "trapped_chest" || name === "barrel";
}

async function collectFarmDrops(ctx: SkillContext, kind: CropKind): Promise<void> {
  await wait(700);
  await pickupDroppedItem(ctx, cropYieldItem(kind), 8);
  await pickupDroppedItem(ctx, CROP_BLOCKS[kind].seed, 8);
}

export function inspectCrop(
  bot: SkillContext["bot"],
  position: Vec3,
  kind: CropKind = "wheat",
): {
  cropName: string | undefined;
  age: number | undefined;
  mature: boolean;
  farmland: boolean;
  soilName: string | undefined;
} {
  const crop = bot.blockAt(vecAt(position));
  const soil = bot.blockAt(vecAt({ x: position.x, y: position.y - 1, z: position.z }));
  const age = cropAge(crop);
  return {
    cropName: crop?.name,
    age,
    mature: isMatureCrop(crop, kind),
    farmland: soil?.name === "farmland",
    soilName: soil?.name,
  };
}

export type FarmCellReport = {
  soil: Vec3;
  crop: ReturnType<typeof inspectCrop>;
  blocked: boolean;
};

export type FarmInspection = {
  origin: Vec3;
  size: number;
  kind: CropKind;
  cells: FarmCellReport[];
  water?: Vec3;
  hydrated: boolean;
  mature: number;
  immature: number;
  empty: number;
  untilled: number;
  blocked: number;
};

export type FarmWorkRequest = {
  origin: Vec3;
  size?: number;
  kind?: CropKind;
  water?: Vec3;
  seedStorage?: Vec3;
  cropStorage?: Vec3;
  maxHarvest?: number;
  replant?: boolean;
};

function findHydratingWater(bot: SkillContext["bot"], soils: Vec3[], preferred?: Vec3): Vec3 | undefined {
  if (preferred) {
    const block = bot.blockAt(vecAt(preferred));
    if (block?.name === "water") {
      const water = { x: Math.floor(preferred.x), y: Math.floor(preferred.y), z: Math.floor(preferred.z) };
      if (plotHydrated(soils, [water])) return water;
    }
  }
  if (typeof bot.findBlocks !== "function") return undefined;
  const found = bot.findBlocks({
    matching: (block) => Boolean(block && block.name === "water"),
    maxDistance: 8,
    count: 16,
  });
  const waters = found.map((pos) => ({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }));
  return waters.find((entry) => plotHydrated(soils, [entry]));
}

export function inspectFarm(
  bot: SkillContext["bot"],
  origin: Vec3,
  size = 3,
  kind: CropKind = "wheat",
  water?: Vec3,
): FarmInspection {
  const cells = plotCells(origin, size);
  const reports: FarmCellReport[] = cells.map((soil) => {
    const crop = inspectCrop(bot, { x: soil.x, y: soil.y + 1, z: soil.z }, kind);
    const blocked = Boolean(
      crop.cropName &&
        crop.cropName !== CROP_BLOCKS[kind].crop &&
        !REPLACEABLE_ABOVE.has(crop.cropName) &&
        !cropKindFromBlock(crop.cropName),
    );
    return { soil, crop, blocked };
  });
  const foundWater = findHydratingWater(bot, cells, water);
  const empty = reports.filter(
    (cell) => cell.crop.farmland && (!cell.crop.cropName || REPLACEABLE_ABOVE.has(cell.crop.cropName)),
  ).length;
  const immature = reports.filter((cell) => cell.crop.cropName === CROP_BLOCKS[kind].crop && !cell.crop.mature).length;
  return {
    origin: { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) },
    size,
    kind,
    cells: reports,
    water: foundWater,
    hydrated: Boolean(foundWater && plotHydrated(cells, [foundWater])),
    mature: reports.filter((cell) => cell.crop.mature).length,
    immature,
    empty,
    untilled: reports.filter(
      (cell) => cell.crop.soilName === "dirt" || cell.crop.soilName === "grass_block" || cell.crop.soilName === "dirt_path",
    ).length,
    blocked: reports.filter((cell) => cell.blocked).length,
  };
}

export function evaluateFarmPreconditions(
  inspection: FarmInspection,
  bag: { hoe: boolean; seeds: number; seedStorage?: Vec3; cropStorage?: Vec3; storagePresent?: boolean },
): { ok: true } | { ok: false; code: ErrorCode; error: string } {
  if (!inspection.hydrated || !inspection.water) {
    return { ok: false, code: "SITE_UNSUITABLE", error: "Farm is not hydrated; water is missing or cannot hydrate this plot" };
  }
  if (inspection.blocked > 0) {
    return { ok: false, code: "SITE_UNSUITABLE", error: `${inspection.blocked} plot cells are blocked above the soil` };
  }
  if (inspection.untilled > 0 && !bag.hoe) {
    return { ok: false, code: "MISSING_TOOL", error: "Need a hoe to till this farm" };
  }
  const needSeeds = inspection.empty + inspection.untilled;
  if (needSeeds > 0 && bag.seeds < 1 && !bag.seedStorage) {
    return { ok: false, code: "ITEM_NOT_FOUND", error: "No seeds and no designated seed storage" };
  }
  if (bag.seedStorage && bag.storagePresent === false) {
    return { ok: false, code: "CONTAINER_NOT_FOUND", error: "Designated seed storage is missing" };
  }
  if (bag.cropStorage && bag.storagePresent === false) {
    return { ok: false, code: "CONTAINER_NOT_FOUND", error: "Designated crop storage is missing" };
  }
  return { ok: true };
}

export async function workFarmPlot(
  ctx: SkillContext,
  request: FarmWorkRequest,
): Promise<
  ActionResult<{
    origin: Vec3;
    inspected: FarmInspection;
    tilled: Vec3[];
    planted: Vec3[];
    harvested: Vec3[];
    replanted: Vec3[];
    failed: Array<{ position: Vec3; code: ErrorCode; error: string }>;
    wheatDelta: number;
    seedsDelta: number;
    deposited: number;
    withdrawn: number;
  }>
> {
  const started = Date.now();
  const size = request.size ?? 3;
  const kind = request.kind ?? "wheat";
  const spec = CROP_BLOCKS[kind];
  const replant = request.replant ?? true;
  const wheatBefore = countItem(ctx, cropYieldItem(kind));
  const seedsBefore = countItem(ctx, spec.seed);

  let inspection = inspectFarm(ctx.bot, request.origin, size, kind, request.water);
  const seedChestOk = request.seedStorage ? isDesignatedChest(ctx.bot, request.seedStorage) : true;
  const cropChestOk = request.cropStorage ? isDesignatedChest(ctx.bot, request.cropStorage) : true;
  const gate = evaluateFarmPreconditions(inspection, {
    hoe: Boolean(ctx.bot.inventory.items().find((item) => item.name.endsWith("_hoe"))),
    seeds: countItem(ctx, spec.seed),
    seedStorage: request.seedStorage,
    cropStorage: request.cropStorage,
    storagePresent: seedChestOk && cropChestOk,
  });
  if (!gate.ok) return fail(gate.code, gate.error, Date.now() - started, true);

  let withdrawn = 0;
  const needSeeds = Math.max(0, inspection.empty + inspection.untilled - countItem(ctx, spec.seed));
  if (needSeeds > 0 && request.seedStorage) {
    const restock = await withdrawItems(ctx, spec.seed, needSeeds, request.seedStorage);
    if (!restock.success && countItem(ctx, spec.seed) < 1) return restock;
    if (restock.success) withdrawn = restock.data.count;
  }

  const tilled: Vec3[] = [];
  const planted: Vec3[] = [];
  const harvested: Vec3[] = [];
  const replanted: Vec3[] = [];
  const failed: Array<{ position: Vec3; code: ErrorCode; error: string }> = [];
  for (const cell of inspection.cells) {
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "Farm work interrupted", Date.now() - started, false);
    }
    if (cell.crop.farmland && cell.crop.cropName === spec.crop) continue;
    const made = await tillAndPlant(ctx, cell.soil, kind);
    if (!made.success) continue;
    tilled.push(cell.soil);
    planted.push({ x: cell.soil.x, y: cell.soil.y + 1, z: cell.soil.z });
  }

  inspection = inspectFarm(ctx.bot, request.origin, size, kind, request.water);
  let remaining = request.maxHarvest ?? inspection.mature;
  for (const cell of inspection.cells) {
    if (remaining <= 0) break;
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "Farm work interrupted", Date.now() - started, false);
    }
    if (!cell.crop.mature) continue;
    const cropPos = { x: cell.soil.x, y: cell.soil.y + 1, z: cell.soil.z };
    let result = await harvestCropAt(ctx, cropPos, kind, { replant });
    if (!result.success && (result.code === "PATH_FAILED" || result.code === "TIMEOUT" || result.code === "PATH_BLOCKED")) {
      await wait(400);
      result = await harvestCropAt(ctx, cropPos, kind, { replant });
    }
    if (!result.success) {
      failed.push({ position: cropPos, code: result.code, error: result.error });
      continue;
    }
    harvested.push(cropPos);
    remaining -= 1;
    if (result.data.replanted) replanted.push(cropPos);
  }
  await collectFarmDrops(ctx, kind);

  let deposited = 0;
  if (request.cropStorage && countItem(ctx, cropYieldItem(kind)) > 0) {
    const stored = await depositItems(ctx, cropYieldItem(kind), request.cropStorage);
    if (!stored.success && harvested.length === 0 && planted.length === 0 && tilled.length === 0) return stored;
    if (stored.success) deposited = stored.data.deposited;
  }

  inspection = inspectFarm(ctx.bot, request.origin, size, kind, request.water);
  return ok(
    {
      origin: inspection.origin,
      inspected: inspection,
      tilled,
      planted,
      harvested,
      replanted,
      failed,
      wheatDelta: countItem(ctx, cropYieldItem(kind)) - wheatBefore,
      seedsDelta: countItem(ctx, spec.seed) - seedsBefore,
      deposited,
      withdrawn,
    },
    Date.now() - started,
  );
}

export async function findTillablePlot(
  ctx: SkillContext,
  opts?: { size?: number; maxDistance?: number },
): Promise<ActionResult<{ origin: Vec3; cells: Vec3[]; water: Vec3 }>> {
  const started = Date.now();
  const size = opts?.size ?? 3;
  const maxDistance = opts?.maxDistance ?? 16;
  const bot = ctx.bot;
  const waters = bot.findBlocks({
    matching: (block) => Boolean(block && block.name === "water"),
    maxDistance,
    count: 32,
  });
  if (waters.length === 0) {
    return fail("SITE_UNSUITABLE", "No water nearby for a hydrated farm plot", Date.now() - started, true);
  }
  const soils = bot.findBlocks({
    matching: (block) => Boolean(block && TILLABLE_SOIL.has(block.name)),
    maxDistance,
    count: 80,
  });
  const openSoils = soils.filter((pos) => {
    const above = bot.blockAt(new Vec3Class(pos.x, pos.y + 1, pos.z));
    return !above || REPLACEABLE_ABOVE.has(above.name) || Boolean(cropKindFromBlock(above.name));
  });
  const selected = selectHydratedPlot(openSoils, waters, size);
  if (!selected) {
    return fail("SITE_UNSUITABLE", `No ${size}x${size} dirt/grass plot near water`, Date.now() - started, true);
  }
  return ok(selected, Date.now() - started);
}

export async function tillSoil(
  ctx: SkillContext,
  position: Vec3,
): Promise<ActionResult<{ position: Vec3; alreadyFarmland: boolean }>> {
  const started = Date.now();
  const dirt = ctx.bot.blockAt(vecAt(position));
  if (!dirt) return fail("BLOCK_NOT_FOUND", "No soil", Date.now() - started, true);
  if (dirt.name === "farmland") {
    return ok({ position, alreadyFarmland: true }, Date.now() - started);
  }
  if (dirt.name !== "dirt" && dirt.name !== "grass_block" && dirt.name !== "dirt_path") {
    return fail("PLACE_FAILED", `Cannot till ${dirt.name}`, Date.now() - started, true);
  }
  const above = ctx.bot.blockAt(vecAt({ x: position.x, y: position.y + 1, z: position.z }));
  if (above && !REPLACEABLE_ABOVE.has(above.name) && !cropKindFromBlock(above.name)) {
    return fail(
      "PLACE_FAILED",
      `Cannot till; ${above.name} is above the soil (farmland would revert to dirt)`,
      Date.now() - started,
      true,
    );
  }
  const hoe = ctx.bot.inventory.items().find((item) => item.name.endsWith("_hoe"));
  if (!hoe) return fail("MISSING_TOOL", "Need a hoe to till farmland", Date.now() - started, true);
  const equipped = await equipItem(ctx, hoe.name);
  if (!equipped.success) return equipped;
  if (above && REPLACEABLE_ABOVE.has(above.name) && above.name !== "air" && above.name !== "cave_air") {
    try {
      await ctx.bot.dig(above, true);
    } catch (error) {
      return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
    }
  }
  const move = await approachFarmBlock(ctx, position, ctx.timeoutMs ?? 10_000);
  if (!move.success) return move;
  await lookAtPosition(ctx, position);
  try {
    await ctx.bot.activateBlock(dirt);
  } catch (error) {
    return fail("PLACE_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const soil = ctx.bot.blockAt(vecAt(position));
  if (soil?.name !== "farmland") {
    return fail("PLACE_FAILED", `Hoe did not till farmland, still ${soil?.name ?? "none"}`, Date.now() - started, true);
  }
  return ok({ position, alreadyFarmland: false }, Date.now() - started);
}

export async function harvestCropAt(
  ctx: SkillContext,
  position: Vec3,
  kind: CropKind = "wheat",
  opts?: { replant?: boolean },
): Promise<ActionResult<{ crop: string; collected: number; replanted: boolean; position: Vec3 }>> {
  const started = Date.now();
  const spec = CROP_BLOCKS[kind];
  const replant = opts?.replant ?? true;
  const block = ctx.bot.blockAt(vecAt(position));
  if (!block || block.name !== spec.crop) {
    return fail("BLOCK_NOT_FOUND", `No ${spec.crop} at ${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`, Date.now() - started, true);
  }
  if (!isMatureCrop(block, kind)) {
    return fail("CROP_IMMATURE", `${spec.crop} at age ${cropAge(block) ?? "?"} is not mature`, Date.now() - started, true, {
      item: spec.crop,
    });
  }
  const move = await approachFarmBlock(ctx, block.position, ctx.timeoutMs ?? 12_000);
  if (!move.success) return move;
  await lookAtPosition(ctx, { x: block.position.x, y: block.position.y, z: block.position.z });
  const beforeSeed = countItem(ctx, spec.seed);
  const beforeCrop = countItem(ctx, cropYieldItem(kind));
  try {
    await ctx.bot.dig(block, true);
  } catch (error) {
    return fail("DIG_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const afterBlock = ctx.bot.blockAt(block.position);
  if (afterBlock && afterBlock.name === spec.crop) {
    return fail("VERIFY_FAILED", `${spec.crop} still present after harvest`, Date.now() - started, true);
  }
  await wait(400);
  const collected =
    kind === "wheat"
      ? countItem(ctx, "wheat") - beforeCrop + (countItem(ctx, spec.seed) - beforeSeed)
      : countItem(ctx, spec.seed) - beforeSeed;
  let replanted = false;
  if (replant && countItem(ctx, spec.seed) >= 1) {
    const planted = await plantCrop(ctx, kind, { x: block.position.x, y: block.position.y, z: block.position.z });
    replanted = planted.success;
  }
  return ok(
    {
      crop: spec.crop,
      collected: Math.max(0, collected),
      replanted,
      position: { x: block.position.x, y: block.position.y, z: block.position.z },
    },
    Date.now() - started,
  );
}

export async function harvestCrop(
  ctx: SkillContext,
  kind: CropKind = "wheat",
): Promise<ActionResult<{ crop: string; collected: number; replanted: boolean; position: Vec3 }>> {
  const started = Date.now();
  const spec = CROP_BLOCKS[kind];
  const block = ctx.bot.findBlock({
    matching: (candidate) => isMatureCrop(candidate, kind),
    maxDistance: 16,
  });
  if (!block) {
    const immature = ctx.bot.findBlock({
      matching: (candidate) => candidate.name === spec.crop,
      maxDistance: 16,
    });
    if (immature) {
      return fail("CROP_IMMATURE", `${spec.crop} at age ${cropAge(immature) ?? "?"} is not mature`, Date.now() - started, true, {
        item: spec.crop,
      });
    }
    return fail("BLOCK_NOT_FOUND", `No ${spec.crop} nearby`, Date.now() - started, true);
  }
  return harvestCropAt(ctx, { x: block.position.x, y: block.position.y, z: block.position.z }, kind);
}

export async function plantCrop(
  ctx: SkillContext,
  kind: CropKind,
  position: Vec3,
): Promise<ActionResult<{ crop: string; position: Vec3 }>> {
  const started = Date.now();
  const spec = CROP_BLOCKS[kind];
  const soil = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y) - 1, Math.floor(position.z)));
  if (soil?.name !== "farmland") {
    return fail("PLACE_FAILED", `Need farmland under plant cell, found ${soil?.name ?? "none"}`, Date.now() - started, true);
  }
  const cell = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
  if (cell && cell.name !== "air" && cell.name !== "cave_air") {
    return fail("PLACE_FAILED", `Plant cell occupied by ${cell.name}`, Date.now() - started, true);
  }
  if (countItem(ctx, spec.seed) < 1) {
    return fail("ITEM_NOT_FOUND", `No ${spec.seed} to plant`, Date.now() - started, true);
  }
  const equipped = await equipItem(ctx, spec.seed);
  if (!equipped.success) return equipped;
  const move = await approachFarmBlock(ctx, position, ctx.timeoutMs ?? 10_000);
  if (!move.success) return move;
  await lookAtPosition(ctx, position);
  try {
    await ctx.bot.activateBlock(soil);
  } catch (error) {
    return fail("PLACE_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const planted = ctx.bot.blockAt(new Vec3Class(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)));
  if (!planted || planted.name !== spec.crop) {
    return fail("VERIFY_FAILED", `Expected ${spec.crop} after plant, got ${planted?.name ?? "none"}`, Date.now() - started, true);
  }
  return ok({ crop: spec.crop, position }, Date.now() - started);
}

export async function tillAndPlant(
  ctx: SkillContext,
  position: Vec3,
  kind: CropKind = "wheat",
): Promise<ActionResult<{ position: Vec3 }>> {
  const started = Date.now();
  const tilled = await tillSoil(ctx, position);
  if (!tilled.success) return tilled;
  const planted = await plantCrop(ctx, kind, { x: position.x, y: position.y + 1, z: position.z });
  if (!planted.success) return planted;
  return ok({ position: planted.data.position }, Date.now() - started);
}

export async function tillAndPlantPlot(
  ctx: SkillContext,
  origin: Vec3,
  size = 3,
  kind: CropKind = "wheat",
): Promise<
  ActionResult<{
    origin: Vec3;
    size: number;
    tilled: Vec3[];
    planted: Vec3[];
    failed: Array<{ position: Vec3; code: ErrorCode; error: string }>;
  }>
> {
  const started = Date.now();
  const cells = plotCells(origin, size);
  const tilled: Vec3[] = [];
  const planted: Vec3[] = [];
  const failed: Array<{ position: Vec3; code: ErrorCode; error: string }> = [];
  for (const cell of cells) {
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "Farm plot interrupted", Date.now() - started, false, { item: kind });
    }
    const soil = await tillSoil(ctx, cell);
    if (!soil.success) {
      failed.push({ position: cell, code: soil.code, error: soil.error });
      continue;
    }
    tilled.push(cell);
    const cropPos = { x: cell.x, y: cell.y + 1, z: cell.z };
    const plantedOne = await plantCrop(ctx, kind, cropPos);
    if (!plantedOne.success) {
      failed.push({ position: cropPos, code: plantedOne.code, error: plantedOne.error });
      continue;
    }
    planted.push(cropPos);
  }
  if (planted.length === 0 && tilled.length === 0) {
    const first = failed[0];
    return fail(first?.code ?? "PLACE_FAILED", first?.error ?? "Plot till/plant failed", Date.now() - started, true);
  }
  return ok({ origin, size, tilled, planted, failed }, Date.now() - started);
}

export async function harvestPlot(
  ctx: SkillContext,
  origin: Vec3,
  size = 3,
  kind: CropKind = "wheat",
  opts?: { replant?: boolean },
): Promise<
  ActionResult<{
    harvested: Vec3[];
    replanted: Vec3[];
    failed: Array<{ position: Vec3; code: ErrorCode; error: string }>;
    collected: number;
  }>
> {
  const started = Date.now();
  const harvested: Vec3[] = [];
  const replanted: Vec3[] = [];
  const failed: Array<{ position: Vec3; code: ErrorCode; error: string }> = [];
  let collected = 0;
  for (const soil of plotCells(origin, size)) {
    const cropPos = { x: soil.x, y: soil.y + 1, z: soil.z };
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "Harvest interrupted", Date.now() - started, false);
    }
    let result = await harvestCropAt(ctx, cropPos, kind, { replant: opts?.replant ?? true });
    if (!result.success && (result.code === "PATH_FAILED" || result.code === "TIMEOUT" || result.code === "PATH_BLOCKED")) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      result = await harvestCropAt(ctx, cropPos, kind, { replant: opts?.replant ?? true });
    }
    if (!result.success) {
      failed.push({ position: cropPos, code: result.code, error: result.error });
      continue;
    }
    harvested.push(cropPos);
    collected += result.data.collected;
    if (result.data.replanted) replanted.push(cropPos);
  }
  await collectFarmDrops(ctx, kind);
  collected = Math.max(collected, countItem(ctx, cropYieldItem(kind)));
  if (harvested.length === 0) {
    const first = failed[0];
    return fail(first?.code ?? "BLOCK_NOT_FOUND", first?.error ?? "No mature crops in plot", Date.now() - started, true);
  }
  return ok({ harvested, replanted, failed, collected }, Date.now() - started);
}
