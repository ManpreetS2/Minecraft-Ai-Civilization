import { describe, expect, it } from "vitest";
import { fail, ok } from "@civ/shared";
import { physicalWorkComplete } from "./task-recovery.js";
import {
  HOME_CLAIM_REACH_BLOCKS,
  evaluateClaimHomeAction,
  WORLD_LAB_CLAIMABLE_HOMES,
} from "./available-homes.js";
import {
  ATLAS_POND_LAST_POS,
  catalogHomeDistance,
  housingOpportunity,
  housingTravelTarget,
  nearestEligibleHome,
  travelTowardHousingResult,
} from "./home-discovery.js";
import { CivilizationStore } from "./store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempStore(): CivilizationStore {
  return new CivilizationStore(join(mkdtempSync(join(tmpdir(), "civ-home-disc-")), "test.sqlite"));
}

const pond = ATLAS_POND_LAST_POS;
const h9 = WORLD_LAB_CLAIMABLE_HOMES.find((home) => home.id === "home_h9")!;
const h5 = WORLD_LAB_CLAIMABLE_HOMES.find((home) => home.id === "home_h5")!;

const farWest = {
  id: "home_west",
  origin: { x: -1200, y: 68, z: 700 },
  entrance: { x: -1198, y: 68, z: 700 },
  bed: { x: -1201, y: 68, z: 699 },
  personalChest: { x: -1200, y: 68, z: 701 },
};
const nearerSouth = {
  id: "home_south",
  origin: { x: -1043, y: 63, z: 900 },
  entrance: { x: -1041, y: 63, z: 900 },
  bed: { x: -1044, y: 63, z: 899 },
  personalChest: { x: -1043, y: 63, z: 901 },
};

describe("housing discovery vs claim reach", () => {
  it("treats the fishing pond as travel, not a claim, for the Site C catalog", () => {
    const opportunity = housingOpportunity(pond, WORLD_LAB_CLAIMABLE_HOMES);
    expect(opportunity.kind).toBe("travel");
    if (opportunity.kind !== "travel") throw new Error("expected travel");
    expect(opportunity.distance).toBeGreaterThan(HOME_CLAIM_REACH_BLOCKS);
    expect(opportunity.home.id).toBe(nearestEligibleHome(pond, WORLD_LAB_CLAIMABLE_HOMES)?.id);
    expect(opportunity.home.id).not.toBe("home_h1");
    expect(catalogHomeDistance(pond, h9)).toBeGreaterThan(HOME_CLAIM_REACH_BLOCKS);
  });

  it("picks the nearest eligible house as a walk destination, not hardcoded H9", () => {
    const opportunity = housingOpportunity(pond, [farWest, nearerSouth]);
    expect(opportunity.kind).toBe("travel");
    if (opportunity.kind !== "travel") throw new Error("expected travel");
    expect(opportunity.home.id).toBe("home_south");
    expect(opportunity.home.id).not.toBe("home_west");
    expect(opportunity.distance).toBeGreaterThan(HOME_CLAIM_REACH_BLOCKS);
    expect(housingTravelTarget(opportunity.home)).toEqual(nearerSouth.entrance);
  });

  it("switches to claim once the body is inside HOME_CLAIM_REACH", () => {
    const opportunity = housingOpportunity(h9.origin, WORLD_LAB_CLAIMABLE_HOMES);
    expect(opportunity.kind).toBe("claim");
    if (opportunity.kind !== "claim") throw new Error("expected claim");
    expect(opportunity.home.id).toBe("home_h9");
    expect(opportunity.distance).toBeLessThanOrEqual(HOME_CLAIM_REACH_BLOCKS);
  });

  it("reports no-house-found when the catalog is empty", () => {
    expect(housingOpportunity(pond, []).kind).toBe("none");
    expect(housingOpportunity(pond, undefined).kind).toBe("none");
    expect(housingOpportunity(undefined, WORLD_LAB_CLAIMABLE_HOMES).kind).toBe("none");
  });
});

describe("travelTowardHousingResult does not persist a claim", () => {
  it("keeps workComplete false after a successful approach still outside claim reach", () => {
    const result = travelTowardHousingResult({
      home: h9,
      position: { x: -1043, y: 63, z: 920 },
      moved: ok({ position: { x: -1043, y: 63, z: 920 }, distance: 40 }, 12),
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.claimed).toBe(false);
    expect(result.data.workComplete).toBe(false);
    expect(result.data.inClaimReach).toBe(false);
    expect(result.data.homeId).toBe("home_h9");
    expect(physicalWorkComplete(result)).toBe(false);
  });

  it("marks inClaimReach after arrival without writing sqlite", () => {
    const store = tempStore();
    const result = travelTowardHousingResult({
      home: h9,
      position: { x: -1063, y: 68, z: 847 },
      moved: ok({ position: { x: -1063, y: 68, z: 847 }, distance: 1 }, 8),
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.inClaimReach).toBe(true);
    expect(result.data.claimed).toBe(false);
    expect(store.getCitizenHome("citizen_atlas")).toBeUndefined();
    store.close();
  });

  it("forwards a blocked route without claiming a fallback house", () => {
    const result = travelTowardHousingResult({
      home: h9,
      position: pond,
      moved: fail("HAZARD_BLOCKED", "rooftop drop", 4, true, { homeId: "home_h9" }),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.code).toBe("HAZARD_BLOCKED");
    expect(result.details?.claimed).toBe(false);
    expect(result.details?.homeId).toBe("home_h9");
  });
});

describe("homeless/out-of-range -> travel -> in-range claim", () => {
  it("refuses claimHome from the pond, then persists the citizen-selected house in reach", () => {
    const store = tempStore();
    const fromPond = evaluateClaimHomeAction({
      store,
      citizenId: "citizen_atlas",
      homeId: h9.id,
      position: pond,
    });
    expect(fromPond.success).toBe(false);
    if (fromPond.success) throw new Error("pond must not claim");
    expect(fromPond.code).toBe("TARGET_UNREACHABLE");
    expect(store.getCitizenHome("citizen_atlas")).toBeUndefined();

    const approached = travelTowardHousingResult({
      home: h9,
      position: { x: -1061, y: 68, z: 847 },
      moved: ok({ position: { x: -1061, y: 68, z: 847 }, distance: 2 }, 20),
    });
    expect(approached.success).toBe(true);
    if (!approached.success) throw new Error(approached.error);
    expect(approached.data.inClaimReach).toBe(true);
    expect(approached.data.claimed).toBe(false);

    const claimed = evaluateClaimHomeAction({
      store,
      citizenId: "citizen_atlas",
      homeId: h9.id,
      position: { x: -1061, y: 68, z: 847 },
    });
    expect(claimed.success).toBe(true);
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h9");
    store.close();
  });

  it("does not grant the next house after a blocked path until that house is chosen in range", () => {
    expect(housingOpportunity(pond, [h9]).kind).toBe("travel");
    expect(housingOpportunity(pond, [h5]).kind).toBe("travel");
    if (housingOpportunity(pond, [h5]).kind !== "travel") throw new Error("h5 still a walk");
    expect(evaluateClaimHomeAction({
      store: tempStore(),
      citizenId: "citizen_atlas",
      homeId: h5.id,
      position: pond,
    }).success).toBe(false);
  });
});
