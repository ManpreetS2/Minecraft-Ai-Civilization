import { z } from "zod";
import { GOALS, type Goal } from "./goals.js";
import { normalizeDecisionInput } from "./normalize.js";

export { GOALS, type Goal };

export const DecisionSchema = z.object({
  goal: z.enum(GOALS),
  priority: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
  targetCitizenId: z.string().optional(),
});

export type HighLevelDecision = z.infer<typeof DecisionSchema>;

export const CognitionDecisionSchema = z.object({
  goal: z.enum(GOALS),
  priority: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
  targetCitizenId: z.string().min(1).optional(),
  targetProjectId: z.string().min(1).optional(),
  targetResource: z.string().min(1).optional(),
  uncertainty: z.number().min(0).max(1).optional(),
});

export type CognitionDecision = z.infer<typeof CognitionDecisionSchema>;

export type CognitionPrompt = {
  citizenName: string;
  health?: number;
  hunger?: number;
  occupation?: string;
  inventory: string[];
  settlementNeeds: string[];
  memories: string[];
  nearbyCitizens: string[];
  gameFacts?: string[];
};

export type CognitionProvider = {
  readonly name: string;
  decide(prompt: CognitionPrompt, timeoutMs?: number): Promise<HighLevelDecision>;
};

export function validateDecision(input: unknown): HighLevelDecision {
  return DecisionSchema.parse(normalizeDecisionInput(input));
}

export function validateCognitionDecision(input: unknown): CognitionDecision {
  const parsed = CognitionDecisionSchema.parse(normalizeDecisionInput(input));
  if (
    (parsed.goal === "socialize" || parsed.goal === "assist_citizen" || parsed.goal === "help_citizen") &&
    !parsed.targetCitizenId
  ) {
    throw new Error("Social goals require targetCitizenId");
  }
  return parsed;
}

export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("No JSON object in model output");
  }
  const raw = text.slice(start, end + 1);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Garbage JSON in model output");
  }
}

export { normalizeDecisionInput, normalizeGoal } from "./normalize.js";
