import type {
  Commitment,
  DecisionCategory,
  LearnedTendency,
  MemoryRecord,
  MoodAffect,
  RelationshipBelief,
} from "@civ/shared";
import { retrieveRelevantMemories } from "@civ/memory";
import type { CognitionTrace } from "./cognition-trace.js";
import { formatCognitionTrace } from "./cognition-trace.js";
import {
  PRIMARY_GOALS,
  toLegacyDecision,
  tryValidateStructuredDecision,
  type StructuredDecision,
} from "./decision-schema.js";
import { shouldReconsiderDecision, type CooldownState } from "./cooldown.js";
import { buildCognitionInput, cognitionInputToPromptLines, type CognitionInput } from "./input.js";
import { activeCommitmentsFor } from "./commitments.js";
import {
  classifyDecisionCategory,
  emptyUsageStats,
  recordUsage,
  type CognitionUsageStats,
  type RoutingContext,
} from "./routing.js";

export type BrainObserveArgs = {
  citizenId: string;
  citizenName: string;
  hunger?: number;
  health?: number;
  locationSummary?: string;
  inventorySummary?: string[];
  homeStatus?: string;
  currentGoal?: string;
  settlementNeeds?: string[];
  memories: MemoryRecord[];
  relationships: RelationshipBelief[];
  commitments: Commitment[];
  learned: LearnedTendency[];
  mood?: MoodAffect;
  recentImportantEvents?: string[];
  uncertainty?: string[];
  timeContext?: string;
  situationQuery: string;
  routing: RoutingContext;
  cooldown: CooldownState;
  now?: number;
};

export type BrainPlan = {
  category: DecisionCategory;
  allowLlm: boolean;
  cooldownReason: string;
  input?: CognitionInput;
  promptLines?: string[];
  trace: CognitionTrace;
};

export type BrainDecideArgs = BrainObserveArgs & {
  /** Raw model JSON / object — never movement instructions. */
  modelOutput?: unknown;
  provider?: string;
  model?: string;
  latencyMs?: number;
  tokenUsage?: number;
  fallbackUsed?: boolean;
};

export type BrainDecisionResult = {
  category: DecisionCategory;
  llmCalled: boolean;
  decision?: StructuredDecision;
  legacyGoal?: string;
  validationOk: boolean;
  validationError?: string;
  usage: CognitionUsageStats;
  trace: CognitionTrace;
  input?: CognitionInput;
};

/**
 * Citizen brain facade: builds cognition input, classifies routing,
 * applies cooldown, validates structured decisions.
 * Does not execute Minecraft skills.
 */
export class CitizenBrain {
  private usage = new Map<string, CognitionUsageStats>();

  getUsage(citizenId: string): CognitionUsageStats {
    return this.usage.get(citizenId) ?? emptyUsageStats(citizenId);
  }

  prepare(args: BrainObserveArgs): BrainPlan {
    const routed = classifyDecisionCategory(args.routing);
    const cooldown = shouldReconsiderDecision(args.cooldown, routed.category, args.now ?? Date.now());
    const allowLlm = routed.category !== "NO_LLM" && cooldown.allowLlm;

    const memories = retrieveRelevantMemories(args.memories, {
      citizenId: args.citizenId,
      situation: args.situationQuery,
      limit: 5,
      now: args.now,
      activeCommitmentHints: args.commitments.map((c) => c.goal),
      unresolvedHints: args.relationships.flatMap((r) => [...r.unresolvedPromises, ...r.unresolvedRequests]),
    });

    let input: CognitionInput | undefined;
    let promptLines: string[] | undefined;
    if (allowLlm) {
      input = buildCognitionInput({
        citizen: { id: args.citizenId, name: args.citizenName },
        needs: {
          hunger: args.hunger,
          health: args.health,
          settlementNeeds: args.settlementNeeds ?? [],
          housing: args.homeStatus?.includes("homeless") ? true : undefined,
        },
        locationSummary: args.locationSummary,
        inventorySummary: args.inventorySummary,
        homeStatus: args.homeStatus,
        currentGoal: args.currentGoal,
        commitments: activeCommitmentsFor(args.citizenId, args.commitments),
        recentImportantEvents: args.recentImportantEvents,
        relevantMemories: memories.map((m) => m.content),
        relationships: args.relationships.filter((r) => r.observerId === args.citizenId),
        learned: args.learned,
        mood: args.mood,
        availableHighLevelActions: [...PRIMARY_GOALS],
        uncertainty: args.uncertainty,
        timeContext: args.timeContext,
      });
      promptLines = cognitionInputToPromptLines(input);
    }

    const trace: CognitionTrace = {
      citizenId: args.citizenId,
      citizenName: args.citizenName,
      category: routed.category,
      llmCalled: false,
      memoryCount: memories.length,
      relationshipCount: args.relationships.filter((r) => r.observerId === args.citizenId).length,
      commitmentsConsidered: activeCommitmentsFor(args.citizenId, args.commitments).length,
      availableActions: [...PRIMARY_GOALS],
      validationOk: true,
      reason: allowLlm ? routed.reason : cooldown.reason,
    };

    return {
      category: routed.category,
      allowLlm,
      cooldownReason: cooldown.reason,
      input,
      promptLines,
      trace,
    };
  }

  finalize(args: BrainDecideArgs, prepared: BrainPlan): BrainDecisionResult {
    let usage = this.getUsage(args.citizenId);
    usage = recordUsage(usage, {
      category: prepared.category,
      estimatedTokens: args.tokenUsage,
      provider: args.provider,
      model: args.model,
      fallbackUsed: args.fallbackUsed,
    });
    this.usage.set(args.citizenId, usage);

    if (!prepared.allowLlm || prepared.category === "NO_LLM") {
      const trace: CognitionTrace = {
        ...prepared.trace,
        llmCalled: false,
        validationOk: true,
        selectedGoal: undefined,
        reason: prepared.cooldownReason,
      };
      return {
        category: prepared.category,
        llmCalled: false,
        validationOk: true,
        usage,
        trace,
        input: prepared.input,
      };
    }

    const parsed = tryValidateStructuredDecision(args.modelOutput);
    const trace: CognitionTrace = {
      ...prepared.trace,
      llmCalled: true,
      provider: args.provider,
      model: args.model,
      fallbackUsed: args.fallbackUsed,
      latencyMs: args.latencyMs,
      tokenUsage: args.tokenUsage,
      validationOk: parsed.ok,
      validationError: parsed.ok ? undefined : parsed.error,
      selectedGoal: parsed.ok ? parsed.decision.primaryGoal : undefined,
      reason: parsed.ok ? parsed.decision.reasonSummary : parsed.error,
    };

    // Ensure secrets never land in default string form.
    void formatCognitionTrace(trace);

    if (!parsed.ok) {
      return {
        category: prepared.category,
        llmCalled: true,
        validationOk: false,
        validationError: parsed.error,
        usage,
        trace,
        input: prepared.input,
      };
    }

    const legacy = toLegacyDecision(parsed.decision);
    return {
      category: prepared.category,
      llmCalled: true,
      decision: parsed.decision,
      legacyGoal: legacy.goal,
      validationOk: true,
      usage,
      trace,
      input: prepared.input,
    };
  }
}
