import type { Commitment, LearnedTendency, MoodAffect, RelationshipBelief } from "@civ/shared";
import type { PrimaryGoal } from "./decision-schema.js";

/** Soft token/size budget for cognition prompts (chars ≈ tokens/4 rough). */
export const COGNITION_INPUT_MAX_CHARS = 3_500;
export const COGNITION_INPUT_MAX_MEMORIES = 6;
export const COGNITION_INPUT_MAX_EVENTS = 5;
export const COGNITION_INPUT_MAX_RELATIONSHIPS = 4;

export type CitizenIdentityInput = {
  id: string;
  name: string;
};

export type CurrentNeedsInput = {
  hunger?: number;
  health?: number;
  shelter?: boolean;
  housing?: boolean;
  settlementNeeds: string[];
};

export type CognitionInput = {
  citizen: CitizenIdentityInput;
  needs: CurrentNeedsInput;
  locationSummary: string;
  inventorySummary: string[];
  homeStatus: string;
  currentGoal?: string;
  commitments: Array<{ id: string; goal: string; status: string; counterpartyId?: string }>;
  recentImportantEvents: string[];
  relevantMemories: string[];
  relationshipContext: Array<{
    subjectId: string;
    trust: number;
    familiarity: number;
    unresolved: number;
  }>;
  learnedBehaviorSummary: Array<{ dimension: string; score: number; confidence: number }>;
  mood?: { label: string; intensity: number };
  availableHighLevelActions: PrimaryGoal[];
  uncertainty: string[];
  timeContext: string;
  /** Approximate serialized size after guards. */
  charCount: number;
};

export type BuildCognitionInputArgs = {
  citizen: CitizenIdentityInput;
  needs: CurrentNeedsInput;
  locationSummary?: string;
  inventorySummary?: string[];
  homeStatus?: string;
  currentGoal?: string;
  commitments?: Commitment[];
  recentImportantEvents?: string[];
  relevantMemories?: string[];
  relationships?: RelationshipBelief[];
  learned?: LearnedTendency[];
  mood?: MoodAffect;
  availableHighLevelActions: PrimaryGoal[];
  uncertainty?: string[];
  timeContext?: string;
  /** Wall clock / game time string. */
  nowIso?: string;
};

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Build a concise, citizen-specific cognition input.
 * Deterministic for the same args. Never dumps full history/DB/world.
 */
export function buildCognitionInput(args: BuildCognitionInputArgs): CognitionInput {
  const memories = (args.relevantMemories ?? [])
    .map((m) => clip(m, 160))
    .filter(Boolean)
    .slice(0, COGNITION_INPUT_MAX_MEMORIES);

  const events = (args.recentImportantEvents ?? [])
    .map((e) => clip(e, 120))
    .filter(Boolean)
    .slice(0, COGNITION_INPUT_MAX_EVENTS);

  const relationships = (args.relationships ?? [])
    .filter((r) => r.observerId === args.citizen.id)
    .slice(0, COGNITION_INPUT_MAX_RELATIONSHIPS)
    .map((r) => ({
      subjectId: r.subjectId,
      trust: round2(r.trust),
      familiarity: round2(r.familiarity),
      unresolved: r.unresolvedPromises.length + r.unresolvedRequests.length,
    }));

  const learnedBehaviorSummary = (args.learned ?? [])
    .filter((t) => t.confidence > 0)
    .slice(0, 6)
    .map((t) => ({
      dimension: t.dimension,
      score: round2(t.score),
      confidence: round2(t.confidence),
    }));

  const commitments = (args.commitments ?? [])
    .filter((c) => c.ownerCitizenId === args.citizen.id || c.counterpartyId === args.citizen.id)
    .filter((c) => c.status === "ACTIVE")
    .slice(0, 4)
    .map((c) => ({
      id: c.id,
      goal: clip(c.goal, 80),
      status: c.status,
      counterpartyId: c.counterpartyId,
    }));

  const inventorySummary = (args.inventorySummary ?? []).slice(0, 12).map((i) => clip(i, 40));

  const input: CognitionInput = {
    citizen: { id: args.citizen.id, name: args.citizen.name },
    needs: {
      hunger: args.needs.hunger,
      health: args.needs.health,
      shelter: args.needs.shelter,
      housing: args.needs.housing,
      settlementNeeds: (args.needs.settlementNeeds ?? []).slice(0, 8),
    },
    locationSummary: clip(args.locationSummary ?? "unknown", 80),
    inventorySummary,
    homeStatus: clip(args.homeStatus ?? "unknown", 60),
    currentGoal: args.currentGoal ? clip(args.currentGoal, 60) : undefined,
    commitments,
    recentImportantEvents: events,
    relevantMemories: memories,
    relationshipContext: relationships,
    learnedBehaviorSummary,
    mood: args.mood
      ? { label: args.mood.label, intensity: round2(args.mood.intensity) }
      : undefined,
    availableHighLevelActions: args.availableHighLevelActions.slice(0, 16),
    uncertainty: (args.uncertainty ?? []).slice(0, 5).map((u) => clip(u, 80)),
    timeContext: clip(args.timeContext ?? args.nowIso ?? "unknown", 40),
    charCount: 0,
  };

  let serialized = stableSerialize(input);
  if (serialized.length > COGNITION_INPUT_MAX_CHARS) {
    // Drop lowest-priority fields first.
    input.learnedBehaviorSummary = input.learnedBehaviorSummary.slice(0, 2);
    input.relevantMemories = input.relevantMemories.slice(0, 3);
    input.recentImportantEvents = input.recentImportantEvents.slice(0, 2);
    serialized = stableSerialize(input);
  }
  if (serialized.length > COGNITION_INPUT_MAX_CHARS) {
    input.relationshipContext = input.relationshipContext.slice(0, 2);
    input.inventorySummary = input.inventorySummary.slice(0, 6);
    serialized = stableSerialize(input);
  }
  input.charCount = serialized.length;
  return input;
}

export function cognitionInputToPromptLines(input: CognitionInput): string[] {
  return [
    `Citizen: ${input.citizen.name} (${input.citizen.id})`,
    `Needs: hunger=${input.needs.hunger ?? "?"} health=${input.needs.health ?? "?"} settlement=${input.needs.settlementNeeds.join(",") || "none"}`,
    `Location: ${input.locationSummary}`,
    `Home: ${input.homeStatus}`,
    `Goal: ${input.currentGoal ?? "none"}`,
    `Inventory: ${input.inventorySummary.join(", ") || "empty"}`,
    `Commitments: ${input.commitments.map((c) => c.goal).join("; ") || "none"}`,
    `Recent: ${input.recentImportantEvents.join(" | ") || "none"}`,
    `Memories: ${input.relevantMemories.join(" | ") || "none"}`,
    `Relationships: ${input.relationshipContext.map((r) => `${r.subjectId}:t=${r.trust},f=${r.familiarity}`).join("; ") || "none"}`,
    `Learned: ${input.learnedBehaviorSummary.map((l) => `${l.dimension}:${l.score}@${l.confidence}`).join("; ") || "unknown"}`,
    `Mood: ${input.mood ? `${input.mood.label}:${input.mood.intensity}` : "unknown"}`,
    `Actions: ${input.availableHighLevelActions.join(", ")}`,
    `Uncertainty: ${input.uncertainty.join("; ") || "none"}`,
    `Time: ${input.timeContext}`,
  ];
}

export function stableSerialize(input: CognitionInput): string {
  // Deterministic key order for regression tests.
  return JSON.stringify(input);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
