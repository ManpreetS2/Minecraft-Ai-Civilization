import { z } from "zod";
import { extractJson, normalizeGoal, GOALS, type Goal } from "./schema.js";

/**
 * High-level decision schema — WHAT / WHY only.
 * Movement / dig / coordinate instructions are rejected.
 */

export const PRIMARY_GOALS = [
  ...GOALS,
  "seek_home",
  "share_resources",
  "fulfill_commitment",
  "request_help",
  "socialize",
] as const;

export type PrimaryGoal = (typeof PRIMARY_GOALS)[number];

export const SPEECH_INTENTS = [
  "request",
  "response",
  "offer",
  "refusal",
  "promise",
  "gratitude",
  "discovery",
  "conflict",
  "none",
] as const;

export type SpeechIntent = (typeof SPEECH_INTENTS)[number];

export const StructuredDecisionSchema = z.object({
  primaryGoal: z.enum(PRIMARY_GOALS),
  followUpGoals: z.array(z.enum(PRIMARY_GOALS)).max(3).default([]),
  targetCitizenId: z.string().optional(),
  targetKnownLocationId: z.string().optional(),
  reasonSummary: z.string().min(1).max(280),
  confidence: z.coerce.number().min(0).max(1),
  wantsToSpeak: z.boolean().default(false),
  speechIntent: z.enum(SPEECH_INTENTS).optional(),
  reconsiderAfter: z.enum(["failure", "major_event", "request", "cooldown", "survival_change"]).optional(),
  proposedCommitmentGoal: z.string().max(120).optional(),
});

export type StructuredDecision = z.infer<typeof StructuredDecisionSchema>;

const MOVEMENT_PATTERNS = [
  /\bwalk\b/i,
  /\bjump\b/i,
  /\bmine\s+block\b/i,
  /\bopen\s+chest\b/i,
  /\b\d+\s*blocks?\b/i,
  /\bnorth|south|east|west\b/i,
  /\bcoords?\b/i,
  /\bx\s*[:=]\s*-?\d+/i,
  /\by\s*[:=]\s*-?\d+/i,
  /\bz\s*[:=]\s*-?\d+/i,
];

export function looksLikeMovementInstruction(text: string): boolean {
  return MOVEMENT_PATTERNS.some((re) => re.test(text));
}

export function normalizePrimaryGoal(raw: unknown): PrimaryGoal | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
  if ((PRIMARY_GOALS as readonly string[]).includes(key)) return key as PrimaryGoal;
  // Map legacy `goal` field.
  const legacy = normalizeGoal(raw);
  return legacy;
}

export function normalizeStructuredDecisionInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const source = input as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };

  const primary =
    normalizePrimaryGoal(source.primaryGoal) ??
    normalizePrimaryGoal(source.goal) ??
    undefined;
  if (primary) next.primaryGoal = primary;

  if (Array.isArray(source.followUpGoals)) {
    next.followUpGoals = source.followUpGoals
      .map((g) => normalizePrimaryGoal(g))
      .filter((g): g is PrimaryGoal => Boolean(g))
      .slice(0, 3);
  } else if (next.followUpGoals === undefined) {
    next.followUpGoals = [];
  }

  if (typeof source.confidence === "string" && /^-?\d+(\.\d+)?$/.test(source.confidence.trim())) {
    next.confidence = Number(source.confidence.trim());
  }
  if (next.confidence === undefined) {
    if (typeof source.priority === "number" && Number.isFinite(source.priority)) {
      next.confidence = source.priority;
    } else if (typeof source.priority === "string" && /^-?\d+(\.\d+)?$/.test(source.priority.trim())) {
      next.confidence = Number(source.priority.trim());
    }
  }
  if (typeof source.reason === "string" && !source.reasonSummary) {
    next.reasonSummary = source.reason;
  }
  if (typeof source.wantsToSpeak === "string") {
    next.wantsToSpeak = source.wantsToSpeak.toLowerCase() === "true";
  }
  return next;
}

export type StructuredDecisionResult =
  | { ok: true; decision: StructuredDecision }
  | { ok: false; error: string; code: "LLM_INVALID_OUTPUT" };

/**
 * Validate structured high-level decisions.
 * Never invents success / unsupported goals. Rejects movement instructions.
 */
export function validateStructuredDecision(input: unknown): StructuredDecision {
  const normalized = normalizeStructuredDecisionInput(input);
  if (!normalized || typeof normalized !== "object") {
    throw new Error("Decision is not an object");
  }
  const obj = normalized as Record<string, unknown>;
  const reason = String(obj.reasonSummary ?? obj.reason ?? "");
  if (looksLikeMovementInstruction(reason)) {
    throw new Error("Decision reason looks like a movement/execution instruction");
  }
  if (typeof obj.primaryGoal === "string" && looksLikeMovementInstruction(obj.primaryGoal)) {
    throw new Error("Unsupported movement-like goal");
  }
  if (obj.primaryGoal === undefined) {
    throw new Error("Missing primaryGoal; refusing to invent a goal");
  }
  return StructuredDecisionSchema.parse(normalized);
}

export function tryValidateStructuredDecision(input: unknown): StructuredDecisionResult {
  try {
    return { ok: true, decision: validateStructuredDecision(input) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: "LLM_INVALID_OUTPUT",
    };
  }
}

export function parseStructuredDecisionFromText(text: string): StructuredDecisionResult {
  try {
    return tryValidateStructuredDecision(extractJson(text));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: "LLM_INVALID_OUTPUT",
    };
  }
}

/** Map structured decision onto legacy HighLevelDecision for existing planner bridge. */
export function toLegacyDecision(decision: StructuredDecision): {
  goal: Goal;
  priority: number;
  reason: string;
  targetCitizenId?: string;
} {
  const goal = (GOALS as readonly string[]).includes(decision.primaryGoal)
    ? (decision.primaryGoal as Goal)
    : mapExtendedGoal(decision.primaryGoal);
  return {
    goal,
    priority: decision.confidence,
    reason: decision.reasonSummary,
    targetCitizenId: decision.targetCitizenId,
  };
}

function mapExtendedGoal(goal: PrimaryGoal): Goal {
  switch (goal) {
    case "seek_home":
      return "build_shelter";
    case "share_resources":
    case "request_help":
    case "socialize":
    case "fulfill_commitment":
      return "help_citizen";
    default:
      return "explore";
  }
}
