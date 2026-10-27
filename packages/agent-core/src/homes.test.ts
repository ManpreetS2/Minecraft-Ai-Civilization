import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CivilizationStore } from "./store.js";
import {
  assertChestAccess,
  claimHome,
  leaveHome,
  markHomeInaccessible,
  resolveHomeSleepTarget,
  resolveStorageTarget,
} from "./homes.js";

function tempStore(): CivilizationStore {
  const dir = mkdtempSync(join(tmpdir(), "civ-home-"));
  return new CivilizationStore(join(dir, "test.sqlite"));
}

const origin = { x: -1089, y: 68, z: 817 };
const entrance = { x: -1086, y: 68, z: 816 };
const bedA = { x: -1089, y: 68, z: 817 };
const bedB = { x: -1087, y: 68, z: 817 };
const chestA = { x: -1088, y: 68, z: 815 };
const chestB = { x: -1086, y: 68, z: 815 };
const householdChest = { x: -1085, y: 68, z: 815 };
const communal = { x: -1038, y: 65, z: 839 };

describe("persistent citizen-chosen homes", () => {
  it("claims a home and restores it after reopen (reconnect/restart)", () => {
    const path = join(mkdtempSync(join(tmpdir(), "civ-home-reopen-")), "test.sqlite");
    const store = new CivilizationStore(path);
    const claimed = claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin,
      entrance,
      bed: bedA,
      personalChest: chestA,
      storageAccess: "personal",
    });
    expect(claimed.success).toBe(true);
    if (!claimed.success) throw new Error(claimed.error);
    expect(claimed.data.home.id).toBe("home_h7");
    expect(store.getCitizen("citizen_atlas")?.homeId).toBe("home_h7");
    store.close();

    const restored = new CivilizationStore(path);
    const home = restored.getCitizenHome("citizen_atlas");
    expect(home?.homeId).toBe("home_h7");
    expect(home?.bed).toEqual(bedA);
    expect(home?.personalChest).toEqual(chestA);
    expect(home?.entrance).toEqual(entrance);
    expect(home?.status).toBe("active");
    restored.close();
  });

  it("does not assign houses by roster order", () => {
    const store = tempStore();
    const maya = claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_h9",
      origin: { x: -1067, y: 68, z: 848 },
      bed: { x: -1067, y: 68, z: 848 },
      personalChest: { x: -1066, y: 68, z: 847 },
    });
    const atlas = claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h2",
      origin: { x: -1056, y: 68, z: 756 },
      bed: { x: -1056, y: 68, z: 756 },
      personalChest: { x: -1057, y: 68, z: 755 },
    });
    expect(maya.success && atlas.success).toBe(true);
    expect(store.getCitizenHome("citizen_maya")?.homeId).toBe("home_h9");
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h2");
    store.close();
  });

  it("prevents exclusive bed and personal-chest conflicts", () => {
    const store = tempStore();
    expect(
      claimHome(store, {
        citizenId: "citizen_atlas",
        homeId: "home_shared_try",
        origin,
        bed: bedA,
        personalChest: chestA,
      }).success,
    ).toBe(true);
    const bedClash = claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_other",
      origin,
      bed: bedA,
      personalChest: chestB,
    });
    expect(bedClash.success).toBe(false);
    if (bedClash.success) throw new Error("bed clash should fail");
    expect(bedClash.code).toBe("CLAIM_CONFLICT");

    const chestClash = claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_other",
      origin,
      bed: bedB,
      personalChest: chestA,
    });
    expect(chestClash.success).toBe(false);
    if (chestClash.success) throw new Error("chest clash should fail");
    expect(chestClash.code).toBe("CLAIM_CONFLICT");
    store.close();
  });

  it("allows two consenting residents in one house with separate beds and chests", () => {
    const store = tempStore();
    const first = claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin,
      entrance,
      bed: bedA,
      personalChest: chestA,
      householdChest,
    });
    const second = claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_h7",
      origin,
      entrance,
      bed: bedB,
      personalChest: chestB,
      householdChest,
    });
    expect(first.success && second.success).toBe(true);
    const members = store.listHomeMembers("home_h7").map((row) => row.citizenId);
    expect(members).toEqual(["citizen_atlas", "citizen_maya"]);
    expect(store.getCitizenHome("citizen_atlas")?.bed).toEqual(bedA);
    expect(store.getCitizenHome("citizen_maya")?.bed).toEqual(bedB);
    expect(store.getCitizenHome("citizen_atlas")?.personalChest).toEqual(chestA);
    expect(store.getCitizenHome("citizen_maya")?.personalChest).toEqual(chestB);
    store.close();
  });

  it("separates personal, household, and communal storage access", () => {
    const store = tempStore();
    const settlement = store.getSettlement();
    settlement.storage = communal;
    store.saveSettlement(settlement);
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin,
      bed: bedA,
      personalChest: chestA,
      householdChest,
    });
    claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_h7",
      origin,
      bed: bedB,
      personalChest: chestB,
      householdChest,
    });

    expect(assertChestAccess(store, "citizen_atlas", chestA, "personal").success).toBe(true);
    const stolen = assertChestAccess(store, "citizen_maya", chestA, "personal");
    expect(stolen.success).toBe(false);
    if (stolen.success) throw new Error("maya must not use atlas personal chest");
    expect(stolen.code).toBe("ACCESS_DENIED");

    expect(assertChestAccess(store, "citizen_maya", householdChest, "household").success).toBe(true);
    const outsider = assertChestAccess(store, "citizen_theo", householdChest, "household");
    expect(outsider.success).toBe(false);
    if (outsider.success) throw new Error("theo is not in the household");
    expect(outsider.code).toBe("ACCESS_DENIED");

    expect(resolveStorageTarget(store, "citizen_atlas", "communal").success).toBe(true);
    const atlasPersonal = resolveStorageTarget(store, "citizen_atlas", "personal");
    const mayaPersonal = resolveStorageTarget(store, "citizen_maya", "personal");
    expect(atlasPersonal.success).toBe(true);
    expect(mayaPersonal.success).toBe(true);
    if (atlasPersonal.success) expect(atlasPersonal.data.position).toEqual(chestA);
    if (mayaPersonal.success) expect(mayaPersonal.data.position).toEqual(chestB);
    store.close();
  });

  it("reports a missing home without silently reassigning ownership", () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin,
      bed: bedA,
      personalChest: chestA,
    });
    const displaced = markHomeInaccessible(store, "citizen_atlas", "bed_missing");
    expect(displaced.success).toBe(true);
    const home = store.getCitizenHome("citizen_atlas");
    expect(home?.status).toBe("displaced");
    expect(home?.homeId).toBe("home_h7");
    expect(home?.bed).toEqual(bedA);

    const sleep = resolveHomeSleepTarget(store, "citizen_atlas");
    expect(sleep.success).toBe(false);
    if (sleep.success) throw new Error("displaced home must not sleep as if valid");
    expect(sleep.code).toBe("HOME_INACCESSIBLE");

    const silent = claimHome(store, {
      citizenId: "citizen_atlas",
      origin: { x: 0, y: 64, z: 0 },
      bed: { x: 1, y: 64, z: 1 },
      personalChest: { x: 2, y: 64, z: 2 },
    });
    expect(silent.success).toBe(false);
    if (silent.success) throw new Error("must not overwrite without move=true");
    expect(silent.code).toBe("CLAIM_CONFLICT");
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h7");

    const moved = claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h3",
      origin: { x: -1056, y: 67, z: 768 },
      bed: { x: -1056, y: 67, z: 768 },
      personalChest: { x: -1057, y: 67, z: 767 },
      move: true,
    });
    expect(moved.success).toBe(true);
    expect(store.getCitizenHome("citizen_atlas")?.homeId).toBe("home_h3");
    store.close();
  });

  it("keeps home through respawn-style status upsert", () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_ava",
      homeId: "home_h4",
      origin: { x: -1055, y: 65, z: 779 },
      bed: { x: -1055, y: 65, z: 779 },
      personalChest: { x: -1056, y: 65, z: 778 },
    });
    const ava = store.getCitizen("citizen_ava");
    if (!ava) throw new Error("missing Ava");
    ava.status = "respawning";
    ava.reason = "body died; waiting to respawn";
    ava.homeId = undefined;
    store.upsertCitizen(ava);
    expect(store.getCitizen("citizen_ava")?.homeId).toBe("home_h4");
    expect(store.getCitizenHome("citizen_ava")?.bed).toEqual({ x: -1055, y: 65, z: 779 });
    ava.status = "online";
    ava.reason = "respawned; replanning";
    store.upsertCitizen(ava);
    expect(store.getCitizenHome("citizen_ava")?.homeId).toBe("home_h4");
    store.close();
  });

  it("leaveHome clears association without deleting the house record for remaining members", () => {
    const store = tempStore();
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin,
      bed: bedA,
      personalChest: chestA,
    });
    claimHome(store, {
      citizenId: "citizen_maya",
      homeId: "home_h7",
      origin,
      bed: bedB,
      personalChest: chestB,
    });
    expect(leaveHome(store, "citizen_atlas").success).toBe(true);
    expect(store.getCitizenHome("citizen_atlas")).toBeUndefined();
    expect(store.getCitizen("citizen_atlas")?.homeId).toBeUndefined();
    expect(store.getCitizenHome("citizen_maya")?.homeId).toBe("home_h7");
    expect(store.getHome("home_h7")?.origin).toEqual(origin);
    store.close();
  });
});
