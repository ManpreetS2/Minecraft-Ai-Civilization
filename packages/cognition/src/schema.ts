import { z } from "zod";
import { GOALS, type Goal } from "./goals.js";
import { normalizeDecisionInput } from "./normalize.js";

export { GOALS, type Goal };

const spokenMessage = z.string().trim().min(1).max(200);

/**
 * SEC-001: what a citizen may choose to say. Only content and a target NAME are model-supplied. The sender, the
 * community and the source event id are resolved by the runtime; any such field a model adds is stripped here.
 */
export const CommunicationIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("say"), message: spokenMessage, toCitizen: z.string().min(1).max(64).optional() }),
  z.object({ kind: z.literal("announce_to_community"), message: spokenMessage }),
  z.object({
    kind: z.literal("share_bulletin_line"),
    bulletinLine: z.number().int().min(1).max(64),
    toCitizen: z.string().min(1).max(64),
    message: spokenMessage,
  }),
]);

export type CommunicationIntent = z.infer<typeof CommunicationIntentSchema>;

export const DecisionSchema = z.object({
  goal: z.enum(GOALS),
  priority: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
  targetCitizenId: z.string().optional(),
  /** Optional and voluntary. A malformed intent is dropped; it never invalidates the goal decision. */
  communication: CommunicationIntentSchema.optional().catch(undefined),
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
  /** Neutral personality tendency text (optional; never imperative commands). */
  personalityContext?: string;
  /** Perspective-authorized public bulletin text (optional). */
  bulletin?: string;
  /** Shared demo survival objective when three-citizen profile is active. */
  sharedObjective?: string;
  /** SEC-001: neutral description of the optional communication field (community mode only). */
  communicationGuide?: string;
};

export type CognitionProvider = {
  readonly name: string;
  decide(prompt: CognitionPrompt, timeoutMs?: number): Promise<HighLevelDecision>;
};

export function validateDecision(input: unknown): HighLevelDecision {
  return DecisionSchema.parse(normalizeDecisionInput(input));
}

/**
 * For model output on its way to logs. A schema error quotes the rejected value, and a model can put anything there,
 * including text from its private prompt. Other validation errors name only allowlisted fields.
 */
export function validateDecisionForLogging(input: unknown): HighLevelDecision {
  try {
    return validateDecision(input);
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("model output failed decision validation");
    throw error;
  }
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
