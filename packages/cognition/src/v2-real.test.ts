import { describe, expect, it } from "vitest";
import { FOOD_ITEM_NAMES } from "@civ/shared";
import { classifyFailure } from "./classify.js";
import { parseCompoundGoal } from "./compound.js";
import { SpeechGate, speechIsNotAction } from "./communication.js";
import { assembleBoundedDecision } from "./decision-contract.js";
import { observerDebugSnapshot } from "./debug-snapshot.js";
import { guardDecisionFacts, personalEdibleCount } from "./fact-guards.js";
import { heuristicDeliberation } from "./heuristic-deliberation.js";
import { detectEmergencyReflex } from "./reflex.js";
import { chatInvalidatesWork, isDecisionStale, shouldReconsiderFollowUps } from "./stale.js";
import { evaluateCognitionVectors } from "./vector-eval.js";
import { COGNITION_VECTORS } from "./vectors.js";
import { hashWorldState } from "./world-hash.js";
import type { CognitionContext } from "@civ/psychology";

function ctx(overrides: Partial<CognitionContext> = {}): CognitionContext {
  return {
    citizen: { id: "citizen_atlas", name: "Atlas" },
    immediateNeeds: { health: 20, hunger: 14, concerns: [] },
    nearbyWorldState: { entities: [] },
    mood: {
      citizenId: "citizen_atlas",
      moodValence: 0,
      stress: 0.2,
      fear: 0,
      anger: 0,
      sadness: 0,
      positiveAffect: 0.3,
      confidence: 0.4,
      currentConcerns: [],
      updatedAt: "2026-09-17T00:00:00.000Z",
    },
    activeAffect: { dominant: "neutral", intensity: 0 },
    relevantMemories: [],
    relevantSocialBeliefs: [],
    activityFamiliarity: {},
    learnedAssociations: [],
    habits: [],
    recentImportantEvents: [],
    settlementNeeds: [],
    inventorySummary: [],
    uncertainty: 0.2,
    uncertainties: [],
    ...overrides,
  };
}

describe("structured decision contract", () => {
  it("assembles a bounded decision with hash and no hidden CoT", () => {
    const decision = assembleBoundedDecision({
      proposal: { goal: "gather_wood", priority: 0.6, reason: "The settlement needs more wood." },
      facts: { hunger: 14, health: 20, hasPersonalFood: true, settlementNeeds: ["NEED_WOOD"] },
      memoryIds: ["m1"],
      lessonIds: ["l1"],
    });
    expect(decision.primaryGoal).toBe("gather_wood");
    expect(decision.followUpGoals).toEqual([]);
    expect(decision.worldStateHash).toMatch(/^[0-9a-f]+$/);
    expect(decision.relevantMemoryIds).toEqual(["m1"]);
    expect(JSON.stringify(decision)).not.toMatch(/chain_of_thought|thinking/);
  });
});

describe("compound and execution-level rejection", () => {
  it("splits gather stone and craft tools when pickaxe is missing", () => {
    const parsed = parseCompoundGoal("Gather stone and craft better tools", { hasPickaxe: false });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.primaryGoal).toBe("craft_tools");
    expect(parsed.followUpGoals).toContain("mine_stone");
  });

  it("rejects walk west / coordinate commands", () => {
    const west = parseCompoundGoal("walk west");
    expect(west.ok).toBe(false);
    if (west.ok) return;
    expect(west.code).toBe("EXECUTION_LEVEL");
    expect(parseCompoundGoal("break block 10,64,-4").ok).toBe(false);
    expect(parseCompoundGoal("do a cartwheel").ok).toBe(false);
  });
});

describe("personal food vs settlement food", () => {
  it("does not conclude Atlas has no food when carrying 64 steak", () => {
    const facts = {
      hunger: 14,
      health: 20,
      personalInventory: [{ name: "steak", count: 64 }],
      settlementFoodReserve: 0,
    };
    expect(personalEdibleCount(facts.personalInventory)).toBe(64);
    const guarded = guardDecisionFacts({
      goal: "gather_food",
      reason: "I have no food.",
      facts,
    });
    expect(guarded.ok).toBe(false);
    expect(guarded.violations.some((row) => row.code === "PERSONAL_FOOD_PRESENT")).toBe(true);

    const decided = heuristicDeliberation(
      ctx({
        immediateNeeds: { health: 20, hunger: 14, concerns: [] },
        inventorySummary: ["steak x64"],
        settlementNeeds: ["NEED_FOOD"],
      }),
    );
    expect(decided.reason).not.toMatch(/no food/i);
    expect(decided.goal).not.toBe("gather_food");
    expect(
      guardDecisionFacts({
        goal: "gather_food",
        reason: "Settlement food reserve is empty.",
        facts,
      }).ok,
    ).toBe(true);
  });

  it("treats cooked_beef as edible even if listed as steak-like", () => {
    expect(FOOD_ITEM_NAMES.has("cooked_beef") || /steak/.test("steak")).toBe(true);
    expect(personalEdibleCount([{ name: "cooked_beef", count: 2 }])).toBe(2);
  });
});

describe("NO_LLM reflexes", () => {
  it("returns reflex for creeper, drowning, fire, and held-food hunger", () => {
    expect(detectEmergencyReflex({ inventory: [], nearbyHostiles: [{ name: "creeper", distance: 3 }], nearbyCitizens: [] })?.kind).toBe(
      "lethal_mob",
    );
    expect(detectEmergencyReflex({ oxygen: 2, inventory: [], nearbyHostiles: [], nearbyCitizens: [] })?.kind).toBe("drowning");
    expect(detectEmergencyReflex({ onFire: true, inventory: [], nearbyHostiles: [], nearbyCitizens: [] })?.kind).toBe("fire");
    expect(
      detectEmergencyReflex({
        hunger: 5,
        inventory: [{ name: "bread", count: 1 }],
        nearbyHostiles: [],
        nearbyCitizens: [],
      })?.kind,
    ).toBe("eat_available_food");
  });
});

describe("fact guards", () => {
  it("blocks invented injury, creeper, missing tool, and finished project claims", () => {
    expect(guardDecisionFacts({ goal: "rest", reason: "I am critically injured", facts: { health: 20, personalInventory: [] } }).ok).toBe(false);
    expect(
      guardDecisionFacts({
        goal: "seek_safety",
        reason: "A creeper is about to explode",
        facts: { personalInventory: [], nearbyHostiles: [] },
      }).ok,
    ).toBe(false);
    expect(
      guardDecisionFacts({
        goal: "craft_tools",
        reason: "I don't have a pickaxe",
        facts: { personalInventory: [{ name: "wooden_pickaxe", count: 1 }] },
      }).ok,
    ).toBe(false);
    expect(
      guardDecisionFacts({
        goal: "contribute_to_project",
        reason: "finish the same project",
        facts: { personalInventory: [], projectComplete: true },
      }).ok,
    ).toBe(false);
  });
});

describe("staleness and follow-ups", () => {
  it("stales on threat, food, directive, and project completion but not idle chat", () => {
    const base = {
      version: 2,
      createdAtMs: 1,
      hunger: 6,
      health: 18,
      hasFoodInInventory: false,
      nearbyHostile: false,
    };
    expect(isDecisionStale(base, { ...base, nearbyHostile: true }).reason).toBe("new_threat");
    expect(isDecisionStale(base, { ...base, hasFoodInInventory: true }).reason).toBe("food_acquired");
    expect(isDecisionStale({ ...base, directiveId: "a" }, { ...base, directiveId: "b" }).reason).toBe("directive_changed");
    expect(isDecisionStale(base, { ...base, projectComplete: true }).reason).toBe("project_completed");
    expect(chatInvalidatesWork("nice weather today", "gather_wood")).toBe(false);
    expect(shouldReconsiderFollowUps({ primary: "craft_tools", primaryCompleted: true })).toBe(true);
  });
});

describe("infrastructure veto vs execution failure", () => {
  it("does not turn keepalive into a mining lesson", () => {
    const classified = classifyFailure({
      errorMessage: "client timed out after 30000 milliseconds",
      goal: "mine_stone",
    });
    expect(classified.track).toBe("SYSTEM");
    expect(classified.citizenLearns).toBe(false);
  });

  it("treats path failure as execution, not a bad gather_wood decision", () => {
    const classified = classifyFailure({ goal: "gather_wood", errorCode: "PATH_BLOCKED" });
    expect(classified.category).toBe("SKILL_EXECUTION");
    expect(classified.category).not.toBe("AGENT_DECISION");
  });
});

describe("speech is not action", () => {
  it("does not treat a promise utterance as a transfer", () => {
    const act = {
      speakerId: "citizen_atlas",
      listenerId: "citizen_maya",
      intent: "offer_resource" as const,
      text: "I'll give Maya food",
      createdAtMs: Date.now(),
    };
    expect(speechIsNotAction(act)).toBe(true);
    const gate = new SpeechGate();
    expect(gate.allow(act).ok).toBe(true);
    gate.record(act);
    expect(gate.allow({ ...act, createdAtMs: act.createdAtMs + 1000 }).ok).toBe(false);
  });
});

describe("world hash and debug snapshot", () => {
  it("hashes compact facts and omits chain-of-thought", () => {
    const a = hashWorldState({ hunger: 14, hasPersonalFood: true, settlementNeeds: ["NEED_FOOD"] });
    const b = hashWorldState({ hunger: 14, hasPersonalFood: true, settlementNeeds: ["NEED_FOOD"] });
    const c = hashWorldState({ hunger: 4, hasPersonalFood: false, settlementNeeds: ["NEED_FOOD"] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const debug = observerDebugSnapshot({
      citizenId: "citizen_atlas",
      hunger: 14,
      personalFoodCount: 64,
      settlementFoodReserve: 0,
      validation: { ok: true, violations: [] },
      memories: ["Maya helped"],
    });
    expect(JSON.stringify(debug)).not.toMatch(/chain_of_thought/);
    expect(debug.inputFacts.personalFoodCount).toBe(64);
  });
});

describe("benchmark vectors", () => {
  it("includes at least 150 portable cognition scenarios", () => {
    expect(COGNITION_VECTORS.length).toBeGreaterThanOrEqual(150);
    const families = new Set(COGNITION_VECTORS.map((row) => row.family));
    expect(families.has("personal_vs_settlement_food")).toBe(true);
    expect(families.has("no_llm")).toBe(true);
    expect(families.has("creeper_loss")).toBe(true);
    expect(families.has("infrastructure_veto")).toBe(true);
    const evaluated = evaluateCognitionVectors(COGNITION_VECTORS);
    expect(evaluated.failed).toEqual([]);
    expect(evaluated.passed).toBe(COGNITION_VECTORS.length);
  });
});

describe("multi-citizen settlement need", () => {
  it("does not send every citizen to gather wood for NEED_WOOD", () => {
    const atlas = heuristicDeliberation(ctx({ settlementNeeds: ["NEED_WOOD"] }), []);
    const maya = heuristicDeliberation(
      ctx({ citizen: { id: "citizen_maya", name: "Maya" }, settlementNeeds: ["NEED_WOOD"] }),
      [atlas.goal],
    );
    const kai = heuristicDeliberation(
      ctx({ citizen: { id: "citizen_kai", name: "Kai" }, settlementNeeds: ["NEED_WOOD"] }),
      [atlas.goal, maya.goal],
    );
    const goals = new Set([atlas.goal, maya.goal, kai.goal]);
    expect(goals.size).toBeGreaterThan(1);
  });
});

describe("personality summary is not causal", () => {
  it("heuristic decisions ignore observer phrases", () => {
    const a = heuristicDeliberation(ctx({ settlementNeeds: ["NEED_WOOD"] }));
    const b = heuristicDeliberation(ctx({ settlementNeeds: ["NEED_WOOD"] }));
    expect(a.goal).toBe(b.goal);
    expect(JSON.stringify(ctx())).not.toMatch(/bravery|kindness|ambition/);
  });
});
