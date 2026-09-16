import type { ObjectiveWorldEvent, StoredMemory } from "@civ/memory";
import type {
  ReflectionContext,
  ReflectionKind,
  ReflectionResult,
  ReflectionTrigger,
  SocialBelief,
} from "./types.js";

export function detectReflectionTrigger(args: {
  citizenId: string;
  event: ObjectiveWorldEvent;
  salience: number;
  belief?: SocialBelief;
  id: string;
  at: string;
}): ReflectionTrigger | undefined {
  const kind = classify(args.event, args.salience, args.belief);
  if (!kind) return undefined;
  return {
    id: args.id,
    kind,
    citizenId: args.citizenId,
    eventId: args.event.id,
    salience: args.salience,
    createdAt: args.at,
  };
}

function classify(event: ObjectiveWorldEvent, salience: number, belief?: SocialBelief): ReflectionKind | undefined {
  if (event.category === "citizen_death" && salience >= 0.45) return "close_citizen_death";
  if (event.category === "citizen_attacked_citizen" && (belief?.trustEvidence ?? 0) > 0.2) return "major_betrayal";
  if (event.category === "danger_encountered" && event.facts.destroyed === "storage" && salience >= 0.5) {
    return "large_resource_loss";
  }
  if (event.category === "construction_completed" && salience >= 0.5) return "major_achievement";
  if (event.category === "promise_agreement" && salience >= 0.55) return "leadership_conflict";
  return undefined;
}

/**
 * Structured placeholder. Does not call a heavy model.
 * Later this may route rare events to gpt-oss:20b.
 */
export function prepareReflection(context: ReflectionContext): ReflectionResult {
  const { trigger, relevantMemories, psychState } = context;
  return {
    citizenId: trigger.citizenId,
    triggerKind: trigger.kind,
    summary: `Rare pause suggested: ${trigger.kind}. Current mood valence ${psychState.moodValence.toFixed(2)}.`,
    proposedSemanticFacts: relevantMemories.slice(0, 3).map((m) => m.summary),
    proposedAssociationRevisions: [],
    moodDelta: 0,
    createdAt: trigger.createdAt,
  };
}

export function memoriesForReflection(memories: StoredMemory[]): StoredMemory[] {
  return memories.filter((m) => m.importance >= 0.35).slice(0, 10);
}
