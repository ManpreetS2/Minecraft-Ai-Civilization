export type DecisionAssumptions = {
  version: number;
  createdAtMs: number;
  hunger?: number;
  health?: number;
  hasFoodInInventory: boolean;
  nearbyHostile: boolean;
  currentGoal?: string;
  significantEventId?: string;
  majorNeed?: string;
};

export type StaleReason =
  | "hunger_resolved"
  | "food_acquired"
  | "new_threat"
  | "critical_injury"
  | "significant_event"
  | "need_changed";

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
  if (!assumed.nearbyHostile && current.nearbyHostile) {
    return { stale: true, reason: "new_threat" };
  }
  if ((assumed.health ?? 20) > 6 && (current.health ?? 20) <= 4) {
    return { stale: true, reason: "critical_injury" };
  }
  if (
    current.significantEventId &&
    current.significantEventId !== assumed.significantEventId
  ) {
    return { stale: true, reason: "significant_event" };
  }
  if (current.majorNeed && assumed.majorNeed && current.majorNeed !== assumed.majorNeed) {
    return { stale: true, reason: "need_changed" };
  }
  return { stale: false };
}
