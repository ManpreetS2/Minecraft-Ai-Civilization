import { describe, expect, it } from "vitest";
import { CognitiveStore, dangerEncounteredEvent, itemReceivedEvent, createIdFactory, mutableClock } from "@civ/memory";
import { CitizenMind } from "@civ/psychology";
import { loadConfig } from "@civ/shared";
import { scoreHeuristic } from "./benchmark.js";
import { resolveCognitionConfig } from "./config.js";
import { CognitionContextBuilder } from "./context-builder.js";
import { createCooldownState, shouldDeliberate } from "./cooldown.js";
import { BENCHMARK_SCENARIOS } from "./fixtures.js";
import { normalizeGoal, rejectPrivilegedFields } from "./normalize.js";
import { promptContainsPersonalityInjection, buildDeliberationMessages } from "./prompt.js";
import { InferenceQueue } from "./queue.js";
import { applyReflectionProposal } from "./reflection-apply.js";
import { validateReflectionProposal } from "./reflection-schema.js";
import { detectEmergencyReflex } from "./reflex.js";
import { ModelRouter } from "./router.js";
import { validateCognitionDecision, validateDecision } from "./schema.js";
import { CognitionService, type Deliberator } from "./service.js";
import { isDecisionStale } from "./stale.js";
import { trimCognitionContext } from "./trim.js";

const cfg = resolveCognitionConfig(loadConfig({}));

function fakeDeliberator(goal: "gather_wood" | "rest" = "gather_wood"): Deliberator {
  return {
    async decide() {
      return {
        value: { goal, priority: 0.5, reason: "Fixture choice." },
        normalized: true,
        model: "fake",
      };
    },
    async reflect() {
      return {
        value: {
          significance: 0.7,
          beliefUpdates: [{ subject: "creeper", proposedInterpretation: "Creepers remain a storage threat.", confidence: 0.6 }],
        },
        normalized: true,
        model: "fake-reflect",
      };
    },
  };
}

describe("model routing", () => {
  const router = new ModelRouter({ enabled: true, reflectionEnabled: true });

  it("uses NO_LLM for true emergencies and not for night or wood shortage", () => {
    const drowning = router.route({
      view: { oxygen: 2, inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      llmEnabled: true,
      reflectionEnabled: true,
      reflectionAvailable: true,
      shouldDeliberate: true,
      hasGoal: false,
      busy: false,
    });
    expect(drowning.mode).toBe("NO_LLM");
    expect(drowning.reflex?.kind).toBe("drowning");

    const night = detectEmergencyReflex({
      isNight: true,
      inventory: [],
      nearbyHostiles: [],
      nearbyCitizens: [],
      hunger: 16,
      health: 18,
    });
    expect(night).toBeUndefined();
  });

  it("routes rare reflection separately from routine deliberation", () => {
    const reflection = router.route({
      view: { inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      llmEnabled: true,
      reflectionEnabled: true,
      reflectionAvailable: true,
      shouldDeliberate: true,
      hasGoal: true,
      busy: false,
      reflectionTrigger: {
        id: "r1",
        kind: "close_citizen_death",
        citizenId: "citizen_atlas",
        salience: 0.8,
        createdAt: "t",
      },
    });
    expect(reflection.mode).toBe("DEEP_REFLECTION");

    const routine = router.route({
      view: { inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      llmEnabled: true,
      reflectionEnabled: true,
      reflectionAvailable: true,
      shouldDeliberate: true,
      hasGoal: false,
      busy: false,
    });
    expect(routine.mode).toBe("ROUTINE_DELIBERATION");
  });

  it("falls back to routine mode when the reflection model is unavailable", () => {
    const fallback = router.route({
      view: { inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      llmEnabled: true,
      reflectionEnabled: true,
      reflectionAvailable: false,
      shouldDeliberate: true,
      hasGoal: true,
      busy: false,
      reflectionTrigger: {
        id: "r2",
        kind: "major_betrayal",
        citizenId: "citizen_atlas",
        salience: 0.7,
        createdAt: "t",
      },
    });
    expect(fallback.mode).toBe("ROUTINE_DELIBERATION");
    expect(fallback.reason).toBe("reflection_model_unavailable_fallback");
  });
});

describe("normalization", () => {
  it("normalizes related goal phrasing and rejects unrelated mapping", () => {
    expect(normalizeGoal("Gather wood")).toBe("gather_wood");
    expect(normalizeGoal("help citizen")).toBe("help_citizen");
    expect(normalizeGoal("assist")).toBe("assist_citizen");
    expect(normalizeGoal("gather_food")).toBe("gather_food");
    expect(normalizeGoal("take over the server")).toBeUndefined();
  });

  it("rejects NaN, Infinity, unknown goals, and privileged fields", () => {
    expect(() => validateDecision({ goal: "gather_wood", priority: Number.NaN, reason: "x" })).toThrow();
    expect(() => validateDecision({ goal: "gather_wood", priority: Number.POSITIVE_INFINITY, reason: "x" })).toThrow();
    expect(() => validateCognitionDecision({ goal: "fly", priority: 0.2, reason: "nope" })).toThrow();
    expect(() => rejectPrivilegedFields({ goal: "rest", thinking: "secret" })).toThrow(/privileged/);
    expect(() =>
      validateCognitionDecision({ goal: "gather_wood", priority: 0.2, reason: "logs", chain_of_thought: "nope" }),
    ).toThrow();
  });

  it("defaults missing priority and truncates long reasons", () => {
    const decision = validateCognitionDecision({
      goal: "gather_wood",
      reason: `${"need logs ".repeat(40)}`,
    });
    expect(decision.priority).toBe(0.5);
    expect(decision.reason.length).toBeLessThanOrEqual(280);
    expect(validateCognitionDecision({ goal: "rest", reason: "idle", priority: null }).priority).toBe(0.5);
    expect(validateCognitionDecision({ goal: "rest", reason: "idle", priority: "high" }).priority).toBe(0.85);
    expect(
      validateCognitionDecision({ decision: { goal: "explore", reason: "look around" } }).goal,
    ).toBe("explore");
  });

  it("requires a real target for social goals", () => {
    expect(() => validateCognitionDecision({ goal: "socialize", priority: 0.4, reason: "chat" })).toThrow();
    expect(
      validateCognitionDecision({
        goal: "assist_citizen",
        priority: 0.4,
        reason: "Maya is nearby and helped before.",
        targetCitizenId: "citizen_maya",
      }).targetCitizenId,
    ).toBe("citizen_maya");
  });
});

describe("context trim and prompt", () => {
  it("keeps a compact relevant subset and avoids personality injection", () => {
    const store = new CognitiveStore(":memory:");
    const mind = new CitizenMind(store, { id: createIdFactory("ctx") });
    mind.ingest(
      itemReceivedEvent({
        giverId: "citizen_maya",
        receiverId: "citizen_atlas",
        item: "bread",
        count: 3,
        receiverHunger: 4,
        location: { x: 0, y: 64, z: 0 },
      }),
      {
        nearbyRadius: 24,
        citizens: [
          { id: "citizen_atlas", name: "Atlas", position: { x: 0, y: 64, z: 0 }, hunger: 4 },
          { id: "citizen_maya", name: "Maya", position: { x: 1, y: 64, z: 0 } },
        ],
      },
    );
    const ctx = new CognitionContextBuilder(mind).build({
      citizenId: "citizen_atlas",
      name: "Atlas",
      health: 18,
      hunger: 4,
      inventory: ["bread x3"],
      settlementNeeds: ["NEED_FOOD"],
      contextSize: 2048,
    });
    expect(ctx.relevantMemories.length).toBeLessThanOrEqual(6);
    expect(ctx.relevantSocialBeliefs.length).toBeGreaterThan(0);
    const prompt = buildDeliberationMessages(ctx, 2048);
    expect(promptContainsPersonalityInjection(prompt.user)).toBe(false);
    expect(promptContainsPersonalityInjection(prompt.system)).toBe(false);
    expect(prompt.user).toMatch(/Retrieved memories/);
    expect(prompt.system).not.toMatch(/You are Atlas/);
    store.close();
  });

  it("trims background memories before urgent state", () => {
    const memories = Array.from({ length: 20 }, (_, i) => ({
      summary: `old event ${i}`,
      importance: i === 19 ? 0.9 : 0.2,
      source: "DIRECT" as const,
      eventType: "task_outcome",
    }));
    const trimmed = trimCognitionContext(
      {
        citizen: { id: "citizen_atlas", name: "Atlas" },
        immediateNeeds: { health: 4, hunger: 6, concerns: ["injury"] },
        currentGoal: "seek_safety",
        inventorySummary: ["bread x1", "stick x20", "dirt x64", "cobblestone x32", "torch x8"],
        nearbyWorldState: { entities: ["creeper"] },
        mood: {
          citizenId: "citizen_atlas",
          moodValence: -0.4,
          stress: 0.7,
          fear: 0.8,
          anger: 0,
          sadness: 0.2,
          positiveAffect: 0.1,
          confidence: 0.2,
          currentConcerns: [],
          updatedAt: "t",
        },
        activeAffect: { dominant: "fear", intensity: 0.8 },
        relevantMemories: memories,
        relevantSocialBeliefs: Array.from({ length: 8 }, (_, i) => ({
          targetId: `citizen_${i}`,
          evidenceSummary: "saw them once",
          familiarity: 0.1,
          sourceNotes: [],
        })),
        activityFamiliarity: {},
        learnedAssociations: [],
        habits: [{ contextKey: "night", action: "rest", strength: 0.3 }],
        recentImportantEvents: [{ summary: "A creeper exploded nearby.", timestamp: "t" }],
        settlementNeeds: ["NEED_WOOD"],
        uncertainty: 0.4,
        uncertainties: ["food_status"],
      },
      256,
    );
    expect(trimmed.relevantMemories.length).toBeLessThanOrEqual(4);
    expect(trimmed.relevantMemories[0]?.summary).toBe("old event 19");
    expect(trimmed.relevantSocialBeliefs.length).toBeLessThanOrEqual(2);
    expect(trimmed.immediateNeeds.hunger).toBe(6);
  });
});

describe("stale decisions, queue, cooldown", () => {
  it("discards a result after hunger is resolved", async () => {
    const service = new CognitionService({
      config: { ...cfg, enabled: true, cooldownMs: 1 },
      deliberator: fakeDeliberator(),
    });
    const result = await service.decide({
      citizenId: "citizen_atlas",
      view: { hunger: 4, inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      acceptView: { hunger: 16, inventory: [{ name: "bread", count: 1 }], nearbyHostiles: [], nearbyCitizens: [] },
      settlementNeeds: ["NEED_FOOD"],
      trigger: "major_need_changed",
      context: trimCognitionContext(
        {
          citizen: { id: "citizen_atlas", name: "Atlas" },
          immediateNeeds: { hunger: 4, concerns: [] },
          inventorySummary: [],
          nearbyWorldState: { entities: [] },
          mood: {
            citizenId: "citizen_atlas",
            moodValence: 0,
            stress: 0.2,
            fear: 0,
            anger: 0,
            sadness: 0,
            positiveAffect: 0.4,
            confidence: 0.4,
            currentConcerns: [],
            updatedAt: "t",
          },
          activeAffect: { dominant: "neutral", intensity: 0 },
          relevantMemories: [],
          relevantSocialBeliefs: [],
          activityFamiliarity: {},
          learnedAssociations: [],
          habits: [],
          recentImportantEvents: [],
          settlementNeeds: ["NEED_FOOD"],
          uncertainty: 0.4,
          uncertainties: [],
        },
        8192,
      ),
    });
    expect(result.accepted).toBe(false);
    expect(result.discardedReason).toBe("hunger_resolved");
    expect(result.wroteObjectiveEvent).toBe(false);
  });

  it("queues work and records wait time", async () => {
    const queue = new InferenceQueue(1);
    let released = false;
    const first = queue.enqueue({
      id: "a",
      citizenId: "citizen_atlas",
      type: "routine",
      run: () =>
        new Promise<string>((resolve) => {
          const wait = setInterval(() => {
            if (released) {
              clearInterval(wait);
              resolve("one");
            }
          }, 5);
        }),
    });
    const second = queue.enqueue({
      id: "b",
      citizenId: "citizen_maya",
      type: "routine",
      run: async () => "two",
    });
    expect(queue.snapshot().inFlight).toBe(1);
    expect(queue.snapshot().queued).toBe(1);
    released = true;
    const [a, b] = await Promise.all([first, second]);
    expect(a.value).toBe("one");
    expect(b.meta.queueWaitMs).toBeGreaterThanOrEqual(0);
  });

  it("applies cooldowns so idle citizens are not polled every tick", () => {
    const state = createCooldownState();
    state.lastAt.set("citizen_atlas", 1000);
    const blocked = shouldDeliberate(
      {
        citizenId: "citizen_atlas",
        now: 2000,
        cooldownMs: 60_000,
        idle: true,
        hasGoal: false,
        busy: false,
        consecutiveFailures: 0,
      },
      state,
    );
    expect(blocked.allowed).toBe(false);
  });

  it("does not treat a decision as stale when assumptions hold", () => {
    const assumed = {
      version: 1,
      createdAtMs: 1,
      hunger: 12,
      health: 18,
      hasFoodInInventory: false,
      nearbyHostile: false,
      currentGoal: "gather_wood",
    };
    expect(isDecisionStale(assumed, assumed).stale).toBe(false);
  });
});

describe("reflection validation and bounded apply", () => {
  it("validates structured reflection and never writes objective facts", () => {
    expect(() => validateReflectionProposal({ significance: 2, beliefUpdates: [] })).toThrow();
    expect(() => validateReflectionProposal({ significance: 0.4, beliefUpdates: [], thinking: "nope" })).toThrow();
    const store = new CognitiveStore(":memory:");
    const applied = applyReflectionProposal(
      store,
      "citizen_atlas",
      {
        significance: 0.7,
        beliefUpdates: [{ subject: "citizen_ava", proposedInterpretation: "Ava's death matters to me.", confidence: 0.6 }],
      },
      () => "ref_1",
    );
    expect(applied.wroteObjectiveEvent).toBe(false);
    expect(store.listObjectiveEvents()).toHaveLength(0);
    expect(store.listDurableMemories("citizen_atlas")[0]?.source).toBe("INFERRED");
    store.close();
  });

  it("falls back to deterministic reflection when the model is missing", async () => {
    const failing: Deliberator = {
      async decide() {
        throw new Error("unused");
      },
      async reflect() {
        throw new Error("reflection model down");
      },
    };
    const store = new CognitiveStore(":memory:");
    const mind = new CitizenMind(store, { id: createIdFactory("ref") });
    const service = new CognitionService({
      config: { ...cfg, enabled: true, reflectionEnabled: true },
      mind,
      deliberator: failing,
    });
    const trigger = {
      id: "r4",
      kind: "settlement_destruction" as const,
      citizenId: "citizen_atlas",
      salience: 0.8,
      createdAt: "t",
    };
    const result = await service.reflect({
      citizenId: "citizen_atlas",
      trigger,
      context: {
        trigger,
        relevantMemories: [],
        psychState: {
          citizenId: "citizen_atlas",
          moodValence: -0.3,
          stress: 0.5,
          fear: 0.4,
          anger: 0,
          sadness: 0.4,
          positiveAffect: 0.1,
          confidence: 0.2,
          currentConcerns: [],
          updatedAt: "t",
        },
        socialBeliefs: [],
      },
    });
    expect(result.fallback).toBe("deterministic");
    expect(result.accepted).toBe(true);
    expect(result.applied?.wroteObjectiveEvent).toBe(false);
    store.close();
  });
});

describe("two citizens, same event, different context", () => {
  it("differs because of memory, needs, and associations rather than personality sliders", () => {
    const store = new CognitiveStore(":memory:");
    const mind = new CitizenMind(store, { clock: mutableClock(), id: createIdFactory("two") });
    const farKai = {
      nearbyRadius: 24,
      citizens: [
        { id: "citizen_atlas", name: "Atlas", position: { x: 0, y: 64, z: 0 }, hunger: 4, health: 10 },
        { id: "citizen_kai", name: "Kai", position: { x: 200, y: 64, z: 180 }, hunger: 18, health: 20 },
      ],
    };
    mind.ingest(
      dangerEncounteredEvent({
        citizenId: "citizen_atlas",
        threatKey: "creeper",
        harmOccurred: true,
        outcome: "destroyed",
        destroyed: "storage",
        location: { x: 0, y: 64, z: 0 },
      }),
      farKai,
    );
    const together = {
      nearbyRadius: 24,
      citizens: [
        { id: "citizen_atlas", name: "Atlas", position: { x: 0, y: 64, z: 0 }, hunger: 4, health: 10 },
        { id: "citizen_kai", name: "Kai", position: { x: 1, y: 64, z: 0 }, hunger: 18, health: 20 },
      ],
    };
    mind.ingest(
      itemReceivedEvent({
        giverId: "citizen_maya",
        receiverId: "citizen_atlas",
        item: "bread",
        count: 3,
        receiverHunger: 4,
        location: { x: 0, y: 64, z: 0 },
      }),
      together,
    );
    const builder = new CognitionContextBuilder(mind);
    const atlas = builder.build({ citizenId: "citizen_atlas", name: "Atlas", hunger: 8, health: 10 });
    const kai = builder.build({ citizenId: "citizen_kai", name: "Kai", hunger: 18, health: 20 });
    expect(atlas.relevantMemories.some((m) => /creeper/i.test(m.summary))).toBe(true);
    expect(kai.relevantMemories.some((m) => /creeper/i.test(m.summary))).toBe(false);
    expect(atlas.learnedAssociations.some((a) => a.subjectKey === "creeper")).toBe(true);
    expect(kai.learnedAssociations.some((a) => a.subjectKey === "creeper")).toBe(false);
    expect(atlas.immediateNeeds.hunger).not.toBe(kai.immediateNeeds.hunger);
    expect(atlas.relevantSocialBeliefs.length).toBeGreaterThan(0);
    store.close();
  });
});

describe("idle and high-level-only goals", () => {
  it("allows idle rest instead of inventing busywork", async () => {
    const service = new CognitionService({
      config: { ...cfg, enabled: false },
      deliberator: fakeDeliberator("gather_wood"),
    });
    const result = await service.decide({
      citizenId: "citizen_kai",
      idle: true,
      trigger: "idle",
      view: { hunger: 18, health: 20, inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      settlementNeeds: [],
      context: trimCognitionContext(
        {
          citizen: { id: "citizen_kai", name: "Kai" },
          immediateNeeds: { hunger: 18, health: 20, concerns: [] },
          inventorySummary: [],
          nearbyWorldState: { entities: [] },
          mood: {
            citizenId: "citizen_kai",
            moodValence: 0,
            stress: 0.1,
            fear: 0,
            anger: 0,
            sadness: 0,
            positiveAffect: 0.4,
            confidence: 0.4,
            currentConcerns: [],
            updatedAt: "t",
          },
          activeAffect: { dominant: "neutral", intensity: 0 },
          relevantMemories: [],
          relevantSocialBeliefs: [],
          activityFamiliarity: {},
          learnedAssociations: [],
          habits: [],
          recentImportantEvents: [],
          settlementNeeds: [],
          uncertainty: 0.3,
          uncertainties: ["no_current_goal"],
        },
        8192,
      ),
    });
    expect(result.accepted).toBe(true);
    expect(result.decision?.goal).toBe("rest");
    expect(result.mode).toBe("NO_LLM");
  });

  it("keeps contribute_to_project as a high-level goal and rejects block-level inventions", () => {
    expect(
      validateCognitionDecision({ goal: "contribute_to_project", priority: 0.6, reason: "Shelter still needs hands." }).goal,
    ).toBe("contribute_to_project");
    expect(normalizeGoal("chop this oak")).toBeUndefined();
    expect(normalizeGoal("break_block")).toBeUndefined();
  });

  it("does not treat decide() as the deep reflection API", async () => {
    const service = new CognitionService({
      config: { ...cfg, enabled: true, reflectionEnabled: true },
      deliberator: fakeDeliberator("gather_wood"),
    });
    const result = await service.decide({
      citizenId: "citizen_atlas",
      view: { hunger: 16, inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      settlementNeeds: [],
      trigger: "significant_event",
      reflectionTrigger: {
        id: "r3",
        kind: "close_citizen_death",
        citizenId: "citizen_atlas",
        salience: 0.9,
        createdAt: "t",
      },
      context: trimCognitionContext(
        {
          citizen: { id: "citizen_atlas", name: "Atlas" },
          immediateNeeds: { hunger: 16, concerns: [] },
          inventorySummary: [],
          nearbyWorldState: { entities: [] },
          mood: {
            citizenId: "citizen_atlas",
            moodValence: -0.2,
            stress: 0.4,
            fear: 0.3,
            anger: 0,
            sadness: 0.4,
            positiveAffect: 0.1,
            confidence: 0.3,
            currentConcerns: [],
            updatedAt: "t",
          },
          activeAffect: { dominant: "sadness", intensity: 0.4 },
          relevantMemories: [],
          relevantSocialBeliefs: [],
          activityFamiliarity: {},
          learnedAssociations: [],
          habits: [],
          recentImportantEvents: [],
          settlementNeeds: [],
          uncertainty: 0.5,
          uncertainties: [],
        },
        8192,
      ),
    });
    expect(result.accepted).toBe(false);
    expect(result.discardedReason).toBe("use_reflect");
    expect(result.decision?.goal).not.toBe("gather_wood");
  });
});

describe("benchmark fixtures", () => {
  it("scores heuristic/reflex fixtures without claiming live model superiority", () => {
    const rows = BENCHMARK_SCENARIOS.map(scoreHeuristic);
    expect(rows.find((r) => r.scenario === "starving_with_food")?.model).toBe("reflex");
    expect(rows.find((r) => r.scenario === "idle_no_urgent")?.ok).toBe(true);
    expect(rows.every((r) => r.latencyMs >= 0)).toBe(true);
  });
});

describe("config", () => {
  it("keeps model names in config rather than business logic", () => {
    const resolved = resolveCognitionConfig(loadConfig({}));
    expect(resolved.routineModel).toBe("qwen3.5:9b");
    expect(resolved.reflectionModel).toBe("gpt-oss:20b");
    expect(resolved.maxConcurrency).toBe(1);
    expect(resolved.contextSize).toBe(8192);
    expect(resolved.reflectionEnabled).toBe(false);
  });
});
