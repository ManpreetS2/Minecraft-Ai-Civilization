import type { AppConfig, CognitionState, DecisionCategory } from "@civ/shared";
import {
  CitizenBrain,
  checkModelBudget,
  classifyDecisionCategory,
  type BrainDecisionResult,
  type BrainObserveArgs,
  type BudgetCallRecord,
  type ModelBudgetConfig,
  type RoutingContext,
  type StructuredDecision,
} from "@civ/cognition";
import {
  loadBudgetHistoryFromStore,
  shouldCountTowardBudget,
} from "./durable-budget.js";
import type { BrainPersistence, PendingReconsiderSignal } from "./brain-persistence.js";

export type AdapterObserveInput = {
  citizenId: string;
  citizenName: string;
  hunger?: number;
  health?: number;
  locationSummary?: string;
  inventorySummary?: string[];
  homeStatus?: string;
  settlementNeeds?: string[];
  memories: BrainObserveArgs["memories"];
  situationQuery: string;
  routing: RoutingContext;
  /** Wall-clock / sim now. */
  now?: number;
  /** Minecraft day index for budget windows. */
  mcDay?: number;
  /** Immediate lethal reflex — must never call LLM. */
  lethalReflex?: boolean;
  /** Currently executing a valid deterministic skill. */
  executingValidSkill?: boolean;
  /** True when at a safe skill boundary (can flush pending reconsider). */
  atSkillBoundary?: boolean;
  /** Task / skill just failed. */
  taskFailed?: boolean;
  /**
   * Direct/required meaningful social request (not ambient chatter).
   * Must not be lost during long skills — queued if needed.
   */
  meaningfulRequest?: boolean;
  /** Ordinary ambient speech — does not interrupt work. */
  ambientSpeech?: boolean;
  /** Commitment conflict detected. */
  commitmentConflict?: boolean;
  /** Major relationship event. */
  majorRelationshipEvent?: boolean;
  /** Survival needs changed meaningfully. */
  survivalChanged?: boolean;
  /** Current high-level goal invalidated. */
  goalInvalidated?: boolean;
};

export type GateDecision = {
  category: DecisionCategory;
  reason: string;
  forceReconsider: boolean;
  /** Skill may continue; pending signal was queued. */
  queuedSignals: PendingReconsiderSignal[];
  /** Lethal / safety path. */
  lethal: boolean;
};

export type NormalizedIntention = {
  citizenId: string;
  category: DecisionCategory;
  llmCalled: boolean;
  primaryGoal?: string;
  reasonSummary?: string;
  confidence?: number;
  budgetExhausted: boolean;
  featureEnabled: boolean;
  /** High-level only — never path nodes or Mineflayer handles. */
  highLevelGoalRestored?: string;
  physicalExecutionAssumed: false;
  decision?: StructuredDecision;
  validationOk: boolean;
  validationError?: string;
  skipReason?: string;
  queuedSignals?: PendingReconsiderSignal[];
  pendingSignals?: PendingReconsiderSignal[];
};

/**
 * Thin feature-flagged boundary between future AgentManager and CitizenBrain.
 * Does NOT execute Minecraft movement, mining, crafting, fishing, or job assignment.
 *
 * Reconsideration precedence:
 * 1. lethal reflex → NO_LLM safety
 * 2. failed / invalid / impossible current task → reconsider now
 * 3. important direct social/commitment event → reconsider now OR queue if mid-skill
 * 4. otherwise valid deterministic skill may continue without LLM
 */
export class CitizenBrainAdapter {
  private readonly brain: CitizenBrain;

  constructor(
    private readonly config: AppConfig,
    private readonly persistence: BrainPersistence,
    brain?: CitizenBrain,
  ) {
    this.brain = brain ?? new CitizenBrain();
  }

  get enabled(): boolean {
    return this.config.CITIZEN_BRAIN_V2_ENABLED === true;
  }

  budgetConfig(): ModelBudgetConfig {
    return {
      maxCallsPerCitizenPerMcDay: this.config.LLM_MAX_CALLS_PER_CITIZEN_PER_MC_DAY,
      maxRoutineCallsPerWindow: this.config.LLM_MAX_ROUTINE_CALLS_PER_WINDOW,
      routineWindowMs: this.config.LLM_ROUTINE_WINDOW_MS,
      maxDeepReflectionCallsPerMcDay: this.config.LLM_MAX_DEEP_REFLECTION_CALLS_PER_MC_DAY,
      globalMaxCallsPerMcDay: this.config.LLM_GLOBAL_MAX_CALLS_PER_MC_DAY,
    };
  }

  /** Durable budget history reconstructed from llm_calls. */
  loadDurableBudgetHistory(): BudgetCallRecord[] {
    return loadBudgetHistoryFromStore(this.persistence.store);
  }

  classifyGate(input: AdapterObserveInput): GateDecision {
    const queuedSignals: PendingReconsiderSignal[] = [];
    const at = new Date(input.now ?? Date.now()).toISOString();

    // 1. Lethal reflex always wins.
    if (input.lethalReflex || input.routing.lethalDanger) {
      return {
        category: "NO_LLM",
        reason: "immediate lethal reflex",
        forceReconsider: false,
        queuedSignals,
        lethal: true,
      };
    }

    // Persist important signals before skill-continuation short-circuit.
    if (input.taskFailed) {
      this.persistence.upsertPendingReconsideration(input.citizenId, "TASK_FAILURE", undefined, at);
      queuedSignals.push("TASK_FAILURE");
    }
    if (input.goalInvalidated) {
      this.persistence.upsertPendingReconsideration(input.citizenId, "GOAL_INVALIDATED", undefined, at);
      queuedSignals.push("GOAL_INVALIDATED");
    }
    if (input.meaningfulRequest) {
      this.persistence.upsertPendingReconsideration(input.citizenId, "REQUEST_PENDING", undefined, at);
      queuedSignals.push("REQUEST_PENDING");
    }
    if (input.commitmentConflict) {
      this.persistence.upsertPendingReconsideration(input.citizenId, "COMMITMENT_CONFLICT", undefined, at);
      queuedSignals.push("COMMITMENT_CONFLICT");
    }
    if (input.majorRelationshipEvent) {
      this.persistence.upsertPendingReconsideration(input.citizenId, "MAJOR_RELATIONSHIP", undefined, at);
      queuedSignals.push("MAJOR_RELATIONSHIP");
    }
    if (input.survivalChanged) {
      this.persistence.upsertPendingReconsideration(input.citizenId, "SURVIVAL_CHANGED", undefined, at);
      queuedSignals.push("SURVIVAL_CHANGED");
    }
    // ambientSpeech intentionally ignored for interruption

    const pending = this.persistence.listPendingReconsideration(input.citizenId);
    const hasTaskBreak =
      Boolean(input.taskFailed) ||
      Boolean(input.goalInvalidated) ||
      pending.some((p) => p.signal === "TASK_FAILURE" || p.signal === "GOAL_INVALIDATED");

    // 2. Failed / invalid task → reconsider now (even mid-skill).
    if (hasTaskBreak) {
      const routed = classifyDecisionCategory({
        ...input.routing,
        continuingObviousSkill: false,
        ordinaryChoice: false,
      });
      return {
        category: routed.category === "NO_LLM" ? "ROUTINE" : routed.category,
        reason: "task failed or goal invalidated — reconsider",
        forceReconsider: true,
        queuedSignals,
        lethal: false,
      };
    }

    const hasImportantSocial =
      Boolean(input.meaningfulRequest) ||
      Boolean(input.commitmentConflict) ||
      Boolean(input.majorRelationshipEvent) ||
      pending.some((p) =>
        p.signal === "REQUEST_PENDING" ||
        p.signal === "COMMITMENT_CONFLICT" ||
        p.signal === "MAJOR_RELATIONSHIP",
      );

    const midSkill = Boolean(input.executingValidSkill || input.routing.continuingObviousSkill);
    const atBoundary = Boolean(input.atSkillBoundary);

    // 3. Important social/commitment while mid-skill → queue, continue skill (unless boundary).
    if (midSkill && hasImportantSocial && !atBoundary) {
      return {
        category: "NO_LLM",
        reason: "valid skill continues; important reconsideration queued",
        forceReconsider: false,
        queuedSignals,
        lethal: false,
      };
    }

    if (hasImportantSocial && (!midSkill || atBoundary)) {
      const routed = classifyDecisionCategory({
        ...input.routing,
        continuingObviousSkill: false,
        seriousRelationshipEvent: true,
        ordinaryChoice: false,
      });
      return {
        category: routed.category,
        reason: "important direct social/commitment reconsideration",
        forceReconsider: true,
        queuedSignals,
        lethal: false,
      };
    }

    // Flush other pending at skill boundary
    if (atBoundary && pending.length > 0) {
      return {
        category: "IMPORTANT",
        reason: "skill boundary — flush pending reconsideration",
        forceReconsider: true,
        queuedSignals,
        lethal: false,
      };
    }

    // 4. Valid deterministic skill continuation
    if (midSkill) {
      return {
        category: "NO_LLM",
        reason: "executing valid deterministic action",
        forceReconsider: false,
        queuedSignals,
        lethal: false,
      };
    }

    const forceReconsider = Boolean(input.survivalChanged) || pending.some((p) => p.signal === "SURVIVAL_CHANGED");
    const routed = classifyDecisionCategory({
      ...input.routing,
      ordinaryChoice: input.routing.ordinaryChoice && !forceReconsider,
    });
    return {
      category: routed.category,
      reason: routed.reason,
      forceReconsider,
      queuedSignals,
      lethal: false,
    };
  }

  deliberate(
    input: AdapterObserveInput,
    modelOutput?: unknown,
    meta?: {
      provider?: string;
      model?: string;
      latencyMs?: number;
      tokenUsage?: number;
      decisionId?: string;
      ok?: boolean;
      fallbackUsed?: boolean;
    },
  ): NormalizedIntention {
    if (!this.enabled) {
      return {
        citizenId: input.citizenId,
        category: "NO_LLM",
        llmCalled: false,
        budgetExhausted: false,
        featureEnabled: false,
        physicalExecutionAssumed: false,
        validationOk: true,
        skipReason: "CITIZEN_BRAIN_V2_ENABLED=false",
      };
    }

    const now = input.now ?? Date.now();
    const mcDay = input.mcDay ?? 0;
    const cogn = this.persistence.getCognitionState(input.citizenId);
    const commitments = this.persistence.listCommitmentsFor(input.citizenId);
    const relationships = this.persistence.listRelationshipBeliefs(input.citizenId);
    const learned = this.persistence.summarizeLearned(input.citizenId, now);
    const gate = this.classifyGate(input);
    const pending = this.persistence.listPendingReconsideration(input.citizenId);

    if (gate.category === "NO_LLM" && !gate.forceReconsider) {
      return {
        citizenId: input.citizenId,
        category: "NO_LLM",
        llmCalled: false,
        budgetExhausted: false,
        featureEnabled: true,
        highLevelGoalRestored: cogn?.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        primaryGoal: cogn?.currentHighLevelGoal,
        validationOk: true,
        skipReason: gate.reason,
        queuedSignals: gate.queuedSignals,
        pendingSignals: pending.map((p) => p.signal),
      };
    }

    const cooldown = {
      citizenId: input.citizenId,
      currentGoal: cogn?.currentHighLevelGoal,
      lastDecisionAt: cogn?.lastDeliberationAt ? Date.parse(cogn.lastDeliberationAt) : 0,
      lastCategory: (cogn?.lastDecisionCategory ?? "ROUTINE") as DecisionCategory,
      lastFailureAt: input.taskFailed ? now : undefined,
      majorEventAt: input.majorRelationshipEvent || input.commitmentConflict ? now : undefined,
      requestAt: input.meaningfulRequest ? now : undefined,
      survivalSeverity: input.survivalChanged
        ? 0.9
        : input.hunger !== undefined
          ? (20 - input.hunger) / 20
          : 0.2,
      goalValid: !input.goalInvalidated && Boolean(cogn?.currentHighLevelGoal || !gate.forceReconsider),
    };

    if (
      !gate.forceReconsider &&
      cogn?.reconsiderAfter &&
      Date.parse(cogn.reconsiderAfter) > now &&
      cogn.currentHighLevelGoal &&
      pending.length === 0
    ) {
      return {
        citizenId: input.citizenId,
        category: "NO_LLM",
        llmCalled: false,
        budgetExhausted: false,
        featureEnabled: true,
        highLevelGoalRestored: cogn.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        primaryGoal: cogn.currentHighLevelGoal,
        validationOk: true,
        skipReason: "no meaningful state change during cooldown",
      };
    }

    const observe: BrainObserveArgs = {
      citizenId: input.citizenId,
      citizenName: input.citizenName,
      hunger: input.hunger,
      health: input.health,
      locationSummary: input.locationSummary,
      inventorySummary: input.inventorySummary,
      homeStatus: input.homeStatus,
      currentGoal: cogn?.currentHighLevelGoal,
      settlementNeeds: input.settlementNeeds,
      memories: input.memories,
      relationships,
      commitments,
      learned,
      mood:
        cogn?.moodLabel && cogn.moodIntensity !== undefined
          ? {
              label: cogn.moodLabel,
              intensity: cogn.moodIntensity,
              evidenceCount: cogn.moodEvidenceCount ?? 0,
              updatedAt: cogn.moodUpdatedAt ?? cogn.updatedAt,
            }
          : undefined,
      situationQuery: input.situationQuery,
      routing: {
        ...input.routing,
        lethalDanger: Boolean(input.lethalReflex || input.routing.lethalDanger),
        continuingObviousSkill: gate.category === "NO_LLM" && !gate.forceReconsider,
        seriousRelationshipEvent:
          input.routing.seriousRelationshipEvent || Boolean(input.majorRelationshipEvent),
        ordinaryChoice: input.routing.ordinaryChoice && !gate.forceReconsider,
      },
      cooldown,
      now,
    };

    // Override prepare routing category via force path: build args so prepare sees non-NO_LLM when reconsidering
    const prepared = this.brain.prepare({
      ...observe,
      routing: {
        ...observe.routing,
        continuingObviousSkill: false,
        lethalDanger: false,
      },
      cooldown: {
        ...cooldown,
        goalValid: gate.forceReconsider ? false : cooldown.goalValid,
      },
    });

    const category = gate.forceReconsider ? gate.category : prepared.category;
    const allowLlm = category !== "NO_LLM" && (prepared.allowLlm || gate.forceReconsider);

    if (!allowLlm) {
      return {
        citizenId: input.citizenId,
        category,
        llmCalled: false,
        budgetExhausted: false,
        featureEnabled: true,
        highLevelGoalRestored: cogn?.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        primaryGoal: cogn?.currentHighLevelGoal,
        validationOk: true,
        skipReason: prepared.cooldownReason,
        pendingSignals: pending.map((p) => p.signal),
      };
    }

    const budgetHistory = this.loadDurableBudgetHistory();
    const budget = checkModelBudget(
      input.citizenId,
      category,
      budgetHistory,
      this.budgetConfig(),
      now,
      mcDay,
    );

    if (!budget.allowed) {
      return {
        citizenId: input.citizenId,
        category,
        llmCalled: false,
        budgetExhausted: true,
        featureEnabled: true,
        highLevelGoalRestored: cogn?.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        primaryGoal: cogn?.currentHighLevelGoal,
        validationOk: true,
        skipReason: budget.reason,
        pendingSignals: pending.map((p) => p.signal),
      };
    }

    if (modelOutput === undefined) {
      return {
        citizenId: input.citizenId,
        category,
        llmCalled: false,
        budgetExhausted: false,
        featureEnabled: true,
        highLevelGoalRestored: cogn?.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        validationOk: true,
        skipReason: "awaiting_provider",
        pendingSignals: pending.map((p) => p.signal),
      };
    }

    const preparedForFinalize = {
      ...prepared,
      category,
      allowLlm: true,
    };

    const result = this.brain.finalize(
      {
        ...observe,
        modelOutput,
        provider: meta?.provider,
        model: meta?.model,
        latencyMs: meta?.latencyMs,
        tokenUsage: meta?.tokenUsage,
        fallbackUsed: meta?.fallbackUsed,
      },
      preparedForFinalize,
    );

    const decisionId = meta?.decisionId ?? crypto.randomUUID();
    const ok = meta?.ok ?? result.validationOk;
    const alreadyCounted = this.persistence.store.hasBudgetCountForDecision(decisionId);
    const countsTowardBudget = shouldCountTowardBudget({
      category,
      ok: Boolean(ok && result.llmCalled),
      alreadyCountedForDecision: alreadyCounted,
    });

    this.persistence.store.logLlmCall({
      citizenId: input.citizenId,
      latencyMs: meta?.latencyMs ?? 0,
      ok: Boolean(ok),
      goal: result.decision?.primaryGoal,
      reason: result.decision?.reasonSummary ?? result.validationError,
      error: result.validationOk ? undefined : result.validationError,
      decisionCategory: category,
      mcDay,
      provider: meta?.provider,
      model: meta?.model,
      fallbackUsed: meta?.fallbackUsed,
      decisionId,
      countsTowardBudget,
      timestamp: new Date(now).toISOString(),
    });

    if (result.validationOk && result.decision) {
      this.persistDecisionState(input.citizenId, result, now);
      // Clear handled pending signals after successful deliberation.
      this.persistence.clearPendingReconsideration(input.citizenId);
    }

    return {
      ...normalizeResult(input.citizenId, result, cogn, false),
      category,
      pendingSignals: [],
    };
  }

  /**
   * Record a durable budget-consuming LLM call (tests / external provider path).
   * Retries must reuse decisionId so only one attempt counts.
   */
  recordDurableBudgetCall(entry: {
    citizenId: string;
    category: DecisionCategory;
    atMs: number;
    mcDay?: number;
    decisionId?: string;
    ok?: boolean;
    provider?: string;
    model?: string;
    fallbackUsed?: boolean;
    latencyMs?: number;
  }): void {
    if (entry.category === "NO_LLM") return;
    const decisionId = entry.decisionId ?? crypto.randomUUID();
    const ok = entry.ok ?? true;
    const already = this.persistence.store.hasBudgetCountForDecision(decisionId);
    const countsTowardBudget = shouldCountTowardBudget({
      category: entry.category,
      ok,
      alreadyCountedForDecision: already,
    });
    this.persistence.store.logLlmCall({
      citizenId: entry.citizenId,
      latencyMs: entry.latencyMs ?? 0,
      ok,
      decisionCategory: entry.category,
      mcDay: entry.mcDay ?? 0,
      provider: entry.provider,
      model: entry.model,
      fallbackUsed: entry.fallbackUsed,
      decisionId,
      countsTowardBudget,
      timestamp: new Date(entry.atMs).toISOString(),
    });
  }

  /** @deprecated Use recordDurableBudgetCall — kept for Pass-4 tests. */
  recordBudgetCall(citizenId: string, category: DecisionCategory, atMs: number, mcDay = 0): void {
    this.recordDurableBudgetCall({ citizenId, category, atMs, mcDay });
  }

  getBudgetHistory(): readonly BudgetCallRecord[] {
    return this.loadDurableBudgetHistory();
  }

  private persistDecisionState(citizenId: string, result: BrainDecisionResult, now: number): void {
    const prev = this.persistence.getCognitionState(citizenId);
    const goal = result.decision?.primaryGoal ?? prev?.currentHighLevelGoal;
    const state: CognitionState = {
      citizenId,
      currentHighLevelGoal: goal,
      goalStartedAt:
        goal && goal !== prev?.currentHighLevelGoal
          ? new Date(now).toISOString()
          : prev?.goalStartedAt ?? new Date(now).toISOString(),
      lastDeliberationAt: new Date(now).toISOString(),
      reconsiderAfter: new Date(now + 60_000).toISOString(),
      lastMajorEventId: prev?.lastMajorEventId,
      lastDecisionCategory: result.category,
      moodLabel: prev?.moodLabel,
      moodIntensity: prev?.moodIntensity,
      moodEvidenceCount: prev?.moodEvidenceCount,
      moodUpdatedAt: prev?.moodUpdatedAt,
      updatedAt: new Date(now).toISOString(),
    };
    this.persistence.saveCognitionState(state);
  }
}

function normalizeResult(
  citizenId: string,
  result: BrainDecisionResult,
  cogn: CognitionState | undefined,
  budgetExhausted: boolean,
): NormalizedIntention {
  return {
    citizenId,
    category: result.category,
    llmCalled: result.llmCalled,
    primaryGoal: result.decision?.primaryGoal ?? cogn?.currentHighLevelGoal,
    reasonSummary: result.decision?.reasonSummary,
    confidence: result.decision?.confidence,
    budgetExhausted,
    featureEnabled: true,
    highLevelGoalRestored: cogn?.currentHighLevelGoal,
    physicalExecutionAssumed: false,
    decision: result.decision,
    validationOk: result.validationOk,
    validationError: result.validationError,
    skipReason: result.trace.reason,
  };
}
