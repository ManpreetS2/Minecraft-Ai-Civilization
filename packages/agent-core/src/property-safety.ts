/**
 * RED property / discovery rules.
 *
 * GREEN: call refuseAccidentalPropertyBreak from mine/gather and
 * refuseAccidentalPropertyReplace from place. Do not retune mining search.
 * BLUE: ordinary navigation already uses canDig=false and
 * isProtectedFromPathfinder; this phase does not edit pathing.ts.
 *
 * Seeing a house, chest, bed, door, shore, or ore cell is knowledge.
 * It is not permission to use or destroy that block.
 */
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { refuseAccidentalPropertyBreak, refuseAccidentalPropertyReplace } from "@civ/minecraft-knowledge";
import {
  isCatalogHomeFurniture,
  isCatalogPersonalChest,
  WORLD_LAB_CLAIMABLE_HOMES,
} from "./available-homes.js";
import { assertChestAccess, sameCell, type StorageAccess } from "./homes.js";
import type { CivilizationStore } from "./store.js";
import { isDesignatedCommunalChest, isTestFixtureChest, TEST_FIXTURE_CHESTS } from "./test-fixtures.js";
import { usableSettlementChest } from "./workstations.js";

export type PlaceKnowledgeKind =
  | "observed"
  | "catalog_option"
  | "persisted_claim"
  | "designated_communal"
  | "test_fixture";

export type ChestAccessClass =
  | "personal"
  | "household"
  | "communal"
  | "unclaimed_catalog"
  | "test_fixture"
  | "unknown_observed";

export type ChestKnowledge = {
  kind: PlaceKnowledgeKind;
  access: ChestAccessClass;
  ownerId?: string;
  homeId?: string;
};

export function classifyChestKnowledge(
  store: CivilizationStore,
  position: Vec3,
): ChestKnowledge {
  if (isTestFixtureChest(position)) {
    return { kind: "test_fixture", access: "test_fixture" };
  }
  const settlement = store.getSettlement();
  const designated =
    Boolean(settlement.storage && sameCell(settlement.storage, position) && usableSettlementChest(store, position)) ||
    isDesignatedCommunalChest(position);
  if (designated) {
    const granted = Boolean(
      settlement.storage && sameCell(settlement.storage, position) && usableSettlementChest(store, position),
    );
    return { kind: "designated_communal", access: granted ? "communal" : "unknown_observed" };
  }
  const personalOwner = store.personalChestOwner(position);
  if (personalOwner) {
    const home = store.getCitizenHome(personalOwner);
    return {
      kind: "persisted_claim",
      access: "personal",
      ownerId: personalOwner,
      homeId: home?.homeId,
    };
  }
  const catalog = WORLD_LAB_CLAIMABLE_HOMES.find((home) => sameCell(home.personalChest, position));
  if (catalog) {
    return { kind: "catalog_option", access: "unclaimed_catalog", homeId: catalog.id };
  }
  return { kind: "observed", access: "unknown_observed" };
}

/**
 * Use-permission. Catalog options and TEST_CONTROL fixtures are never granted
 * just because the block is in view or in a handoff document.
 */
export function assertMayUseChest(
  store: CivilizationStore,
  citizenId: string | undefined,
  position: Vec3,
  purpose: StorageAccess = "communal",
): ActionResult<{ position: Vec3; access: StorageAccess; knowledge: ChestKnowledge }> {
  const knowledge = classifyChestKnowledge(store, position);
  if (knowledge.access === "test_fixture") {
    return fail(
      "ACCESS_DENIED",
      "BLOCKED: TEST_CONTROL fixture chest; knowing the coordinate is not citizen permission",
      0,
      false,
      { position, knowledge },
    );
  }
  if (knowledge.access === "unclaimed_catalog") {
    return fail(
      "ACCESS_DENIED",
      "BLOCKED: unclaimed house chest is not communal storage; claim the house first",
      0,
      false,
      { position, knowledge },
    );
  }
  if (knowledge.access === "personal" && knowledge.ownerId && knowledge.ownerId !== citizenId) {
    return fail(
      "ACCESS_DENIED",
      "BLOCKED: cannot use another citizen's personal chest",
      0,
      false,
      { position, knowledge, ownerId: knowledge.ownerId },
    );
  }
  if (purpose === "communal" && !usableSettlementChest(store, position)) {
    return fail(
      "ACCESS_DENIED",
      "BLOCKED: that chest is not designated communal storage",
      0,
      false,
      { position, knowledge },
    );
  }
  const access = assertChestAccess(store, citizenId, position, purpose);
  if (!access.success) return access;
  return ok({ position: access.data.position, access: access.data.access, knowledge }, 0);
}

export type BreakIntent = {
  name?: string;
  position: Vec3;
  /** True when the dig is only to expose a different resource (ore behind a chest). */
  towardResource?: boolean;
};

export function assertMayBreakBlock(
  store: CivilizationStore | undefined,
  intent: BreakIntent,
): ActionResult<{ position: Vec3 }> {
  const nameDenied = refuseAccidentalPropertyBreak(intent.name);
  if (!nameDenied.ok) {
    return fail(nameDenied.code, nameDenied.error, 0, false, { position: intent.position, towardResource: intent.towardResource });
  }
  if (isTestFixtureChest(intent.position)) {
    return fail(
      "ACCESS_DENIED",
      "BLOCKED: refusing to break a TEST_CONTROL fixture chest, including to reach ore",
      0,
      false,
      { position: intent.position },
    );
  }
  if (isCatalogHomeFurniture(intent.position) || isCatalogPersonalChest(intent.position)) {
    return fail(
      "ACCESS_DENIED",
      "BLOCKED: refusing to break catalog house furniture; unclaimed buildings are not free materials",
      0,
      false,
      { position: intent.position },
    );
  }
  if (store) {
    if (store.personalChestOwner(intent.position) || store.bedClaimOwner(intent.position)) {
      return fail(
        "ACCESS_DENIED",
        "BLOCKED: refusing to break claimed personal property",
        0,
        false,
        { position: intent.position },
      );
    }
  }
  return ok({ position: intent.position }, 0);
}

export function assertMayPlaceOver(existingName: string | undefined, position: Vec3): ActionResult<{ position: Vec3 }> {
  const denied = refuseAccidentalPropertyReplace(existingName);
  if (!denied.ok) {
    return fail(denied.code, denied.error, 0, false, { position, existingName });
  }
  if (isTestFixtureChest(position) || isCatalogHomeFurniture(position)) {
    return fail(
      "ACCESS_DENIED",
      "BLOCKED: refusing to place over protected house or TEST_CONTROL furniture",
      0,
      false,
      { position },
    );
  }
  return ok({ position }, 0);
}

/**
 * Skip cells while searching for a work block. Does not grant use of the
 * skipped chest; it only prevents adopting it as "the nearest chest".
 */
export function skipProtectedPropertyCell(store: CivilizationStore, position: Vec3): boolean {
  if (isTestFixtureChest(position)) return true;
  if (isCatalogHomeFurniture(position)) return true;
  if (store.isClaimedPersonalChest(position)) return true;
  if (store.bedClaimOwner(position)) return true;
  return false;
}

export function testFixtureChestList(): readonly Vec3[] {
  return TEST_FIXTURE_CHESTS;
}

export { isProtectedFurnitureName, refuseAccidentalPropertyBreak, refuseAccidentalPropertyReplace } from "@civ/minecraft-knowledge";
