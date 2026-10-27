import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOME_CLAIM_REACH_BLOCKS,
  evaluateClaimHomeAction,
  isCatalogHomeFurniture,
  listAvailableHomes,
  nearestClaimableHome,
  persistCitizenHomeClaim,
  WORLD_LAB_CLAIMABLE_HOMES,
} from "./available-homes.js";
import { CivilizationStore } from "./store.js";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "civ-homes-avail-")), "test.sqlite");
}

const h1 = WORLD_LAB_CLAIMABLE_HOMES.find((home) => home.id === "home_h1")!;
const h9 = WORLD_LAB_CLAIMABLE_HOMES.find((home) => home.id === "home_h9")!;

describe("available WORLD-LAB homes", () => {
  it("picks the nearest unclaimed house, not H1 by default", () => {
    expect(nearestClaimableHome(h9.origin, WORLD_LAB_CLAIMABLE_HOMES)?.id).toBe("home_h9");
    expect(nearestClaimableHome(h1.origin, WORLD_LAB_CLAIMABLE_HOMES)?.id).toBe("home_h1");
    expect(nearestClaimableHome({ x: -1043, y: 63, z: 980 }, WORLD_LAB_CLAIMABLE_HOMES, HOME_CLAIM_REACH_BLOCKS)).toBeUndefined();
  });

  it("persists a citizen-chosen home for that citizen in the given sqlite", () => {
    const path = tempPath();
    const store = new CivilizationStore(path);
    const claimed = persistCitizenHomeClaim(store, "citizen_kai", "home_h9");
    expect(claimed.success).toBe(true);
    if (!claimed.success) throw new Error(claimed.error);
    expect(claimed.data.home.id).toBe("home_h9");
    expect(store.getCitizen("citizen_kai")?.homeId).toBe("home_h9");
    expect(store.getCitizen("citizen_atlas")?.homeId).toBeUndefined();
    expect(listAvailableHomes(store).some((home) => home.id === "home_h9")).toBe(false);
    expect(listAvailableHomes(store).some((home) => home.id === "home_h1")).toBe(true);
    store.close();

    const restored = new CivilizationStore(path);
    expect(restored.getCitizenHome("citizen_kai")?.homeId).toBe("home_h9");
    expect(restored.getCitizenHome("citizen_atlas")).toBeUndefined();
    restored.close();
  });

  it("refuses TEST_CONTROL identities and does not assign H1 to Atlas", () => {
    const store = new CivilizationStore(tempPath());
    expect(persistCitizenHomeClaim(store, "probe_home", "home_h1").success).toBe(false);
    expect(persistCitizenHomeClaim(store, "HomeProbe", "home_h1").success).toBe(false);
    expect(store.getCitizenHome("citizen_atlas")).toBeUndefined();
    expect(store.getCitizenHome("citizen_kai")).toBeUndefined();
    store.close();
  });

  it("returns CLAIM_CONFLICT when a second citizen tries the same house", () => {
    const store = new CivilizationStore(tempPath());
    expect(persistCitizenHomeClaim(store, "citizen_kai", "home_h2").success).toBe(true);
    const clash = persistCitizenHomeClaim(store, "citizen_atlas", "home_h2");
    expect(clash.success).toBe(false);
    if (clash.success) throw new Error("expected conflict");
    expect(clash.code).toBe("CLAIM_CONFLICT");
    expect(store.getCitizenHome("citizen_atlas")).toBeUndefined();
    store.close();
  });

  it("treats audited beds and doors as catalog furniture, not claims", () => {
    expect(isCatalogHomeFurniture({ x: -1097, y: 69, z: 728 })).toBe(true);
    expect(isCatalogHomeFurniture({ x: -1096, y: 69, z: 731 })).toBe(true);
    expect(isCatalogHomeFurniture({ x: -1042, y: 63, z: 980 })).toBe(false);
  });

  it("refuses a claim from the pond and accepts a claim standing at H9", () => {
    const store = new CivilizationStore(tempPath());
    const far = evaluateClaimHomeAction({
      store,
      citizenId: "citizen_atlas",
      homeId: "home_h9",
      position: { x: -1043.5, y: 63, z: 981.5 },
    });
    expect(far.success).toBe(false);
    if (far.success) throw new Error("expected unreachable");
    expect(far.code).toBe("TARGET_UNREACHABLE");
    const near = evaluateClaimHomeAction({
      store,
      citizenId: "citizen_atlas",
      homeId: "home_h9",
      position: { x: -1061, y: 68, z: 847 },
    });
    expect(near.success).toBe(true);
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h9");
    const taken = evaluateClaimHomeAction({
      store,
      citizenId: "citizen_kai",
      homeId: "home_h9",
      position: { x: -1061, y: 68, z: 847 },
    });
    expect(taken.success).toBe(false);
    if (taken.success) throw new Error("expected conflict");
    expect(taken.code).toBe("CLAIM_CONFLICT");
    store.close();
  });
});
