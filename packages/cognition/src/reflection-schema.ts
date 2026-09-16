import { z } from "zod";
import { rejectPrivilegedFields } from "./normalize.js";

export const AssociationProposalSchema = z.object({
  subjectType: z.enum(["entity", "location", "activity", "citizen", "item", "concept"]),
  subjectKey: z.string().min(1).max(80),
  associationType: z.enum(["danger", "safety", "success", "failure", "help", "threat", "resource"]),
  reinforce: z.number().min(0).max(1).optional(),
  contradict: z.number().min(0).max(1).optional(),
});

export const BeliefUpdateSchema = z.object({
  subject: z.string().min(1).max(80),
  previousConfidence: z.number().min(0).max(1).optional(),
  proposedInterpretation: z.string().min(1).max(280),
  confidence: z.number().min(0).max(1),
});

export const MemoryImportanceAdjustmentSchema = z.object({
  memoryId: z.string().min(1),
  importance: z.number().min(0).max(1),
});

export const SocialInterpretationSchema = z.object({
  targetCitizenId: z.string().min(1),
  summary: z.string().min(1).max(280),
  confidence: z.number().min(0).max(1),
});

export const ReflectionProposalSchema = z.object({
  significance: z.number().min(0).max(1),
  beliefUpdates: z.array(BeliefUpdateSchema).max(8).default([]),
  goalReconsideration: z.boolean().optional(),
  memoryImportanceAdjustments: z.array(MemoryImportanceAdjustmentSchema).max(8).optional(),
  associationProposals: z.array(AssociationProposalSchema).max(8).optional(),
  socialInterpretations: z.array(SocialInterpretationSchema).max(8).optional(),
  narrativeSummary: z.string().max(400).optional(),
});

export type ReflectionProposal = z.infer<typeof ReflectionProposalSchema>;

export function validateReflectionProposal(input: unknown): ReflectionProposal {
  rejectPrivilegedFields(input);
  return ReflectionProposalSchema.parse(input);
}
