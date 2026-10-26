import { describe, expect, it } from "vitest";
import {
  foodSearchBackoffReason,
  homeSleepBackoffReason,
  shouldBackoffFoodSearch,
  shouldBackoffHomeSleepRoute,
} from "./failure-backoff.js";
import { FAILURE_BACKOFF_STREAK } from "./failure-backoff.js";
import type { LastOutcome } from "./planner.js";

const outcome = (over: Partial<LastOutcome>): LastOutcome => ({
  task: "acquire_food",
  action: "gatherFood",
  success: false,
  streak: 1,
  ...over,
});

describe("failure backoff (Day 2 loops)", () => {
  it("backs off acquire_food after repeated FOOD_NOT_FOUND", () => {
    expect(shouldBackoffFoodSearch(outcome({ code: "FOOD_NOT_FOUND", streak: 2 }))).toBe(false);
    expect(
      shouldBackoffFoodSearch(outcome({ code: "FOOD_NOT_FOUND", streak: FAILURE_BACKOFF_STREAK })),
    ).toBe(true);
    expect(foodSearchBackoffReason(outcome({ code: "FOOD_NOT_FOUND", streak: 3 }))).toMatch(/exhausted/i);
  });

  it("backs off sleep_at_home after repeated STUCK/TIMEOUT", () => {
    expect(
      shouldBackoffHomeSleepRoute(
        outcome({
          task: "sleep_at_home",
          action: "sleep",
          code: "STUCK",
          streak: 2,
          error: "no progress; obstacle=crafting_table",
        }),
      ),
    ).toBe(false);
    expect(
      shouldBackoffHomeSleepRoute(
        outcome({
          task: "sleep_at_home",
          action: "sleep",
          code: "STUCK",
          streak: FAILURE_BACKOFF_STREAK,
          error: "no progress; obstacle=crafting_table",
        }),
      ),
    ).toBe(true);
    expect(
      homeSleepBackoffReason(
        outcome({
          task: "sleep_at_home",
          action: "sleep",
          code: "TIMEOUT",
          streak: 3,
          error: "timed out; obstacle=crafting_table",
        }),
      ),
    ).toMatch(/crafting_table/);
  });
});
