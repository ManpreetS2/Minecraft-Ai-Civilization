import { describe, expect, it } from "vitest";
import { LOG_BLOCK_NAMES } from "@civ/shared";
import { listActivityOptions } from "./activity-choice.js";

function optionIds(inventory: Array<{ name: string; count: number }>): string[] {
  const obs = { position: { x: 0, y: 64, z: 0 }, health: 20, food: 20, inventory, nearby: [], players: [], spawned: true } as never;
  const out = listActivityOptions({ observation: obs, citizenId: "c", heldFood: 0 } as never);
  return out.options.map((o: { id: string }) => o.id);
}

describe("bootstrap wood lists cover every gatherable log type", () => {
  it("empty inventory offers gather_wood and not obtain_tool", () => {
    const ids = optionIds([]);
    expect(ids).toContain("gather_wood");
    expect(ids).not.toContain("obtain_tool");
  });

  it.each([...LOG_BLOCK_NAMES])("holding 4 %s offers obtain_tool (not another gather_wood)", (log) => {
    const ids = optionIds([{ name: log, count: 4 }]);
    expect(ids).toContain("obtain_tool");
    expect(ids).not.toContain("gather_wood");
  });

  it.each([...LOG_BLOCK_NAMES])("holding 8 %s planks offers obtain_tool", (log) => {
    const ids = optionIds([{ name: log.replace(/_log$/, "_planks"), count: 8 }]);
    expect(ids).toContain("obtain_tool");
  });
});
