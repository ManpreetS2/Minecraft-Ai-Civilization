import { runNavigationScope } from "./navigation-scope.js";
import { navigationBodyReady, navigationParametersValid } from "./connection-health.js";
import type { Bot } from "mineflayer";
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { tryOpenAdjacentDoor, walkForward, type DoorResolution } from "./step-jump.js";
import { navigationBackend } from "./navigation.js";

function xzDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function cellCenter(cell: Vec3): Vec3 {
  return { x: Math.floor(cell.x) + 0.5, y: cell.y, z: Math.floor(cell.z) + 0.5 };
}

export function alreadyInsideClaimedHome(position: Vec3, interior: Vec3): boolean {
  return xzDist(position, interior) <= 1.6 && Math.abs(position.y - interior.y) < 1.6;
}

export function atClaimedEntrance(position: Vec3, entrance: Vec3 | undefined, interior: Vec3): boolean {
  if (alreadyInsideClaimedHome(position, interior)) return false;
  if (!entrance) return false;
  return xzDist(position, entrance) <= 1.8 && Math.abs(position.y - entrance.y) < 1.6;
}

/**
 * True when extra interior navigation would walk back out the door.
 * Arrival at the doorway is not the same as being inside.
 */
export function shouldSkipInteriorApproach(position: Vec3, interior: Vec3, entrance?: Vec3): boolean {
  if (alreadyInsideClaimedHome(position, interior)) return true;
  if (!entrance) return false;
  const toInterior = xzDist(position, interior);
  const toEntrance = xzDist(position, entrance);
  return toInterior <= 2.2 && toInterior + 0.4 < toEntrance;
}

export type EnterHomeResult = {
  interior: Vec3;
  entrance?: Vec3;
  skippedInteriorNav: boolean;
  arrivedAtEntrance: boolean;
  enteredInterior: boolean;
  door: DoorResolution;
  position: Vec3;
};

export async function enterClaimedHouse(
  bot: Bot,
  input: { interior: Vec3; entrance?: Vec3; signal?: AbortSignal; timeoutMs?: number },
): Promise<ActionResult<EnterHomeResult>> {
  if (input.signal?.aborted) return fail("CANCELLED", "house entry cancelled", 0, true);
  if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Cannot enter a house without an active body", 0, true);
  if (!navigationParametersValid(input.interior, 2.2, input.timeoutMs ?? 1) ||
    input.entrance && !navigationParametersValid(input.entrance, 2.2, input.timeoutMs ?? 1)) {
    return fail("INVALID_ARGUMENT", "Invalid home target, entrance or timeout", 0);
  }
  const here = bot.entity?.position;
  if (!here) return fail("NOT_CONNECTED", "Cannot enter a house without a body", 0, true);
  const start = { x: here.x, y: here.y, z: here.z };
  const interior = cellCenter(input.interior);
  const entrance = input.entrance ? cellCenter(input.entrance) : undefined;
  const arrivedAtEntrance = Boolean(entrance && xzDist(start, entrance) <= 2.2);
  const skip = shouldSkipInteriorApproach(start, interior, entrance);
  return runNavigationScope<EnterHomeResult>(bot, { timeoutMs: input.timeoutMs ?? 20_000, signal: input.signal }, async signal => {
    const scopedInput = { ...input, signal };
    const door = await tryOpenAdjacentDoor(bot, scopedInput.signal);
    if (scopedInput.signal?.aborted) return fail("CANCELLED", "house entry cancelled", 0, true);
    if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body during house entry", 0, true);
    if (!skip) {
      const entity = bot.entity;
      if (entity) {
        entity.yaw = Math.atan2(-(interior.x - start.x), -(interior.z - start.z));
        entity.pitch = 0;
      }
      await walkForward(bot, 16, scopedInput.signal);
      if (scopedInput.signal?.aborted) return fail("CANCELLED", "house entry cancelled", 0, true);
      if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body during house entry", 0, true);
      const moved = await navigationBackend().navigateToPosition(bot, interior, {
        range: 0.8,
        timeoutMs: scopedInput.timeoutMs ?? 20_000,
        signal: scopedInput.signal,
        recover: true,
      });
      if (scopedInput.signal?.aborted) return fail("CANCELLED", "house entry cancelled", 0, true);
      if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body during house entry", 0, true);
      if (!moved.success && moved.code !== "VERIFY_FAILED") {
        const afterFail = bot.entity?.position ?? start;
        return fail(moved.code, moved.error, moved.durationMs, moved.retryable, {
          skippedInteriorNav: false,
          arrivedAtEntrance,
          enteredInterior: alreadyInsideClaimedHome(afterFail, interior),
          door,
        });
      }
    }
    const after = bot.entity?.position;
    if (!after || !navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body during house entry", 0, true);
    const enteredInterior = xzDist(after, interior) <= 2.2 && Math.abs(after.y - interior.y) < 1.6;
    if (!enteredInterior) {
      return fail(
        "INTERIOR_UNREACHABLE",
        `did not reach the interior; finished ${after.x.toFixed(1)},${after.y.toFixed(1)},${after.z.toFixed(1)}`,
        0,
        true,
        { skippedInteriorNav: skip, arrivedAtEntrance, enteredInterior: false, door },
      );
    }
    return ok(
      {
        interior,
        entrance,
        skippedInteriorNav: skip,
        arrivedAtEntrance: arrivedAtEntrance || Boolean(entrance && xzDist(after, entrance) <= 2.2),
        enteredInterior,
        door,
        position: { x: after.x, y: after.y, z: after.z },
      },
      0,
    );
  });
}
