import { afterEach, expect, it } from "vitest";
import { WORKSHOP_CABIN_ID } from "@civ/minecraft-knowledge";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { createProductionHarness, stubNavOk } from "./construction-production-harness.js";
import { executeBuildStructurePlan, dispatchCitizenBuildIntention } from "./build-structure.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import { CivilizationStore } from "./store.js";
import { communityConstruction } from "./community-construction.js";
import { cellClaimKey } from "./claims.js";
afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));
const plan = { goal: "contribute_to_project", task: "build_structure", action: "buildStructure" as const, source: "planner" as const, reason: "regression", priority: 1, item: WORKSHOP_CABIN_ID, target: { x: 100, y: 70, z: 100 } };
it("reports cancellation persistence failure without claiming durable cancellation", async () => {
  const harness = createProductionHarness();
  const runtime = new SettlementRuntime();
  const result = await executeBuildStructurePlan({ ctx: harness.ctx, plan, runtime, cancelled: true, persist: () => ({ ok: false, reason: "disk_full" }) });
  expect(result).toMatchObject({ success: false, retryable: true, details: { phase: "PERSIST_FAILED", persisted: false, reason: "disk_full" } });
});
it("restores site claims and refuses owner reassignment at the durable boundary", async () => {
  const store = new CivilizationStore(":memory:");
  try {
    const audit = { actor: "orchestrator-config" as const, reason: "test" };
    store.upsertCommunity("north", "North", audit);
    for (const id of ["citizen_atlas", "other"]) store.addCommunityMember("north", id, audit);
    const runtime = new SettlementRuntime();
    const result = await dispatchCitizenBuildIntention({ intention: { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin: plan.target, requireSiteOk: false }, runtime });
    const access = communityConstruction(store);
    expect(access.forCitizen("citizen_atlas").save(result.project)).toBe(true);
    expect(access.forCitizen("other").save({ ...result.project, ownerCitizenId: "other" } as typeof result.project)).toBe(false);
    expect(access.forCitizen("citizen_atlas").save({ ...result.project, ownerCitizenId: undefined } as typeof result.project)).toBe(false);
    const harness = createProductionHarness(); harness.ctx.citizenId = "other";
    runtime.project = result.project;
    expect(await executeBuildStructurePlan({ ctx: harness.ctx, plan, runtime, cancelled: true })).toMatchObject({ success: false, code: "ACCESS_DENIED" });
    expect((runtime.project as typeof result.project).cancelled).not.toBe(true);
    const restarted = new SettlementRuntime(); restarted.forCommunity("north", store);
    expect(restarted.claims.ownerOf("construction_site", cellClaimKey(100, 70, 100))).toBe("citizen_atlas");
  } finally { store.close(); }
});
it("missing observed door properties cannot turn a claimed complete session into verified completion", async () => {
  setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
  const harness = createProductionHarness({ inventory: [] });
  const runtime = new SettlementRuntime();
  const result = await dispatchCitizenBuildIntention({ intention: { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin: plan.target, inventory: {} }, runtime, getBlock: harness.getBlock, getBlockProperties: () => undefined });
  expect(result.worldVerifiedComplete).toBe(false);
  expect(result.phase).not.toBe("COMPLETED");
  expect(harness.placeRequests).toHaveLength(0);
});

it("stateful reconciliation rejects a door whose observed properties disagree", async () => {
  const { planBuildStructure, applyWorldReconcileToSession } = await import("./build-structure.js");
  const { concreteBlock, expandBlueprint, getBlueprint, propertiesForPlannedBlock, worldPosition } = await import("@civ/minecraft-knowledge");
  const harness = createProductionHarness();
  const { project } = planBuildStructure({ citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin: plan.target, requireSiteOk: false });
  const session = project.session!;
  const expanded = expandBlueprint(getBlueprint(WORKSHOP_CABIN_ID)!, session.materials, "south", session.extras);
  for (const block of expanded.blocks) {
    if (block.skipIfSolid) continue;
    const pos = worldPosition(plan.target, block.dx, block.dy, block.dz, expanded.blueprint.footprint, "south");
    harness.setBlock(pos, concreteBlock(block, session.materials), propertiesForPlannedBlock(block, "south"));
  }
  setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
  let probes = 0;
  Object.assign(harness.ctx.bot, { activateBlock: async () => undefined, openContainer: async () => { probes++; return { containerItems: () => [], close: () => undefined }; } });
  const { validateBuiltStructure } = await import("@civ/skills");
  expect((await validateBuiltStructure(harness.ctx, session, true)).ok).toBe(true);
  expect((await validateBuiltStructure(harness.ctx, session, true)).ok).toBe(true);
  expect(probes).toBe(2);
  expect(harness.ctx.bot.inventory.items()).toEqual([]);
  Object.assign(harness.ctx.bot, { openContainer: async () => { throw new Error("unreachable"); } });
  expect((await validateBuiltStructure(harness.ctx, session, true)).failures).toContain("WORKSTATION_UNREACHABLE");
  const correct = applyWorldReconcileToSession(session, plan.target, "south", harness.getBlock, harness.getBlockProperties);
  expect(correct.complete).toBe(true);
  const door = [...harness.world.values()].find(b => b.name === "oak_door")!;
  harness.setBlock(door.position, door.name, { ...door.properties, facing: "north" });
  expect(applyWorldReconcileToSession(session, plan.target, "south", harness.getBlock, harness.getBlockProperties).complete).toBe(false);
});
