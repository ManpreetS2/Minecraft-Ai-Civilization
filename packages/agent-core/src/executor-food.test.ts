import { describe, expect, it } from "vitest";
import { EventBus, fail, ok } from "@civ/shared";
import type { SkillContext } from "@civ/skills";
import { executePlan, finalizeFoodGather, gatherFood } from "./executor.js";
import type { PlannedTask } from "./planner.js";
import { CivilizationStore } from "./store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type InvItem = { name: string; count: number };

function fakeCtx(items: InvItem[], entities: Array<{ id: number; name: string }> = []): SkillContext {
  return {
    citizenId: "citizen_atlas",
    body: {
      nearbyEntities: () =>
        entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: "mob",
          hostile: false,
          position: { x: 0, y: 64, z: 0 },
          distance: 3,
        })),
      nearbyPlayers: () => [],
      position: () => ({ x: 0, y: 64, z: 0 }),
      unreachable: { has: () => false },
    } as unknown as SkillContext["body"],
    bot: {
      inventory: {
        items: () => items,
      },
      registry: { blocksByName: {} },
      findBlocks: () => [],
      blockAt: () => null,
    } as unknown as SkillContext["bot"],
  };
}

describe("truthful food gathering", () => {
  it("does not credit already-owned food as newly gathered", async () => {
    const ctx = fakeCtx([{ name: "bread", count: 2 }]);
    const result = await gatherFood(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FOOD_NOT_ACQUIRED");
      expect(result.error).toMatch(/not credited as newly gathered/i);
    }
  });

  it("returns FOOD_NOT_FOUND when no food sources exist (does not mine logs)", async () => {
    const result = await gatherFood(fakeCtx([]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FOOD_NOT_FOUND");
      expect(result.error).toMatch(/not mining wood as food/i);
    }
  });

  it("does not treat successful log mining as food acquisition", () => {
    const finalized = finalizeFoodGather(fakeCtx([]), 0, ok({ mined: "oak_log" }, 12), "oak_log");
    expect(finalized.success).toBe(false);
    if (!finalized.success) {
      expect(finalized.code).toBe("FOOD_NOT_FOUND");
      expect(finalized.error).toMatch(/food did not increase/i);
    }
  });

  it("reports acquired success only when inventory food increases", () => {
    const items: InvItem[] = [];
    const ctx = fakeCtx(items);
    const before = 0;
    items.push({ name: "sweet_berries", count: 3 });
    const result = finalizeFoodGather(ctx, before, ok({ mined: "sweet_berry_bush" }, 40), "sweet_berry_bush");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        acquired: true,
        foodGained: 3,
        source: "sweet_berry_bush",
      });
    }
  });

  it("ActionCompleted food meta marks newly acquired food only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-food-"));
    const store = new CivilizationStore(join(dir, "meta.sqlite"));
    const events = new EventBus();
    const items: InvItem[] = [];
    const ctx = fakeCtx(items);
    // Force gatherFood already-held path via executePlan gatherFood action with bread present.
    const withBread = fakeCtx([{ name: "bread", count: 1 }]);
    const plan: PlannedTask = {
      goal: "gather_food",
      task: "gather_food",
      action: "gatherFood",
      source: "planner",
      reason: "need food",
      priority: 0.7,
    };
    const held = await executePlan(withBread, plan, store, events);
    expect(held.success).toBe(false);
    const failed = events.getRecent().find((e) => e.type === "ActionFailed");
    expect(failed?.payload.code).toBe("FOOD_NOT_ACQUIRED");
    expect(failed?.payload.food).toBeUndefined();

    items.push({ name: "sweet_berries", count: 2 });
    const acquired = finalizeFoodGather(ctx, 0, ok({ mined: true }, 10), "sweet_berry_bush");
    expect(acquired.success).toBe(true);
    if (acquired.success) {
      expect(acquired.data).toMatchObject({ acquired: true, foodGained: 2 });
    }
    store.close();
  });

  it("treats successful animal attack without food drops as FOOD_NOT_FOUND", () => {
    const ctx = fakeCtx([]);
    const result = finalizeFoodGather(ctx, 0, ok({ attacked: true }, 25), "cow");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FOOD_NOT_FOUND");
    }
  });

  it("preserves underlying failure codes when the gather attempt failed", () => {
    const ctx = fakeCtx([]);
    const result = finalizeFoodGather(ctx, 0, fail("BLOCK_NOT_FOUND", "no bush", 5, true), "sweet_berry_bush");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("BLOCK_NOT_FOUND");
    }
  });

  it("executePlan refuses unknown actions instead of mining wood", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-food-"));
    const store = new CivilizationStore(join(dir, "t.sqlite"));
    const events = new EventBus();
    const plan: PlannedTask = {
      goal: "gather_food",
      task: "gather_food",
      action: "gather_food",
      source: "llm",
      reason: "bad snake_case action leak",
      priority: 0.8,
    };
    const result = await executePlan(fakeCtx([]), plan, store, events);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNSUPPORTED_ACTION");
      expect(result.error).toMatch(/refusing silent wood-mining/i);
    }
    store.close();
  });
});
