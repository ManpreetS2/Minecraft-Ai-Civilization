import { z } from "zod";
import { rejectPrivilegedFields } from "./normalize.js";

export const LessonProposalSchema = z.object({
  causeHypothesis: z.string().min(1).max(280),
  applicableWhen: z.string().min(1).max(280),
  avoidWhen: z.string().max(280).optional(),
  recommendedAdjustment: z.string().min(1).max(280),
  confidence: z.number().min(0).max(1),
});

export type LessonProposal = z.infer<typeof LessonProposalSchema>;

export function validateLessonProposal(input: unknown): LessonProposal {
  rejectPrivilegedFields(input);
  return LessonProposalSchema.parse(input);
}

export const DecisionEvaluationSchema = z.object({
  outcome: z.enum(["SUCCESS", "PARTIAL", "FAILURE", "UNKNOWN"]),
  failureCategory: z
    .enum([
      "AGENT_DECISION",
      "PLANNING",
      "SKILL_EXECUTION",
      "WORLD_CONSTRAINT",
      "KNOWLEDGE_ERROR",
      "RESOURCE_CONFLICT",
      "SOCIAL_OUTCOME",
      "INFRASTRUCTURE",
      "NETWORK",
      "SERVER",
      "UNKNOWN",
    ])
    .optional(),
  relevantLessonIds: z.array(z.string()).max(8).default([]),
  shouldReconsider: z.boolean(),
  shortExplanation: z.string().min(1).max(280),
});

export type StructuredDecisionEvaluation = z.infer<typeof DecisionEvaluationSchema>;

export function validateDecisionEvaluation(input: unknown): StructuredDecisionEvaluation {
  rejectPrivilegedFields(input);
  return DecisionEvaluationSchema.parse(input);
}
