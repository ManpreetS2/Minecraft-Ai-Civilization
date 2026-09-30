import { describe, expect, it } from "vitest";
import { createMemory } from "@civ/memory";
import { summarizeLearnedBehavior } from "@civ/memory";
import { blankBelief, applyBeliefEvent } from "@civ/society";
import { CitizenBrain } from "./brain.js";
import {
  looksLikeMovementInstruction,
  tryValidateStructuredDecision,
  validateStructuredDecision,
} from "./decision-schema.js";
import { buildCognitionInput, stableSerialize } from "./input.js";
import {
  completeCommitment,
  createCommitment,
  updateCommitmentStatus,
} from "./commitments.js";
import { shouldReconsiderDecision } from "./cooldown.js";
import { classifyDecisionCategory, recordUsage, emptyUsageStats } from "./routing.js";
import { separateWorldBeliefEmotion, updateMood } from "./psychology.js";
import { assertNoSecretsInTrace, formatCognitionTrace } from "./cognition-trace.js";
import { PRIMARY_GOALS } from "./decision-schema.js";

describe("cognition input contract", () => {
  it("builds deterministic concise input with size guards", () => {
    const args = {
      citizen: { id: "citizen_atlas", name: "Atlas" },
      needs: { hunger: 10, health: 18, settlementNeeds: ["NEED_FOOD"] },
      locationSummary: "near river",
      inventorySummary: ["bread x1", "stick x4"],
      homeStatus: "claimed H3",
      currentGoal: "gather_food",
      relevantMemories: ["Maya promised food", "Failed fishing once"],
      availableHighLevelActions: [...PRIMARY_GOALS],
      timeContext: "dusk",
    };
    const a = buildCognitionInput(args);
    const b = buildCognitionInput(args);
    expect(stableSerialize(a)).toBe(stableSerialize(b));
    expect(a.charCount).toBeLessThan(3_500);
    expect(a.relevantMemories.length).toBeLessThanOrEqual(6);
    expect(a.citizen.id).toBe("citizen_atlas");
  });
});

describe("high-level decision schema", () => {
  it("accepts structured WHAT/WHY and rejects movement instructions", () => {
    const ok = validateStructuredDecision({
      primaryGoal: "gather_food",
      followUpGoals: ["share_resources"],
      reasonSummary: "Hunger is rising and Maya may share",
      confidence: 0.7,
      wantsToSpeak: true,
      speechIntent: "request",
      targetCitizenId: "citizen_maya",
    });
    expect(ok.primaryGoal).toBe("gather_food");

    expect(looksLikeMovementInstruction("walk 8 blocks north")).toBe(true);
    const bad = tryValidateStructuredDecision({
      primaryGoal: "gather_food",
      reasonSummary: "walk 8 blocks north then mine block x=3",
      confidence: 0.5,
    });
    expect(bad.ok).toBe(false);

    const invent = tryValidateStructuredDecision({ reasonSummary: "do something", confidence: 0.2 });
    expect(invent.ok).toBe(false);
  });

  it("normalizes legacy goal/priority fields safely", () => {
    const decision = validateStructuredDecision({
      goal: "Gather wood",
      priority: "0.66",
      reason: "Need logs",
    });
    expect(decision.primaryGoal).toBe("gather_wood");
    expect(decision.confidence).toBe(0.66);
  });
});

describe("commitments", () => {
  it("LLM cannot complete without verified evidence", () => {
    const c = createCommitment({
      ownerCitizenId: "citizen_maya",
      counterpartyId: "citizen_atlas",
      goal: "bring food",
    });
    const empty = completeCommitment(c, []);
    expect("error" in empty && empty.error).toMatch(/verified/i);
    const fake = completeCommitment(c, ["I gave Maya bread"]);
    expect("error" in fake && fake.error).toMatch(/verification/i);
    const done = completeCommitment(c, ["transfer:bread:maya->atlas", "event:ItemTransferred"]);
    expect("status" in done && done.status).toBe("COMPLETED");
    expect(() => updateCommitmentStatus(c, "COMPLETED")).toThrow();
  });
});

describe("decision cooldown / routing / psychology / tracing", () => {
  it("stable situation suppresses LLM; lethal is NO_LLM; mood stays evidence-driven", () => {
    const cooldown = shouldReconsiderDecision(
      {
        citizenId: "citizen_ava",
        currentGoal: "mine_stone",
        lastDecisionAt: Date.now() - 5_000,
        lastCategory: "ROUTINE",
        survivalSeverity: 0.1,
        goalValid: true,
      },
      "ROUTINE",
      Date.now(),
      { routineCooldownMs: 60_000 },
    );
    expect(cooldown.allowLlm).toBe(false);

    const fail = shouldReconsiderDecision(
      {
        citizenId: "citizen_ava",
        currentGoal: "mine_stone",
        lastDecisionAt: Date.now() - 5_000,
        lastCategory: "ROUTINE",
        lastFailureAt: Date.now() - 1_000,
        survivalSeverity: 0.1,
        goalValid: true,
      },
      "ROUTINE",
    );
    expect(fail.allowLlm).toBe(true);

    expect(classifyDecisionCategory({ lethalDanger: true, continuingObviousSkill: false, ordinaryChoice: false }).category).toBe(
      "NO_LLM",
    );
    expect(
      classifyDecisionCategory({
        lethalDanger: false,
        continuingObviousSkill: false,
        ordinaryChoice: false,
        betrayal: true,
      }).category,
    ).toBe("DEEP_REFLECTION");

    const mood = updateMood(undefined, "repeated_failure");
    expect(mood.label).toBe("frustrated");
    const separated = separateWorldBeliefEmotion({
      world: [{ id: "w1", description: "Maya did not deliver food", verified: true }],
      beliefs: [{ about: "Maya", description: "Maya may have forgotten", confidence: 0.4 }],
      mood,
    });
    expect(separated.world[0]?.verified).toBe(true);
    expect(separated.beliefs[0]?.description).toMatch(/forgotten/);
    expect(separated.mood.label).toBe("frustrated");

    let usage = emptyUsageStats("citizen_atlas");
    usage = recordUsage(usage, { category: "ROUTINE", estimatedTokens: 120, provider: "ollama", model: "qwen" });
    expect(usage.calls).toBe(1);
    expect(usage.byCategory.ROUTINE).toBe(1);

    const line = formatCognitionTrace({
      citizenId: "citizen_atlas",
      category: "ROUTINE",
      llmCalled: true,
      provider: "ollama",
      model: "qwen",
      memoryCount: 2,
      relationshipCount: 1,
      commitmentsConsidered: 0,
      availableActions: ["gather_food"],
      selectedGoal: "gather_food",
      validationOk: true,
    });
    expect(line).toContain("ROUTINE");
    expect(
      assertNoSecretsInTrace({
        citizenId: "x",
        category: "ROUTINE",
        llmCalled: false,
        memoryCount: 0,
        relationshipCount: 0,
        commitmentsConsidered: 0,
        availableActions: [],
        validationOk: true,
      }),
    ).toBe(true);
  });
});

describe("CitizenBrain multi-citizen scenarios", () => {
  const brain = new CitizenBrain();

  it("Scenario A/B: food request + broken promise context differs by citizen", () => {
    const atlasMem = [
      createMemory("citizen_atlas", "social", "I asked Maya for food", 0.8, "citizen_maya"),
      createMemory("citizen_atlas", "social", "Maya promised food but did not deliver", 0.9, "citizen_maya"),
    ];
    const mayaMem = [
      createMemory("citizen_maya", "social", "Atlas asked me for food", 0.8, "citizen_atlas"),
      createMemory("citizen_maya", "episodic", "I still have bread in my pack", 0.7),
    ];
    let atlasRel = blankBelief("citizen_atlas", "citizen_maya");
    atlasRel = applyBeliefEvent(atlasRel, {
      kind: "promise_made",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: true,
      detail: "bring food",
    });
    atlasRel = applyBeliefEvent(atlasRel, {
      kind: "promise_broken",
      observerId: "citizen_atlas",
      subjectId: "citizen_maya",
      firstPerson: true,
      detail: "bring food",
    });

    const atlasPrep = brain.prepare({
      citizenId: "citizen_atlas",
      citizenName: "Atlas",
      hunger: 8,
      health: 18,
      memories: atlasMem,
      relationships: [atlasRel],
      commitments: [],
      learned: summarizeLearnedBehavior([]),
      situationQuery: "food maya promise",
      settlementNeeds: ["NEED_FOOD"],
      inventorySummary: [],
      homeStatus: "housed",
      routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true, seriousRelationshipEvent: true },
      cooldown: {
        citizenId: "citizen_atlas",
        lastDecisionAt: 0,
        lastCategory: "ROUTINE",
        survivalSeverity: 0.3,
        goalValid: true,
        majorEventAt: Date.now(),
      },
    });
    expect(atlasPrep.allowLlm).toBe(true);
    expect(atlasPrep.input?.relevantMemories.some((m) => /promised|deliver/i.test(m))).toBe(true);

    const mayaPrep = brain.prepare({
      citizenId: "citizen_maya",
      citizenName: "Maya",
      hunger: 16,
      health: 20,
      memories: [...mayaMem, ...atlasMem], // even if mixed store, retrieval must filter
      relationships: [blankBelief("citizen_maya", "citizen_atlas")],
      commitments: [
        createCommitment({
          ownerCitizenId: "citizen_maya",
          counterpartyId: "citizen_atlas",
          goal: "bring food",
        }),
      ],
      learned: summarizeLearnedBehavior([
        { dimension: "resource_sharing", direction: 1, at: new Date().toISOString() },
      ]),
      situationQuery: "atlas food request bread",
      inventorySummary: ["bread x2"],
      homeStatus: "housed",
      routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
      cooldown: {
        citizenId: "citizen_maya",
        lastDecisionAt: 0,
        lastCategory: "ROUTINE",
        survivalSeverity: 0.1,
        goalValid: true,
      },
    });
    expect(mayaPrep.input?.citizen.name).toBe("Maya");
    expect(mayaPrep.input?.relevantMemories.every((m) => !m.includes("I asked Maya"))).toBe(true);
    expect(mayaPrep.input?.commitments[0]?.goal).toMatch(/food/);

    const mayaDecision = brain.finalize(
      {
        citizenId: "citizen_maya",
        citizenName: "Maya",
        hunger: 16,
        memories: mayaMem,
        relationships: [],
        commitments: [],
        learned: [],
        situationQuery: "share",
        routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
        cooldown: {
          citizenId: "citizen_maya",
          lastDecisionAt: 0,
          lastCategory: "ROUTINE",
          survivalSeverity: 0.1,
          goalValid: true,
        },
        modelOutput: {
          primaryGoal: "share_resources",
          reasonSummary: "Atlas asked and I have bread",
          confidence: 0.72,
          wantsToSpeak: true,
          speechIntent: "offer",
          targetCitizenId: "citizen_atlas",
        },
        provider: "ollama",
        model: "qwen",
        tokenUsage: 200,
      },
      mayaPrep,
    );
    expect(mayaDecision.validationOk).toBe(true);
    expect(mayaDecision.decision?.primaryGoal).toBe("share_resources");
    expect(mayaDecision.trace.llmCalled).toBe(true);
  });

  it("Scenario C/D/E/F: cooperation learning, failure reconsider, hunger context, lethal NO_LLM", () => {
    const learned = summarizeLearnedBehavior([
      { dimension: "solo_vs_coop", direction: 1, at: "2026-09-30T10:00:00.000Z" },
      { dimension: "solo_vs_coop", direction: 1, at: "2026-09-30T11:00:00.000Z" },
      { dimension: "solo_vs_coop", direction: 1, at: "2026-09-30T12:00:00.000Z" },
    ]);
    expect(learned.find((d) => d.dimension === "solo_vs_coop")!.confidence).toBeGreaterThan(0.3);
    expect(learned.find((d) => d.dimension === "solo_vs_coop")!.confidence).toBeLessThan(0.95);

    const avaFail = shouldReconsiderDecision(
      {
        citizenId: "citizen_ava",
        currentGoal: "mine_stone",
        lastDecisionAt: Date.now(),
        lastCategory: "ROUTINE",
        lastFailureAt: Date.now(),
        survivalSeverity: 0.2,
        goalValid: true,
      },
      "ROUTINE",
    );
    expect(avaFail.forceReconsider).toBe(true);

    const hungry = brain.prepare({
      citizenId: "citizen_theo",
      citizenName: "Theo",
      hunger: 9,
      health: 18,
      memories: [],
      relationships: [],
      commitments: [],
      learned: summarizeLearnedBehavior([]),
      situationQuery: "hunger",
      settlementNeeds: ["NEED_FOOD"],
      routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
      cooldown: {
        citizenId: "citizen_theo",
        lastDecisionAt: 0,
        lastCategory: "ROUTINE",
        survivalSeverity: 0.35,
        goalValid: true,
      },
    });
    expect(hungry.allowLlm).toBe(true);
    expect(hungry.category).toBe("ROUTINE");
    expect(hungry.input?.needs.hunger).toBe(9);

    const lethal = brain.prepare({
      citizenId: "citizen_kai",
      citizenName: "Kai",
      hunger: 12,
      health: 4,
      memories: [],
      relationships: [],
      commitments: [],
      learned: [],
      situationQuery: "creeper",
      routing: { lethalDanger: true, continuingObviousSkill: false, ordinaryChoice: false },
      cooldown: {
        citizenId: "citizen_kai",
        lastDecisionAt: 0,
        lastCategory: "NO_LLM",
        survivalSeverity: 1,
        goalValid: true,
      },
    });
    expect(lethal.allowLlm).toBe(false);
    expect(lethal.category).toBe("NO_LLM");
  });

  it("Scenario G/H: private histories and divergent beliefs", () => {
    const atlas = brain.prepare({
      citizenId: "citizen_atlas",
      citizenName: "Atlas",
      memories: [createMemory("citizen_atlas", "episodic", "I saw Maya near the farm at dusk", 0.7, "citizen_maya")],
      relationships: [
        applyBeliefEvent(blankBelief("citizen_atlas", "citizen_maya"), {
          kind: "promise_broken",
          observerId: "citizen_atlas",
          subjectId: "citizen_maya",
          firstPerson: true,
          detail: "food",
        }),
      ],
      commitments: [],
      learned: [],
      situationQuery: "maya farm",
      routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
      cooldown: {
        citizenId: "citizen_atlas",
        lastDecisionAt: 0,
        lastCategory: "ROUTINE",
        survivalSeverity: 0.1,
        goalValid: true,
      },
    });
    const maya = brain.prepare({
      citizenId: "citizen_maya",
      citizenName: "Maya",
      memories: [createMemory("citizen_maya", "episodic", "I was gathering wood, not farming", 0.7)],
      relationships: [blankBelief("citizen_maya", "citizen_atlas")],
      commitments: [],
      learned: [],
      situationQuery: "wood",
      routing: { lethalDanger: false, continuingObviousSkill: false, ordinaryChoice: true },
      cooldown: {
        citizenId: "citizen_maya",
        lastDecisionAt: 0,
        lastCategory: "ROUTINE",
        survivalSeverity: 0.1,
        goalValid: true,
      },
    });
    expect(atlas.input?.relevantMemories.join(" ")).not.toEqual(maya.input?.relevantMemories.join(" "));
    expect(atlas.input?.relationshipContext[0]?.trust).toBeLessThan(0.5);
    expect(maya.input?.relationshipContext[0]?.trust).toBe(0.5);
  });
});
