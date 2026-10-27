import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import {
  alreadyInsideClaimedHome,
  msUntilVanillaSleep,
  vanillaMorning,
  vanillaNightWindowEnded,
  vanillaSleepTimeValid,
} from "@civ/minecraft-adapter";

export const WAIT_INSIDE_POLL_MS = 500;
export const WAIT_INSIDE_SLACK_MS = 5_000;
/** Covers a remaining Minecraft day-to-night wait without an unbounded loop. */
export const WAIT_INSIDE_MAX_MS = 12 * 60_000;

export type WaitInsideHomeInput = {
  timeOfDay: () => number;
  thundering?: () => boolean;
  bedPresent: () => boolean;
  connected: () => boolean;
  position: () => Vec3 | undefined;
  interior: Vec3;
  signal?: AbortSignal;
  now?: () => number;
  delayMs?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxWaitMs?: number;
};

export type WaitInsideHomeData = {
  waited: boolean;
  polls: number;
  sleepTimeValid: boolean;
  enteredInterior: boolean;
  walked: false;
  sleepAttempts: 0;
};

function snapshot(polls: number, sleepTimeValid: boolean): WaitInsideHomeData {
  return {
    waited: polls > 0 || !sleepTimeValid,
    polls,
    sleepTimeValid,
    enteredInterior: true,
    walked: false,
    sleepAttempts: 0,
  };
}

/**
 * Interruptible wait inside a claimed interior until vanilla sleep is legal.
 * Does not call sleep(), walk, teleport, or reassign the bed.
 */
export async function waitInsideHomeUntilSleepTime(
  input: WaitInsideHomeInput,
): Promise<ActionResult<WaitInsideHomeData>> {
  const now = input.now ?? Date.now;
  const delay = input.delayMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = input.pollMs ?? WAIT_INSIDE_POLL_MS;
  const startedAt = now();
  const startTick = input.timeOfDay();
  if (vanillaMorning(startTick) && !(input.thundering?.() ?? false)) {
    return fail("NOT_SLEEP_TIME", "Daylight; not waiting inside for next night", 0, true, {
      ...snapshot(0, false),
      daylight: true,
      workComplete: false,
      teleported: false,
      stayedInside: true,
    });
  }
  const remainingToNight = msUntilVanillaSleep(startTick);
  const maxWaitMs = Math.min(input.maxWaitMs ?? WAIT_INSIDE_MAX_MS, remainingToNight + WAIT_INSIDE_SLACK_MS);
  let polls = 0;

  const inspect = (): ActionResult<WaitInsideHomeData> | "continue" | "ready" => {
    const elapsed = now() - startedAt;
    if (input.signal?.aborted) {
      return fail("CANCELLED", "WAIT_INSIDE_HOME aborted; stayed inside claimed home", elapsed, true, {
        ...snapshot(polls, false),
        workComplete: false,
        teleported: false,
        stayedInside: true,
      });
    }
    if (!input.connected()) {
      return fail("NOT_CONNECTED", "Disconnected while waiting inside claimed home", elapsed, true, {
        ...snapshot(polls, false),
        workComplete: false,
        teleported: false,
      });
    }
    if (!input.bedPresent()) {
      return fail("BED_MISSING", "Designated home bed is missing; ownership was not reassigned", elapsed, true, {
        ...snapshot(polls, false),
        workComplete: false,
        teleported: false,
        stayedInside: true,
      });
    }
    const here = input.position();
    if (!here) {
      return fail("NOT_CONNECTED", "Lost body while waiting inside claimed home", elapsed, true, {
        ...snapshot(polls, false),
        workComplete: false,
        teleported: false,
      });
    }
    if (!alreadyInsideClaimedHome(here, input.interior)) {
      return fail(
        "INTERIOR_UNREACHABLE",
        "Left claimed interior while waiting; wait will not walk back outside",
        elapsed,
        true,
        {
          ...snapshot(polls, false),
          enteredInterior: false,
          walked: false,
          workComplete: false,
          teleported: false,
        },
      );
    }
    const tick = input.timeOfDay();
    if (vanillaSleepTimeValid(tick, input.thundering?.() ?? false)) {
      return "ready";
    }
    if (vanillaNightWindowEnded(startTick, tick)) {
      return fail("NOT_SLEEP_TIME", "Daylight returned before vanilla sleep; stayed inside claimed home", elapsed, true, {
        ...snapshot(polls, false),
        daylight: true,
        workComplete: false,
        teleported: false,
        stayedInside: true,
      });
    }
    if (elapsed >= maxWaitMs) {
      return fail("NOT_SLEEP_TIME", "WAIT_INSIDE_HOME timed out before vanilla sleep; stayed inside claimed home", elapsed, true, {
        ...snapshot(polls, false),
        workComplete: false,
        teleported: false,
        stayedInside: true,
      });
    }
    return "continue";
  };

  for (;;) {
    const status = inspect();
    if (status === "ready") {
      return ok(
        {
          waited: polls > 0,
          polls,
          sleepTimeValid: true,
          enteredInterior: true,
          walked: false,
          sleepAttempts: 0,
        },
        now() - startedAt,
      );
    }
    if (status !== "continue") return status;
    polls += 1;
    await delay(pollMs);
  }
}
