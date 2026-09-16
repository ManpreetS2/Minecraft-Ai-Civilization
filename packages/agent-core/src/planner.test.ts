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
      observation: obs({ isNight: true }),
      settlement: emptySettlement(),
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
    });
    expect(planned.task).not.toBe("gather_wood");
    expect(planned.action).toBe("buildShelter");
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
});

describe("assignSettlementNeeds", () => {
  it("spreads needs across citizens", () => {
    const assigned = assignSettlementNeeds(["a", "b", "c"], ["NEED_FOOD", "NEED_WOOD", "NEED_STONE"]);
    expect(assigned.get("a")).toEqual(["NEED_FOOD"]);
    expect(assigned.get("b")).toEqual(["NEED_WOOD"]);
    expect(assigned.get("c")).toEqual(["NEED_STONE"]);
  });
});
