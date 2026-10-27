import { describe, expect, it } from "vitest";
import {
  WORKSHOP_CABIN_ID,
  getBlueprint,
  STORAGE_SHED_ID,
} from "@civ/minecraft-knowledge";
import { SettlementRuntime } from "./settlement-runtime.js";
import { selectConstructionSite } from "./construction-site-select.js";
import { planConstructionProcurement, releaseConstructionReservations } from "./construction-procurement.js";
import {
  runWorkshopCabinOfflineAcceptance,
  seedFlatPad,
  simGetBlock,
  type SimWorld,
} from "./construction-offline-engine.js";
import { dispatchCitizenBuildIntention } from "./build-structure.js";

describe("Phase C site selection", () => {
  it("never treats unloaded cells as empty buildable space", () => {
    const runtime = new SettlementRuntime();
    const world: SimWorld = new Map(); // empty → all undefined
    const result = selectConstructionSite({
      blueprint: getBlueprint(WORKSHOP_CABIN_ID)!,
      from: { x: 0, y: 70, z: 0 },
      citizenId: "citizen_atlas",
      runtime,
      getBlock: simGetBlock(world),
      radius: 8,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.blockers).toContain("NO_SUITABLE_SITE");
  });

  it("rejects sites overlapping another citizen's active project", async () => {
    const runtime = new SettlementRuntime();
    const world: SimWorld = new Map();
    seedFlatPad(world, { x: 400, y: 70, z: 400 }, 40, 40, 70);
    const getBlock = simGetBlock(world);
    const first = await dispatchCitizenBuildIntention({
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
    expect(first.project.site).toBeTruthy();

    const site = selectConstructionSite({
      blueprint: getBlueprint(STORAGE_SHED_ID)!,
      from: { x: 410, y: 70, z: 410 },
      citizenId: "citizen_maya",
      runtime,
      getBlock,
      radius: 12,
    });
    // May still find a far site; ensure overlapping origin near atlas project is rejected in candidates
    if (site.ok) {
      const dx = Math.abs(site.site.origin.x - 410);
      const dz = Math.abs(site.site.origin.z - 410);
      expect(dx > 3 || dz > 3).toBe(true);
    }
  });
});

describe("Phase D procurement", () => {
  it("plans incremental gather without fabricating chest stock", () => {
    const runtime = new SettlementRuntime();
    const plan = planConstructionProcurement({
      citizenId: "citizen_atlas",
      runtime,
      remainingBill: { oak_planks: 40, oak_door: 1 },
      physicalInventory: { oak_planks: 2 },
    });
    expect(plan.status).toBe("NEED_GATHER");
    expect(plan.nextObtainItem).toBe("oak_planks");
    expect(plan.nextObtainCount).toBeLessThanOrEqual(16);
    expect(plan.shortfall.oak_door).toBe(1);
  });

  it("releases construction reservations on cleanup", () => {
    const runtime = new SettlementRuntime();
    runtime.reservations.reserve("citizen_atlas", "construction", "oak_planks", 8);
    expect(releaseConstructionReservations(runtime, "citizen_atlas")).toBe(1);
    expect(runtime.reservations.list()).toHaveLength(0);
  });
});

describe("Phase G multi-citizen isolation", () => {
  it("Maya cannot spend Atlas-reserved planks", () => {
    const runtime = new SettlementRuntime();
    runtime.reservations.reserve("citizen_atlas", "construction", "oak_planks", 30);
    const plan = planConstructionProcurement({
      citizenId: "citizen_maya",
      runtime,
      remainingBill: { oak_planks: 20 },
      physicalInventory: { oak_planks: 40 },
    });
    // Maya sees 40-30=10 authorized → still short 10
    expect(plan.shortfall.oak_planks).toBe(10);
  });
});

describe("Phase H end-to-end offline acceptance", () => {
  it("completes workshop cabin with interrupt, reconcile, and world verify (simulated only)", async () => {
    const result = await runWorkshopCabinOfflineAcceptance({ interruptAfter: 6 });
    expect(result.simulatedOnly).toBe(true);
    expect(result.blueprintOk).toBe(true);
    expect(result.interruptedAt).toBe(6);
    expect(result.resumedSkipped).toBeGreaterThanOrEqual(0);
    expect(result.phase).toBe("COMPLETED");
    expect(result.worldVerifiedComplete).toBe(true);
    expect(result.projectStatus).toBe("COMPLETED");
  }, 30_000);

  it("stays PROCURING when materials are starved (no free items)", async () => {
    const result = await runWorkshopCabinOfflineAcceptance({ starveMaterials: true });
    expect(result.phase).toBe("PROCURING");
    expect(result.worldVerifiedComplete).toBe(false);
    expect(result.blockers).toContain("MATERIALS_MISSING");
  });

  it("distinguishes persist failure from world verification", async () => {
    const result = await runWorkshopCabinOfflineAcceptance({ interruptAfter: 6, failPersist: true });
    expect(result.phase).toBe("PERSIST_FAILED");
    expect(result.worldVerifiedComplete).toBe(true);
    expect(result.projectStatus).not.toBe("COMPLETED");
  }, 30_000);
});
