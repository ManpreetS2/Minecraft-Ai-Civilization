import { runNavigationScope } from "./navigation-scope.js";
import { navigationBodyReady, navigationParametersValid } from "./connection-health.js";
import type { Bot } from "mineflayer";
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { walkForward } from "./step-jump.js";
import { navigationBackend } from "./navigation.js";
import { alreadyInsideClaimedHome } from "./enter-home.js";
import { evaluateReturnHome, type ReturnHomePlan } from "./travel-home.js";
import { movedEnough, nearbyOffsets } from "./path-recovery.js";

function obstacleIsProtectedFurniture(error: string | undefined): boolean {
  return /obstacle=(crafting_table|furnace|chest|barrel|door)/i.test(error ?? "");
}

function clockOf(bot: Bot): { timeOfDay: number; worldTick: number } {
  const time = bot.time as { timeOfDay?: number; age?: number } | undefined;
  return {
    timeOfDay: time?.timeOfDay ?? 0,
    worldTick: time?.age ?? time?.timeOfDay ?? 0,
  };
}

function xzDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export type ReturnHomeLiveResult = {
  plan: ReturnHomePlan;
  home: Vec3;
  bed?: Vec3;
  entrance?: Vec3;
  departure: { position: Vec3; timeOfDay: number; worldTick: number };
  arrival: { position: Vec3; timeOfDay: number; worldTick: number };
};

export async function executeReturnHome(
  bot: Bot,
  input: { home: Vec3; bed?: Vec3; entrance?: Vec3; timeoutMs?: number; signal?: AbortSignal },
): Promise<ActionResult<ReturnHomeLiveResult>> {
  if (input.signal?.aborted) return fail("CANCELLED", "return home cancelled", 0, true);
  if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Cannot return home without an active body", 0);
  if (!navigationParametersValid(input.home, 2.2, input.timeoutMs ?? 1) ||
    input.entrance && !navigationParametersValid(input.entrance, 2.2, input.timeoutMs ?? 1)) {
    return fail("INVALID_ARGUMENT", "Invalid home target, entrance or timeout", 0);
  }
  const start = bot.entity?.position;
  if (!start) return fail("NOT_CONNECTED", "Cannot return home without a body", 0);
  const departureClock = clockOf(bot);
  const departure = {
    position: { x: start.x, y: start.y, z: start.z },
    timeOfDay: departureClock.timeOfDay,
    worldTick: departureClock.worldTick,
  };
  const plan = evaluateReturnHome({
    position: departure.position,
    home: input.home,
    timeOfDay: departure.timeOfDay,
  });
  const timeoutMs = input.timeoutMs ?? Math.max(20_000, plan.estimateMs + 15_000);
  const started = Date.now();
  return runNavigationScope<ReturnHomeLiveResult>(bot, { timeoutMs, signal: input.signal }, async signal => {
    const scopedInput = { ...input, signal };
    if (alreadyInsideClaimedHome(departure.position, scopedInput.home)) {
      return ok(
        { plan, home: scopedInput.home, bed: scopedInput.bed, entrance: scopedInput.entrance, departure, arrival: { ...departure } },
        0,
      );
    }
    const legs: Vec3[] = scopedInput.entrance ? [scopedInput.entrance, scopedInput.home] : [scopedInput.home];
    let moved: ActionResult<{ position: Vec3; distance: number }> | undefined;
    for (const dest of legs) {
      if (scopedInput.signal?.aborted) return fail("CANCELLED", "return home cancelled", Date.now() - started, true);
      if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body while returning home", Date.now() - started);
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining < 800) break;
      moved = await navigationBackend().navigateToPosition(bot, dest, {
        recover: true,
        timeoutMs: remaining,
        signal: scopedInput.signal,
      });
      if (
        moved.success === false &&
        moved.retryable &&
        (moved.code === "HAZARD_BLOCKED" || moved.code === "PATH_BLOCKED")
      ) {
        const mid = bot.entity?.position;
        const remaining2 = timeoutMs - (Date.now() - started);
        if (mid && remaining2 > 2_000 && !scopedInput.signal?.aborted && movedEnough(departure.position, mid, 0.8)) {
          moved = await navigationBackend().navigateToPosition(bot, dest, {
            recover: true,
            timeoutMs: remaining2,
            signal: scopedInput.signal,
          });
        }
      }
      // Day 2: sleep/home STUCK on crafting_table ~27 blocks from H9 bed. Do not dig furniture —
      // step laterally around the protected obstacle, then retry the same destination once.
      if (
        moved.success === false &&
        (moved.code === "STUCK" || moved.code === "TIMEOUT" || moved.code === "PATH_BLOCKED") &&
        obstacleIsProtectedFurniture(moved.error)
      ) {
        const mid = bot.entity?.position;
        const remaining2 = timeoutMs - (Date.now() - started);
        if (mid && remaining2 > 4_000 && !scopedInput.signal?.aborted) {
          for (const offset of nearbyOffsets(3).slice(0, 8)) {
            if (scopedInput.signal.aborted) return fail("CANCELLED", "return home cancelled", Date.now() - started, true);
            const bypass = {
              x: Math.floor(mid.x) + offset.x + 0.5,
              y: mid.y,
              z: Math.floor(mid.z) + offset.z + 0.5,
            };
            const step = await navigationBackend().navigateToPosition(bot, bypass, {
              recover: true,
              timeoutMs: Math.min(6_000, remaining2 / 2),
              signal: scopedInput.signal,
            });
            if (scopedInput.signal.aborted) return fail("CANCELLED", "return home cancelled", Date.now() - started, true);
            if (!step.success) continue;
            const retryBudget = timeoutMs - (Date.now() - started);
            if (retryBudget < 2_000) break;
            moved = await navigationBackend().navigateToPosition(bot, dest, {
              recover: true,
              timeoutMs: retryBudget,
              signal: scopedInput.signal,
            });
            if (moved.success || moved.code === "VERIFY_FAILED") break;
          }
        }
      }
      if (!moved.success && moved.code !== "VERIFY_FAILED") {
        const end = bot.entity?.position;
        const arrivalClock = clockOf(bot);
        return fail(moved.code, moved.error, Date.now() - started, moved.retryable, {
          plan,
          home: scopedInput.home,
          bed: scopedInput.bed,
          entrance: scopedInput.entrance,
          departure,
          arrived: false,
          teleported: false,
          workComplete: false,
          position: end ? { x: end.x, y: end.y, z: end.z } : departure.position,
          arrival: end
            ? { position: { x: end.x, y: end.y, z: end.z }, timeOfDay: arrivalClock.timeOfDay, worldTick: arrivalClock.worldTick }
            : departure,
        });
      }
    }
    if (scopedInput.signal?.aborted) return fail("CANCELLED", "return home cancelled", Date.now() - started, true);
    if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body while returning home", Date.now() - started);
    const here = bot.entity?.position;
    if (here && xzDist(here, scopedInput.home) > 1.4 && xzDist(here, scopedInput.home) < 4.5) {
      const entity = bot.entity;
      if (entity) {
        entity.yaw = Math.atan2(-(scopedInput.home.x - here.x), -(scopedInput.home.z - here.z));
        entity.pitch = 0;
      }
      await walkForward(bot, 12, scopedInput.signal);
    }
    if (scopedInput.signal?.aborted) return fail("CANCELLED", "return home cancelled", Date.now() - started, true);
    const end = bot.entity?.position;
    if (!end || !navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body while returning home", Date.now() - started);
    const arrivalClock = clockOf(bot);
    const arrival = {
      position: { x: end.x, y: end.y, z: end.z },
      timeOfDay: arrivalClock.timeOfDay,
      worldTick: arrivalClock.worldTick,
    };
    const arrived = xzDist(end, scopedInput.home) <= 2.2 && Math.abs(end.y - scopedInput.home.y) < 1.6;
    if (!arrived) {
      return fail(
        moved && !moved.success ? moved.code : "VERIFY_FAILED",
        `return-home did not arrive; finished ${end.x.toFixed(1)},${end.y.toFixed(1)},${end.z.toFixed(1)}`,
        Date.now() - started,
        true,
        {
          plan,
          home: scopedInput.home,
          bed: scopedInput.bed,
          entrance: scopedInput.entrance,
          departure,
          arrival,
          arrived: false,
          teleported: false,
          workComplete: false,
        },
      );
    }
    return ok(
      { plan, home: scopedInput.home, bed: scopedInput.bed, entrance: scopedInput.entrance, departure, arrival, arrived: true, teleported: false },
      Date.now() - started,
    );
  });
}
