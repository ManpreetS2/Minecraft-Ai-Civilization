import { describe, expect, it } from "vitest";
import { WORKSHOP_CABIN_ID, expandBlueprint, getBlueprint, resolveMaterials, worldPosition } from "@civ/minecraft-knowledge";
import { createBuildSession, type BuildSession, type SkillContext } from "@civ/skills";
import { ok, fail, type ActionResult, type Vec3 } from "@civ/shared";
import { SettlementRuntime } from "./settlement-runtime.js";
import {
  applyWorldReconcileToSession,
  authorizedInventoryForCitizen,
  cancelConstructionProject,
  dispatchCitizenBuildIntention,
  planBuildStructure,
  plannedTaskForConstructionProject,
} from "./build-structure.js";
import { planCitizen } from "./planner.js";

function solidPad(y = 70): (pos: Vec3) => string | undefined {
  return (pos) => (pos.y === y - 1 ? "grass_block" : "air");
}

const FULL_INV = {
  oak_planks: 200,
  oak_door: 1,
  chest: 1,
  torch: 1,
  crafting_table: 1,
};

describe("intention integration reliability", () => {
  it("repeated identical intentions reuse one project id / session", async () => {
    const runtime = new SettlementRuntime();
    const intention = {
      citizenId: "citizen_atlas",
      blueprintId: WORKSHOP_CABIN_ID,
      origin: { x: 200, y: 70, z: 200 },
      facing: "south" as const,
      inventory: FULL_INV,
    };
    const first = await dispatchCitizenBuildIntention({
      intention,
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
    });
    const second = await dispatchCitizenBuildIntention({
      intention,
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
    });
    expect(first.project.id).toBe(second.project.id);
    expect(second.reusedExisting).toBe(true);
    expect(first.project.session?.instanceId).toBe(second.project.session?.instanceId);
  });

  it("refuses another citizen taking over a reserved construction site", async () => {
    const runtime = new SettlementRuntime();
    const origin = { x: 210, y: 70, z: 210 };
    const atlas = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: FULL_INV,
      },
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
    });
    expect(["PLANNED", "REUSED", "PROCURING"].includes(atlas.phase) || atlas.phase === "PLANNED").toBe(true);

    // Clear runtime project so Maya attempts a fresh plan on the same site claim.
    runtime.project = undefined;
    const maya = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_maya",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: FULL_INV,
      },
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
    });
    expect(maya.phase).toBe("SITE_CLAIM_DENIED");
    expect(maya.project.status).toBe("BLOCKED");
  });

  it("does not treat other citizens' reserved inventory as available", () => {
    const runtime = new SettlementRuntime();
    runtime.reservations.reserve("citizen_maya", "construction", "oak_planks", 50);
    const auth = authorizedInventoryForCitizen(runtime, "citizen_atlas", { oak_planks: 60 });
    expect(auth.oak_planks).toBe(10);
  });

  it("missing materials yield PROCURING instead of fabricated stock or placement", async () => {
    const runtime = new SettlementRuntime();
    const result = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin: { x: 220, y: 70, z: 220 },
        inventory: { oak_planks: 1 },
      },
      runtime,
      getBlock: solidPad(70),
      physicalInventory: { oak_planks: 1 },
    });
    expect(result.phase).toBe("PROCURING");
    expect(Object.keys(result.shortfall).length).toBeGreaterThan(0);
    const planned = plannedTaskForConstructionProject(result.project, "citizen_atlas");
    expect(planned?.action).toBe("obtainItem");
    expect(planned?.blocked?.code).toBe("MATERIALS_MISSING");
  });

  it("unknown/unloaded cells never count as verified completion", () => {
    const session = createBuildSession({
      blueprintId: WORKSHOP_CABIN_ID,
      facing: "south",
      origin: { x: 0, y: 64, z: 0 },
    });
    session.status = "COMPLETE";
    session.placed = 999;
    const reconciled = applyWorldReconcileToSession(session, { x: 0, y: 64, z: 0 }, "south", () => undefined);
    expect(reconciled.complete).toBe(false);
    expect(reconciled.unknown).toBeGreaterThan(0);
    expect(reconciled.session.status).toBe("IN_PROGRESS");
  });

  it("stale COMPLETE checkpoint is reconciled against the world before COMPLETED", async () => {
    const runtime = new SettlementRuntime();
    const origin = { x: 5, y: 64, z: 5 };
    const cabin = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(cabin, FULL_INV);
    const expanded = expandBlueprint(cabin, materials, "south", ["chest", "lighting", "crafting_table"]);
    const world = new Map<string, string>();
    let n = 0;
    for (const block of expanded.blocks) {
      if (block.skipIfSolid) continue;
      if (n >= 6) break;
      const pos = worldPosition(origin, block.dx, block.dy, block.dz, cabin.footprint, "south");
      world.set(`${pos.x},${pos.y},${pos.z}`, "oak_planks");
      n += 1;
    }
    const { project } = planBuildStructure(
      {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: FULL_INV,
        requireSiteOk: false,
      },
      (pos) => world.get(`${pos.x},${pos.y},${pos.z}`) ?? "air",
    );
    project.session!.status = "COMPLETE";
    project.session!.placed = 999;
    project.status = "COMPLETED";
    runtime.project = project;
    runtime.claims.tryClaim("construction_site", `${origin.x},${origin.y},${origin.z}`, "citizen_atlas");

    const result = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: FULL_INV,
        requireSiteOk: false,
      },
      runtime,
      getBlock: (pos) => world.get(`${pos.x},${pos.y},${pos.z}`) ?? "air",
      physicalInventory: FULL_INV,
    });
    expect(result.phase).not.toBe("COMPLETED");
    expect(result.worldVerifiedComplete).toBe(false);
    expect(result.project.session?.placed).toBeLessThan(999);
  });

  it("cancellation prevents further dispatch", async () => {
    const runtime = new SettlementRuntime();
    const origin = { x: 230, y: 70, z: 230 };
    await dispatchCitizenBuildIntention({
      intention: { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin, inventory: FULL_INV },
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
    });
    runtime.project = cancelConstructionProject(runtime.project as NonNullable<typeof runtime.project>);
    const again = await dispatchCitizenBuildIntention({
      intention: { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin, inventory: FULL_INV },
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
    });
    expect(again.phase).toBe("CANCELLED");
  });

  it("failed placement does not silently advance placed count beyond world truth", async () => {
    const runtime = new SettlementRuntime();
    const origin = { x: 240, y: 70, z: 240 };
    const advance = async (_ctx: SkillContext, session: BuildSession): Promise<ActionResult> => {
      session.placed = session.placed + 50; // dishonest advance attempt
      return fail("BUILD_BLOCKED", "placement failed", 1, true, { session });
    };
    const first = await dispatchCitizenBuildIntention({
      intention: { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin, inventory: FULL_INV },
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
    });
    const before = first.project.session!.placed;
    const fakeCtx = {
      citizenId: "citizen_atlas",
      bot: { inventory: { items: () => [] }, entity: { position: origin } },
      body: { position: () => origin },
    } as unknown as SkillContext;
    const blocked = await dispatchCitizenBuildIntention({
      intention: { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin, inventory: FULL_INV },
      runtime,
      getBlock: solidPad(70),
      physicalInventory: FULL_INV,
      ctx: fakeCtx,
      advance,
    });
    expect(blocked.phase).toBe("BLOCKED");
    expect(blocked.project.placed).toBeLessThanOrEqual(before);
  });

  it("persistence failure is distinguished from physical verification", async () => {
    const runtime = new SettlementRuntime();
    const origin = { x: 250, y: 70, z: 250 };
    const cabin = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(cabin, FULL_INV);
    const expanded = expandBlueprint(cabin, materials, "south", ["chest", "lighting", "crafting_table"]);
    const world = new Map<string, string>();
    const props = new Map<string, Record<string, string>>();
    for (const block of expanded.blocks) {
      if (block.skipIfSolid) continue;
      const pos = worldPosition(origin, block.dx, block.dy, block.dz, cabin.footprint, "south");
      const name =
        block.role === "door"
          ? "oak_door"
          : block.role === "chest"
            ? "chest"
            : block.role === "lighting"
              ? "torch"
              : block.role === "crafting_table"
                ? "crafting_table"
                : "oak_planks";
      world.set(`${pos.x},${pos.y},${pos.z}`, name);
      if (block.role === "door") {
        props.set(`${pos.x},${pos.y},${pos.z}`, {
          facing: "south",
          half: block.multiblockPart === "door_upper" ? "upper" : "lower",
          hinge: "left",
          open: "false",
          powered: "false",
        });
      }
    }
    const { project } = planBuildStructure(
      {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: FULL_INV,
        requireSiteOk: false,
        extras: ["chest", "lighting", "crafting_table"],
      },
      (pos) => world.get(`${pos.x},${pos.y},${pos.z}`),
    );
    // Align session extras with the filled world (no bed/furnace).
    if (project.session) project.session.extras = ["chest", "lighting", "crafting_table"];
    runtime.project = project;
    runtime.claims.tryClaim("construction_site", `${origin.x},${origin.y},${origin.z}`, "citizen_atlas");
    const result = await dispatchCitizenBuildIntention({
      intention: {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin,
        inventory: FULL_INV,
        requireSiteOk: false,
        extras: ["chest", "lighting", "crafting_table"],
      },
      runtime,
      getBlock: (pos) => world.get(`${pos.x},${pos.y},${pos.z}`),
      getBlockProperties: (pos) => props.get(`${pos.x},${pos.y},${pos.z}`),
      physicalInventory: FULL_INV,
      persist: () => ({ ok: false, reason: "sqlite_locked" }),
    });
    expect(result.phase).toBe("PERSIST_FAILED");
    expect(result.worldVerifiedComplete).toBe(true);
    expect(result.project.status).not.toBe("COMPLETED");
    expect(result.project.lastPersistOk).toBe(false);
  });

  it("planner resumes construction project without human directive", () => {
    const { project } = planBuildStructure(
      {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin: { x: 260, y: 70, z: 260 },
        inventory: { oak_planks: 1 },
      },
      solidPad(70),
    );
    expect(project.status).toBe("PROCURING");
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: {
        username: "Atlas",
        connected: true,
        spawned: true,
        health: 20,
        food: 18,
        inventory: [{ name: "oak_planks", count: 1 }],
        players: [],
        nearby: [],
        position: { x: 260, y: 70, z: 260 },
        gameTime: 1000,
        isNight: false,
      },
      settlement: {
        wood: 0,
        food: 0,
        stone: 0,
        tools: 0,
        beds: 0,
        shelterComplete: true,
        housingCapacity: 4,
      },
      assignedNeeds: [],
      constructionProject: project,
    });
    expect(planned.action).toBe("obtainItem");
    expect(planned.blocked?.code).toBe("MATERIALS_MISSING");
  });
});
