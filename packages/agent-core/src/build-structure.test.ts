import { describe, expect, it } from "vitest";
import { WORKSHOP_CABIN_ID, expandBlueprint, getBlueprint, resolveMaterials, worldPosition } from "@civ/minecraft-knowledge";
import { createBuildSession } from "@civ/skills";
import { applyWorldReconcileToSession, planBuildStructure } from "./build-structure.js";

function solidPad(y = 70): (pos: { x: number; y: number; z: number }) => string | undefined {
  return (pos) => (pos.y === y - 1 ? "grass_block" : "air");
}

describe("planBuildStructure project integration", () => {
  it("creates a STRUCTURE_BUILD project from workshop preflight without touching sqlite", () => {
    const { preflight, project } = planBuildStructure(
      {
        citizenId: "citizen_atlas",
        structureType: "WORKSHOP",
        origin: { x: 200, y: 70, z: 200 },
        facing: "south",
        inventory: {
          oak_planks: 200,
          oak_door: 1,
          chest: 1,
          torch: 1,
          crafting_table: 1,
        },
      },
      solidPad(70),
    );
    expect(preflight.blueprint.id).toBe(WORKSHOP_CABIN_ID);
    expect(preflight.status).toBe("PLANNED");
    expect(project.type).toBe("STRUCTURE_BUILD");
    expect(project.blueprintId).toBe(WORKSHOP_CABIN_ID);
    expect(project.site).toEqual({ x: 200, y: 70, z: 200 });
    expect(project.session?.blueprintId).toBe(WORKSHOP_CABIN_ID);
    expect(["READY_TO_BUILD", "PLANNED", "PROCURING"]).toContain(project.status);
    expect(project.preflightBlockers ?? []).not.toContain("SITE_UNSUITABLE");
  });

  it("keeps projects BLOCKED when the site is unsafe", () => {
    const { project, preflight } = planBuildStructure(
      {
        citizenId: "citizen_atlas",
        blueprintId: WORKSHOP_CABIN_ID,
        origin: { x: 0, y: 64, z: 0 },
        inventory: { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 },
      },
      (pos) => (pos.y === 64 ? "lava" : pos.y === 63 ? "stone" : "air"),
    );
    expect(preflight.status).toBe("BLOCKED");
    expect(project.status).toBe("BLOCKED");
  });
});

describe("interrupted build world reconcile", () => {
  it("does not mark COMPLETE from a checkpoint alone — requires world match", () => {
    const cabin = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(cabin, { oak_planks: 200, oak_door: 1, chest: 1, torch: 1, crafting_table: 1 });
    const expanded = expandBlueprint(cabin, materials, "south", ["chest", "lighting", "crafting_table"]);
    const origin = { x: 5, y: 64, z: 5 };
    const world = new Map<string, string>();
    // Place only half the non-foundation plan
    let placed = 0;
    for (const block of expanded.blocks) {
      if (block.skipIfSolid) continue;
      if (placed >= 8) break;
      const pos = worldPosition(origin, block.dx, block.dy, block.dz, cabin.footprint, "south");
      world.set(`${pos.x},${pos.y},${pos.z}`, block.role === "door" ? "oak_door" : "oak_planks");
      placed += 1;
    }
    const session = createBuildSession({
      blueprintId: WORKSHOP_CABIN_ID,
      facing: "south",
      origin,
      materials,
    });
    session.placed = 99; // dishonest checkpoint
    session.status = "COMPLETE";
    const reconciled = applyWorldReconcileToSession(session, origin, "south", (pos) => world.get(`${pos.x},${pos.y},${pos.z}`) ?? "air");
    expect(reconciled.complete).toBe(false);
    expect(reconciled.session.status).toBe("IN_PROGRESS");
    expect(reconciled.session.placed).toBeLessThan(99);
    expect(Object.keys(reconciled.remaining).length).toBeGreaterThan(0);
  });
});
