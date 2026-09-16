import { describe, expect, it } from "vitest";
import { CognitiveStore, createIdFactory, mutableClock, taskOutcomeEvent, type WorldSnapshot } from "@civ/memory";
import { CitizenMind } from "./mind.js";
import { recordHabit } from "./habits.js";
import { applyPsychDeltas, defaultPsych } from "./psych.js";
import { decayAssociation } from "./associations.js";
import { buildCognitionContext } from "./context.js";
import { prepareReflection, detectReflectionTrigger } from "./reflection.js";
import { citizenDeathEvent } from "@civ/memory";

describe("habits and psych deltas", () => {
  it("forms a reversible habit from repeated context+action without hardcoding potatoes", () => {
    const at = "2026-09-16T12:00:00.000Z";
    let habit = recordHabit(undefined, "citizen_atlas", "stress_high|settlement_safe", "farm", true, at, "h1");
    habit = recordHabit(habit, "citizen_atlas", "stress_high|settlement_safe", "farm", true, at, "h1");
    habit = recordHabit(habit, "citizen_atlas", "stress_high|settlement_safe", "farm", true, at, "h1");
    expect(habit.occurrences).toBe(3);
    expect(habit.strength).toBeGreaterThan(0.2);
    const weakened = recordHabit(habit, "citizen_atlas", "stress_high|settlement_safe", "farm", false, at, "h1");
    expect(weakened.strength).toBeLessThan(habit.strength);
  });

  it("keeps psych deltas bounded", () => {
    const next = applyPsychDeltas(defaultPsych("citizen_atlas", "t"), { fearDelta: 5, moodDelta: -4 }, "t");
    expect(next.fear).toBeLessThanOrEqual(0.2);
    expect(next.moodValence).toBeGreaterThanOrEqual(-0.2);
  });

  it("decays associations over time", () => {
    const decayed = decayAssociation(
      {
        id: "a",
        citizenId: "citizen_atlas",
        subjectType: "entity",
        subjectKey: "creeper",
        associationType: "danger",
        strength: 0.8,
        confidence: 0.7,
        supportingMemoryIds: [],
        lastReinforcedAt: "t",
      },
      10,
    );
    expect(decayed.strength).toBeLessThan(0.8);
  });
});

describe("cognition context and reflection", () => {
  it("builds a limited context instead of full history", () => {
    const store = new CognitiveStore(":memory:");
    const runtime = new CitizenMind(store, {
      clock: mutableClock(),
      id: createIdFactory("ctx"),
    });
    const snapshot: WorldSnapshot = {
      nearbyRadius: 24,
      citizens: [{ id: "citizen_atlas", name: "Atlas", position: { x: 0, y: 64, z: 0 }, hunger: 12, health: 18 }],
    };
    for (let i = 0; i < 6; i += 1) {
      runtime.ingest(
        taskOutcomeEvent({ citizenId: "citizen_atlas", activity: "gather_wood", success: true }),
        snapshot,
      );
    }
    const ctx = buildCognitionContext(store, {
      citizenId: "citizen_atlas",
      name: "Atlas",
      currentGoal: "gather_wood",
      hunger: 12,
      snapshot,
    });
    expect(ctx.relevantMemories.length).toBeLessThanOrEqual(8);
    expect(ctx.mood.citizenId).toBe("citizen_atlas");
    expect(ctx.uncertainty).toBeGreaterThanOrEqual(0);
  });

  it("detects rare reflection triggers without calling a model", () => {
    const trigger = detectReflectionTrigger({
      citizenId: "citizen_atlas",
      event: citizenDeathEvent({ deceasedId: "citizen_ava", cause: "creeper" }),
      salience: 0.8,
      id: "r1",
      at: "t",
    });
    expect(trigger?.kind).toBe("close_citizen_death");
    const prepared = prepareReflection({
      trigger: trigger!,
      relevantMemories: [],
      psychState: defaultPsych("citizen_atlas", "t"),
      socialBeliefs: [],
    });
    expect(prepared.summary).toMatch(/close_citizen_death/);
  });
});
