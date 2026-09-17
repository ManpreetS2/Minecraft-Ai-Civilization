import { describe, expect, it } from "vitest";
import type { BodyObservation, SettlementState } from "@civ/shared";
import { assignSettlementNeeds, planCitizen } from "./planner.js";

const emptySettlement = (): SettlementState => ({
  id: "settlement_first",
  name: "First Settlement",
  food: 0,
  wood: 0,
  stone: 0,
  beds: 0,
  housingCapacity: 0,
  tools: 0,
  shelterComplete: false,
  needs: ["NEED_FOOD", "NEED_WOOD", "NEED_HOUSING"],
});

const obs = (over: Partial<BodyObservation> = {}): BodyObservation => ({
  username: "Atlas",
  connected: true,
  spawned: true,
  health: 20,
  food: 20,
  inventory: [],
  players: [],
  nearby: [],
  ...over,
});

describe("planCitizen", () => {
  it("flees when health is critical near a hostile", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        health: 5,
        nearby: [
          {
            id: 1,
            name: "zombie",
            type: "mob",
            hostile: true,
            position: { x: 1, y: 64, z: 1 },
            distance: 4,
          },
        ],
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
    });
    expect(planned.action).toBe("flee");
    expect(planned.source).toBe("reflex");
  });

  it("eats when hungry and food is held", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 6, inventory: [{ name: "bread", count: 2 }] }),
      settlement: emptySettlement(),
      assignedNeeds: ["NEED_WOOD"],
    });
    expect(planned.action).toBe("eatFood");
  });

  it("does not send everyone to gather wood just because it is night", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: true,
        inventory: [
          { name: "wooden_pickaxe", count: 1 },
          { name: "oak_planks", count: 16 },
        ],
      }),
      settlement: {
        ...emptySettlement(),
        food: 20,
        wood: 40,
        stone: 40,
        tools: 4,
        needs: ["NEED_HOUSING"],
      },
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
    });
    expect(planned.task).not.toBe("gather_wood");
    expect(planned.action).toBe("buildShelter");
  });

  it("does not treat empty settlement reserve as personal starvation when steak is carried", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 14, inventory: [{ name: "cooked_beef", count: 64 }] }),
      settlement: { ...emptySettlement(), food: 0, needs: ["NEED_FOOD"] },
      assignedNeeds: [],
      workRole: "wood",
    });
    expect(planned.action).not.toBe("gatherFood");
    expect(planned.reason.toLowerCase()).not.toMatch(/no food|has no food|starv/);
  });

  it("prefers existing shelter at night once it is verified", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({ isNight: true }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
    });
    expect(planned.action).toBe("seekSafety");
  });

  it("follows a human directive unless an emergency reflex fires", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: emptySettlement(),
      assignedNeeds: ["NEED_FOOD"],
      humanDirective: { id: "d1", intent: "gather_wood", mode: "DIRECTIVE" },
    });
    expect(planned.task).toBe("gather_wood");
    expect(planned.directiveId).toBe("d1");
  });

  it("lets emergency reflex beat a human directive", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        health: 5,
        nearby: [{ id: 1, name: "zombie", type: "mob", hostile: true, position: { x: 1, y: 64, z: 1 }, distance: 3 }],
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      humanDirective: { id: "d1", intent: "gather_wood", mode: "ADMIN_OVERRIDE" },
    });
    expect(planned.action).toBe("flee");
  });

  it("gathers wood after a shelter oak_door prerequisite failure instead of rebuilding immediately", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({ inventory: [{ name: "oak_log", count: 2 }] }),
      settlement: { ...emptySettlement(), needs: ["NEED_HOUSING"] },
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
      lastOutcome: {
        task: "build_shelter",
        action: "buildShelter",
        success: false,
        code: "MISSING_INGREDIENT",
        error: "Need more wood for the shelter",
        item: "oak_door",
        nextTask: "gather_wood",
        streak: 1,
      },
    });
    expect(planned.task).toBe("gather_wood");
    expect(planned.action).toBe("mineBlock");
  });

  it("deposits when the last mining action reported a full inventory", () => {
    const planned = planCitizen({
      citizenId: "citizen_ava",
      observation: obs({ inventory: [{ name: "oak_log", count: 64 }] }),
      settlement: emptySettlement(),
      assignedNeeds: ["NEED_WOOD"],
      workRole: "wood",
      lastOutcome: {
        task: "gather_wood",
        action: "mineBlock",
        success: false,
        code: "INVENTORY_FULL",
        error: "Inventory is full",
        streak: 1,
      },
    });
    expect(planned.action).toBe("depositItems");
  });
});

describe("assignSettlementNeeds", () => {
  it("spreads needs across citizens", () => {
    const assigned = assignSettlementNeeds(["a", "b", "c"], ["NEED_FOOD", "NEED_WOOD", "NEED_STONE"]);
    expect(assigned.get("a")).toEqual(["NEED_FOOD"]);
    expect(assigned.get("b")).toEqual(["NEED_WOOD"]);
    expect(assigned.get("c")).toEqual(["NEED_STONE"]);
  });
});
