import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GOALS, GOAL_ALIASES, normalizeGoal } from "@civ/cognition";
import { EventBus, type BodyObservation, type SettlementState } from "@civ/shared";
import type { SkillContext } from "@civ/skills";
import { describe, expect, it } from "vitest";
import { WORLD_LAB_CLAIMABLE_HOMES } from "./available-homes.js";
import type { BuildStructureProject } from "./build-structure.js";
import { executePlan } from "./executor.js";
import {
  GOAL_ACTION_MAP,
  cognitionReachableActions,
  deferredCapabilityResult,
  enforceModelOriginatedPlan,
  isCognitionReachableAction,
  resolveModelGoalForPlanner,
  validateModelOriginatedPlan,
} from "./goal-dispatch.js";
import { planCitizen, type PlannedTask } from "./planner.js";
import { CivilizationStore } from "./store.js";

function tempStore(): CivilizationStore {
  return new CivilizationStore(join(mkdtempSync(join(tmpdir(), "civ-dispatch-")), "test.sqlite"));
}

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
  username: "Atlas",
  connected: true,
  spawned: true,
  health: 20,
  food: 20,
  inventory: [{ name: "wooden_pickaxe", count: 1 }, { name: "oak_log", count: 8 }],
  players: [],
  nearby: [],
  ...over,
});

const claimedHome = {
  homeId: "home_h7",
  bed: { x: -1089, y: 68, z: 817 },
  origin: { x: -1089, y: 68, z: 817 },
  status: "active" as const,
};

function llmBase(over: Parameters<typeof planCitizen>[0] extends infer P ? Partial<P> : never = {}) {
  return planCitizen({
    citizenId: "citizen_atlas",
    observation: obs(),
    settlement: emptySettlement(),
    assignedNeeds: [],
    home: claimedHome,
    ...over,
  });
}

describe("dispatch integrity — cognition allowlist", () => {
  it("lists every model-selectable goal as cognition-reachable after resolve", () => {
    const reachable = cognitionReachableActions();
    for (const goal of GOALS) {
      const resolved = resolveModelGoalForPlanner(goal);
      expect(resolved.unsupported).toBeFalsy();
      if (resolved.unsupported) throw new Error("unreachable");
      expect(reachable.has(resolved.action)).toBe(true);
      expect(
        validateModelOriginatedPlan({
          source: "llm",
          goal: resolved.goal,
          task: resolved.task,
          action: resolved.action,
        }).ok,
      ).toBe(true);
    }
  });

  it("normalizes aliases consistently into allowlisted actions", () => {
    for (const [alias, goal] of Object.entries(GOAL_ALIASES)) {
      expect(normalizeGoal(alias)).toBe(goal);
      const resolved = resolveModelGoalForPlanner(alias);
      expect(resolved.unsupported).toBeFalsy();
      if (resolved.unsupported) throw new Error("unreachable");
      expect(isCognitionReachableAction(resolved.action)).toBe(true);
    }
  });

  it("rejects unknown goals and unsupported executor actions for model source", () => {
    expect(resolveModelGoalForPlanner("teleport_home").unsupported).toBe(true);
    expect(
      validateModelOriginatedPlan({
        source: "llm",
        goal: "gather_food",
        task: "gather_food",
        action: "shareItem",
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateModelOriginatedPlan({
        source: "llm",
        goal: "mineOre",
        task: "mineOre",
        action: "mineOre",
      }),
    ).toMatchObject({ ok: false });
    const forged = enforceModelOriginatedPlan({
      source: "llm",
      goal: "rm_rf",
      task: "rm_rf",
      action: "rm_rf",
      reason: "bypass",
    });
    expect(forged.action).toBe("deferCapability");
    expect(forged.task).toBe("unsupported_goal");
    expect(forged.reason).toMatch(/dispatch integrity/i);
  });

  it("defers help_citizen and rest without success", () => {
    for (const goal of ["help_citizen", "rest"] as const) {
      const planned = llmBase({ llmGoal: goal, llmReason: "model asked" });
      expect(planned.source).toBe("llm");
      expect(planned.action).toBe("deferCapability");
      const result = deferredCapabilityResult(planned.task);
      expect(result.success).toBe(false);
      expect(result.code).toBe("UNSUPPORTED_ACTION");
    }
  });

  it("does not restrict deterministic safety reflexes", () => {
    const flee = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        health: 5,
        nearby: [{ id: 1, name: "zombie", type: "mob", hostile: true, position: { x: 1, y: 64, z: 1 }, distance: 3 }],
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      llmGoal: "gather_food",
      llmReason: "hungry plan",
    });
    expect(flee.source).toBe("reflex");
    expect(flee.action).toBe("flee");
    expect(validateModelOriginatedPlan(flee).ok).toBe(true);
  });

  it("leaves human-directed tasks under directive authorization (not llm gate)", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: emptySettlement(),
      assignedNeeds: [],
      home: claimedHome,
      humanDirective: {
        id: "dir_1",
        intent: "obtain_item",
        mode: "ADMIN_OVERRIDE",
        args: { item: "wooden_pickaxe" },
      },
      llmGoal: "explore",
      llmReason: "ignored under admin override",
    });
    expect(planned.source).toBe("planner");
    expect(planned.directiveId).toBe("dir_1");
    expect(planned.source).not.toBe("llm");
  });

  it("preserves LLM-disabled deterministic behavior", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ inventory: [{ name: "wooden_pickaxe", count: 1 }] }),
      settlement: {
        ...emptySettlement(),
        shelterComplete: false,
        wood: 40,
        needs: ["NEED_HOUSING"],
      },
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
    });
    expect(planned.source).toBe("planner");
    expect(planned.action).toBe("buildShelter");
  });
});

describe("dispatch integrity — executor boundary", () => {
  it("fail-closes forged llm plans at executePlan without running an arbitrary skill", async () => {
    const store = tempStore();
    const events = new EventBus();
    const started: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    events.on((event) => {
      if (event.type === "ActionStarted") started.push(event.payload as Record<string, unknown>);
      if (event.type === "ActionFailed") failed.push(event.payload as Record<string, unknown>);
    });
    const forged: PlannedTask = {
      goal: "gather_food",
      task: "gather_food",
      action: "shareItem",
      source: "llm",
      reason: "bypass attempt",
      priority: 0.8,
    };
    const ctx = {
      bot: { inventory: { items: () => [] } },
      citizenId: "citizen_atlas",
      body: {
        position: () => ({ x: 0, y: 64, z: 0 }),
        nearbyEntities: () => [],
      },
    } as unknown as SkillContext;
    const result = await executePlan(ctx, forged, store, events);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNSUPPORTED_ACTION");
    }
    expect(started[0]?.action).toBe("deferCapability");
    expect(started[0]?.dispatchIntegrity).toBe("rewritten_fail_closed");
    expect(started[0]?.source).toBe("llm");
    expect(failed[0]?.action).toBe("deferCapability");
    expect(failed[0]?.dispatchIntegrity).toBe("rewritten_fail_closed");
    store.close();
  });

  it("allows cognition-reachable llm explore past the integrity gate (events retain provenance)", async () => {
    const store = tempStore();
    const events = new EventBus();
    const started: Array<Record<string, unknown>> = [];
    events.on((event) => {
      if (event.type === "ActionStarted") started.push(event.payload as Record<string, unknown>);
    });
    const plan: PlannedTask = {
      goal: "explore",
      task: "explore",
      action: "observeNearby",
      source: "llm",
      reason: "survey",
      priority: 0.8,
    };
    const ctx = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        inventory: { items: () => [] },
      },
      citizenId: "citizen_atlas",
      body: {
        position: () => ({ x: 0, y: 64, z: 0 }),
        nearbyEntities: () => [],
        observe: () => obs(),
      },
    } as unknown as SkillContext;
    // observeNearby may succeed or fail depending on body stubs; integrity must allow it through.
    await executePlan(ctx, plan, store, events);
    expect(started[0]?.dispatchIntegrity).toBe("allowlisted");
    expect(started[0]?.source).toBe("llm");
    expect(started[0]?.goal).toBe("explore");
    expect(started[0]?.action).toBe("observeNearby");
    store.close();
  });
});

describe("planner precedence and proposal starvation (offline provenance)", () => {
  /**
   * Documented planner order (do not treat deterministic wins as autonomous AI decisions):
   * 1 lethal/hunger reflex → 2 admin directive → 3 construction resume → 4 curfew →
   * 5 human directive → 6 corrective → 7 night housing/shelter → 8 day housing →
   * 9 inventory deposit → 10 LLM → 11 bootstrap/work roles/autonomous
   */
  it("shows lethal reflex overrides a valid gather_food model proposal (A: safety-essential)", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        health: 4,
        nearby: [{ id: 1, name: "zombie", type: "mob", hostile: true, position: { x: 1, y: 64, z: 1 }, distance: 4 }],
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      llmGoal: "gather_food",
      llmReason: "I should get food",
      home: claimedHome,
    });
    expect(planned.source).toBe("reflex");
    expect(planned.action).toBe("flee");
    expect(planned.source).not.toBe("llm");
  });

  it("accepts homeless daytime gather_food model proposal (Mission 010B — no housing starvation)", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
      llmGoal: "gather_food",
      llmReason: "Secure food for the demo",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("gatherFood");
    expect(planned.modelProvenance).toEqual({ kind: "accepted", goal: "gather_food" });
  });

  it("allows gather_food model proposal when housed and not in emergency (autonomy path)", () => {
    const planned = llmBase({
      llmGoal: "gather_food",
      llmReason: "Secure food for the demo",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("gatherFood");
    expect(planned.goal).toBe("gather_food");
  });

  it("allows build_shelter model proposal when housed (autonomy path)", () => {
    const planned = llmBase({
      settlement: { ...emptySettlement(), shelterComplete: false, wood: 20 },
      llmGoal: "build_shelter",
      llmReason: "Need a hut before night",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("buildShelter");
  });

  it("shows construction-session resume precedes LLM (B: mechanically necessary)", () => {
    const constructionProject: BuildStructureProject = {
      id: "proj_1",
      type: "STRUCTURE_BUILD",
      status: "PROCURING",
      stage: "FOUNDATION",
      ownerCitizenId: "citizen_atlas",
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
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: emptySettlement(),
      assignedNeeds: [],
      home: claimedHome,
      llmGoal: "gather_food",
      llmReason: "food first",
      constructionProject,
    });
    expect(planned.source).toBe("planner");
    expect(planned.action).toBe("obtainItem");
    expect(planned.source).not.toBe("llm");
  });

  it("does not label deterministic work-role shelter as an llm decision", () => {
    const planned = planCitizen({
      citizenId: "citizen_theo",
      observation: obs({ inventory: [{ name: "wooden_pickaxe", count: 1 }] }),
      settlement: {
        ...emptySettlement(),
        shelterComplete: false,
        wood: 40,
        needs: ["NEED_HOUSING"],
      },
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
    });
    expect(planned.source).toBe("planner");
    expect(planned.action).toBe("buildShelter");
  });
});

describe("cognition-reachable vs internal-only actions", () => {
  it("keeps shareItem / mineOre / fishShore outside cognition-reachable set", () => {
    const reachable = cognitionReachableActions();
    expect(reachable.has("shareItem")).toBe(false);
    expect(reachable.has("mineOre")).toBe(false);
    expect(reachable.has("fishShore")).toBe(false);
    expect(reachable.has("obtainItem")).toBe(false);
    expect(reachable.has("claimHome")).toBe(false);
    for (const action of Object.values(GOAL_ACTION_MAP).map((e) => e.action)) {
      expect(reachable.has(action)).toBe(true);
    }
  });
});
