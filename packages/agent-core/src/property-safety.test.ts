import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { persistCitizenHomeClaim } from "./available-homes.js";
import { claimHome } from "./homes.js";
import { CivilizationStore } from "./store.js";
import { WORLD_LAB_COMMUNAL_CHEST } from "./test-fixtures.js";
import {
  assertMayBreakBlock,
  assertMayPlaceOver,
  assertMayUseChest,
  classifyChestKnowledge,
  skipProtectedPropertyCell,
} from "./property-safety.js";

function tempStore(): CivilizationStore {
  return new CivilizationStore(join(mkdtempSync(join(tmpdir(), "civ-prop-")), "test.sqlite"));
}

const kaiChest = { x: -1042, y: 63, z: 980 };
const atlasPondChest = { x: -1042, y: 63, z: 982 };
const mineChest = { x: -954, y: 58, z: 944 };
const h1Chest = { x: -1096, y: 69, z: 729 };
const h1Bed = { x: -1097, y: 69, z: 728 };
const h9Chest = { x: -1066, y: 68, z: 847 };
const coalBesideChest = { x: -1041, y: 63, z: 980 };

describe("property access and destruction", () => {
  it("denies accessing another citizen's personal chest", () => {
    const store = tempStore();
    expect(persistCitizenHomeClaim(store, "citizen_kai", "home_h1").success).toBe(true);
    const knowledge = classifyChestKnowledge(store, h1Chest);
    expect(knowledge.kind).toBe("persisted_claim");
    expect(knowledge.access).toBe("personal");
    expect(knowledge.ownerId).toBe("citizen_kai");

    const owner = assertMayUseChest(store, "citizen_kai", h1Chest, "personal");
    expect(owner.success).toBe(true);

    const stolen = assertMayUseChest(store, "citizen_atlas", h1Chest, "personal");
    expect(stolen.success).toBe(false);
    if (stolen.success) throw new Error("atlas must not open kai chest");
    expect(stolen.code).toBe("ACCESS_DENIED");
    expect(stolen.error).toMatch(/another citizen|personal/i);

    const stolenCommunal = assertMayUseChest(store, "citizen_atlas", h1Chest, "communal");
    expect(stolenCommunal.success).toBe(false);
    if (stolenCommunal.success) throw new Error("personal chest is not communal");
    expect(stolenCommunal.code).toBe("ACCESS_DENIED");
    store.close();
  });

  it("refuses breaking a protected chest to reach ore", () => {
    const store = tempStore();
    const byName = assertMayBreakBlock(store, {
      name: "chest",
      position: coalBesideChest,
      towardResource: true,
    });
    expect(byName.success).toBe(false);
    if (byName.success) throw new Error("must not break chest for ore");
    expect(byName.code).toBe("ACCESS_DENIED");

    const fixture = assertMayBreakBlock(store, {
      name: "stone",
      position: kaiChest,
      towardResource: true,
    });
    expect(fixture.success).toBe(false);
    if (fixture.success) throw new Error("must not break fixture chest");
    expect(fixture.code).toBe("ACCESS_DENIED");

    const ore = assertMayBreakBlock(store, { name: "coal_ore", position: { x: -954, y: 58, z: 943 } });
    expect(ore.success).toBe(true);
    store.close();
  });

  it("treats unclaimed catalog houses as options, not free storage or materials", () => {
    const store = tempStore();
    expect(classifyChestKnowledge(store, h1Chest).access).toBe("unclaimed_catalog");
    expect(classifyChestKnowledge(store, h1Chest).kind).toBe("catalog_option");

    const use = assertMayUseChest(store, "citizen_atlas", h1Chest, "communal");
    expect(use.success).toBe(false);
    if (use.success) throw new Error("unclaimed house chest is not communal");
    expect(use.code).toBe("ACCESS_DENIED");
    expect(use.error).toMatch(/unclaimed/i);

    const smashChest = assertMayBreakBlock(store, { name: "chest", position: h1Chest });
    expect(smashChest.success).toBe(false);
    const smashBed = assertMayBreakBlock(store, { name: "yellow_bed", position: h1Bed });
    expect(smashBed.success).toBe(false);
    const smashDoor = assertMayBreakBlock(store, { name: "oak_door", position: { x: -1096, y: 69, z: 731 } });
    expect(smashDoor.success).toBe(false);

    expect(skipProtectedPropertyCell(store, h1Chest)).toBe(true);
    expect(skipProtectedPropertyCell(store, h9Chest)).toBe(true);

    const claimed = persistCitizenHomeClaim(store, "citizen_atlas", "home_h1");
    expect(claimed.success).toBe(true);
    expect(assertMayUseChest(store, "citizen_atlas", h1Chest, "personal").success).toBe(true);
    expect(assertMayUseChest(store, "citizen_kai", h1Chest, "personal").success).toBe(false);
    store.close();
  });

  it("allows genuinely designated communal storage", () => {
    const store = tempStore();
    const settlement = store.getSettlement();
    settlement.storage = WORLD_LAB_COMMUNAL_CHEST;
    store.saveSettlement(settlement);

    expect(classifyChestKnowledge(store, WORLD_LAB_COMMUNAL_CHEST).access).toBe("communal");
    expect(classifyChestKnowledge(store, WORLD_LAB_COMMUNAL_CHEST).kind).toBe("designated_communal");

    const shared = assertMayUseChest(store, "citizen_atlas", WORLD_LAB_COMMUNAL_CHEST, "communal");
    expect(shared.success).toBe(true);
    if (!shared.success) throw new Error(shared.error);
    expect(shared.data.access).toBe("communal");

    expect(skipProtectedPropertyCell(store, WORLD_LAB_COMMUNAL_CHEST)).toBe(false);
    const smashShared = assertMayBreakBlock(store, { name: "chest", position: WORLD_LAB_COMMUNAL_CHEST });
    expect(smashShared.success).toBe(false);
    if (smashShared.success) throw new Error("communal use is not permission to break");
    store.close();
  });

  it("denies TEST_CONTROL fixture chests for use, skip, and break", () => {
    const store = tempStore();
    const settlement = store.getSettlement();
    settlement.storage = kaiChest;
    store.saveSettlement(settlement);

    for (const fixture of [kaiChest, atlasPondChest, mineChest]) {
      expect(classifyChestKnowledge(store, fixture).kind).toBe("test_fixture");
      const use = assertMayUseChest(store, "citizen_kai", fixture, "communal");
      expect(use.success).toBe(false);
      if (use.success) throw new Error("fixture must be denied");
      expect(use.code).toBe("ACCESS_DENIED");
      expect(use.error).toMatch(/TEST_CONTROL|fixture/i);
      expect(skipProtectedPropertyCell(store, fixture)).toBe(true);
      expect(assertMayBreakBlock(store, { name: "oak_planks", position: fixture }).success).toBe(false);
    }
    store.close();
  });

  it("refuses placing over a bed, door, or chest", () => {
    const overBed = assertMayPlaceOver("yellow_bed", h1Bed);
    expect(overBed.success).toBe(false);
    if (overBed.success) throw new Error("must not place over bed");
    expect(overBed.code).toBe("ACCESS_DENIED");
    expect(assertMayPlaceOver("oak_door", { x: -1096, y: 69, z: 731 }).success).toBe(false);
    expect(assertMayPlaceOver("chest", kaiChest).success).toBe(false);
    expect(assertMayPlaceOver("air", { x: 0, y: 64, z: 0 }).success).toBe(true);
  });

  it("does not treat a household outsider as a roommate", () => {
    const store = tempStore();
    const householdChest = { x: -1085, y: 68, z: 815 };
    claimHome(store, {
      citizenId: "citizen_atlas",
      homeId: "home_h7",
      origin: { x: -1089, y: 68, z: 817 },
      bed: { x: -1089, y: 68, z: 817 },
      personalChest: { x: -1088, y: 68, z: 815 },
      householdChest,
    });
    const outsider = assertMayUseChest(store, "citizen_theo", householdChest, "household");
    expect(outsider.success).toBe(false);
    if (outsider.success) throw new Error("theo is not in the household");
    expect(outsider.code).toBe("ACCESS_DENIED");
    store.close();
  });
});
