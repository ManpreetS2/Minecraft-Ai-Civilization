/**
 * Mission 019M — planner multi-cycle bootstrap decision contracts.
 * Fixture-supplied inventory deltas only; no fabricated dig→loot.
 */
import { describe, expect, it } from "vitest";
import type { BodyObservation, SettlementState } from "@civ/shared";
import { planCitizen, type LastOutcome, type PlannedTask } from "./planner.js";
import { resolveModelGoalForPlanner } from "./goal-dispatch.js";

const settlement = (): SettlementState => ({
  id: "settlement_first",
  name: "First Settlement",
  food: 0,
  wood: 0,
  stone: 0,
  beds: 0,
  housingCapacity: 0,
  tools: 0,
  shelterComplete: false,
  needs: [],
});

const obs = (over: Partial<BodyObservation> = {}): BodyObservation => ({
  username: "Atlas",
  connected: true,
  spawned: true,
  health: 20,
  food: 18,
  inventory: [],
  players: [],
  nearby: [],
  position: { x: 0, y: 64, z: 0 },
  gameTime: 1_000,
  isNight: false,
  ...over,
});

function classifyDecision(planned: PlannedTask): string {
  if (planned.source === "reflex") return "emergency_reflex";
  if (planned.source === "llm") return "model_selected_strategy";
  if (planned.task === "obtain_item" || planned.task === "gather_wood") return "deterministic_mechanical_prerequisite";
  if (planned.action === "observeNearby") return "heuristic_fallback";
  return "heuristic_fallback";
}

describe("Mission 019M planner bootstrap decision cycle", () => {
  it("Ticks 1–6: empty → fail → logs → obtain pickaxe → owned tool → hunger emergency", () => {
    const traces: Array<{ tick: number; action: string; item?: string; kind: string; reason: string }> = [];

    // Tick 1 — empty inventory
    const t1 = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ inventory: [] }),
      settlement: settlement(),
      assignedNeeds: [],
    });
    traces.push({ tick: 1, action: t1.action, item: t1.item, kind: classifyDecision(t1), reason: t1.reason });
    expect(t1.task).toBe("gather_wood");
    expect(t1.action).toBe("mineBlock");
    expect(["deterministic_mechanical_prerequisite", "heuristic_fallback"]).toContain(classifyDecision(t1));

    // Tick 2 — resource search fails honestly
    const failGather: LastOutcome = {
      task: "gather_wood",
      action: "mineBlock",
      success: false,
      code: "BLOCK_NOT_FOUND",
      streak: 1,
    };
    const t2 = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ inventory: [] }),
      settlement: settlement(),
      assignedNeeds: [],
      lastOutcome: failGather,
    });
    traces.push({ tick: 2, action: t2.action, item: t2.item, kind: classifyDecision(t2), reason: t2.reason });
    expect(t2.action).not.toBe("obtainItem");
    // Still empty — may retry gather or observe; must not invent pickaxe craft success
    expect(t2.item).not.toBe("wooden_pickaxe");

    // Tick 3 — verified logs appear (fixture-supplied observation delta)
    const t3 = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ inventory: [{ name: "oak_log", count: 8 }] }),
      settlement: settlement(),
      assignedNeeds: [],
      lastOutcome: { task: "gather_wood", action: "mineBlock", success: true, streak: 1 },
    });
    traces.push({ tick: 3, action: t3.action, item: t3.item, kind: classifyDecision(t3), reason: t3.reason });
    expect(t3.action).toBe("obtainItem");
    expect(t3.item).toBe("wooden_pickaxe");
    expect(classifyDecision(t3)).toBe("deterministic_mechanical_prerequisite");

    // Tick 4 — crafting prerequisites still expressed as obtainItem wooden_pickaxe
    const t4 = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        inventory: [
          { name: "oak_planks", count: 8 },
          { name: "stick", count: 4 },
        ],
      }),
      settlement: settlement(),
      assignedNeeds: [],
    });
    traces.push({ tick: 4, action: t4.action, item: t4.item, kind: classifyDecision(t4), reason: t4.reason });
    expect(t4.action).toBe("obtainItem");
    expect(t4.item).toBe("wooden_pickaxe");
    // Model goals use allowlisted survival verbs; obtainItem is a mechanical skill action.
    expect(resolveModelGoalForPlanner("craft_tools").unsupported).toBe(false);
    expect(resolveModelGoalForPlanner("become_mayor").unsupported).toBe(true);

    // Tick 5 — pickaxe acquired; do not keep crafting the same tool
    const t5 = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        inventory: [
          { name: "wooden_pickaxe", count: 1 },
          { name: "oak_log", count: 2 },
        ],
      }),
      settlement: settlement(),
      assignedNeeds: [],
    });
    traces.push({ tick: 5, action: t5.action, item: t5.item, kind: classifyDecision(t5), reason: t5.reason });
    expect(t5.item === "wooden_pickaxe" && t5.action === "obtainItem").toBe(false);

    // Tick 6 — survival pressure (hunger with food)
    const t6 = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 5,
        inventory: [
          { name: "wooden_pickaxe", count: 1 },
          { name: "bread", count: 1 },
        ],
      }),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "explore",
      llmReason: "look around",
    });
    traces.push({ tick: 6, action: t6.action, item: t6.item, kind: classifyDecision(t6), reason: t6.reason });
    expect(t6.action).toBe("eatFood");
    expect(classifyDecision(t6)).toBe("emergency_reflex");
    expect(traces).toHaveLength(6);
  });

  it("model-selected food/shelter/explore preserve allowlist autonomy", () => {
    const food = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 16,
        inventory: [{ name: "wooden_pickaxe", count: 1 }],
      }),
      settlement: { ...settlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "gather_food",
      llmReason: "hunt before night",
    });
    expect(food.source).toBe("llm");
    expect(food.action).toBe("gatherFood");
    expect(food.modelProvenance?.kind).toBe("accepted");

    const shelter = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 16,
        inventory: [
          { name: "wooden_pickaxe", count: 1 },
          { name: "oak_log", count: 16 },
        ],
      }),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "build_shelter",
      llmReason: "build a hut",
    });
    expect(shelter.source).toBe("llm");
    expect(shelter.action).toBe("buildShelter");

    const explore = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 16,
        inventory: [{ name: "wooden_pickaxe", count: 1 }],
      }),
      settlement: { ...settlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "explore",
      llmReason: "survey",
    });
    expect(explore.source).toBe("llm");
    expect(explore.action).toBe("observeNearby");
    expect(explore.action).not.toBe("mineBlock");
  });

  it("no-model heuristic still chooses supported bootstrap actions", () => {
    const empty = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ inventory: [] }),
      settlement: settlement(),
      assignedNeeds: [],
    });
    expect(empty.source).toBe("planner");
    expect(empty.action).toBe("mineBlock");
    expect(classifyDecision(empty)).toBe("deterministic_mechanical_prerequisite");
  });
});
