import { describe, expect, it } from "vitest";
import { EventBus, type BodyObservation, type SettlementState } from "@civ/shared";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "./executor.js";
import {
  DEFERRED_GOALS,
  GOAL_ACTION_MAP,
  deferredCapabilityResult,
  isDeferredGoal,
} from "./goal-dispatch.js";
import { planCitizen } from "./planner.js";
import { CivilizationStore } from "./store.js";
import type { SkillContext } from "@civ/skills";

const settlement = (): SettlementState => ({
  id: "settlement_first",
  name: "First Settlement",
  food: 99,
  wood: 99,
  stone: 99,
  beds: 0,
  housingCapacity: 0,
  tools: 99,
  shelterComplete: true,
  needs: [],
});

const obs = (): BodyObservation => ({
  username: "Atlas",
  connected: true,
  spawned: true,
  health: 20,
  food: 20,
  inventory: [{ name: "wooden_pickaxe", count: 1 }],
  players: [],
  nearby: [],
});

function fakeCtx(): SkillContext {
  return {
    citizenId: "citizen_atlas",
    body: {
      nearbyEntities: () => [],
      nearbyPlayers: () => [],
      position: () => ({ x: 0, y: 64, z: 0 }),
      unreachable: { has: () => false },
    } as unknown as SkillContext["body"],
    bot: {
      inventory: { items: () => [] },
      registry: { blocksByName: {} },
      findBlocks: () => [],
      blockAt: () => null,
    } as unknown as SkillContext["bot"],
  };
}

describe("goal semantic honesty", () => {
  it("marks help_citizen and rest as deferred capabilities", () => {
    expect(DEFERRED_GOALS.has("help_citizen")).toBe(true);
    expect(DEFERRED_GOALS.has("rest")).toBe(true);
    expect(GOAL_ACTION_MAP.help_citizen.action).toBe("deferCapability");
    expect(GOAL_ACTION_MAP.rest.action).toBe("deferCapability");
    expect(isDeferredGoal("gather_food")).toBe(false);
  });

  it("plans help_citizen without claiming an observe/help success path", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "help_citizen",
      llmReason: "Maya looks stuck",
    });
    expect(planned.action).toBe("deferCapability");
    expect(planned.task).toBe("help_citizen");
    expect(planned.reason).toMatch(/deferred/i);
  });

  it("plans rest without mapping to sleep or successful observe rest", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "rest",
      llmReason: "Tired",
    });
    expect(planned.action).toBe("deferCapability");
    expect(planned.task).toBe("rest");
    expect(planned.action).not.toBe("observeNearby");
  });

  it("executePlan fails closed for help_citizen (no observe success)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-goal-"));
    const store = new CivilizationStore(join(dir, "t.sqlite"));
    const events = new EventBus();
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "help_citizen",
      llmReason: "assist",
    });
    const result = await executePlan(fakeCtx(), planned, store, events);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNSUPPORTED_ACTION");
      expect(result.error).toMatch(/not verified help/i);
    }
    const completed = events.getRecent().filter((e) => e.type === "ActionCompleted");
    const failed = events.getRecent().filter((e) => e.type === "ActionFailed");
    expect(completed).toHaveLength(0);
    expect(failed.length).toBeGreaterThan(0);
    store.close();
  });

  it("executePlan fails closed for rest (observing is not rest)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-goal-"));
    const store = new CivilizationStore(join(dir, "t.sqlite"));
    const events = new EventBus();
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "rest",
      llmReason: "sleep",
    });
    const result = await executePlan(fakeCtx(), planned, store, events);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not verified sleep or rest/i);
    }
    store.close();
  });

  it("keeps survival eat reflex separate from voluntary rest goal", () => {
    const hungry = planCitizen({
      citizenId: "citizen_atlas",
      observation: { ...obs(), food: 5, inventory: [{ name: "bread", count: 1 }] },
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "rest",
      llmReason: "want rest",
    });
    expect(hungry.source).toBe("reflex");
    expect(hungry.action).toBe("eatFood");
    expect(hungry.task).toBe("eat");
  });

  it("deferredCapabilityResult never reports success", () => {
    expect(deferredCapabilityResult("help_citizen").success).toBe(false);
    expect(deferredCapabilityResult("rest").success).toBe(false);
  });

  it("surfaces unknown goals as deferred failures, not observation success", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: settlement(),
      assignedNeeds: [],
      llmGoal: "summon_dragon",
      llmReason: "chaos",
    });
    expect(planned.task).toBe("unsupported_goal");
    expect(planned.action).toBe("deferCapability");
  });
});
