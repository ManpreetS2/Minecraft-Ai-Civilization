import type { Goal } from "./goals.js";
import { hashWorldState, type WorldStateFacts } from "./world-hash.js";

export type DecisionAssumptions = {
  version: number;
  createdAtMs: number;
  hunger?: number;
  health?: number;
  hasFoodInInventory: boolean;
  hasPickaxe?: boolean;
  nearbyHostile: boolean;
  currentGoal?: string;
  significantEventId?: string;
  majorNeed?: string;
  directiveId?: string;
  projectComplete?: boolean;
  worldStateHash?: string;
};

export type StaleReason =
  | "hunger_resolved"
  | "food_acquired"
  | "tool_acquired"
  | "tool_lost"
  | "new_threat"
  | "critical_injury"
  | "significant_event"
  | "need_changed"
  | "need_resolved"
  | "directive_changed"
  | "project_completed"
  | "world_hash_changed";

export function isDecisionStale(
  assumed: DecisionAssumptions,
  current: DecisionAssumptions,
): { stale: boolean; reason?: StaleReason } {
  if ((assumed.hunger ?? 20) <= 8 && (current.hunger ?? 20) >= 14) {
    return { stale: true, reason: "hunger_resolved" };
  }
  if (!assumed.hasFoodInInventory && current.hasFoodInInventory && (assumed.hunger ?? 20) <= 8) {
    return { stale: true, reason: "food_acquired" };
  }
  if (!assumed.hasPickaxe && current.hasPickaxe) return { stale: true, reason: "tool_acquired" };
  if (assumed.hasPickaxe && current.hasPickaxe === false) return { stale: true, reason: "tool_lost" };
  if (!assumed.nearbyHostile && current.nearbyHostile) {
    return { stale: true, reason: "new_threat" };
  }
  if ((assumed.health ?? 20) > 6 && (current.health ?? 20) <= 4) {
    return { stale: true, reason: "critical_injury" };
  }
  if (current.significantEventId && current.significantEventId !== assumed.significantEventId) {
    return { stale: true, reason: "significant_event" };
  }
  if (current.majorNeed && assumed.majorNeed && current.majorNeed !== assumed.majorNeed) {
    return { stale: true, reason: "need_changed" };
  }
  if (assumed.majorNeed && !current.majorNeed) return { stale: true, reason: "need_resolved" };
  if ((assumed.directiveId ?? "") !== (current.directiveId ?? "") && (current.directiveId || assumed.directiveId)) {
    return { stale: true, reason: "directive_changed" };
  }
  if (!assumed.projectComplete && current.projectComplete) return { stale: true, reason: "project_completed" };
  if (assumed.worldStateHash && current.worldStateHash && assumed.worldStateHash !== current.worldStateHash) {
    return { stale: true, reason: "world_hash_changed" };
  }
  return { stale: false };
}

export function assumptionsFromFacts(facts: WorldStateFacts, extra: Partial<DecisionAssumptions> = {}): DecisionAssumptions {
  return {
    version: 2,
    createdAtMs: Date.now(),
    hunger: facts.hunger,
    health: facts.health,
    hasFoodInInventory: Boolean(facts.hasPersonalFood),
    hasPickaxe: facts.hasPickaxe,
    nearbyHostile: Boolean(facts.nearbyThreat),
    currentGoal: facts.currentGoal,
    significantEventId: facts.urgentEventId,
    majorNeed: facts.settlementNeeds?.[0],
    directiveId: facts.directiveId,
    projectComplete: facts.projectComplete,
    worldStateHash: hashWorldState(facts),
    ...extra,
  };
}

export function shouldReconsiderFollowUps(args: {
  primary: Goal;
  primaryCompleted?: boolean;
  stale?: boolean;
  danger?: boolean;
  newDirective?: boolean;
  personalNeedChanged?: boolean;
  projectCompleted?: boolean;
  failed?: boolean;
}): boolean {
  return Boolean(
    args.primaryCompleted ||
      args.stale ||
      args.danger ||
      args.newDirective ||
      args.personalNeedChanged ||
      args.projectCompleted ||
      args.failed,
  );
}

/** Irrelevant chat must not, by itself, invalidate unrelated work. */
export function chatInvalidatesWork(chatText: string, currentGoal?: string): boolean {
  if (!currentGoal) return false;
  if (/\b(stop|help|danger|creeper|hurt|starv|directive)\b/i.test(chatText)) return true;
  return false;
}
