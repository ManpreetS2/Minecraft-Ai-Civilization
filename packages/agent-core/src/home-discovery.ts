import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import {
  HOME_CLAIM_REACH_BLOCKS,
  nearestClaimableHome,
  type CatalogHome,
} from "./available-homes.js";

export const ATLAS_POND_LAST_POS: Vec3 = { x: -1043.5, y: 63, z: 981.5 };

export type HousingOpportunity =
  | { kind: "claim"; home: CatalogHome; distance: number }
  | { kind: "travel"; home: CatalogHome; distance: number }
  | { kind: "none"; reason: "NO_POSITION" | "NO_ELIGIBLE_HOUSE" };

/**
 * Distance to a catalog house origin. Claim validation uses this same metric.
 * Travel may target the entrance while still measuring claim range to origin.
 */
export function catalogHomeDistance(from: Vec3, home: CatalogHome): number {
  return Math.hypot(from.x - home.origin.x, from.y - home.origin.y, from.z - home.origin.z);
}

/** Nearest unclaimed catalog house at any distance. Not a claim and not H9-by-id. */
export function nearestEligibleHome(
  from: Vec3 | undefined,
  available: readonly CatalogHome[] | undefined,
): CatalogHome | undefined {
  return nearestClaimableHome(from, available, Number.POSITIVE_INFINITY);
}

/**
 * Distinguishes "I know a possible house to walk toward" from "I am close enough to claim".
 * Uses the settlement catalog of unclaimed homes (RED Site C list filtered by sqlite owners).
 * Does not open chests, teleport, or persist a claim.
 */
export function housingOpportunity(
  from: Vec3 | undefined,
  available: readonly CatalogHome[] | undefined,
  claimReach = HOME_CLAIM_REACH_BLOCKS,
): HousingOpportunity {
  if (!from) return { kind: "none", reason: "NO_POSITION" };
  if (!available || available.length === 0) return { kind: "none", reason: "NO_ELIGIBLE_HOUSE" };
  const home = nearestEligibleHome(from, available);
  if (!home) return { kind: "none", reason: "NO_ELIGIBLE_HOUSE" };
  const distance = catalogHomeDistance(from, home);
  if (distance <= claimReach) return { kind: "claim", home, distance };
  return { kind: "travel", home, distance };
}

export function housingTravelTarget(home: CatalogHome): Vec3 {
  return home.entrance ?? home.origin;
}

export type TravelTowardHousingData = {
  homeId: string;
  inClaimReach: boolean;
  distance: number;
  workComplete: false;
  claimed: false;
};

/**
 * Physical approach result. Never writes a home claim; the planner may claimHome
 * on a later tick only if this body's position is within HOME_CLAIM_REACH.
 */
export function travelTowardHousingResult(input: {
  home: CatalogHome;
  position?: Vec3;
  moved: ActionResult<{ position?: Vec3; distance?: number }>;
  claimReach?: number;
}): ActionResult<TravelTowardHousingData> {
  const reach = input.claimReach ?? HOME_CLAIM_REACH_BLOCKS;
  if (!input.moved.success) {
    return fail(input.moved.code, input.moved.error, input.moved.durationMs, input.moved.retryable, {
      ...input.moved.details,
      homeId: input.home.id,
      workComplete: false,
      claimed: false,
    });
  }
  const position = input.position ?? input.moved.data.position;
  if (!position) {
    return fail("NOT_CONNECTED", "BLOCKED: no body position after travel toward housing", input.moved.durationMs, true, {
      homeId: input.home.id,
      workComplete: false,
      claimed: false,
    });
  }
  const distance = catalogHomeDistance(position, input.home);
  return ok(
    {
      homeId: input.home.id,
      inClaimReach: distance <= reach,
      distance,
      workComplete: false,
      claimed: false,
    },
    input.moved.durationMs,
  );
}
