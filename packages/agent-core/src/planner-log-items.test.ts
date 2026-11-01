import { describe, expect, it } from "vitest";
import { LOG_BLOCK_NAMES, type BodyObservation, type SettlementState } from "@civ/shared";
import { planCitizen } from "./planner.js";

const settlement = (): SettlementState => ({
  id: "settlement_first", name: "First Settlement", food: 0, wood: 0, stone: 0, beds: 0, housingCapacity: 0, tools: 0,
  shelterComplete: false, needs: ["NEED_FOOD", "NEED_WOOD", "NEED_HOUSING"],
});
const plan = (inventory: Array<{ name: string; count: number }>) =>
  planCitizen({
    citizenId: "citizen_atlas",
    observation: { username: "Atlas", connected: true, spawned: true, health: 20, food: 20, inventory, players: [], nearby: [] } as BodyObservation,
    settlement: settlement(),
    assignedNeeds: [],
  });

describe("planner LOG_ITEMS covers every gatherable log (BASE-003 review)", () => {
  it("control: an empty inventory gathers wood", () => {
    expect(plan([]).task).toBe("gather_wood");
  });
  it.each([...LOG_BLOCK_NAMES])("holding 4 %s the planner crafts a pickaxe instead of gathering wood again", (log) => {
    const planned = plan([{ name: log, count: 4 }]);
    expect(planned.task).toBe("obtain_item");
    expect(planned.item).toBe("wooden_pickaxe");
  });
});
