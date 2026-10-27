import { fail, isMechanicsProbeUsername, type ActionResult, type Vec3 } from "@civ/shared";
import { claimHome, type HomeMembership, type HomeRecord } from "./homes.js";
import type { CivilizationStore } from "./store.js";
import { isTestFixtureChest, sameStorageCell } from "./test-fixtures.js";

export type CatalogHome = {
  id: string;
  origin: Vec3;
  entrance: Vec3;
  bed: Vec3;
  personalChest: Vec3;
};

/**
 * RED-installed Site C houses that have a usable bed and empty personal chest.
 * These are options, not claims. H1 is one option and is never the default.
 * H3/H6/H7/H8 are omitted until they have a designated personal chest.
 */
export const WORLD_LAB_CLAIMABLE_HOMES: readonly CatalogHome[] = [
  {
    id: "home_h1",
    origin: { x: -1096, y: 69, z: 730 },
    entrance: { x: -1096, y: 69, z: 732 },
    bed: { x: -1097, y: 69, z: 728 },
    personalChest: { x: -1096, y: 69, z: 729 },
  },
  {
    id: "home_h2",
    origin: { x: -1058, y: 68, z: 757 },
    entrance: { x: -1060, y: 68, z: 757 },
    bed: { x: -1056, y: 68, z: 756 },
    personalChest: { x: -1057, y: 68, z: 757 },
  },
  {
    id: "home_h4",
    origin: { x: -1057, y: 65, z: 780 },
    entrance: { x: -1059, y: 65, z: 780 },
    bed: { x: -1055, y: 65, z: 779 },
    personalChest: { x: -1056, y: 65, z: 780 },
  },
  {
    id: "home_h5",
    origin: { x: -1079, y: 69, z: 799 },
    entrance: { x: -1081, y: 69, z: 799 },
    bed: { x: -1077, y: 69, z: 798 },
    personalChest: { x: -1078, y: 69, z: 799 },
  },
  {
    id: "home_h9",
    origin: { x: -1065, y: 68, z: 847 },
    entrance: { x: -1063, y: 68, z: 847 },
    bed: { x: -1067, y: 68, z: 848 },
    personalChest: { x: -1066, y: 68, z: 847 },
  },
];

/** Citizen must be this close to a house to claim it. Distant H1 is never auto-selected. */
export const HOME_CLAIM_REACH_BLOCKS = 48;

export function isTestControlIdentity(citizenId: string | undefined): boolean {
  if (!citizenId) return true;
  const normalized = citizenId.trim().toLowerCase();
  if (isMechanicsProbeUsername(citizenId) || isMechanicsProbeUsername(citizenId.replace(/^citizen_/i, ""))) {
    return true;
  }
  return normalized.includes("probe");
}

export function catalogHomeById(homeId: string | undefined): CatalogHome | undefined {
  if (!homeId) return undefined;
  return WORLD_LAB_CLAIMABLE_HOMES.find((home) => home.id === homeId);
}

/**
 * Citizen claim as a physical action: TEST_CONTROL refused, existing claims
 * respected, house must be in reach. Does not silently assign H1.
 */
export function evaluateClaimHomeAction(input: {
  store: CivilizationStore;
  citizenId: string;
  homeId: string;
  position?: Vec3;
}): ActionResult<{ home: HomeRecord; membership: HomeMembership }> {
  if (!input.position) {
    return fail("NOT_CONNECTED", "BLOCKED: citizen body has no position for claimHome", 0, true);
  }
  const catalog = catalogHomeById(input.homeId);
  if (!catalog) {
    return fail("INVALID_ARGUMENT", `Unknown catalog home ${input.homeId}; houses are not invented`, 0, false);
  }
  const distance = Math.hypot(
    input.position.x - catalog.origin.x,
    input.position.y - catalog.origin.y,
    input.position.z - catalog.origin.z,
  );
  if (distance > HOME_CLAIM_REACH_BLOCKS) {
    return fail(
      "TARGET_UNREACHABLE",
      `BLOCKED: ${catalog.id} is ${distance.toFixed(1)} blocks away (claim reach ${HOME_CLAIM_REACH_BLOCKS})`,
      0,
      false,
      { homeId: catalog.id, distance },
    );
  }
  return persistCitizenHomeClaim(input.store, input.citizenId, input.homeId);
}

export function isCatalogPersonalChest(pos: Vec3 | undefined): boolean {
  if (!pos) return false;
  return WORLD_LAB_CLAIMABLE_HOMES.some((home) => sameStorageCell(home.personalChest, pos));
}

export function catalogHomeCells(home: CatalogHome): Vec3[] {
  return [home.origin, home.entrance, home.bed, home.personalChest];
}

/**
 * Beds and doors from the Site C housing audit, including houses not yet
 * claimable. Catalog options, not live claims. Do not treat as TEST_CONTROL.
 */
export const WORLD_LAB_AUDITED_FURNITURE: readonly Vec3[] = [
  { x: -1097, y: 69, z: 728 },
  { x: -1096, y: 69, z: 731 },
  { x: -1056, y: 68, z: 756 },
  { x: -1059, y: 68, z: 757 },
  { x: -1056, y: 67, z: 768 },
  { x: -1059, y: 67, z: 769 },
  { x: -1055, y: 65, z: 779 },
  { x: -1058, y: 65, z: 780 },
  { x: -1077, y: 69, z: 798 },
  { x: -1080, y: 69, z: 799 },
  { x: -1072, y: 70, z: 798 },
  { x: -1071, y: 70, z: 796 },
  { x: -1089, y: 68, z: 817 },
  { x: -1086, y: 68, z: 816 },
  { x: -1051, y: 65, z: 841 },
  { x: -1050, y: 65, z: 839 },
  { x: -1067, y: 68, z: 848 },
  { x: -1064, y: 68, z: 847 },
  ...WORLD_LAB_CLAIMABLE_HOMES.flatMap(catalogHomeCells),
];

export function isCatalogHomeFurniture(pos: Vec3 | undefined): boolean {
  if (!pos) return false;
  return WORLD_LAB_AUDITED_FURNITURE.some((cell) => sameStorageCell(cell, pos));
}

export function catalogHomeOwner(store: CivilizationStore, home: CatalogHome): string | undefined {
  const member = store.listHomeMembers(home.id).find((row) => row.status === "active" || row.status === "displaced");
  if (member) return member.citizenId;
  return store.bedClaimOwner(home.bed) ?? store.personalChestOwner(home.personalChest);
}

export function listAvailableHomes(
  store: CivilizationStore,
  catalog: readonly CatalogHome[] = WORLD_LAB_CLAIMABLE_HOMES,
): CatalogHome[] {
  return catalog.filter((home) => !catalogHomeOwner(store, home));
}

export function nearestClaimableHome(
  from: Vec3 | undefined,
  available: readonly CatalogHome[] | undefined,
  maxBlocks = HOME_CLAIM_REACH_BLOCKS,
): CatalogHome | undefined {
  if (!from || !available || available.length === 0) return undefined;
  const inRange = available.filter((home) => {
    const dist = Math.hypot(from.x - home.origin.x, from.y - home.origin.y, from.z - home.origin.z);
    return dist <= maxBlocks;
  });
  if (inRange.length === 0) return undefined;
  return [...inRange].sort((a, b) => {
    const da = Math.hypot(from.x - a.origin.x, from.y - a.origin.y, from.z - a.origin.z);
    const db = Math.hypot(from.x - b.origin.x, from.y - b.origin.y, from.z - b.origin.z);
    return da - db;
  })[0];
}

/**
 * Persist a citizen-chosen catalog home through BLUE `claimHome`.
 * Does not assign H1 by roster. TEST_CONTROL probe identities are refused.
 */
export function persistCitizenHomeClaim(
  store: CivilizationStore,
  citizenId: string,
  homeId: string,
): ActionResult<{ home: HomeRecord; membership: HomeMembership }> {
  if (isTestControlIdentity(citizenId)) {
    return fail("ACCESS_DENIED", "TEST_CONTROL identities cannot claim citizen homes", 0, false);
  }
  const catalog = catalogHomeById(homeId);
  if (!catalog) {
    return fail("INVALID_ARGUMENT", `Unknown catalog home ${homeId}; houses are not invented`, 0, false);
  }
  if (isTestFixtureChest(catalog.personalChest)) {
    return fail("ACCESS_DENIED", "Test-fixture chests cannot be claimed as citizen homes", 0, false);
  }
  const owner = catalogHomeOwner(store, catalog);
  if (owner && owner !== citizenId) {
    return fail("CLAIM_CONFLICT", `House ${catalog.id} is already claimed by ${owner}`, 0, false, {
      homeId: catalog.id,
      ownerId: owner,
    });
  }
  return claimHome(store, {
    citizenId,
    homeId: catalog.id,
    origin: catalog.origin,
    entrance: catalog.entrance,
    bed: catalog.bed,
    personalChest: catalog.personalChest,
    storageAccess: "personal",
  });
}
