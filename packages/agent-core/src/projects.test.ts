import { describe, expect, it } from "vitest";
import { createShelterProject, scanBlueprint, transitionProject } from "./projects.js";
import { starterHut } from "./blueprint.js";

describe("settlement project transitions", () => {
  it("moves starter shelter from planned to completed only after verification", () => {
    let project = createShelterProject("t0");
    expect(project.status).toBe("PLANNED");
    project = transitionProject(project, { type: "site_chosen", site: { x: 8, y: 64, z: 8 } });
    expect(project.status).toBe("PROCURING");
    project = transitionProject(project, { type: "materials_ready" });
    expect(["READY_TO_BUILD", "BUILDING"]).toContain(project.status);
    project = transitionProject(project, { type: "build_progress", placed: 10, verified: 10 });
    expect(project.status).toBe("BUILDING");
    project = transitionProject(project, { type: "verified", verified: project.total, total: project.total });
    expect(project.status).toBe("COMPLETED");
  });
});

describe("placement verification", () => {
  it("counts missing and incorrect blocks against the blueprint", () => {
    const hut = starterHut();
    const origin = { x: 0, y: 64, z: 0 };
    const world = new Map<string, string>();
    world.set("0,64,0", "oak_planks");
    world.set("1,64,0", "dirt");
    const scan = scanBlueprint(hut, origin, (pos) => world.get(`${pos.x},${pos.y},${pos.z}`));
    expect(scan.expected).toBe(hut.blocks.length);
    expect(scan.correct).toBe(1);
    expect(scan.incorrect).toBe(1);
    expect(scan.missing).toBe(hut.blocks.length - 2);
  });
});
