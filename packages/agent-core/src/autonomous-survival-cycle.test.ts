/**
 * Mission 018M — multi-cycle autonomous survival decision tests.
 * Uses production planCitizen / chooseActivity. No fake Minecraft successes.
 */
import { describe, expect, it } from "vitest";
import type { BodyObservation, SettlementState } from "@civ/shared";
import { chooseActivity } from "./activity-choice.js";
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
  food: 20,
  inventory: [],
  players: [],
  nearby: [],
  position: { x: 0, y: 64, z: 0 },
  gameTime: 1_000,
  isNight: false,
  ...over,
});

type TraceStep = {
  tick: number;
  food: number;
  inventory: string[];
  last?: string;
  goal: string;
  task: string;
  action: string;
  source: string;
  reason: string;
};

function traceStep(tick: number, observation: BodyObservation, last: LastOutcome | undefined, planned: PlannedTask): TraceStep {
  return {
    tick,
    food: observation.food ?? 20,
    inventory: observation.inventory.map((item) => `${item.name}×${item.count}`),
    last: last ? `${last.action}:${last.code ?? (last.success ? "ok" : "fail")}#${last.streak}` : undefined,
    goal: planned.goal,
    task: planned.task,
    action: planned.action,
    source: planned.source,
    reason: planned.reason,
  };
}

function failFood(streak: number): LastOutcome {
  return {
    task: "acquire_food",
    action: "gatherFood",
    success: false,
    code: "FOOD_NOT_FOUND",
    streak,
  };
}

describe("Mission 018M autonomous survival cycles", () => {
  it("scenario 1 — food unavailable: attempt, bound retries, honest observe without inventing food", () => {
    const traces: TraceStep[] = [];
    let last: LastOutcome | undefined;
    const observation = obs({ food: 6, inventory: [] });

    for (let tick = 1; tick <= 5; tick += 1) {
      const planned = planCitizen({
        citizenId: "citizen_atlas",
        observation,
        settlement: settlement(),
        assignedNeeds: [],
        lastOutcome: last,
      });
      traces.push(traceStep(tick, observation, last, planned));
      if (tick < 4) {
        expect(planned.action).toBe("gatherFood");
        last = failFood(tick);
      } else {
        expect(planned.action).toBe("observeNearby");
        expect(planned.reason).toMatch(/exhausted/i);
        last = failFood(tick);
      }
    }

    expect(traces.map((step) => step.action)).toEqual([
      "gatherFood",
      "gatherFood",
      "gatherFood",
      "observeNearby",
      "observeNearby",
    ]);
    expect(observation.inventory).toEqual([]);
    // Readable CI artifact
    expect(traces[3]?.reason).toMatch(/not inventing food/i);
  });

  it("scenario 2 — environment improves: animals appear after food-search backoff", () => {
    const last = failFood(3);
    const blocked = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 6, inventory: [] }),
      settlement: settlement(),
      assignedNeeds: [],
      lastOutcome: last,
    });
    expect(blocked.action).toBe("observeNearby");

    const improved = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 6,
        inventory: [],
        nearby: [{ id: 1, name: "cow", type: "mob", hostile: false, position: { x: 2, y: 64, z: 2 }, distance: 4 }],
      }),
      settlement: settlement(),
      assignedNeeds: [],
      lastOutcome: last,
    });
    expect(improved.action).toBe("gatherFood");
    expect(improved.reason).toMatch(/animals/i);
  });

  it("scenario 3 — urgent hunger with held food outranks other work", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 5,
        inventory: [
          { name: "oak_log", count: 8 },
          { name: "bread", count: 2 },
        ],
      }),
      settlement: settlement(),
      assignedNeeds: ["NEED_WOOD"],
      workRole: "wood",
      lastOutcome: {
        task: "gather_wood",
        action: "mineBlock",
        success: true,
        streak: 1,
      },
    });
    expect(planned.action).toBe("eatFood");
    expect(planned.source).toBe("reflex");
  });

  it("scenario 4 — empty inventory then logs adapt the plan", () => {
    const empty = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 18, inventory: [] }),
      settlement: settlement(),
      assignedNeeds: [],
    });
    expect(empty.task).toBe("gather_wood");
    expect(empty.action).toBe("mineBlock");

    const withLogs = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 18, inventory: [{ name: "oak_log", count: 8 }] }),
      settlement: settlement(),
      assignedNeeds: [],
    });
    expect(withLogs.action).toBe("obtainItem");
    expect(withLogs.item).toBe("wooden_pickaxe");
    expect(withLogs.action).not.toBe("mineBlock");

    const choice = chooseActivity({
      citizenId: "citizen_atlas",
      observation: obs({ food: 18, inventory: [{ name: "oak_log", count: 8 }] }),
      heldFood: 0,
    });
    expect(choice.option.id).toBe("obtain_tool");
    expect(choice.option.item).toBe("wooden_pickaxe");
  });

  it("scenario 5 — repeated unreachable seek_shelter backs off without false arrival", () => {
    const day = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 16,
        isNight: false,
        gameTime: 1_000,
        inventory: [{ name: "wooden_pickaxe", count: 1 }],
      }),
      settlement: { ...settlement(), shelterComplete: true },
      assignedNeeds: [],
      home: undefined,
      lastOutcome: {
        task: "seek_shelter",
        action: "seekSafety",
        success: false,
        code: "PATH_BLOCKED",
        streak: 3,
      },
    });
    expect(day.action).toBe("observeNearby");
    expect(day.reason).toMatch(/unreachable|back off/i);
    expect(day.reason).not.toMatch(/arrived|teleport/i);
  });

  it("scenario 6 — nighttime safety without inventing a home", () => {
    const noHome = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 16, isNight: true, gameTime: 14_000 }),
      settlement: settlement(),
      assignedNeeds: [],
    });
    expect(noHome.action).toBe("seekSafety");
    expect(noHome.item).toBeUndefined();

    const withHome = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 16, isNight: true, gameTime: 14_000, position: { x: 10, y: 64, z: 10 } }),
      settlement: settlement(),
      assignedNeeds: [],
      home: {
        homeId: "home_h9",
        bed: { x: 12, y: 64, z: 12 },
        status: "active",
        origin: { x: 12, y: 64, z: 12 },
      },
    });
    expect(["sleep", "seekSafety"]).toContain(withHome.action);
  });

  it("scenario 7 — unsupported model goal fails closed", () => {
    const mapped = resolveModelGoalForPlanner("become_mayor");
    expect(mapped.unsupported).toBe(true);

    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 18 }),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "become_mayor",
      llmReason: "seize power",
    });
    expect(planned.action).not.toBe("become_mayor");
    expect(planned.task === "unsupported_goal" || planned.modelProvenance?.kind === "rejected_unsupported" || planned.source === "llm").toBe(
      true,
    );
  });

  it("scenario 8 — survival emergency outranks model proposal", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 5,
        inventory: [{ name: "cooked_beef", count: 1 }],
      }),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "gather_wood",
      llmReason: "expand the lumber stockpile",
    });
    expect(planned.action).toBe("eatFood");
    expect(planned.source).toBe("reflex");
  });

  it("prints a deterministic multi-cycle decision trace artifact", () => {
    const lines: string[] = [];
    let last: LastOutcome | undefined;
    const food = 6;

    for (let tick = 1; tick <= 6; tick += 1) {
      // Animals appear only after backoff has forced an observe cycle.
      const observation = obs({
        food,
        inventory: [],
        nearby:
          tick >= 5
            ? [{ id: 1, name: "cow", type: "mob", hostile: false, position: { x: 1, y: 64, z: 1 }, distance: 3 }]
            : [],
      });
      const planned = planCitizen({
        citizenId: "citizen_atlas",
        observation,
        settlement: settlement(),
        assignedNeeds: [],
        lastOutcome: last,
      });
      const step = traceStep(tick, observation, last, planned);
      lines.push(
        `t${step.tick} food=${step.food} inv=[${step.inventory.join(",")}] last=${step.last ?? "-"} → ${step.action} (${step.source}) ${step.reason}`,
      );
      if (planned.action === "gatherFood" && tick <= 3) {
        last = failFood(tick);
      } else if (planned.action === "observeNearby") {
        last = failFood(3);
      } else if (planned.action === "gatherFood" && tick >= 5) {
        last = { task: "acquire_food", action: "gatherFood", success: false, code: "FOOD_NOT_FOUND", streak: 1 };
      }
    }

    expect(lines[0]).toMatch(/gatherFood/);
    expect(lines.some((line) => /observeNearby/.test(line))).toBe(true);
    expect(lines.some((line) => /animals/i.test(line) && /gatherFood/.test(line))).toBe(true);
    expect(lines.length).toBe(6);
  });
});
