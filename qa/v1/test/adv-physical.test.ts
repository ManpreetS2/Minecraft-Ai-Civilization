import { describe, expect, it } from "vitest";
import { EventBus } from "@civ/shared";
import { executePlan, type PlannedTask } from "@civ/agent-core";
import { createMineflayerCraftFixture } from "@civ/skills/testing";
import { caseTitle } from "../src/scenario.js";
import { installNoNetworkGuard, useStores } from "../src/fixture.js";

installNoNetworkGuard();
const newStore = useStores();

const plan = (over: Partial<PlannedTask>): PlannedTask =>
  ({ goal: "g", task: "t", action: "gatherFood", source: "planner", reason: "qa", priority: 1, ...over }) as PlannedTask;
const world = (trees: Array<{ x: number; z: number; height: number }>) => {
  const fx = createMineflayerCraftFixture({ trees });
  fx.bot.food = 5;
  return fx;
};
const run = (fx: ReturnType<typeof world>, p: PlannedTask) => {
  const store = newStore();
  const events = new EventBus();
  return executePlan(fx.ctx, p, store, events).then((result) => ({ result }));
};

describe("survival truthfulness: failed actions never create success records", () => {
  it(caseTitle("ADV-04", "gather food in a world with only trees fails, adds no food, and does not report logs as food"), async () => {
    const fx = world([{ x: 6, z: 3, height: 6 }]);
    const before = fx.items.map((s) => `${s.name}x${s.count}`).join();
    const { result } = await run(fx, plan({ action: "gatherFood", task: "gather_food", goal: "gather_food" }));
    const foodNames = /bread|apple|beef|pork|mutton|chicken|cod|salmon|berries|carrot|potato|melon|cooked/;
    expect(fx.items.filter((s) => foodNames.test(s.name))).toEqual([]);
    if (result.success) {
      // If the executor reports success it must name food it actually holds; logs are not food.
      expect(JSON.stringify(result)).not.toMatch(/log/);
      expect(fx.items.some((s) => foodNames.test(s.name))).toBe(true);
    } else {
      expect(result.code).toBeTruthy();
    }
    expect(before).toBeDefined();
  });

  it(caseTitle("ADV-06", "crafting without the required ingredients fails with a typed code and leaves the inventory unchanged"), async () => {
    const fx = world([]);
    const before = fx.totalItems();
    const { result } = await run(fx, plan({ action: "craftItem", task: "craft_item", item: "stone_pickaxe", count: 1 }));
    expect(result.success).toBe(false);
    expect(fx.totalItems()).toBe(before);
    expect(fx.stats.craftCalls.filter((c) => c.crafts > 0)).toEqual([]);
  });

  it(caseTitle("ADV-06", "returning home without a claimed home is a typed failure and the body does not move"), async () => {
    const fx = world([]);
    const start = { ...fx.bot.entity.position };
    const { result } = await run(fx, plan({ action: "returnHome", task: "return_home" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("HOME_MISSING");
    expect(fx.bot.entity.position).toMatchObject(start);
  });

  it(caseTitle("ADV-06", "withdrawing when no chest is known fails and adds nothing to the inventory"), async () => {
    const fx = world([]);
    const before = fx.totalItems();
    const { result } = await run(fx, plan({ action: "withdrawItems", task: "withdraw_food", item: "bread", count: 4 }));
    expect(result.success).toBe(false);
    expect(fx.totalItems()).toBe(before);
    expect(fx.count("bread")).toBe(0);
  });
});

describe("unknown or forged model actions", () => {
  it.each(["teleportHome", "runShellCommand", "gatherFood; opSelf", "__proto__"])(
    caseTitle("ADV-05", "a model-originated action named %j is rejected, never defaulted to mining logs"),
    async (action) => {
      const fx = world([{ x: 6, z: 3, height: 6 }]);
      const before = fx.totalItems();
      const { result } = await run(fx, plan({ action: action as never, source: "llm", goal: action, task: action }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe("UNSUPPORTED_ACTION");
      expect(fx.totalItems()).toBe(before);
      expect(fx.stats.digs).toEqual([]);
    },
  );
});

/** The assertions must catch deliberately vulnerable behaviour, otherwise a green result proves nothing. */
describe("meta: the physical assertions fail against a vulnerable executor", () => {
  const vulnerable = async (fx: ReturnType<typeof world>) => {
    fx.items.push({ name: "oak_log", count: 1 } as never);
    return { success: true as const, data: { food: "oak_log" }, durationMs: 0 };
  };
  it(caseTitle("ADV-05", "a legacy fail-open executor (unknown action mines a log) is detected"), async () => {
    const fx = world([{ x: 6, z: 3, height: 6 }]);
    const before = fx.totalItems();
    const result = await vulnerable(fx);
    expect(() => {
      expect(result.success).toBe(false);
      expect(fx.totalItems()).toBe(before);
    }).toThrow();
  });
  it(caseTitle("ADV-04", "an executor that reports a mined log as food is detected"), async () => {
    const fx = world([{ x: 6, z: 3, height: 6 }]);
    const result = await vulnerable(fx);
    const foodNames = /bread|apple|beef|pork|mutton|chicken|cod|salmon|berries|carrot|potato|melon|cooked/;
    expect(() => expect(fx.items.some((s) => foodNames.test(s.name))).toBe(true)).toThrow();
    expect(JSON.stringify(result)).toMatch(/log/);
  });
});
