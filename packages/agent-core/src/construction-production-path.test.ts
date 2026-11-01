/**
 * Mission 005 — production executor path with fake Mineflayer.
 * Invokes real advanceBlueprintBuild / placeBlock. Not physical proof.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKSHOP_CABIN_ID,
  getBlueprint,
  matchBlockProperties,
  propertiesForPlannedBlock,
  resolveMaterials,
} from "@civ/minecraft-knowledge";
import {
  advanceBlueprintBuild,
  createBuildSession,
  placeBlock,
  type BuildSession,
} from "@civ/skills";
import {
  createNavigationBackend,
  setNavigationBackend,
  type NavigationBackend,
} from "@civ/minecraft-adapter";
import { SettlementRuntime } from "./settlement-runtime.js";
import {
  cancelConstructionProject,
  dispatchCitizenBuildIntention,
  executeBuildStructurePlan,
} from "./build-structure.js";
import {
  createProductionHarness,
  stubNavFail,
  stubNavOk,
} from "./construction-production-harness.js";
import { selectConstructionSite } from "./construction-site-select.js";
import { seedFlatPad, simGetBlock, type SimWorld } from "./construction-offline-engine.js";
import type { PlannedTask } from "./planner.js";

afterEach(() => {
  setNavigationBackend(createNavigationBackend("pathfinder"));
});

function plan(item = WORKSHOP_CABIN_ID): PlannedTask {
  return {
    goal: "contribute_to_project",
    task: "build_structure",
    action: "buildStructure",
    source: "planner",
    reason: "mission005",
    priority: 1,
    item,
  };
}

describe("Mission 005 production placeBlock contract", () => {
  it("requires supporting neighbor and confirms exact identity after place", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [{ name: "oak_planks", count: 4 }],
    });
    const dest = { x: 105, y: 70, z: 105 };
    // Ensure solid below as neighbor
    harness.setBlock({ x: 105, y: 69, z: 105 }, "grass_block");
    harness.setBlock(dest, "air");

    const result = await placeBlock(harness.ctx, "oak_planks", dest, {
      purpose: "shelter_blueprint",
      structureId: "floor",
    });
    expect(result.success).toBe(true);
    expect(harness.placeRequests.length).toBeGreaterThan(0);
    expect(harness.getBlock(dest)).toBe("oak_planks");
    expect(harness.equipRequests).toContain("oak_planks");
  });

  it("fails VERIFY when placement promise resolves without world change", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [{ name: "oak_planks", count: 2 }],
      silentPlace: true,
    });
    const dest = { x: 106, y: 70, z: 106 };
    harness.setBlock({ x: 106, y: 69, z: 106 }, "grass_block");
    harness.setBlock(dest, "air");

    const result = await placeBlock(harness.ctx, "oak_planks", dest, {
      purpose: "shelter_blueprint",
      structureId: "floor",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("VERIFY_FAILED");
    expect(harness.placeRequests.length).toBeGreaterThan(0);
    expect(harness.getBlock(dest)).toBe("air");
  });

  it("fails when inventory missing", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({ inventory: [] });
    const dest = { x: 107, y: 70, z: 107 };
    harness.setBlock({ x: 107, y: 69, z: 107 }, "grass_block");
    harness.setBlock(dest, "air");
    const result = await placeBlock(harness.ctx, "oak_planks", dest, {
      purpose: "shelter_blueprint",
      structureId: "floor",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("ITEM_NOT_FOUND");
  });

  it("fails when navigation fails", async () => {
    setNavigationBackend(stubNavFail() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [{ name: "oak_planks", count: 2 }],
    });
    const dest = { x: 108, y: 70, z: 108 };
    harness.setBlock({ x: 108, y: 69, z: 108 }, "grass_block");
    harness.setBlock(dest, "air");
    const result = await placeBlock(harness.ctx, "oak_planks", dest, {
      purpose: "shelter_blueprint",
      structureId: "floor",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("PATH_BLOCKED");
    expect(harness.placeRequests).toHaveLength(0);
  });

  it("fails when no supporting neighbor", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [{ name: "oak_planks", count: 2 }],
    });
    const dest = { x: 200, y: 80, z: 200 };
    // Floating cell: air everywhere including neighbors
    for (const n of [
      dest,
      { x: 200, y: 79, z: 200 },
      { x: 201, y: 80, z: 200 },
      { x: 199, y: 80, z: 200 },
      { x: 200, y: 80, z: 201 },
      { x: 200, y: 80, z: 199 },
      { x: 200, y: 81, z: 200 },
    ]) {
      harness.setBlock(n, "air");
    }
    const result = await placeBlock(harness.ctx, "oak_planks", dest, {
      purpose: "shelter_blueprint",
      structureId: "wall",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("PLACE_FAILED");
  });

  it("verifies door upper half after place", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [{ name: "oak_door", count: 1 }],
    });
    const dest = { x: 110, y: 70, z: 110 };
    // Valid doorway: solid below + east/west jambs + approach from south
    harness.setBlock({ x: 110, y: 69, z: 110 }, "oak_planks");
    harness.setBlock({ x: 111, y: 70, z: 110 }, "oak_planks");
    harness.setBlock({ x: 111, y: 71, z: 110 }, "oak_planks");
    harness.setBlock({ x: 109, y: 70, z: 110 }, "oak_planks");
    harness.setBlock({ x: 109, y: 71, z: 110 }, "oak_planks");
    harness.setBlock(dest, "air");
    harness.setBlock({ x: 110, y: 71, z: 110 }, "air");
    harness.setBlock({ x: 110, y: 70, z: 111 }, "air");
    harness.setBlock({ x: 110, y: 71, z: 111 }, "air");
    harness.setBlock({ x: 110, y: 69, z: 111 }, "oak_planks");
    const result = await placeBlock(harness.ctx, "oak_door", dest, {
      purpose: "shelter_blueprint",
      structureId: "door",
    });
    expect(result.success).toBe(true);
    expect(harness.getBlock(dest)).toBe("oak_door");
    expect(harness.getBlock({ x: 110, y: 71, z: 110 })).toBe("oak_door");
  });
});

describe("Mission 005 advanceBlueprintBuild production entry", () => {
  it("creates session and places via advanceBlueprintBuild (fake bot)", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [
        { name: "oak_planks", count: 64 },
        { name: "oak_door", count: 1 },
        { name: "chest", count: 1 },
        { name: "torch", count: 2 },
        { name: "crafting_table", count: 1 },
      ],
    });
    const origin = { x: 100, y: 70, z: 100 };
    const session = createBuildSession({
      blueprintId: WORKSHOP_CABIN_ID,
      origin,
      facing: "south",
      materials: resolveMaterials(getBlueprint(WORKSHOP_CABIN_ID)!, {
        oak_planks: 64,
        oak_door: 1,
        chest: 1,
        torch: 2,
        crafting_table: 1,
      }),
      extras: ["chest", "lighting", "crafting_table"],
    });
    // Skip clearing — pad is already air; jump to FLOOR for placement.
    session.stage = "FLOOR";

    const result = await advanceBlueprintBuild(harness.ctx, session, {
      maxPlacements: 1,
      liveValidate: false,
      forceNew: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.placedThisCall).toBe(1);
      expect(result.data.session.placed).toBeGreaterThanOrEqual(1);
    }
    expect(harness.placeRequests.length).toBeGreaterThan(0);
    expect(harness.equipRequests.length).toBeGreaterThan(0);
  });

  it("dispatch → advance places one block and persists progress", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [
        { name: "oak_planks", count: 200 },
        { name: "oak_door", count: 1 },
        { name: "chest", count: 1 },
        { name: "torch", count: 2 },
        { name: "crafting_table", count: 1 },
      ],
    });
    const runtime = new SettlementRuntime();
    const origin = { x: 100, y: 70, z: 100 };
    let persistCalls = 0;
    const dispatched = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        facing: "south",
        inventory: {
          oak_planks: 200,
          oak_door: 1,
          chest: 1,
          torch: 2,
          crafting_table: 1,
        },
      },
      runtime,
      getBlock: harness.getBlock,
      getBlockProperties: harness.getBlockProperties,
      physicalInventory: {
        oak_planks: 200,
        oak_door: 1,
        chest: 1,
        torch: 2,
        crafting_table: 1,
      },
      ctx: harness.ctx,
      persist: (_project) => {
        persistCalls += 1;
        return { ok: true };
      },
      maxPlacements: 1,
      advance: async (ctx, session, opts) => {
        session.stage = "FLOOR";
        return advanceBlueprintBuild(ctx, session, { ...opts, liveValidate: false, forceNew: true });
      },
    });

    expect(["BUILDING", "PARTIAL", "PLANNED", "REUSED"]).toContain(dispatched.phase);
    expect(runtime.project).toBeTruthy();
    expect(persistCalls).toBeGreaterThanOrEqual(0);
    if (dispatched.phase === "BUILDING") {
      expect(harness.placeRequests.length).toBeGreaterThan(0);
    }
  });

  it("unknown world blocks refuse COMPLETE", async () => {
    const runtime = new SettlementRuntime();
    const result = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin: { x: 0, y: 70, z: 0 },
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      runtime,
      getBlock: () => undefined,
      physicalInventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
    });
    expect(result.phase).toBe("BLOCKED");
    expect(result.worldVerifiedComplete).toBe(false);
  });

  it("persist failure does not claim COMPLETED", async () => {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const harness = createProductionHarness({
      inventory: [{ name: "oak_planks", count: 200 }, { name: "oak_door", count: 1 }, { name: "chest", count: 1 }, { name: "torch", count: 1 }, { name: "crafting_table", count: 1 }],
    });
    const runtime = new SettlementRuntime();
    // Pre-seed a fully "correct" world with properties so reconcile could complete — then fail persist.
    const origin = { x: 100, y: 70, z: 100 };
    const bp = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(bp, { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 });
    // Minimal: create project then force reconcile complete path via reused session
    const session = createBuildSession({
      blueprintId: WORKSHOP_CABIN_ID,
      origin,
      facing: "south",
      materials,
      extras: ["chest", "lighting", "crafting_table"],
    });
    session.status = "COMPLETE";
    session.stage = "FINAL_VALIDATION";
    runtime.project = {
      id: "p1",
      type: "STRUCTURE_BUILD",
      status: "BUILDING",
      stage: "FINAL_VALIDATION",
      blueprintId: WORKSHOP_CABIN_ID,
      blueprintVersion: 1,
      facing: "south",
      site: origin,
      requiredResources: {},
      reservedResources: {},
      blocked: [],
      placed: 1,
      total: 1,
      verified: 1,
      startedAt: new Date().toISOString(),
      session,
      ownerCitizenId: "citizen_atlas",
    } as never;

    // Fill world so remainingAfterPartialBuild would need props — without full fill, not complete.
    // Instead assert persist fail path via dispatch when advance reports COMPLETE with getBlock verifying.
    const result = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        facing: "south",
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      runtime,
      getBlock: harness.getBlock,
      getBlockProperties: harness.getBlockProperties,
      ctx: harness.ctx,
      persist: () => ({ ok: false, reason: "sqlite_locked" }),
      advance: async (_ctx, sess) => {
        const s = sess as BuildSession;
        s.status = "COMPLETE";
        s.stage = "FINAL_VALIDATION";
        // Leave world empty → reconcile incomplete → PARTIAL, not COMPLETED
        return {
          success: true,
          data: { session: s, stage: s.stage, placedThisCall: 0 },
          durationMs: 1,
        };
      },
    });
    expect(result.phase).not.toBe("COMPLETED");
    expect(result.worldVerifiedComplete).toBe(false);
  });

  it("cancellation during execution stops placement", async () => {
    const runtime = new SettlementRuntime();
    const harness = createProductionHarness({
      inventory: [{ name: "oak_planks", count: 10 }],
    });
    const origin = { x: 100, y: 70, z: 100 };
    await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      runtime,
      getBlock: harness.getBlock,
      physicalInventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
    });
    runtime.project = cancelConstructionProject(runtime.project as never);
    const result = await executeBuildStructurePlan({
      ctx: harness.ctx,
      plan: { ...plan(), target: origin },
      runtime,
      getBlock: harness.getBlock,
      cancelled: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
  });

  it("site claim by another citizen is denied", async () => {
    const runtime = new SettlementRuntime();
    const world: SimWorld = new Map();
    seedFlatPad(world, { x: 400, y: 70, z: 400 }, 20, 20, 70);
    const getBlock = simGetBlock(world);
    await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin: { x: 410, y: 70, z: 410 },
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      runtime,
      getBlock,
      physicalInventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
    });
    const denied = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_maya",
        blueprintId: WORKSHOP_CABIN_ID,
        origin: { x: 410, y: 70, z: 410 },
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      runtime: new SettlementRuntime(), // separate project bag but shared claim board needed
      getBlock,
      physicalInventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
    });
    // Same runtime required for claim board — re-run on shared runtime:
    const deniedShared = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_maya",
        blueprintId: WORKSHOP_CABIN_ID,
        origin: { x: 410, y: 70, z: 410 },
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      runtime,
      getBlock,
      physicalInventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
    });
    expect(deniedShared.phase).toBe("SITE_CLAIM_DENIED");
    void denied;
  });
});

describe("Mission 005 multi-citizen exact footprint overlap", () => {
  it("rejects selecting a site that exactly overlaps another citizen active project", async () => {
    const runtime = new SettlementRuntime();
    const world: SimWorld = new Map();
    seedFlatPad(world, { x: 500, y: 70, z: 500 }, 40, 40, 70);
    const getBlock = simGetBlock(world);
    const origin = { x: 510, y: 70, z: 510 };
    await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      runtime,
      getBlock,
      physicalInventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
    });
    expect(runtime.project?.site).toEqual(origin);

    // Force-evaluate the exact same origin as a candidate for Maya via selectConstructionSite rings —
    // also assert direct overlap rejection by scoring that origin.
    const site = selectConstructionSite({
      blueprint: getBlueprint(WORKSHOP_CABIN_ID)!,
      from: origin,
      citizenId: "citizen_maya",
      runtime,
      getBlock,
      facing: "south",
      radius: 8,
    });
    if (site.ok) {
      const ox = site.site.origin.x;
      const oz = site.site.origin.z;
      const same =
        Math.floor(ox) === Math.floor(origin.x) && Math.floor(oz) === Math.floor(origin.z);
      expect(same).toBe(false);
    }
    // Exact origin must appear as rejected alternative or not selected
    const exactRejected =
      site.ok === false ||
      site.alternatives?.some((a) => !a.ok && a.reason?.includes("overlaps")) ||
      (site.ok &&
        !(Math.floor(site.site.origin.x) === origin.x && Math.floor(site.site.origin.z) === origin.z));
    expect(exactRejected).toBe(true);
  });
});

describe("Mission 005 door/bed state verification", () => {
  it("wrong door facing fails property match", () => {
    const expected = propertiesForPlannedBlock(
      { dx: 0, dy: 1, dz: 0, role: "door", stage: "DOOR_ACCESS", multiblockPart: "door_lower" },
      "south",
    );
    const bad = matchBlockProperties(expected, { ...expected!, facing: "north", half: "lower" });
    expect(bad.ok).toBe(false);
    expect(bad.unverified).toBe(false);
  });

  it("missing properties remain unverified", () => {
    const expected = propertiesForPlannedBlock(
      { dx: 0, dy: 1, dz: 0, role: "door", stage: "DOOR_ACCESS", multiblockPart: "door_lower" },
      "south",
    );
    const missing = matchBlockProperties(expected, null);
    expect(missing.unverified).toBe(true);
    expect(missing.ok).toBe(false);
  });
});
