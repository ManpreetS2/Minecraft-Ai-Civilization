import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import type { CivilizationStore } from "./store.js";
import { isTestFixtureChest } from "./test-fixtures.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
import type {
  CitizenHome,
  ClaimHomeRequest,
  HomeMembership,
  HomeRecord,
  StorageAccess,
} from "./home-types.js";

export type {
  CitizenHome,
  ClaimHomeRequest,
  HomeMembership,
  HomeMembershipStatus,
  HomeRecord,
  StorageAccess,
} from "./home-types.js";

export function floorCell(pos: Vec3): Vec3 {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

export function sameCell(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

export function homeWaypoint(home: Pick<CitizenHome, "entrance" | "origin" | "bed">): Vec3 {
  return home.entrance ?? home.origin ?? home.bed;
}

function constraintConflict(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  return code.includes("CONSTRAINT") || String(error).toUpperCase().includes("UNIQUE");
}

/**
 * Persist a citizen-chosen home. Does not assign House 1 to Atlas or any roster order.
 * Joining a household requires an explicit homeId. Moving requires move=true.
 */
export function claimHome(store: CivilizationStore, request: ClaimHomeRequest): ActionResult<{ home: HomeRecord; membership: HomeMembership }> {
  const citizen = store.getCitizen(request.citizenId);
  if (!citizen) {
    return fail("INVALID_ARGUMENT", `Unknown citizen ${request.citizenId}`, 0, false);
  }
  if (!request.bed) {
    return fail("INVALID_ARGUMENT", "A designated bed is required to claim a home", 0, false);
  }
  const access: StorageAccess = request.storageAccess ?? (request.personalChest ? "personal" : request.householdChest ? "household" : "communal");
  if (access === "personal" && !request.personalChest) {
    return fail("INVALID_ARGUMENT", "Personal storage access requires designated personal-chest coordinates", 0, false);
  }

  const existing = store.getCitizenHome(request.citizenId);
  if (existing && existing.status !== "left" && !request.move) {
    const joiningSame = request.homeId && request.homeId === existing.homeId;
    const sameBed = sameCell(existing.bed, request.bed);
    const sameChest =
      (!request.personalChest && !existing.personalChest) ||
      (request.personalChest && existing.personalChest && sameCell(existing.personalChest, request.personalChest));
    if (!(joiningSame && sameBed && sameChest && existing.status === "active")) {
      return fail(
        "CLAIM_CONFLICT",
        "Citizen already has a claimed home. Pass move=true to change it; a nearby bed does not replace it.",
        0,
        false,
        { homeId: existing.homeId, bed: existing.bed },
      );
    }
  }

  const bed = floorCell(request.bed);
  const personalChest = request.personalChest ? floorCell(request.personalChest) : undefined;
  const origin = floorCell(request.origin);
  const entrance = request.entrance ? floorCell(request.entrance) : undefined;
  const householdChest = request.householdChest ? floorCell(request.householdChest) : undefined;
  const homeId = request.homeId ?? `home_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const bedOwner = store.bedClaimOwner(bed);
  if (bedOwner && bedOwner !== request.citizenId) {
    return fail("CLAIM_CONFLICT", `Bed ${bed.x},${bed.y},${bed.z} is already claimed by ${bedOwner}`, 0, false, {
      resource: "bed",
      ownerId: bedOwner,
      position: bed,
    });
  }
  if (personalChest) {
    const chestOwner = store.personalChestOwner(personalChest);
    if (chestOwner && chestOwner !== request.citizenId) {
      return fail(
        "CLAIM_CONFLICT",
        `Personal chest ${personalChest.x},${personalChest.y},${personalChest.z} is already claimed by ${chestOwner}`,
        0,
        false,
        { resource: "chest", ownerId: chestOwner, position: personalChest },
      );
    }
  }

  try {
    store.writeHomeClaim({
      home: {
        id: homeId,
        dimension: request.dimension ?? "overworld",
        origin,
        entrance,
        householdChest,
        createdAt: now,
        updatedAt: now,
      },
      membership: {
        citizenId: request.citizenId,
        homeId,
        bed,
        personalChest,
        storageAccess: access,
        status: "active",
        createdAt: existing?.createdAt ?? now,
      },
      previousHomeId: existing && existing.status !== "left" ? existing.homeId : undefined,
    });
  } catch (error) {
    if (constraintConflict(error)) {
      return fail("CLAIM_CONFLICT", "That bed or personal chest is already exclusively claimed", 0, false);
    }
    return fail("DATABASE_ERROR", error instanceof Error ? error.message : String(error), 0, true);
  }

  const home = store.getHome(homeId);
  const membership = store.getMembership(request.citizenId);
  if (!home || !membership) {
    return fail("DATABASE_ERROR", "Home claim did not persist", 0, true);
  }
  return ok({ home, membership }, 0);
}

export function leaveHome(store: CivilizationStore, citizenId: string): ActionResult<{ left: true; homeId?: string }> {
  const existing = store.getCitizenHome(citizenId);
  if (!existing) {
    return fail("HOME_MISSING", "Citizen has not claimed a home", 0, false);
  }
  store.leaveHome(citizenId);
  return ok({ left: true, homeId: existing.homeId }, 0);
}

export function markHomeInaccessible(
  store: CivilizationStore,
  citizenId: string,
  reason: string,
): ActionResult<{ status: "displaced"; homeId: string }> {
  const existing = store.getCitizenHome(citizenId);
  if (!existing) {
    return fail("HOME_MISSING", "Citizen has not claimed a home", 0, false);
  }
  store.markHomeDisplaced(citizenId, reason);
  return ok({ status: "displaced", homeId: existing.homeId }, 0);
}

export function resolveHomeSleepTarget(store: CivilizationStore, citizenId: string | undefined): ActionResult<{ bed: Vec3; homeId: string; waypoint: Vec3 }> {
  if (!citizenId) {
    return fail("HOME_MISSING", "No citizen identity for home sleep", 0, false);
  }
  const home = store.getCitizenHome(citizenId);
  if (!home) {
    return fail("HOME_MISSING", "Citizen has not claimed a home bed", 0, true);
  }
  if (home.status === "left") {
    return fail("HOME_MISSING", "Citizen left their home", 0, false);
  }
  if (home.status === "displaced") {
    return fail(
      "HOME_INACCESSIBLE",
      "Claimed home is currently inaccessible; ownership was not reassigned",
      0,
      true,
      { homeId: home.homeId, bed: home.bed, status: home.status },
    );
  }
  return ok({ bed: home.bed, homeId: home.homeId, waypoint: homeWaypoint(home) }, 0);
}

export function resolveStorageTarget(
  store: CivilizationStore,
  citizenId: string | undefined,
  purpose: StorageAccess,
): ActionResult<{ position: Vec3; access: StorageAccess; homeId?: string }> {
  if (purpose === "communal") {
    const settlement = store.getSettlement();
    if (!settlement.storage) {
      return fail("CONTAINER_NOT_FOUND", "No communal settlement chest", 0, true);
    }
    const owner = store.personalChestOwner(settlement.storage);
    if (owner && owner !== citizenId) {
      return fail("ACCESS_DENIED", "Settlement storage points at another citizen's personal chest", 0, true, {
        ownerId: owner,
        position: settlement.storage,
      });
    }
    return ok({ position: settlement.storage, access: "communal" }, 0);
  }
  if (!citizenId) {
    return fail("HOME_MISSING", "No citizen identity for storage", 0, false);
  }
  const home = store.getCitizenHome(citizenId);
  if (!home) {
    return fail("HOME_MISSING", "Citizen has not claimed a home", 0, true);
  }
  if (home.status === "displaced") {
    return fail("HOME_INACCESSIBLE", "Claimed home storage is currently inaccessible; ownership was not reassigned", 0, true, {
      homeId: home.homeId,
    });
  }
  if (purpose === "personal") {
    if (!home.personalChest) {
      return fail("CONTAINER_NOT_FOUND", "Citizen has no designated personal chest", 0, true, { homeId: home.homeId });
    }
    return ok({ position: home.personalChest, access: "personal", homeId: home.homeId }, 0);
  }
  if (!home.householdChest) {
    return fail("CONTAINER_NOT_FOUND", "Household has no shared chest", 0, true, { homeId: home.homeId });
  }
  return ok({ position: home.householdChest, access: "household", homeId: home.homeId }, 0);
}

export function assertChestAccess(
  store: CivilizationStore,
  citizenId: string | undefined,
  position: Vec3,
  purpose: StorageAccess,
  dimension?: string,
): ActionResult<{ position: Vec3; access: StorageAccess }> {
  const cell = floorCell(position);
  if (store.hasCommunities()) {
    const denied = () => fail("ACCESS_DENIED", "Storage access requires current identity and explicit scoped authorization", 0, false, { position: cell });
    if (!citizenId || !store.getCitizen(citizenId) || !store.getCommunityDirectory().communityOf(citizenId) || isTestFixtureChest(cell)) return denied();
    if (purpose === "communal") {
      // Legacy callers have no dimension. Refuse rather than assuming these coordinates refer to the overworld.
      if (typeof dimension !== "string" || !dimension.replace(/^minecraft:/, "").trim()) return denied();
      const key = physicalBlockKey(dimension.replace(/^minecraft:/, ""), cell);
      const permitted = communityPhysicalState(store).forCitizen(citizenId).accessibleAssets().some((a) => a.kind === "chest" && a.key === key);
      return permitted ? ok({ position: cell, access: purpose }, 0) : denied();
    }
    const home = store.getCitizenHome(citizenId);
    const designated = purpose === "personal" ? home?.personalChest : home?.householdChest;
    if (!home || home.status !== "active" || !designated || !sameCell(designated, cell)) return denied();
    const owner = store.personalChestOwner(cell);
    if (owner && owner !== citizenId) return denied();
    return ok({ position: cell, access: purpose }, 0);
  }
  const personalOwner = store.personalChestOwner(cell);
  if (purpose === "personal") {
    if (!citizenId) return fail("ACCESS_DENIED", "Personal storage requires a citizen identity", 0, false);
    if (personalOwner && personalOwner !== citizenId) {
      return fail("ACCESS_DENIED", "Cannot use another citizen's private chest", 0, false, { ownerId: personalOwner, position: cell });
    }
    const home = citizenId ? store.getCitizenHome(citizenId) : undefined;
    if (!home?.personalChest || !sameCell(home.personalChest, cell)) {
      return fail("ACCESS_DENIED", "That chest is not this citizen's designated personal storage", 0, false, { position: cell });
    }
    return ok({ position: cell, access: "personal" }, 0);
  }
  if (personalOwner && personalOwner !== citizenId) {
    return fail("ACCESS_DENIED", "Cannot withdraw from another citizen's private chest without authorized access", 0, false, {
      ownerId: personalOwner,
      position: cell,
    });
  }
  if (purpose === "household") {
    if (!citizenId) return fail("ACCESS_DENIED", "Household storage requires a citizen identity", 0, false);
    const home = store.getCitizenHome(citizenId);
    if (!home?.householdChest || !sameCell(home.householdChest, cell)) {
      return fail("ACCESS_DENIED", "That chest is not this household's shared storage", 0, false, { position: cell });
    }
    return ok({ position: cell, access: "household" }, 0);
  }
  if (isTestFixtureChest(cell)) {
    return fail(
      "ACCESS_DENIED",
      "TEST_CONTROL fixture chests are not citizen storage; discovering them is not permission",
      0,
      false,
      { position: cell },
    );
  }
  const settlement = store.getSettlement();
  if (!settlement.storage || !sameCell(settlement.storage, cell)) {
    return fail(
      "ACCESS_DENIED",
      "That chest is not designated communal storage; discovering a chest is not permission to use it",
      0,
      false,
      { position: cell },
    );
  }
  if (isTestFixtureChest(settlement.storage)) {
    return fail("ACCESS_DENIED", "TEST_CONTROL fixture chests are not communal storage", 0, false, { position: cell });
  }
  return ok({ position: cell, access: "communal" }, 0);
}
