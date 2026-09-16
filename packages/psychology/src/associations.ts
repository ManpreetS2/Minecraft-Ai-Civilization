import { clamp01, reinforce, weaken, type AssociationRow } from "@civ/memory";
import { parseJson, toJson } from "./json.js";
import type { AssociationProposal, LearnedAssociation } from "./types.js";

export function associationFromRow(row: AssociationRow): LearnedAssociation {
  return {
    id: row.id,
    citizenId: row.citizenId,
    subjectType: row.subjectType as LearnedAssociation["subjectType"],
    subjectKey: row.subjectKey,
    associationType: row.associationType as LearnedAssociation["associationType"],
    strength: row.strength,
    confidence: row.confidence,
    supportingMemoryIds: parseJson<string[]>(row.supportingMemoryIdsJson, []),
    lastReinforcedAt: row.lastReinforcedAt,
    lastContradictedAt: row.lastContradictedAt,
  };
}

export function associationToRow(value: LearnedAssociation): AssociationRow {
  return {
    id: value.id,
    citizenId: value.citizenId,
    subjectType: value.subjectType,
    subjectKey: value.subjectKey,
    associationType: value.associationType,
    strength: value.strength,
    confidence: value.confidence,
    supportingMemoryIdsJson: toJson(value.supportingMemoryIds),
    lastReinforcedAt: value.lastReinforcedAt,
    lastContradictedAt: value.lastContradictedAt,
  };
}

export function applyAssociationProposal(
  existing: LearnedAssociation | undefined,
  proposal: AssociationProposal,
  citizenId: string,
  memoryId: string | undefined,
  at: string,
  id: string,
): LearnedAssociation {
  const current = existing ?? {
    id,
    citizenId,
    subjectType: proposal.subjectType,
    subjectKey: proposal.subjectKey,
    associationType: proposal.associationType,
    strength: 0.15,
    confidence: 0.3,
    supportingMemoryIds: [],
    lastReinforcedAt: at,
  };
  const supporting = memoryId
    ? [...new Set([...current.supportingMemoryIds, memoryId])].slice(-12)
    : current.supportingMemoryIds;
  if (proposal.contradict && proposal.contradict > 0) {
    return {
      ...current,
      strength: weaken(current.strength, proposal.contradict),
      confidence: clamp01(current.confidence * 0.92 + 0.05),
      supportingMemoryIds: supporting,
      lastContradictedAt: at,
    };
  }
  const amount = proposal.reinforce ?? 0.2;
  return {
    ...current,
    strength: reinforce(current.strength, amount),
    confidence: clamp01(current.confidence + 0.08),
    supportingMemoryIds: supporting,
    lastReinforcedAt: at,
  };
}

export function decayAssociation(value: LearnedAssociation, days: number): LearnedAssociation {
  if (days <= 0) return value;
  const factor = Math.max(0, 1 - 0.02 * days);
  return { ...value, strength: clamp01(value.strength * factor) };
}
