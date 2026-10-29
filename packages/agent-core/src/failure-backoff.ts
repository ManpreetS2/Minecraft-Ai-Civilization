import type { LastOutcome } from "./planner.js";

/** Matches task-recovery RETRYABLE_FAILURE_LIMIT without requiring that WIP module at commit time. */
export const FAILURE_BACKOFF_STREAK = 3;

/** Codes that mean the same physical attempt should not be re-issued immediately. */
export const FOOD_SEARCH_EXHAUSTED_CODES = new Set(["FOOD_NOT_FOUND", "SEARCH_EXHAUSTED"]);

export const HOME_ROUTE_BLOCKED_CODES = new Set([
  "STUCK",
  "TIMEOUT",
  "PATH_BLOCKED",
  "BED_UNREACHABLE",
  "INTERIOR_UNREACHABLE",
  "NAV_NO_INITIAL_PROGRESS",
]);

export function isAcquireFoodTask(task?: string, action?: string): boolean {
  return task === "acquire_food" || task === "gather_food" || action === "gatherFood";
}

export function isSleepAtHomeTask(task?: string, action?: string): boolean {
  return task === "sleep_at_home" || action === "sleep";
}

/**
 * Hunger reflex must not re-issue gatherFood forever after an honest search miss.
 * Day 2: ~362 identical FOOD_NOT_FOUND loops because reflex short-circuited backoff.
 */
export function shouldBackoffFoodSearch(last: LastOutcome | undefined): boolean {
  if (!last || last.success) return false;
  if (!isAcquireFoodTask(last.task, last.action)) return false;
  if (!last.code || !FOOD_SEARCH_EXHAUSTED_CODES.has(last.code)) return false;
  return last.streak >= FAILURE_BACKOFF_STREAK;
}

/**
 * Curfew bedtime must not re-issue the identical blocked home route forever.
 * Day 2: 19× sleep_at_home STUCK/TIMEOUT on crafting_table ~27 blocks from bed.
 */
export function shouldBackoffHomeSleepRoute(last: LastOutcome | undefined): boolean {
  if (!last || last.success) return false;
  if (!isSleepAtHomeTask(last.task, last.action)) return false;
  if (!last.code || !HOME_ROUTE_BLOCKED_CODES.has(last.code)) return false;
  return last.streak >= FAILURE_BACKOFF_STREAK;
}

export function foodSearchBackoffReason(last: LastOutcome): string {
  return `Food search exhausted ${last.streak}× (${last.code}); not inventing food — backing off`;
}

/**
 * Backoff suppresses the identical exhausted gatherFood loop.
 * New environmental evidence (animals, farm, fishable shore) is a different
 * acquisition path and must remain eligible.
 */
export function foodSearchHasAlternateOpportunity(facts: {
  animalsNearby: boolean;
  canFish: boolean;
  farmReachable: boolean;
}): boolean {
  return facts.animalsNearby || facts.canFish || facts.farmReachable;
}

export function homeSleepBackoffReason(last: LastOutcome): string {
  const obstacle =
    typeof last.error === "string" && /obstacle=([^\s;]+)/.test(last.error)
      ? last.error.match(/obstacle=([^\s;]+)/)?.[1]
      : undefined;
  return obstacle
    ? `Home/sleep route blocked ${last.streak}× (${last.code}, obstacle=${obstacle}); not retrying the identical path`
    : `Home/sleep route blocked ${last.streak}× (${last.code}); not retrying the identical path`;
}
