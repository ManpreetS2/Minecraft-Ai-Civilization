import { describe, expect, it } from "vitest";
import { checkModelBudget, countCitizenBudgetUsage, type BudgetCallRecord } from "./model-budget.js";

describe("model budget guards", () => {
  it("tracks budgets independently per citizen", () => {
    const history: BudgetCallRecord[] = [
      { citizenId: "citizen_atlas", category: "ROUTINE", atMs: 1000, mcDay: 0 },
      { citizenId: "citizen_atlas", category: "ROUTINE", atMs: 2000, mcDay: 0 },
      { citizenId: "citizen_maya", category: "ROUTINE", atMs: 3000, mcDay: 0 },
    ];
    const atlas = checkModelBudget("citizen_atlas", "ROUTINE", history, {
      maxCallsPerCitizenPerMcDay: 2,
      maxRoutineCallsPerWindow: 8,
      routineWindowMs: 60_000,
      maxDeepReflectionCallsPerMcDay: 4,
    }, 4000, 0);
    expect(atlas.allowed).toBe(false);
    expect(atlas.reason).toMatch(/MODEL_BUDGET_EXHAUSTED/);

    const maya = checkModelBudget("citizen_maya", "ROUTINE", history, {
      maxCallsPerCitizenPerMcDay: 2,
      maxRoutineCallsPerWindow: 8,
      routineWindowMs: 60_000,
      maxDeepReflectionCallsPerMcDay: 4,
    }, 4000, 0);
    expect(maya.allowed).toBe(true);
    expect(countCitizenBudgetUsage("citizen_atlas", history, 0)).toBe(2);
    expect(countCitizenBudgetUsage("citizen_maya", history, 0)).toBe(1);
  });

  it("never blocks NO_LLM / emergency path", () => {
    const history: BudgetCallRecord[] = Array.from({ length: 50 }, (_, i) => ({
      citizenId: "citizen_atlas",
      category: "ROUTINE" as const,
      atMs: i,
      mcDay: 0,
    }));
    const decision = checkModelBudget("citizen_atlas", "NO_LLM", history, undefined, 999, 0);
    expect(decision.allowed).toBe(true);
    expect(decision.emergencyBypass).toBe(true);
  });

  it("enforces deep reflection and routine window limits separately", () => {
    const now = 50_000;
    const history: BudgetCallRecord[] = [
      { citizenId: "a", category: "DEEP_REFLECTION", atMs: 1, mcDay: 1 },
      { citizenId: "a", category: "DEEP_REFLECTION", atMs: 2, mcDay: 1 },
      { citizenId: "a", category: "ROUTINE", atMs: now - 1000, mcDay: 1 },
      { citizenId: "a", category: "ROUTINE", atMs: now - 500, mcDay: 1 },
    ];
    const deep = checkModelBudget(
      "a",
      "DEEP_REFLECTION",
      history,
      {
        maxCallsPerCitizenPerMcDay: 100,
        maxRoutineCallsPerWindow: 2,
        routineWindowMs: 10_000,
        maxDeepReflectionCallsPerMcDay: 2,
      },
      now,
      1,
    );
    expect(deep.allowed).toBe(false);
    expect(deep.reason).toMatch(/deep_reflection/);

    const routine = checkModelBudget(
      "a",
      "ROUTINE",
      history,
      {
        maxCallsPerCitizenPerMcDay: 100,
        maxRoutineCallsPerWindow: 2,
        routineWindowMs: 10_000,
        maxDeepReflectionCallsPerMcDay: 2,
      },
      now,
      1,
    );
    expect(routine.allowed).toBe(false);
    expect(routine.reason).toMatch(/routine_window/);
  });
});
