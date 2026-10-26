import { describe, expect, it } from "vitest";
import { fail, ok } from "@civ/shared";
import { completionMemoryForTask, finalizeFoodGather, persistConfirmed } from "./executor.js";
import type { SkillContext } from "@civ/skills";

function fakeCtx(foodItems: Array<{ name: string; count: number }>): SkillContext {
  return {
    bot: {
      inventory: {
        items: () => foodItems,
      },
    },
  } as unknown as SkillContext;
}

describe("food acquisition honesty", () => {
  it("requires inventory food increase for gather success", () => {
    const ctx = fakeCtx([{ name: "bread", count: 1 }]);
    const result = finalizeFoodGather(ctx, 0, ok({ mined: true }, 10), "sweet_berry_bush");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data).toMatchObject({ acquired: true, foodGained: 1, source: "sweet_berry_bush" });
  });

  it("does not credit success when inventory food did not increase", () => {
    const ctx = fakeCtx([]);
    const result = finalizeFoodGather(ctx, 0, ok({ mined: true }, 12), "sweet_berry_bush");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.code).toBe("FOOD_NOT_ACQUIRED");
  });

  it("preserves underlying failure when attempt failed and no food gained", () => {
    const ctx = fakeCtx([]);
    const attempt = fail("BLOCK_NOT_FOUND", "no bush", 5, true);
    const result = finalizeFoodGather(ctx, 0, attempt, "sweet_berry_bush");
    expect(result).toEqual(attempt);
  });

  it("only writes gather_food memory when acquired=true", () => {
    expect(
      completionMemoryForTask("gather_food", {
        success: true,
        data: { acquired: true, foodGained: 2 },
        durationMs: 1,
      }),
    ).toContain("Newly gathered food");
    expect(
      completionMemoryForTask("gather_food", {
        success: true,
        data: { mined: true },
        durationMs: 1,
      }),
    ).toBeUndefined();
  });

  it("does not claim completed shelter without complete+persisted evidence", () => {
    expect(
      completionMemoryForTask("build_shelter", {
        success: true,
        data: { complete: false },
        durationMs: 1,
      }),
    ).toBeUndefined();
    expect(
      completionMemoryForTask("build_shelter", {
        success: true,
        data: { complete: true, persisted: false },
        durationMs: 1,
      }),
    ).toContain("not persisted");
    expect(
      completionMemoryForTask("build_shelter", {
        success: true,
        data: { complete: true, persisted: true },
        durationMs: 1,
      }),
    ).toBe("Completed build_shelter");
  });

  it("treats missing persisted flag as confirmed for non-shelter tasks", () => {
    expect(persistConfirmed({ success: true, data: {}, durationMs: 0 })).toBe(true);
    expect(persistConfirmed({ success: true, data: { foo: 1 }, durationMs: 0 })).toBe(true);
    expect(persistConfirmed({ success: true, data: { persisted: false }, durationMs: 0 })).toBe(false);
  });
});
