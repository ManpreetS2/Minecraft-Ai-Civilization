import { fail, createEvent, type ActionResult, type EventBus, type Vec3 } from "@civ/shared";
import {
  alreadyInsideClaimedHome,
  cellCenter,
  enterClaimedHouse,
  executeReturnHome,
} from "@civ/minecraft-adapter";
import { depositItems, sleep, withdrawItems, type SkillContext } from "@civ/skills";
import { Vec3 as Vec3Class } from "vec3";
import { cellClaimKey } from "./claims.js";
import { assertMayUseChest } from "./property-safety.js";
import { resolveHomeSleepTarget, resolveStorageTarget, type StorageAccess } from "./homes.js";
import type { SettlementRuntime } from "./settlement-runtime.js";
import type { CivilizationStore } from "./store.js";
import { forgetWorkstation, verifyWorkstation } from "./workstations.js";
import { waitInsideHomeUntilSleepTime } from "./wait-inside-home.js";

function isBedName(name: string | undefined): boolean {
  return Boolean(name?.endsWith("_bed"));
}

export type SleepAtHomeHooks = {
  delayMs?: (ms: number) => Promise<void>;
  now?: () => number;
};

export async function executeSleepAtHome(
  ctx: SkillContext,
  store: CivilizationStore,
  hooks?: SleepAtHomeHooks,
): Promise<ActionResult> {
  const target = resolveHomeSleepTarget(store, ctx.citizenId);
  if (!target.success) return target;
  const home = ctx.citizenId ? store.getCitizenHome(ctx.citizenId) : undefined;
  if (!home || home.status !== "active") return target;
  const block = ctx.bot.blockAt(new Vec3Class(target.data.bed.x, target.data.bed.y, target.data.bed.z));
  const name = block && "name" in block ? String(block.name) : undefined;
  if (!isBedName(name)) {
    if (ctx.citizenId) store.markHomeDisplaced(ctx.citizenId, "bed_missing");
    return fail("BED_MISSING", "Designated home bed is missing; ownership was not reassigned", 0, true, {
      homeId: target.data.homeId,
      bed: target.data.bed,
    });
  }

  const interior = cellCenter(home.origin);
  const entrance = home.entrance ? cellCenter(home.entrance) : undefined;
  const start = ctx.body.position() ?? ctx.bot.entity?.position;
  let arrivedAtEntrance = false;
  let enteredInterior = Boolean(start && alreadyInsideClaimedHome(start, interior));
  let doorToggled = false;

  if (start && !enteredInterior) {
    const walked = await executeReturnHome(ctx.bot, {
      home: interior,
      bed: home.bed,
      entrance,
      timeoutMs: ctx.timeoutMs ?? 90_000,
      signal: ctx.signal,
    });
    if (!walked.success) {
      return fail(walked.code, walked.error, walked.durationMs, walked.retryable, {
        ...walked.details,
        homeId: home.homeId,
        bed: home.bed,
        workComplete: false,
        teleported: false,
        sleptInOwnBed: false,
        arrived: false,
      });
    }
    arrivedAtEntrance = true;
    const afterWalk = ctx.body.position() ?? ctx.bot.entity?.position;
    enteredInterior = Boolean(afterWalk && alreadyInsideClaimedHome(afterWalk, interior));
  }

  const entered = await enterClaimedHouse(ctx.bot, {
    interior,
    entrance,
    signal: ctx.signal,
    timeoutMs: Math.min(ctx.timeoutMs ?? 20_000, 20_000),
  });
  if (!entered.success) {
    return fail(entered.code, entered.error, entered.durationMs, entered.retryable, {
      ...entered.details,
      homeId: home.homeId,
      bed: home.bed,
      arrivedAtEntrance,
      workComplete: false,
      teleported: false,
      sleptInOwnBed: false,
    });
  }
  arrivedAtEntrance = arrivedAtEntrance || entered.data.arrivedAtEntrance;
  enteredInterior = entered.data.enteredInterior;
  doorToggled = Boolean(entered.data.door.toggled);

  const waited = await waitInsideHomeUntilSleepTime({
    timeOfDay: () => Number(ctx.bot.time?.timeOfDay ?? 0),
    thundering: () => Number((ctx.bot as { thunderState?: number }).thunderState ?? 0) > 0,
    bedPresent: () => {
      const current = ctx.bot.blockAt(new Vec3Class(home.bed.x, home.bed.y, home.bed.z));
      return isBedName(current && "name" in current ? String(current.name) : undefined);
    },
    connected: () => Boolean(ctx.bot.entity && (ctx.body.position() ?? ctx.bot.entity.position)),
    position: () => {
      const here = ctx.body.position() ?? ctx.bot.entity?.position;
      return here ? { x: here.x, y: here.y, z: here.z } : undefined;
    },
    interior,
    signal: ctx.signal,
    now: hooks?.now,
    delayMs: hooks?.delayMs,
  });
  if (!waited.success) {
    if (waited.code === "BED_MISSING" && ctx.citizenId) {
      store.markHomeDisplaced(ctx.citizenId, "bed_missing");
    }
    return fail(waited.code, waited.error, waited.durationMs, waited.retryable, {
      ...waited.details,
      homeId: home.homeId,
      bed: home.bed,
      arrivedAtEntrance,
      enteredInterior,
      doorToggled,
      sleptInOwnBed: false,
      sleepAttempts: 0,
      workComplete: false,
      teleported: false,
    });
  }

  const slept = await sleep(ctx, home.bed);
  const details = {
    homeId: home.homeId,
    bed: home.bed,
    arrivedAtEntrance,
    enteredInterior,
    waitedInsideHome: waited.data.waited,
    waitPolls: waited.data.polls,
    sleptInOwnBed: Boolean(slept.success && slept.data.designated),
    designated: slept.success ? slept.data.designated : true,
    doorToggled,
    sleepAttempts: 1,
    workComplete: Boolean(slept.success),
    teleported: false,
  };
  if (!slept.success) {
    return fail(slept.code, slept.error, slept.durationMs, slept.retryable, details);
  }
  return {
    success: true,
    data: { ...slept.data, ...details },
    durationMs: slept.durationMs,
  };
}

export async function executePersonalStorage(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  runtime: SettlementRuntime,
  action: "deposit" | "withdraw",
  itemName?: string,
  count = 1,
): Promise<ActionResult> {
  return executeStorage(ctx, store, events, runtime, "personal", action, itemName, count);
}

export async function executeHouseholdStorage(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  runtime: SettlementRuntime,
  action: "deposit" | "withdraw",
  itemName?: string,
  count = 1,
): Promise<ActionResult> {
  return executeStorage(ctx, store, events, runtime, "household", action, itemName, count);
}

async function executeStorage(
  ctx: SkillContext,
  store: CivilizationStore,
  events: EventBus,
  runtime: SettlementRuntime,
  purpose: Exclude<StorageAccess, "communal">,
  action: "deposit" | "withdraw",
  itemName?: string,
  count = 1,
): Promise<ActionResult> {
  const resolved = resolveStorageTarget(store, ctx.citizenId, purpose);
  if (!resolved.success) return resolved;
  const access = assertMayUseChest(store, ctx.citizenId, resolved.data.position, purpose);
  if (!access.success) return access;
  const chest = resolved.data.position;
  if (!verifyWorkstation(ctx, chest, "chest")) {
    if (ctx.citizenId) store.markHomeDisplaced(ctx.citizenId, "chest_missing");
    return fail("CONTAINER_NOT_FOUND", "Designated home chest is missing; ownership was not reassigned", 0, true, {
      position: chest,
      access: purpose,
    });
  }
  if (ctx.citizenId && !runtime.claims.tryClaim("container", cellClaimKey(chest.x, chest.y, chest.z), ctx.citizenId, 30_000)) {
    return fail("CONTAINER_BUSY", "Chest is in use", 0, true, { position: chest });
  }
  try {
    if (action === "deposit") {
      const result = await depositItems(ctx, itemName, chest);
      if (result.success) {
        events.emit(
          createEvent("ItemDeposited", { count: result.data.deposited, contents: result.data.contents, position: chest, access: purpose }, ctx.citizenId),
        );
      }
      return result;
    }
    if (!itemName) {
      return fail("INVALID_ARGUMENT", "Withdraw requires an item name", 0, false);
    }
    const result = await withdrawItems(ctx, itemName, count, chest);
    if (result.success) {
      events.emit(createEvent("ItemWithdrawn", { item: itemName, count: result.data.count, position: chest, access: purpose }, ctx.citizenId));
    }
    return result;
  } finally {
    runtime.claims.release("container", cellClaimKey(chest.x, chest.y, chest.z), ctx.citizenId);
  }
}

export function skipCommunalChestIfPersonal(store: CivilizationStore, pos: Vec3 | undefined): boolean {
  return Boolean(pos && store.isClaimedPersonalChest(pos));
}

export function forgetMissingCommunalChest(store: CivilizationStore, pos: Vec3): void {
  forgetWorkstation(store, "chest", pos);
}
