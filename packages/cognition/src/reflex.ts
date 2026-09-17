import { isEdibleName } from "./fact-guards.js";

export type WorldView = {
  health?: number;
  hunger?: number;
  oxygen?: number;
  onFire?: boolean;
  isNight?: boolean;
  inventory: Array<{ name: string; count: number }>;
  nearbyHostiles: Array<{ name: string; distance: number }>;
  nearbyCitizens: string[];
};

export type ReflexKind =
  | "drowning"
  | "fire"
  | "eat_available_food"
  | "critical_injury_threat"
  | "lethal_mob";

export type ReflexDecision = {
  kind: ReflexKind;
  goal: "seek_safety" | "use_storage" | "gather_food" | "rest";
  action: "flee" | "eatFood" | "attack";
  reason: string;
  priority: number;
};

/**
 * Only true immediate physical danger. Night, wood shortage, full inventory,
 * missing tools, and generic shelter need are planning inputs — not reflexes.
 */
export function detectEmergencyReflex(view: WorldView): ReflexDecision | undefined {
  if ((view.oxygen ?? 20) <= 4) {
    return {
      kind: "drowning",
      goal: "seek_safety",
      action: "flee",
      reason: "Oxygen is critically low",
      priority: 1,
    };
  }
  if (view.onFire) {
    return {
      kind: "fire",
      goal: "seek_safety",
      action: "flee",
      reason: "On fire",
      priority: 1,
    };
  }
  const hasFood = view.inventory.some((item) => item.count > 0 && isEdibleName(item.name));
  if ((view.hunger ?? 20) <= 7 && hasFood) {
    return {
      kind: "eat_available_food",
      goal: "rest",
      action: "eatFood",
      reason: "Hunger is low and food is already in inventory",
      priority: 0.95,
    };
  }
  const closeHostile = view.nearbyHostiles.find((h) => h.distance < 6);
  const closeCreeper = view.nearbyHostiles.find((h) => h.name.toLowerCase().includes("creeper") && h.distance < 8);
  if ((view.health ?? 20) <= 6 && (closeHostile || closeCreeper)) {
    return {
      kind: "critical_injury_threat",
      goal: "seek_safety",
      action: "flee",
      reason: "Critical injury with a nearby threat",
      priority: 0.98,
    };
  }
  if (closeCreeper || (closeHostile && closeHostile.distance < 4)) {
    return {
      kind: "lethal_mob",
      goal: "seek_safety",
      action: "flee",
      reason: closeCreeper ? "Creeper is too close" : `Hostile ${closeHostile?.name ?? "mob"} is too close`,
      priority: 0.92,
    };
  }
  return undefined;
}

export function isPlanningInputNotReflex(kind: "night" | "low_wood" | "full_inventory" | "missing_tool" | "shelter"): true {
  void kind;
  return true;
}
