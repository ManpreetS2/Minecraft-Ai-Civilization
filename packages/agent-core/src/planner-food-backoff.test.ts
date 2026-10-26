import { describe, expect, it } from "vitest";
import type { BodyObservation, SettlementState } from "@civ/shared";
import { planCitizen } from "./planner.js";

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
  needs: ["NEED_FOOD"],
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

describe("planner food-search backoff (Day 2)", () => {
  it("stops spinning acquire_food after FOOD_NOT_FOUND and tries fishing when possible", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 6,
        inventory: [{ name: "fishing_rod", count: 1 }],
        position: { x: -1043.5, y: 63, z: 981.5 },
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      visibleShores: [{ stand: { x: -1043, y: 63, z: 980 }, water: { x: -1044, y: 62, z: 980 } }],
      lastOutcome: {
        task: "acquire_food",
        action: "gatherFood",
        success: false,
        code: "FOOD_NOT_FOUND",
        streak: 3,
      },
    });
    expect(planned.action).toBe("fishShore");
    expect(planned.target).toEqual({ x: -1043, y: 63, z: 980 });
  });

  it("observes honestly when food search is exhausted and fishing is unavailable", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 6, inventory: [] }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      lastOutcome: {
        task: "acquire_food",
        action: "gatherFood",
        success: false,
        code: "FOOD_NOT_FOUND",
        streak: 3,
      },
    });
    expect(planned.action).toBe("observeNearby");
    expect(planned.reason).toMatch(/exhausted/i);
  });
});
