import {
  clamp01,
  randomId,
  retrieveLessons,
  SYSTEM_FAILURE_CATEGORIES,
  type CognitiveStore,
  type DecisionEvaluation,
  type DecisionOutcome,
  type FailureEpisode,
  type LearningLesson,
  type LearningMetrics,
  type LessonRetrievalQuery,
  type SystemIncident,
} from "@civ/memory";
import { classifyFailure, type FailureSignal } from "./classify.js";
import type { LessonProposal } from "./lesson-schema.js";

export type AttemptInput = {
  citizenId: string;
  timestamp?: string;
  goal?: string;
  task?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  targetPosition?: { x: number; y: number; z: number };
  contextSummary: string;
  expectedOutcome?: string;
  actualOutcome?: string;
  inventory?: string[];
  worldFacts?: string[];
  relatedMemoryIds?: string[];
  decisionId?: string;
  model?: string;
  success?: boolean;
  signal?: FailureSignal;
};

export type RecordedAttempt = {
  track: "CITIZEN" | "SYSTEM";
  episode?: FailureEpisode;
  incident?: SystemIncident;
  lesson?: LearningLesson;
  repeated: boolean;
  createdLesson: boolean;
};

const KNOWN_LESSONS: Record<string, { pattern: string; lesson: string; candidateEngineRule?: boolean }> = {
  MISSING_TOOL: {
    pattern: "missing_tool:mine_stone",
    lesson: "Before attempting to collect stone, ensure a usable pickaxe is available.",
    candidateEngineRule: true,
  },
  MISSING_RECIPE_INPUT: {
    pattern: "missing_recipe_input",
    lesson: "Craft or gather missing recipe inputs before retrying the same craft.",
  },
  TARGET_UNREACHABLE: {
    pattern: "target_unreachable",
    lesson: "When a resource cannot be reached from one approach, try a different reachable target instead of repeating the same approach.",
  },
  INVENTORY_FULL: {
    pattern: "inventory_full",
    lesson: "Deposit or use storage before gathering more items when inventory is full.",
  },
};

export class ExperienceLedger {
  retrieved = 0;
  revised = 0;
  repeatedMistakeCount = 0;

  constructor(
    private readonly store: CognitiveStore,
    private readonly ids: () => string = randomId,
  ) {}

  recordAttempt(input: AttemptInput): RecordedAttempt {
    const at = input.timestamp ?? new Date().toISOString();
    if (input.success) return this.recordSuccess(input, at);

    const classified = classifyFailure(input.signal ?? {});
    if (!classified.citizenLearns || classified.track === "SYSTEM" || SYSTEM_FAILURE_CATEGORIES.has(classified.category)) {
      const incident: SystemIncident = {
        id: this.ids(),
        timestamp: at,
        errorCode: classified.code,
        errorCategory: classified.category,
        summary: input.contextSummary || input.actualOutcome || classified.code,
        citizenId: input.citizenId,
      };
      this.store.putSystemIncident(incident);
      return { track: "SYSTEM", incident, repeated: false, createdLesson: false };
    }

    const similar = this.store.listSimilarFailures(input.citizenId, input.goal, classified.code, 8);
    const repeated = similar.length >= 2;
    if (repeated) this.repeatedMistakeCount += 1;

    const open = this.store.getOpenChain(input.citizenId, input.goal);
    const chainId = open?.id ?? this.ids();
    const previousId = open?.episodeIds.at(-1);
    const episode: FailureEpisode = {
      id: this.ids(),
      citizenId: input.citizenId,
      timestamp: at,
      goal: input.goal,
      task: input.task,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetPosition: input.targetPosition,
      contextSummary: input.contextSummary,
      expectedOutcome: input.expectedOutcome,
      actualOutcome: input.actualOutcome,
      errorCode: classified.code,
      errorCategory: classified.category,
      track: "CITIZEN",
      relevantInventory: (input.inventory ?? []).slice(0, 8),
      relevantWorldFacts: (input.worldFacts ?? []).slice(0, 6),
      relatedMemoryIds: input.relatedMemoryIds ?? [],
      decisionId: input.decisionId,
      model: input.model,
      chainId,
      previousEpisodeId: previousId,
      resolved: false,
    };
    this.store.putFailureEpisode(episode);
    const episodeIds = [...(open?.episodeIds ?? []), episode.id];
    this.store.putEpisodeChain({
      id: chainId,
      citizenId: input.citizenId,
      goal: input.goal,
      status: "open",
      episodeIds,
      createdAt: open?.createdAt ?? at,
      updatedAt: at,
    });

    const lesson = this.maybeExtractLesson(episode, similar.length + 1, at);
    return { track: "CITIZEN", episode, lesson, repeated, createdLesson: Boolean(lesson && similar.length === 0) };
  }

  applyLessonProposal(
    citizenId: string,
    proposal: LessonProposal,
    supportingFailureId?: string,
    at = new Date().toISOString(),
  ): LearningLesson | undefined {
    if (proposal.confidence < 0.45) return undefined;
    const pattern = `llm:${proposal.applicableWhen.slice(0, 80)}`;
    const existing = this.store.findLessonByPattern(citizenId, pattern);
    if (existing) {
      return this.reviseLesson(existing, {
        confidence: clamp01((existing.confidence + proposal.confidence) / 2),
        lesson: proposal.recommendedAdjustment,
        supportingFailureId,
        at,
      });
    }
    const lesson: LearningLesson = {
      id: this.ids(),
      citizenId,
      scope: "PERSONAL",
      triggerPattern: pattern,
      lesson: proposal.recommendedAdjustment,
      confidence: Math.min(proposal.confidence, 0.55),
      supportingFailureIds: supportingFailureId ? [supportingFailureId] : [],
      supportingSuccessIds: [],
      contradictedByIds: [],
      timesApplied: 0,
      successfulApplications: 0,
      lastUpdatedAt: at,
      createdAt: at,
      active: true,
      candidateEngineRule: false,
      origin: "llm_proposal",
    };
    this.store.putLesson(lesson);
    return lesson;
  }

  retrieveRelevant(query: LessonRetrievalQuery) {
    const lessons = this.store.listLessons(query.citizenId, true);
    const scored = retrieveLessons(lessons, query);
    this.retrieved += scored.length;
    return scored;
  }

  markApplied(lessonId: string, citizenId: string, goal?: string, decisionId?: string, at = new Date().toISOString()): void {
    const lesson = this.store.getLesson(lessonId);
    if (!lesson) return;
    lesson.timesApplied += 1;
    lesson.lastAppliedAt = at;
    lesson.lastUpdatedAt = at;
    this.store.putLesson(lesson);
    this.store.putLessonApplication({
      id: this.ids(),
      lessonId,
      citizenId,
      decisionId,
      goal,
      createdAt: at,
    });
  }

  recordOutcomeForLessons(
    lessonIds: string[],
    outcome: DecisionOutcome,
    citizenId: string,
    at = new Date().toISOString(),
  ): void {
    for (const id of lessonIds) {
      const lesson = this.store.getLesson(id);
      if (!lesson) continue;
      if (outcome === "SUCCESS") {
        lesson.successfulApplications += 1;
        lesson.supportingSuccessIds = [...lesson.supportingSuccessIds, id].slice(-12);
        lesson.confidence = clamp01(lesson.confidence + 0.08);
        if (lesson.successfulApplications >= 3 && lesson.origin === "deterministic") {
          lesson.candidateEngineRule = true;
        }
      } else if (outcome === "FAILURE") {
        lesson.confidence = clamp01(lesson.confidence - 0.12);
        lesson.contradictedByIds = [...lesson.contradictedByIds, this.ids()].slice(-12);
        this.revised += 1;
        if (lesson.confidence < 0.2) lesson.active = false;
      }
      lesson.lastUpdatedAt = at;
      this.store.putLesson(lesson);
      this.store.putLessonApplication({
        id: this.ids(),
        lessonId: id,
        citizenId,
        outcome,
        createdAt: at,
      });
    }
  }

  evaluateDecision(args: {
    citizenId: string;
    decisionId?: string;
    goal?: string;
    outcome: DecisionOutcome;
    failureCategory?: DecisionEvaluation["failureCategory"];
    relevantLessonIds?: string[];
    shouldReconsider?: boolean;
    shortExplanation: string;
    timestamp?: string;
  }): DecisionEvaluation {
    const at = args.timestamp ?? new Date().toISOString();
    const evaluation: DecisionEvaluation = {
      id: this.ids(),
      citizenId: args.citizenId,
      decisionId: args.decisionId,
      goal: args.goal,
      outcome: args.outcome,
      failureCategory: args.failureCategory,
      relevantLessonIds: args.relevantLessonIds ?? [],
      shouldReconsider: Boolean(args.shouldReconsider),
      shortExplanation: args.shortExplanation.slice(0, 280),
      createdAt: at,
    };
    this.store.putDecisionEvaluation(evaluation);
    if (evaluation.relevantLessonIds.length > 0) {
      this.recordOutcomeForLessons(evaluation.relevantLessonIds, evaluation.outcome, args.citizenId, at);
    }
    return evaluation;
  }

  metrics(): LearningMetrics {
    const counts = this.store.learningCounts();
    return {
      ...counts,
      lessonsRevised: this.revised,
      lessonsRetrieved: this.retrieved,
      repeatedMistakeCount: this.repeatedMistakeCount,
    };
  }

  private recordSuccess(input: AttemptInput, at: string): RecordedAttempt {
    const open = this.store.getOpenChain(input.citizenId, input.goal);
    if (open) {
      for (const id of open.episodeIds) this.store.resolveFailureEpisode(id);
      this.store.putEpisodeChain({ ...open, status: "recovered", updatedAt: at });
      const last = open.episodeIds.at(-1);
      const lastEpisode = last ? this.store.getFailureEpisode(last) : undefined;
      if (lastEpisode?.errorCode && lastEpisode.errorCode !== "UNKNOWN") {
        const pattern = triggerPattern(lastEpisode);
        const existing = this.store.findLessonByPattern(input.citizenId, pattern);
        if (existing) {
          existing.supportingSuccessIds = [...existing.supportingSuccessIds, lastEpisode.id].slice(-12);
          existing.confidence = clamp01(existing.confidence + 0.08);
          existing.lastUpdatedAt = at;
          this.store.putLesson(existing);
        }
      }
    }
    return { track: "CITIZEN", repeated: false, createdLesson: false };
  }

  private maybeExtractLesson(episode: FailureEpisode, similarCount: number, at: string): LearningLesson | undefined {
    if (episode.errorCategory === "UNKNOWN") return undefined;
    if (similarCount < 1) return undefined;
    const known = KNOWN_LESSONS[episode.errorCode ?? ""];
    const pattern = known?.pattern ?? triggerPattern(episode);
    if (!known && similarCount < 3) return undefined;

    const existing = this.store.findLessonByPattern(episode.citizenId, pattern);
    if (existing) {
      existing.supportingFailureIds = unique([...existing.supportingFailureIds, episode.id]).slice(-12);
      existing.confidence = clamp01(existing.confidence + (similarCount >= 3 ? 0.08 : 0.03));
      existing.lastUpdatedAt = at;
      if (known?.candidateEngineRule && existing.supportingFailureIds.length >= 3) {
        existing.candidateEngineRule = true;
      }
      this.store.putLesson(existing);
      this.revised += 1;
      return existing;
    }

    const baseConfidence = known ? (similarCount >= 3 ? 0.82 : 0.7) : similarCount >= 3 ? 0.55 : 0.35;
    if (!known && similarCount < 3) return undefined;
    const lesson: LearningLesson = {
      id: this.ids(),
      citizenId: episode.citizenId,
      scope: "PERSONAL",
      triggerPattern: pattern,
      lesson: known?.lesson ?? compactUnknownLesson(episode),
      confidence: baseConfidence,
      supportingFailureIds: [episode.id],
      supportingSuccessIds: [],
      contradictedByIds: [],
      timesApplied: 0,
      successfulApplications: 0,
      lastUpdatedAt: at,
      createdAt: at,
      active: true,
      candidateEngineRule: Boolean(known?.candidateEngineRule && similarCount >= 3),
      origin: "deterministic",
    };
    this.store.putLesson(lesson);
    return lesson;
  }

  private reviseLesson(
    existing: LearningLesson,
    args: { confidence: number; lesson: string; supportingFailureId?: string; at: string },
  ): LearningLesson {
    existing.confidence = args.confidence;
    existing.lesson = args.lesson;
    if (args.supportingFailureId) {
      existing.supportingFailureIds = unique([...existing.supportingFailureIds, args.supportingFailureId]).slice(-12);
    }
    existing.lastUpdatedAt = args.at;
    this.store.putLesson(existing);
    this.revised += 1;
    return existing;
  }
}

function triggerPattern(episode: FailureEpisode): string {
  return `${episode.errorCode ?? episode.errorCategory}:${episode.goal ?? "any"}`.toLowerCase();
}

function compactUnknownLesson(episode: FailureEpisode): string {
  return `After ${episode.goal ?? "this task"} failed (${episode.errorCode ?? episode.errorCategory}), change approach before repeating the same attempt.`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
