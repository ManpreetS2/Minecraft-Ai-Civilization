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
import type { BrainPersistence } from "./brain-persistence.js";

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
  /** Task / skill just failed. */
  taskFailed?: boolean;
  /** Meaningful social request arrived. */
  meaningfulRequest?: boolean;
  /** Commitment conflict detected. */
  commitmentConflict?: boolean;
  /** Major relationship event. */
  majorRelationshipEvent?: boolean;
  /** Survival needs changed meaningfully. */
  survivalChanged?: boolean;
  /** Current high-level goal invalidated. */
  goalInvalidated?: boolean;
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
};

/**
 * Thin feature-flagged boundary between future AgentManager and CitizenBrain.
 * Does NOT execute Minecraft movement, mining, crafting, fishing, or job assignment.
 */
export class CitizenBrainAdapter {
  private readonly brain: CitizenBrain;
  private readonly budgetHistory: BudgetCallRecord[] = [];

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

  /**
   * Deterministic gate before CitizenBrain / provider.
   * Returns NO_LLM for obvious reflexes and stable cooldown cases.
   */
  classifyGate(input: AdapterObserveInput): {
    category: DecisionCategory;
    reason: string;
    forceReconsider: boolean;
  } {
    if (input.lethalReflex || input.routing.lethalDanger) {
      return { category: "NO_LLM", reason: "immediate lethal reflex", forceReconsider: false };
    }
    if (input.executingValidSkill || input.routing.continuingObviousSkill) {
      return { category: "NO_LLM", reason: "executing valid deterministic action", forceReconsider: false };
    }

    const forceReconsider =
      Boolean(input.taskFailed) ||
      Boolean(input.meaningfulRequest) ||
      Boolean(input.commitmentConflict) ||
      Boolean(input.majorRelationshipEvent) ||
      Boolean(input.survivalChanged) ||
      Boolean(input.goalInvalidated);

    const routed = classifyDecisionCategory({
      ...input.routing,
      seriousRelationshipEvent:
        input.routing.seriousRelationshipEvent || Boolean(input.majorRelationshipEvent),
      ordinaryChoice: input.routing.ordinaryChoice && !forceReconsider,
    });

    return { category: routed.category, reason: routed.reason, forceReconsider };
  }

  /**
   * Prepare + optionally finalize a deliberation.
   * When feature flag is off, returns disabled stub without calling providers.
   */
  deliberate(
    input: AdapterObserveInput,
    modelOutput?: unknown,
    meta?: { provider?: string; model?: string; latencyMs?: number; tokenUsage?: number },
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

    const cooldown = {
      citizenId: input.citizenId,
      currentGoal: cogn?.currentHighLevelGoal,
      lastDecisionAt: cogn?.lastDeliberationAt ? Date.parse(cogn.lastDeliberationAt) : 0,
      lastCategory: (cogn?.lastDecisionCategory ?? "ROUTINE") as DecisionCategory,
      lastFailureAt: input.taskFailed ? now : undefined,
      majorEventAt: input.majorRelationshipEvent || input.commitmentConflict ? now : undefined,
      requestAt: input.meaningfulRequest ? now : undefined,
      survivalSeverity: input.survivalChanged ? 0.9 : (input.hunger !== undefined ? (20 - input.hunger) / 20 : 0.2),
      goalValid: !input.goalInvalidated && Boolean(cogn?.currentHighLevelGoal || !gate.forceReconsider),
    };

    // Stable cooldown with no meaningful change → NO_LLM without provider.
    if (
      !gate.forceReconsider &&
      gate.category !== "NO_LLM" &&
      cogn?.reconsiderAfter &&
      Date.parse(cogn.reconsiderAfter) > now &&
      cogn.currentHighLevelGoal
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
        continuingObviousSkill: Boolean(input.executingValidSkill || input.routing.continuingObviousSkill),
        seriousRelationshipEvent:
          input.routing.seriousRelationshipEvent || Boolean(input.majorRelationshipEvent),
      },
      cooldown,
      now,
    };

    const prepared = this.brain.prepare(observe);

    if (prepared.category === "NO_LLM" || !prepared.allowLlm) {
      return {
        citizenId: input.citizenId,
        category: prepared.category === "NO_LLM" ? "NO_LLM" : prepared.category,
        llmCalled: false,
        budgetExhausted: false,
        featureEnabled: true,
        highLevelGoalRestored: cogn?.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        primaryGoal: cogn?.currentHighLevelGoal,
        validationOk: true,
        skipReason: prepared.cooldownReason,
      };
    }

    const budget = checkModelBudget(
      input.citizenId,
      prepared.category,
      this.budgetHistory,
      this.budgetConfig(),
      now,
      mcDay,
    );

    if (!budget.allowed) {
      return {
        citizenId: input.citizenId,
        category: prepared.category,
        llmCalled: false,
        budgetExhausted: true,
        featureEnabled: true,
        highLevelGoalRestored: cogn?.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        primaryGoal: cogn?.currentHighLevelGoal,
        validationOk: true,
        skipReason: budget.reason,
      };
    }

    // Provider call is injected by caller via modelOutput — adapter never invents decisions.
    if (modelOutput === undefined) {
      return {
        citizenId: input.citizenId,
        category: prepared.category,
        llmCalled: false,
        budgetExhausted: false,
        featureEnabled: true,
        highLevelGoalRestored: cogn?.currentHighLevelGoal,
        physicalExecutionAssumed: false,
        validationOk: true,
        skipReason: "awaiting_provider",
      };
    }

    const result = this.brain.finalize(
      {
        ...observe,
        modelOutput,
        provider: meta?.provider,
        model: meta?.model,
        latencyMs: meta?.latencyMs,
        tokenUsage: meta?.tokenUsage,
      },
      prepared,
    );

    if (result.llmCalled) {
      this.budgetHistory.push({
        citizenId: input.citizenId,
        category: prepared.category,
        atMs: now,
        mcDay,
      });
    }

    if (result.validationOk && result.decision) {
      this.persistDecisionState(input.citizenId, result, now);
    }

    return normalizeResult(input.citizenId, result, cogn, false);
  }

  /** Record an in-memory budget call (tests / when provider invoked outside finalize). */
  recordBudgetCall(citizenId: string, category: DecisionCategory, atMs: number, mcDay = 0): void {
    this.budgetHistory.push({ citizenId, category, atMs, mcDay });
  }

  getBudgetHistory(): readonly BudgetCallRecord[] {
    return this.budgetHistory;
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
