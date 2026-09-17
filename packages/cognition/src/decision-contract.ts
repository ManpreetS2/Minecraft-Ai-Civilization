import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GOALS, type Goal } from "./goals.js";
import { normalizeDecisionInput, normalizeGoal, rejectPrivilegedFields } from "./normalize.js";
import { hashWorldState, type WorldStateFacts } from "./world-hash.js";

export const FollowUpGoalsSchema = z.array(z.enum(GOALS)).max(3);

export const BoundedDecisionSchema = z.object({
  decisionId: z.string().min(1),
  primaryGoal: z.enum(GOALS),
  followUpGoals: FollowUpGoalsSchema.default([]),
  priority: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
  createdAt: z.string().min(1),
  worldStateHash: z.string().min(1),
  relevantMemoryIds: z.array(z.string()).max(8).default([]),
  relevantLessonIds: z.array(z.string()).max(8).default([]),
  targetCitizenId: z.string().min(1).optional(),
  targetProjectId: z.string().min(1).optional(),
  targetResource: z.string().min(1).optional(),
  uncertainty: z.number().min(0).max(1).optional(),
});

export type BoundedDecision = z.infer<typeof BoundedDecisionSchema>;

export type DecisionProposalInput = {
  goal?: unknown;
  primaryGoal?: unknown;
  followUpGoals?: unknown;
  priority?: unknown;
  confidence?: unknown;
  reason?: unknown;
  targetCitizenId?: unknown;
  targetProjectId?: unknown;
  targetResource?: unknown;
  uncertainty?: unknown;
  relevantMemoryIds?: unknown;
  relevantLessonIds?: unknown;
};

export function validateBoundedDecision(input: unknown): BoundedDecision {
  rejectPrivilegedFields(input);
  return BoundedDecisionSchema.parse(input);
}

export function assembleBoundedDecision(args: {
  proposal: DecisionProposalInput;
  facts: WorldStateFacts;
  memoryIds?: string[];
  lessonIds?: string[];
  now?: Date;
  decisionId?: string;
}): BoundedDecision {
  const normalized = normalizeDecisionInput({
    ...args.proposal,
    goal: args.proposal.primaryGoal ?? args.proposal.goal,
  }) as Record<string, unknown>;
  const primary = normalizeGoal(normalized.goal);
  if (!primary) throw new Error("UNKNOWN_GOAL");
  const followUps = normalizeFollowUps(args.proposal.followUpGoals, primary);
  return BoundedDecisionSchema.parse({
    decisionId: args.decisionId ?? randomUUID(),
    primaryGoal: primary,
    followUpGoals: followUps,
    priority: typeof normalized.priority === "number" ? normalized.priority : 0.5,
    confidence: typeof args.proposal.confidence === "number" ? args.proposal.confidence : 0.6,
    reason: String(normalized.reason ?? "No reason provided."),
    createdAt: (args.now ?? new Date()).toISOString(),
    worldStateHash: hashWorldState(args.facts),
    relevantMemoryIds: asIdList(args.proposal.relevantMemoryIds ?? args.memoryIds),
    relevantLessonIds: asIdList(args.proposal.relevantLessonIds ?? args.lessonIds),
    targetCitizenId: normalized.targetCitizenId,
    targetProjectId: normalized.targetProjectId,
    targetResource: normalized.targetResource,
    uncertainty: normalized.uncertainty,
  });
}

export function normalizeFollowUps(raw: unknown, primary: Goal): Goal[] {
  if (!Array.isArray(raw)) return [];
  const out: Goal[] = [];
  for (const item of raw) {
    const goal = normalizeGoal(item);
    if (!goal || goal === primary) continue;
    if (!out.includes(goal)) out.push(goal);
    if (out.length >= 3) break;
  }
  return out;
}

function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 8);
}
