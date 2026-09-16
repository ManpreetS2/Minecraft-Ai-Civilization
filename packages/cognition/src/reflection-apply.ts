import { clamp01, type CognitiveStore } from "@civ/memory";
import { applyAssociationProposal, associationFromRow, associationToRow } from "@civ/psychology";
import type { ReflectionProposal } from "./reflection-schema.js";

export type AppliedReflection = {
  appliedBeliefs: number;
  appliedAssociations: number;
  appliedImportance: number;
  wroteObjectiveEvent: false;
};

/**
 * Model output may propose interpretation. It never writes objective world facts.
 */
export function applyReflectionProposal(
  store: CognitiveStore,
  citizenId: string,
  proposal: ReflectionProposal,
  idFactory: () => string,
  at = new Date().toISOString(),
): AppliedReflection {
  let appliedBeliefs = 0;
  let appliedAssociations = 0;
  let appliedImportance = 0;

  for (const update of proposal.beliefUpdates) {
    const memory = {
      id: idFactory(),
      citizenId,
      memoryType: "semantic" as const,
      eventType: "reflection_interpretation",
      timestamp: at,
      summary: update.proposedInterpretation,
      participants: [citizenId, update.subject],
      objectiveFacts: { subject: update.subject, source: "INFERRED" },
      emotionalSalience: proposal.significance * 0.5,
      importance: clamp01(update.confidence * 0.5),
      source: "INFERRED" as const,
      confidence: clamp01(update.confidence),
      tags: ["reflection", "inferred"],
      relatedEntityIds: [update.subject],
      createdAt: at,
      recallCount: 0,
      compressed: false,
      supportingMemoryIds: [],
    };
    store.putMemory(memory);
    appliedBeliefs += 1;
  }

  for (const adj of proposal.memoryImportanceAdjustments ?? []) {
    const existing = store.getMemory(adj.memoryId);
    if (!existing || existing.citizenId !== citizenId) continue;
    const delta = Math.max(-0.15, Math.min(0.15, adj.importance - existing.importance));
    store.putMemory({ ...existing, importance: clamp01(existing.importance + delta) });
    appliedImportance += 1;
  }

  for (const raw of proposal.associationProposals ?? []) {
    const existing = store.getAssociation(citizenId, raw.subjectType, raw.subjectKey, raw.associationType);
    const updated = applyAssociationProposal(
      existing ? associationFromRow(existing) : undefined,
      {
        subjectType: raw.subjectType,
        subjectKey: raw.subjectKey,
        associationType: raw.associationType,
        reinforce: raw.reinforce,
        contradict: raw.contradict,
      },
      citizenId,
      undefined,
      at,
      existing?.id ?? idFactory(),
    );
    store.saveAssociation(associationToRow(updated));
    appliedAssociations += 1;
  }

  return { appliedBeliefs, appliedAssociations, appliedImportance, wroteObjectiveEvent: false };
}
