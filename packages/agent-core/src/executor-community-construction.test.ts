/** Community-mode construction must not publish a citizen's project/site/shelter state into the shared settlement row. */
import { afterEach, describe, expect, it } from "vitest";
import { WORKSHOP_CABIN_ID } from "@civ/minecraft-knowledge";
import { EventBus } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { CivilizationStore } from "./store.js";
import { executePlan } from "./executor.js";
import { createProductionHarness, stubNavOk } from "./construction-production-harness.js";

afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));
const audit = { actor: "orchestrator-config" as const, reason: "construction scoping regression" };
const plan = {
  goal: "contribute_to_project", task: "build_structure", action: "buildStructure" as const,
  source: "planner" as const, reason: "scoping", priority: 1, item: WORKSHOP_CABIN_ID,
};

async function run(communities: boolean) {
  setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
  const store = new CivilizationStore(":memory:");
  if (communities) {
    store.upsertCommunity("north", "North", audit);
    store.addCommunityMember("north", "citizen_atlas", audit);
  }
  const harness = createProductionHarness({ inventory: [{ name: "oak_planks", count: 200 }, { name: "oak_door", count: 1 }, { name: "chest", count: 1 }, { name: "torch", count: 1 }, { name: "crafting_table", count: 1 }] });
  harness.seedPad({ x: 100, y: 70, z: 100 }, 30, 30, 70);
  harness.ctx.citizenId = "citizen_atlas";
  Object.assign(harness.ctx.bot, { entities: {} });
  const before = JSON.stringify(store.getSettlement());
  await executePlan(harness.ctx, plan, store, new EventBus());
  const after = JSON.stringify(store.getSettlement());
  store.close();
  return { before, after };
}

describe("executor construction community scoping", () => {
  it("legacy single-settlement mode still persists the project (test sensitivity)", async () => {
    const r = await run(false);
    expect(r.after).not.toEqual(r.before);
  });
  it("community mode leaves the shared settlement row untouched", async () => {
    const r = await run(true);
    expect(r.after).toEqual(r.before);
  });
});
