import { classifySkill, type SkillStatus } from "@civ/skills";
import { fail, ok, type ActionResult, type ErrorCode } from "@civ/shared";
import { isTestControlIdentity } from "./available-homes.js";
import type { LastOutcome, PlannedTask } from "./planner.js";
import type { CivilizationStore } from "./store.js";

export const LAST_OUTCOME_META_PREFIX = "last_outcome:";
/** Consecutive retryable failures of the same task before the planner backs off. */
export const RETRYABLE_FAILURE_LIMIT = 3;

export type DecisionKind = "planner_intent" | "physical_result" | "test_control";

export type UnresolvedBlock = {
  action: string;
  task?: string;
  code: string;
  item?: string;
  missing?: string;
};

export type UnresolvedFacts = {
  hasStorage: boolean;
  hasRod: boolean;
  hasPickaxe: boolean;
  hasShore: boolean;
  hasOre: boolean;
  availableHomeIds: string[];
};

const NON_RETRYABLE_CODES = new Set<string>([
  "ACCESS_DENIED",
  "SEARCH_EXHAUSTED",
  "FOOD_NOT_FOUND",
  "CLAIM_CONFLICT",
  "HOME_MISSING",
  "MISSING_TOOL",
  "INVALID_ARGUMENT",
  "UNKNOWN_ITEM",
  "UNKNOWN_RECIPE",
  "NO_RECIPE",
]);

export function decisionKind(citizenId: string | undefined, phase: "intent" | "result"): DecisionKind {
  if (isTestControlIdentity(citizenId)) return "test_control";
  return phase === "intent" ? "planner_intent" : "physical_result";
}

export function physicalWorkComplete(result: ActionResult): boolean {
  if (!result.success) {
    return result.details?.workComplete === true;
  }
  const data = result.data as { workComplete?: unknown } | undefined;
  if (data && typeof data === "object" && data.workComplete === false) return false;
  if (data && typeof data === "object" && typeof (data as { collected?: unknown }).collected === "number") {
    return ((data as { collected: number }).collected ?? 0) > 0;
  }
  return true;
}

export function collectedCount(result: ActionResult): number | undefined {
  if (result.success) {
    const data = result.data as { collected?: unknown } | undefined;
    if (typeof data?.collected === "number") return data.collected;
    return undefined;
  }
  const value = result.details?.collected;
  return typeof value === "number" ? value : undefined;
}

export function mergeUnresolved(
  previous: UnresolvedBlock[] | undefined,
  plan: Pick<PlannedTask, "action" | "task" | "item" | "blocked">,
  result: ActionResult,
  complete: boolean,
): UnresolvedBlock[] {
  let next = [...(previous ?? [])];
  if (complete) {
    return next.filter((entry) => entry.action !== plan.action && entry.task !== plan.task);
  }
  const code = result.success ? "INTERRUPTED" : result.code;
  if (!code || !NON_RETRYABLE_CODES.has(code)) return next;
  next = next.filter((entry) => entry.action !== plan.action);
  const failureDetails = result.success ? undefined : result.details;
  const missing =
    (typeof failureDetails?.missing === "string" ? failureDetails.missing : undefined) ?? plan.blocked?.missing;
  next.push({
    action: plan.action,
    task: plan.task,
    code,
    item: plan.item,
    missing,
  });
  return next;
}

export function unresolvedStillApplies(block: UnresolvedBlock, facts: UnresolvedFacts): boolean {
  if (block.code === "ACCESS_DENIED") return !facts.hasStorage;
  if (block.code === "MISSING_TOOL") {
    if (block.action === "fishShore" || block.task === "fish_shore") return !facts.hasRod;
    if (block.action === "mineOre" || block.task === "mine_ore") return !facts.hasPickaxe;
    return true;
  }
  if (block.code === "SEARCH_EXHAUSTED") {
    if (block.action === "fishShore" || block.task === "fish_shore") return !facts.hasShore;
    if (block.action === "mineOre" || block.task === "mine_ore") return !facts.hasOre;
    return true;
  }
  if (block.code === "CLAIM_CONFLICT" && block.item) {
    return !facts.availableHomeIds.includes(block.item);
  }
  return true;
}

export function suppressedActions(unresolved: UnresolvedBlock[] | undefined, facts: UnresolvedFacts): Set<string> {
  const suppressed = new Set<string>();
  for (const block of unresolved ?? []) {
    if (!unresolvedStillApplies(block, facts)) continue;
    suppressed.add(block.action);
    if (block.task) suppressed.add(block.task);
  }
  return suppressed;
}

const SKIP_HOME_CODES = new Set(["CLAIM_CONFLICT", "TARGET_UNREACHABLE", "HAZARD_BLOCKED", "PATH_BLOCKED"]);

export function suppressedHomeIds(unresolved: UnresolvedBlock[] | undefined, facts: UnresolvedFacts): Set<string> {
  const ids = new Set<string>();
  for (const block of unresolved ?? []) {
    if (!block.item || !SKIP_HOME_CODES.has(block.code)) continue;
    if (!unresolvedStillApplies(block, facts)) continue;
    ids.add(block.item);
  }
  return ids;
}

export function shouldBackoffToObserve(last: LastOutcome | undefined): boolean {
  if (!last || last.success) return false;
  if (last.code === "CURFEW_STOP" || last.code === "CANCELLED" || last.code === "INTERRUPTED" || last.code === "NOT_SLEEP_TIME") {
    return false;
  }
  if (last.retryable === false) return false;
  return last.streak >= RETRYABLE_FAILURE_LIMIT;
}

export function lastOutcomeFrom(plan: PlannedTask, result: ActionResult, previous?: LastOutcome): LastOutcome {
  const complete = physicalWorkComplete(result);
  const details = result.success ? undefined : result.details;
  const item =
    plan.item ??
    (typeof details?.item === "string" ? details.item : undefined) ??
    (typeof details?.next === "string" ? details.next : undefined);
  const classified = complete ? classifySkill(ok({}, 0)) : classifySkill(result.success ? fail("INTERRUPTED", "incomplete", 0, false) : result);
  const code = complete ? undefined : result.success ? "INTERRUPTED" : result.code;
  return {
    task: plan.task,
    action: plan.action,
    success: complete,
    code,
    error: complete ? undefined : result.success ? "Physical work did not complete" : result.error,
    item,
    nextTask: typeof details?.nextTask === "string" ? details.nextTask : undefined,
    nextAction: typeof details?.nextAction === "string" ? details.nextAction : undefined,
    streak: complete ? 0 : previous?.task === plan.task ? previous.streak + 1 : 1,
    retryable: complete ? undefined : result.success ? false : result.retryable,
    workComplete: complete,
    skillStatus: classified,
    collected: collectedCount(result),
    unresolved: mergeUnresolved(previous?.unresolved, plan, result, complete),
  };
}

export function persistCitizenLastOutcome(store: CivilizationStore, citizenId: string, outcome: LastOutcome): void {
  store.setMeta(`${LAST_OUTCOME_META_PREFIX}${citizenId}`, JSON.stringify(outcome));
}

export function loadCitizenLastOutcome(store: CivilizationStore, citizenId: string): LastOutcome | undefined {
  const raw = store.getMeta(`${LAST_OUTCOME_META_PREFIX}${citizenId}`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as LastOutcome;
    if (!parsed || typeof parsed.task !== "string" || typeof parsed.action !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function cancelCitizenWork(citizen: { abort?: AbortController }): void {
  citizen.abort?.abort();
}

export function taskEventType(result: ActionResult): "TaskCompleted" | "TaskFailed" {
  return physicalWorkComplete(result) ? "TaskCompleted" : "TaskFailed";
}

export function skillStatusOf(result: ActionResult): SkillStatus {
  if (physicalWorkComplete(result)) return "SUCCESS";
  if (result.success) return "INTERRUPTED";
  return classifySkill(result);
}

export function isNonRetryableCode(code: string | undefined): boolean {
  return Boolean(code && NON_RETRYABLE_CODES.has(code));
}
