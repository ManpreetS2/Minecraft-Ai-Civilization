import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus } from "@civ/shared";
import { CivilizationStore } from "./store.js";
import { DirectiveBoard } from "./directives.js";
import { intentToPlan } from "./directive-parse.js";
import { starterHut, starterHutSize } from "./blueprint.js";
import { planCitizen } from "./planner.js";

describe("compact starter hut", () => {
  it("stays smaller than the original 101-block 5x5x3 hut", () => {
    const hut = starterHut();
    const size = starterHutSize();
    expect(size.width).toBe(5);
    expect(size.depth).toBe(4);
    expect(size.wallHeight).toBe(2);
    expect(hut.blocks.length).toBeLessThan(85);
    expect(hut.blocks.length).toBeGreaterThan(40);
  });
});

describe("persisted human directives", () => {
  it("issues, lists, and completes a gather-wood directive", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-dir-"));
    const store = new CivilizationStore(join(dir, "civ.sqlite"));
    const events = new EventBus();
    const board = new DirectiveBoard(store, events, () => true, () => "run-1");
    const issued = board.issue({
      instruction: "Atlas get some wood",
      mode: "DIRECTIVE",
      citizens: [{ id: "citizen_atlas", name: "Atlas" }],
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.directives[0]?.intent).toBe("gather_wood");
    expect(board.activeFor("citizen_atlas")?.id).toBe(issued.directives[0]?.id);
    board.mark(issued.directives[0]!.id, "COMPLETED", undefined, "Verified gather_wood");
    expect(board.activeFor("citizen_atlas")).toBeUndefined();
    expect(store.listDirectives()[0]?.status).toBe("COMPLETED");
    store.close();
  });
});

describe("intent mapping", () => {
  it("turns obtain stone pickaxe into a prerequisite-owned skill", () => {
    expect(intentToPlan("craft_tools", { item: "stone_pickaxe" })).toEqual({
      goal: "stone_pickaxe",
      task: "obtain_item",
      action: "obtainItem",
    });
    expect(intentToPlan("contribute_to_project").action).toBe("buildShelter");
  });
});

describe("planner obtain chain", () => {
  it("plans obtainItem from a human stone-pickaxe directive", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: {
        username: "Atlas",
        connected: true,
        spawned: true,
        health: 20,
        food: 20,
        inventory: [],
        players: [],
        nearby: [],
      },
      settlement: {
        id: "settlement_first",
        name: "First Settlement",
        food: 20,
        wood: 20,
        stone: 20,
        beds: 0,
        housingCapacity: 0,
        tools: 0,
        shelterComplete: false,
        needs: [],
      },
      assignedNeeds: [],
      humanDirective: { id: "d2", intent: "craft_tools", mode: "DIRECTIVE", args: { item: "stone_pickaxe" } },
    });
    expect(planned.action).toBe("obtainItem");
    expect(planned.item).toBe("stone_pickaxe");
  });
});
