import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, fail } from "@civ/shared";
import { withdrawItems, type SkillContext } from "@civ/skills";
import { CivilizationStore } from "./store.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
import { executePlan } from "./executor.js";
import { loadCraftFixture } from "./testing/load-craft-fixture.js";

/**
 * Independent QA of community-owned chest contents (dbbb7c4), test-only. Real store and executor; the skill layer is
 * mocked exactly as in the branch's own tests, so physical transfers are simulated. `it.fails` marks a reproduced
 * defect and turns red when it is fixed.
 */
vi.mock("@civ/skills", async (original) => ({
  ...(await original<typeof import("@civ/skills")>()),
  depositItems: vi.fn(),
  withdrawItems: vi.fn(),
}));

const pos = { x: 12, y: 64, z: 8 };
const key = physicalBlockKey("overworld", pos);
const audit = { actor: "orchestrator-config" as const, reason: "independent QA" };
let store: CivilizationStore;
beforeEach(() => {
  store = new CivilizationStore(":memory:");
  store.upsertCommunity("north", "North", audit);
  store.upsertCommunity("south", "South", audit);
  store.addCommunityMember("north", "citizen_atlas", audit);
  store.addCommunityMember("north", "citizen_maya", audit);
  store.addCommunityMember("south", "citizen_theo", audit);
  communityPhysicalState(store).forCitizen("citizen_atlas").registerAsset("chest", "overworld", pos);
  vi.mocked(withdrawItems).mockReset();
});
afterEach(() => store.close());
const of = (id: string) => communityPhysicalState(store).forCitizen(id);

async function ctx(id: string): Promise<SkillContext> {
  const fx = await loadCraftFixture({ trees: [] });
  fx.ctx.citizenId = id;
  Object.assign(fx.ctx.bot, { game: { dimension: "overworld" }, blockAt: () => ({ name: "chest" }) });
  return fx.ctx;
}
const withdrawPlan = { action: "withdrawItems" as const, task: "withdraw_food", goal: "eat", source: "planner" as const, reason: "t", priority: 1 };

describe("QA: access to observed contents follows authorization", () => {
  it("a citizen who was never granted access, in either community, reads nothing and cannot record", () => {
    const owner = of("citizen_atlas");
    owner.recordContainerObservation(key, { bread: 4 });
    for (const rival of ["citizen_maya", "citizen_theo"]) {
      expect(of(rival).observedContainerContents(key)).toBeUndefined();
      expect(of(rival).recordContainerObservation(key, { diamond: 99 })).toBe(false);
    }
    expect(owner.observedContainerContents(key)).toEqual({ bread: 4 });
  });

  it("contents never appear in the community-wide snapshot or the legacy settlement row", () => {
    const before = JSON.stringify(store.getSettlement());
    of("citizen_atlas").recordContainerObservation(key, { bread: 4 });
    expect(JSON.stringify(of("citizen_maya").read())).not.toContain("bread");
    expect(JSON.stringify(of("citizen_atlas").read())).not.toContain("bread");
    expect(JSON.stringify(store.getSettlement())).toBe(before);
  });

  it("negative or fractional counts are rejected without changing what is stored", () => {
    const owner = of("citizen_atlas");
    owner.recordContainerObservation(key, { bread: 4 });
    for (const bad of [{ bread: -1 }, { bread: 1.5 }, { bread: Number.NaN }, { "": 1 }]) {
      expect(() => owner.recordContainerObservation(key, bad)).toThrow();
    }
    expect(owner.observedContainerContents(key)).toEqual({ bread: 4 });
  });

  it("contents survive a restart-style reopen of the same store handle and vanish when the asset is abandoned", () => {
    const owner = of("citizen_atlas");
    owner.recordContainerObservation(key, { bread: 4 });
    expect(of("citizen_atlas").observedContainerContents(key)).toEqual({ bread: 4 });
    expect(owner.abandonAsset(key)).toBe(true);
    expect(of("citizen_atlas").observedContainerContents(key)).toBeUndefined();
  });

  it.fails("DEFECT: after the owner changes community, a fresh handle still reads the old community's chest contents", () => {
    const owner = of("citizen_atlas");
    owner.grantAsset(key, "citizen_maya");
    expect(of("citizen_maya").recordContainerObservation(key, { bread: 4 })).toBe(true);
    store.removeCommunityMember("north", "citizen_atlas", audit);
    store.addCommunityMember("south", "citizen_atlas", audit);
    // Maya (north) keeps stocking the chest after Atlas has joined the rival community.
    of("citizen_maya").recordContainerObservation(key, { bread: 9 });
    expect(of("citizen_atlas").observedContainerContents(key)).toBeUndefined();
  });

  it.fails("DEFECT: a grantee who changes community keeps reading the granting community's chest contents", () => {
    of("citizen_atlas").grantAsset(key, "citizen_maya");
    of("citizen_atlas").recordContainerObservation(key, { bread: 4 });
    store.removeCommunityMember("north", "citizen_maya", audit);
    store.addCommunityMember("south", "citizen_maya", audit);
    expect(of("citizen_maya").observedContainerContents(key)).toBeUndefined();
  });
});

describe("QA: a failed withdrawal must not leave a stale positive observation", () => {
  it.fails("DEFECT: observed bread stays after a live withdrawal finds the chest empty, so the same doomed attempt repeats", async () => {
    of("citizen_atlas").recordContainerObservation(key, { bread: 4 });
    vi.mocked(withdrawItems).mockResolvedValue(fail("CONTAINER_EMPTY", "chest holds no bread", 1, true));
    const actor = await ctx("citizen_atlas");
    const first = await executePlan(actor, { ...withdrawPlan, item: "bread" }, store, new EventBus());
    expect(first.success).toBe(false);
    expect(of("citizen_atlas").observedContainerContents(key)).toEqual({});
  });
});
