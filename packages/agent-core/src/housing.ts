import type { Vec3 } from "@civ/shared";

/**
 * Autonomous home claiming / travel planner (cloud unit-tested).
 * No hardcoded H1 assignment.
 * Status: IMPLEMENTED / LIVE UNVERIFIED
 */

export type HouseRecord = {
  id: string;
  bed: Vec3;
  door?: Vec3;
  claimedBy?: string;
  valid: boolean;
  /** Reachability flags supplied by navigation layer / tests. */
  reachable?: boolean;
};

export type HousingCitizen = {
  id: string;
  position: Vec3;
  homeId?: string;
  connected: boolean;
};

export type HousingPlan =
  | { action: "none"; reason: string }
  | { action: "already_housed"; reason: string; homeId: string }
  | { action: "travel"; reason: string; houseId: string; target: Vec3 }
  | { action: "claim"; reason: string; houseId: string }
  | { action: "wait_unreachable"; reason: string }
  | { action: "abort"; reason: string; code: "NO_HOUSING" | "NOT_CONNECTED" | "CLAIM_FAILED" | "INVALID_HOME" };

export type HousingWorld = {
  houses: HouseRecord[];
  /** Distance between two points (injectable for tests). */
  distance(a: Vec3, b: Vec3): number;
  /** Claim persistence — may fail independently of being in range. */
  persistClaim(citizenId: string, houseId: string): boolean;
  /** Claim radius in blocks. */
  claimRadius: number;
  isNight?: boolean;
};

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function eligibleHouses(citizen: HousingCitizen, houses: HouseRecord[]): HouseRecord[] {
  return houses.filter((h) => h.valid && (!h.claimedBy || h.claimedBy === citizen.id));
}

export function sortByDistance(citizen: HousingCitizen, houses: HouseRecord[], dist: (a: Vec3, b: Vec3) => number): HouseRecord[] {
  return [...houses].sort((a, b) => dist(citizen.position, a.bed) - dist(citizen.position, b.bed));
}

/**
 * Plan next housing step for a homeless (or validating) citizen.
 * Re-evaluates claims while traveling — nearest may become claimed mid-route.
 */
export function planHousing(citizen: HousingCitizen, world: HousingWorld): HousingPlan {
  if (!citizen.connected) {
    return { action: "abort", reason: "Disconnected during housing travel", code: "NOT_CONNECTED" };
  }

  if (citizen.homeId) {
    const home = world.houses.find((h) => h.id === citizen.homeId);
    if (!home || !home.valid) {
      return { action: "abort", reason: "Claimed house became invalid or bed destroyed", code: "INVALID_HOME" };
    }
    if (home.claimedBy && home.claimedBy !== citizen.id) {
      return { action: "abort", reason: "Home claim lost to another citizen", code: "INVALID_HOME" };
    }
    return { action: "already_housed", reason: "Citizen already has a home", homeId: citizen.homeId };
  }

  const catalog = world.houses;
  if (catalog.length === 0) {
    return { action: "abort", reason: "Empty house catalog", code: "NO_HOUSING" };
  }

  let eligible = eligibleHouses(citizen, catalog);
  if (eligible.length === 0) {
    return { action: "abort", reason: "No unclaimed/eligible houses", code: "NO_HOUSING" };
  }

  // Prefer reachable houses; if nearest route blocked, try next eligible.
  const ordered = sortByDistance(citizen, eligible, world.distance);
  const candidates = ordered.filter((h) => h.reachable !== false);
  if (candidates.length === 0) {
    return {
      action: "wait_unreachable",
      reason: world.isNight
        ? "Night while far from housing and all routes blocked"
        : "All eligible houses unreachable",
    };
  }

  const target = candidates[0]!;
  const dist = world.distance(citizen.position, target.bed);

  // Re-check claim race: nearest may have been claimed while traveling.
  if (target.claimedBy && target.claimedBy !== citizen.id) {
    const next = candidates.find((h) => !h.claimedBy || h.claimedBy === citizen.id);
    if (!next) {
      return { action: "abort", reason: "Nearest house claimed while traveling; no alternatives", code: "NO_HOUSING" };
    }
    return {
      action: "travel",
      reason: "Nearest house became claimed; traveling to next eligible house",
      houseId: next.id,
      target: next.door ?? next.bed,
    };
  }

  if (dist <= world.claimRadius) {
    const ok = world.persistClaim(citizen.id, target.id);
    if (!ok) {
      return {
        action: "abort",
        reason: "Inside claim range but claim persistence failed",
        code: "CLAIM_FAILED",
      };
    }
    return { action: "claim", reason: "Within claim range of eligible house", houseId: target.id };
  }

  return {
    action: "travel",
    reason:
      ordered.length > 1 && Math.abs(world.distance(citizen.position, ordered[0]!.bed) - world.distance(citizen.position, ordered[1]!.bed)) < 1
        ? "Two eligible homes at similar distance; selecting nearest stable id order"
        : "Traveling toward nearest eligible housing",
    houseId: target.id,
    target: target.door ?? target.bed,
  };
}

/**
 * Apply a successful claim to house catalog (pure helper for tests / store integration).
 */
export function applyClaim(houses: HouseRecord[], citizenId: string, houseId: string): HouseRecord[] {
  return houses.map((h) => {
    if (h.id === houseId) return { ...h, claimedBy: citizenId };
    if (h.claimedBy === citizenId) return { ...h, claimedBy: undefined };
    return h;
  });
}
