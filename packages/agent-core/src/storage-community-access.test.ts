import { afterEach, describe, expect, it } from "vitest";
import { CivilizationStore } from "./store.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
import { assertChestAccess } from "./homes.js";
import { assertMayUseChest } from "./property-safety.js";
import { persistCitizenHomeClaim } from "./available-homes.js";
import { WORLD_LAB_COMMUNAL_CHEST } from "./test-fixtures.js";
const stores: CivilizationStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) if (s.isOpen()) s.close(); });
const pos = { x: 12, y: 64, z: 8 };
const audit = { actor: "orchestrator-config" as const, reason: "disposable storage authorization fixture" };
function setup() {
  const s = new CivilizationStore(":memory:"); stores.push(s);
  s.upsertCommunity("north", "North", audit); s.upsertCommunity("south", "South", audit);
  s.addCommunityMember("north", "citizen_atlas", audit); s.addCommunityMember("north", "citizen_maya", audit); s.addCommunityMember("south", "citizen_theo", audit);
  const legacy = s.getSettlement(); legacy.storage = pos; legacy.storageContents = { diamond: 64 }; s.saveSettlement(legacy);
  return s;
}
describe("community chest use requires actor and explicit scoped authorization", () => {
  it.each(["citizen_atlas", "citizen_maya", "citizen_theo", undefined])("does not authorize %s from the global legacy storage row", (id) => {
    const s = setup();
    expect(assertChestAccess(s, id, pos, "communal").success).toBe(false);
    expect(assertMayUseChest(s, id, pos, "communal").success).toBe(false);
  });
  it("allows owned or explicitly granted storage without inheriting legacy inventory or team permission", () => {
    const s = setup(); const own = communityPhysicalState(s).forCitizen("citizen_atlas");
    own.registerAsset("chest", "overworld", pos);
    expect(assertChestAccess(s, "citizen_atlas", pos, "communal", "overworld").success).toBe(true);
    expect(assertMayUseChest(s, "citizen_atlas", pos, "communal", "overworld").success).toBe(true);
    expect(assertChestAccess(s, "citizen_maya", pos, "communal", "overworld").success).toBe(false);
    expect(assertChestAccess(s, "citizen_theo", pos, "communal", "overworld").success).toBe(false);
    own.grantAsset(physicalBlockKey("overworld", pos), "citizen_maya");
    expect(assertMayUseChest(s, "citizen_maya", pos, "communal", "overworld").success).toBe(true);
    own.revokeAsset(physicalBlockKey("overworld", pos), "citizen_maya");
    expect(assertMayUseChest(s, "citizen_maya", pos, "communal", "overworld").success).toBe(false);
    expect(s.getSettlement().storageContents).toEqual({ diamond: 64 }); // No implied transfer or rewrite.
  });
  it("refuses unbound or different dimensions even when a grant exists", () => {
    const s = setup(); communityPhysicalState(s).forCitizen("citizen_atlas").registerAsset("chest", "overworld", pos);
    expect(assertChestAccess(s, "citizen_atlas", pos, "communal").success).toBe(false);
    expect(assertChestAccess(s, "citizen_atlas", pos, "communal", "the_nether").success).toBe(false);
    expect(assertChestAccess(s, "citizen_atlas", pos, "communal", "minecraft:overworld").success).toBe(true);
  });
  it("does not reveal another citizen's private home owner in refusal payloads", () => {
    const s = setup(); expect(persistCitizenHomeClaim(s, "citizen_atlas", "home_h1").success).toBe(true);
    const chest = s.getCitizenHome("citizen_atlas")!.personalChest!;
    const refusal = assertChestAccess(s, "citizen_theo", chest, "personal");
    expect(refusal.success).toBe(false);
    expect(JSON.stringify(refusal)).not.toContain("citizen_atlas");
    expect(JSON.stringify(assertMayUseChest(s, "citizen_theo", chest, "personal"))).not.toContain("citizen_atlas");
    expect(assertChestAccess(s, "citizen_atlas", chest, "personal").success).toBe(true);
    s.leaveHome("citizen_atlas");
    expect(assertChestAccess(s, "citizen_atlas", chest, "personal").success).toBe(false);
  });
  it("does not turn fixture controls into usable citizen storage through asset registration", () => {
    const s = setup();
    // The historical named communal chest is a different policy case from fixture controls.
    expect(assertChestAccess(s, "citizen_atlas", WORLD_LAB_COMMUNAL_CHEST, "communal", "overworld").success).toBe(false);
    const fixture = { x: -1042, y: 63, z: 980 };
    communityPhysicalState(s).forCitizen("citizen_atlas").registerAsset("chest", "overworld", fixture);
    expect(assertMayUseChest(s, "citizen_atlas", fixture, "communal", "overworld").success).toBe(false);
  });
});
