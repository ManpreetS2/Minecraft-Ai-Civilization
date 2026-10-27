import { describe, expect, it } from "vitest";
import type { BodyObservation, SettlementState } from "@civ/shared";
import { WORLD_LAB_CLAIMABLE_HOMES } from "./available-homes.js";
import type { BuildStructureProject } from "./build-structure.js";
import { planCitizen, shouldBackoffModelProposal, type PlannedTask } from "./planner.js";

const emptySettlement = (): SettlementState => ({
  id: "settlement_first",
  name: "First Settlement",
  food: 0,
  wood: 0,
  stone: 0,
  beds: 0,
  housingCapacity: 0,
  tools: 0,
  shelterComplete: true,
  needs: [],
});

const obs = (over: Partial<BodyObservation> = {}): BodyObservation => ({
  username: "Maya",
  connected: true,
  spawned: true,
  health: 20,
  food: 20,
  inventory: [{ name: "wooden_pickaxe", count: 1 }, { name: "oak_log", count: 8 }],
  players: [],
  nearby: [],
  position: { x: -1043.5, y: 63, z: 981.5 },
  isNight: false,
  gameTime: 1_000,
  ...over,
});

function homelessDay(over: Parameters<typeof planCitizen>[0] extends infer P ? Partial<P> : never = {}) {
  return planCitizen({
    citizenId: "citizen_maya",
    observation: obs(),
    settlement: emptySettlement(),
    assignedNeeds: [],
    availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    ...over,
  });
}

/** Offline multi-tick trace: pendingLlm arrives on a later tick, then is consumed once. */
function simulatePendingLlmTicks(params: {
  ticks: Array<{ llmGoal?: string; llmReason?: string; observation?: Partial<BodyObservation> }>;
}): PlannedTask[] {
  return params.ticks.map((tick) =>
    homelessDay({
      observation: obs(tick.observation ?? {}),
      llmGoal: tick.llmGoal,
      llmReason: tick.llmReason,
    }),
  );
}

describe("Mission 010B — citizen autonomy precedence", () => {
  it("1. homeless + safe daytime + LLM gather_food → gatherFood", () => {
    const planned = homelessDay({
      llmGoal: "gather_food",
      llmReason: "Find berries before night",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("gatherFood");
    expect(planned.modelProvenance).toEqual({ kind: "accepted", goal: "gather_food" });
  });

  it("2. homeless + safe daytime + LLM build_shelter → buildShelter", () => {
    const planned = homelessDay({
      settlement: { ...emptySettlement(), shelterComplete: false, wood: 24 },
      llmGoal: "build_shelter",
      llmReason: "I will build a hut",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("buildShelter");
    expect(planned.modelProvenance?.kind).toBe("accepted");
  });

  it("3. homeless + model explore → observeNearby (no automatic housing override)", () => {
    const planned = homelessDay({
      llmGoal: "explore",
      llmReason: "Survey the area first",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("observeNearby");
    expect(planned.action).not.toBe("travelTowardHousing");
    expect(planned.action).not.toBe("claimHome");
  });

  it("4. homeless + critical danger → safety intervention overrides model", () => {
    const planned = homelessDay({
      observation: obs({
        health: 5,
        nearby: [
          {
            id: 1,
            name: "zombie",
            type: "mob",
            hostile: true,
            position: { x: -1042, y: 63, z: 981 },
            distance: 3,
          },
        ],
      }),
      llmGoal: "gather_food",
      llmReason: "food",
    });
    expect(planned.source).toBe("reflex");
    expect(planned.action).toBe("flee");
    expect(planned.source).not.toBe("llm");
  });

  it("5. nighttime + actual threat → survival response (not model food)", () => {
    // distance 9: past reflex flee (<8) but still a nearby hostile (<10) for safety override
    const planned = homelessDay({
      observation: obs({
        isNight: true,
        gameTime: 14_000,
        nearby: [
          {
            id: 2,
            name: "skeleton",
            type: "mob",
            hostile: true,
            position: { x: -1042, y: 63, z: 981 },
            distance: 9,
          },
        ],
      }),
      llmGoal: "gather_food",
      llmReason: "still hungry",
    });
    expect(planned.action).toBe("seekSafety");
    expect(planned.source).not.toBe("llm");
    expect(planned.modelProvenance?.kind).toBe("overridden_safety");
  });

  it("6. nighttime + safe + model gather_food → accept model (no forced housing)", () => {
    const planned = homelessDay({
      observation: obs({ isNight: true, gameTime: 14_000, nearby: [] }),
      llmGoal: "gather_food",
      llmReason: "Night foraging is my choice",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("gatherFood");
    expect(planned.action).not.toBe("travelTowardHousing");
  });

  it("7. no LLM proposal → deterministic housing fallback when homeless", () => {
    const planned = homelessDay();
    expect(planned.source).toBe("planner");
    expect(planned.action).toBe("travelTowardHousing");
    expect(planned.modelProvenance).toEqual({ kind: "absent_fallback" });
  });

  it("8. unsupported LLM proposal → fail closed", () => {
    const planned = homelessDay({
      llmGoal: "teleport_home",
      llmReason: "warp",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("deferCapability");
    expect(planned.modelProvenance?.kind).toBe("rejected_unsupported");
  });

  it("9. repeated failed proposal → bounded backoff to deterministic path", () => {
    expect(
      shouldBackoffModelProposal({
        citizenId: "citizen_maya",
        observation: obs(),
        settlement: emptySettlement(),
        assignedNeeds: [],
        llmGoal: "gather_food",
        llmReason: "again",
        lastOutcome: {
          task: "gather_food",
          action: "gatherFood",
          success: false,
          code: "FOOD_NOT_FOUND",
          streak: 3,
          retryable: false,
        },
      }),
    ).toBe(true);

    const planned = homelessDay({
      llmGoal: "gather_food",
      llmReason: "again",
      lastOutcome: {
        task: "gather_food",
        action: "gatherFood",
        success: false,
        code: "TIMEOUT",
        streak: 3,
        retryable: true,
      },
    });
    expect(planned.source).toBe("planner");
    expect(planned.action).not.toBe("gatherFood");
    expect(planned.source).not.toBe("llm");
    expect(planned.modelProvenance?.kind).toBe("backoff_fallback");
  });

  it("10–11. async pendingLlm on later tick; proposal consumed once (no duplicate)", () => {
    const ticks = simulatePendingLlmTicks({
      ticks: [
        { observation: { food: 20 } },
        { llmGoal: "gather_food", llmReason: "pending arrived", observation: { food: 20 } },
        { observation: { food: 20 } },
      ],
    });
    expect(ticks[0]?.source).toBe("planner");
    expect(ticks[0]?.action).toBe("travelTowardHousing");
    expect(ticks[1]?.source).toBe("llm");
    expect(ticks[1]?.action).toBe("gatherFood");
    expect(ticks[2]?.source).toBe("planner");
    expect(ticks[2]?.action).toBe("travelTowardHousing");
    expect(ticks.filter((t) => t.source === "llm")).toHaveLength(1);
  });

  it("12. construction-session resume remains ahead of model food", () => {
    const constructionProject: BuildStructureProject = {
      id: "proj_1",
      type: "STRUCTURE_BUILD",
      status: "PROCURING",
      stage: "FOUNDATION",
      ownerCitizenId: "citizen_maya",
      blueprintId: "workshop_cabin",
      site: { x: 0, y: 70, z: 0 },
      requiredResources: { oak_log: 8 },
      reservedResources: {},
      blocked: [],
      placed: 0,
      total: 10,
      verified: 0,
      startedAt: "2026-10-27T00:00:00.000Z",
      materialShortfall: { oak_log: 8 },
    };
    const planned = homelessDay({
      constructionProject,
      llmGoal: "gather_food",
      llmReason: "food first",
    });
    expect(planned.source).toBe("planner");
    expect(planned.action).toBe("obtainItem");
  });

  it("13. LLM-disabled survival: hungry reflex still gathers food", () => {
    const planned = planCitizen({
      citizenId: "citizen_theo",
      observation: obs({ food: 6, inventory: [] }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    });
    expect(planned.source).toBe("reflex");
    expect(planned.action).toBe("gatherFood");
  });
});
