/** Executor authorization bridge tests; transfer results are simulated, not physical proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, ok } from "@civ/shared";
import { depositItems, type SkillContext } from "@civ/skills";
import { CivilizationStore } from "./store.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
import { executePlan } from "./executor.js";
import { loadCraftFixture } from "./testing/load-craft-fixture.js";

vi.mock("@civ/skills", async (original) => ({
  ...await original<typeof import("@civ/skills")>(),
  depositItems: vi.fn(),
}));
const pos = { x: 12, y: 64, z: 8 };
const audit = { actor: "orchestrator-config" as const, reason: "executor storage regression" };
let store: CivilizationStore;
beforeEach(() => {
  store = new CivilizationStore(":memory:");
  store.upsertCommunity("north", "North", audit);
  store.upsertCommunity("south", "South", audit);
  store.addCommunityMember("north", "citizen_atlas", audit);
  store.addCommunityMember("south", "citizen_theo", audit);
  communityPhysicalState(store).forCitizen("citizen_atlas").registerAsset("chest", "overworld", pos);
  vi.mocked(depositItems).mockReset();
  vi.mocked(depositItems).mockResolvedValue(ok({ deposited: 3, contents: { oak_log: 3 }, position: pos }, 1));
});
afterEach(() => store.close());
async function ctx(id: string, dimension?: string): Promise<SkillContext> {
  const fx = await loadCraftFixture({ trees: [] });
  fx.ctx.citizenId = id;
  Object.assign(fx.ctx.bot, { game: { dimension }, blockAt: () => ({ name: "chest" }) });
  fx.items.push({ name: "oak_log", count: 3 });
  return fx.ctx;
}
const plan = { action: "depositItems", task: "deposit", goal: "storage", source: "planner" as const, reason: "test", priority: 1 };

describe("executor scoped communal storage bridge", () => {
  it("passes authenticated dimension and preserves legacy and communal inventory after an authorized transfer", async () => {
    const before = store.getSettlement();
    const physical = communityPhysicalState(store).forCitizen("citizen_atlas");
    const result = await executePlan(await ctx("citizen_atlas", "minecraft:overworld"), plan, store, new EventBus());
    expect(result.success).toBe(true);
    expect(depositItems).toHaveBeenCalledOnce();
    expect(vi.mocked(depositItems).mock.calls[0]?.[2]).toEqual(pos);
    expect(store.getSettlement()).toEqual(before);
    expect(physical.read().state.storageContents).toEqual({});
  });
  it("allows an explicit grant without publishing the owner's metadata or contents globally", async () => {
    const owner = communityPhysicalState(store).forCitizen("citizen_atlas");
    owner.grantAsset(physicalBlockKey("overworld", pos), "citizen_theo");
    const before = store.getSettlement();
    expect((await executePlan(await ctx("citizen_theo", "overworld"), plan, store, new EventBus())).success).toBe(true);
    expect(depositItems).toHaveBeenCalledOnce();
    expect(store.getSettlement()).toEqual(before);
  });
  it.each([undefined, "the_nether"])("does not use the owned chest in an unbound or different dimension: %s", async (dimension) => {
    // No chest item: no placement fallback; the transfer itself must remain uncalled.
    const actor = await ctx("citizen_atlas", dimension);
    const result = await executePlan(actor, plan, store, new EventBus());
    expect(result.success).toBe(false);
    expect(depositItems).not.toHaveBeenCalled();
  });
  it("does not use a rival's ungranted chest", async () => {
    expect((await executePlan(await ctx("citizen_theo", "overworld"), plan, store, new EventBus())).success).toBe(false);
    expect(depositItems).not.toHaveBeenCalled();
  });
});
