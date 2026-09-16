import { clamp01, clampSigned, type BeliefRow, type EvidenceRow } from "@civ/memory";
import type { KnowledgeSource } from "@civ/memory";
import { parseJson, toJson } from "./json.js";
import type { KnownFact, Rumor, SocialBelief, SocialEvidence } from "./types.js";

export function emptyBelief(observerId: string, targetId: string, at: string): SocialBelief {
  return {
    observerCitizenId: observerId,
    targetCitizenId: targetId,
    familiarity: 0,
    trustEvidence: 0,
    affectionEvidence: 0,
    respectEvidence: 0,
    resentmentEvidence: 0,
    knownFacts: [],
    rumors: [],
    relevantMemoryIds: [],
    confidence: 0.25,
    lastUpdatedAt: at,
  };
}

export function beliefFromRow(row: BeliefRow): SocialBelief {
  return {
    observerCitizenId: row.observerCitizenId,
    targetCitizenId: row.targetCitizenId,
    familiarity: row.familiarity,
    trustEvidence: row.trustEvidence,
    affectionEvidence: row.affectionEvidence,
    respectEvidence: row.respectEvidence,
    resentmentEvidence: row.resentmentEvidence,
    knownFacts: parseJson<KnownFact[]>(row.knownFactsJson, []),
    rumors: parseJson<Rumor[]>(row.rumorsJson, []),
    relevantMemoryIds: parseJson<string[]>(row.relevantMemoryIdsJson, []),
    confidence: row.confidence,
    lastUpdatedAt: row.lastUpdatedAt,
  };
}

export function beliefToRow(value: SocialBelief): BeliefRow {
  return {
    observerCitizenId: value.observerCitizenId,
    targetCitizenId: value.targetCitizenId,
    familiarity: value.familiarity,
    trustEvidence: value.trustEvidence,
    affectionEvidence: value.affectionEvidence,
    respectEvidence: value.respectEvidence,
    resentmentEvidence: value.resentmentEvidence,
    knownFactsJson: toJson(value.knownFacts),
    rumorsJson: toJson(value.rumors),
    relevantMemoryIdsJson: toJson(value.relevantMemoryIds),
    confidence: value.confidence,
    lastUpdatedAt: value.lastUpdatedAt,
  };
}

export function evidenceFromRow(row: EvidenceRow): SocialEvidence {
  return {
    id: row.id,
    observerCitizenId: row.observerCitizenId,
    targetCitizenId: row.targetCitizenId,
    kind: row.kind as SocialEvidence["kind"],
    summary: row.summary,
    source: row.source as KnowledgeSource,
    informantId: row.informantId,
    confidence: row.confidence,
    memoryId: row.memoryId,
    objectiveEventId: row.objectiveEventId,
    createdAt: row.createdAt,
  };
}

export function applySocialEvidence(
  belief: SocialBelief,
  evidence: SocialEvidence,
  interpretation: { trust?: number; affection?: number; respect?: number; resentment?: number },
  at: string,
): SocialBelief {
  const fact: KnownFact = {
    text: evidence.summary,
    source: evidence.source,
    confidence: evidence.confidence,
    memoryId: evidence.memoryId,
    createdAt: at,
  };
  const rumors =
    evidence.source === "HEARD"
      ? [
          ...belief.rumors,
          {
            text: evidence.summary,
            informantId: evidence.informantId ?? "unknown",
            confidence: evidence.confidence,
            aboutCitizenId: evidence.targetCitizenId,
            createdAt: at,
          },
        ].slice(-12)
      : belief.rumors;
  const knownFacts =
    evidence.source === "HEARD" ? belief.knownFacts : [...belief.knownFacts, fact].slice(-20);
  return {
    ...belief,
    familiarity: clamp01(belief.familiarity + (evidence.source === "DIRECT" ? 0.08 : 0.03)),
    trustEvidence: clampSigned(belief.trustEvidence + (interpretation.trust ?? 0)),
    affectionEvidence: clampSigned(belief.affectionEvidence + (interpretation.affection ?? 0)),
    respectEvidence: clampSigned(belief.respectEvidence + (interpretation.respect ?? 0)),
    resentmentEvidence: clampSigned(belief.resentmentEvidence + (interpretation.resentment ?? 0)),
    knownFacts,
    rumors,
    relevantMemoryIds: evidence.memoryId
      ? [...new Set([...belief.relevantMemoryIds, evidence.memoryId])].slice(-20)
      : belief.relevantMemoryIds,
    confidence: clamp01(Math.max(belief.confidence, evidence.confidence * 0.6)),
    lastUpdatedAt: at,
  };
}

export function evidenceInterpretation(kind: SocialEvidence["kind"], source: KnowledgeSource): {
  trust?: number;
  affection?: number;
  respect?: number;
  resentment?: number;
} {
  const scale = source === "DIRECT" ? 1 : source === "WITNESSED" ? 0.7 : source === "HEARD" ? 0.35 : 0.5;
  switch (kind) {
    case "help_received":
    case "help_given":
      return { trust: 0.08 * scale, affection: 0.05 * scale, respect: 0.04 * scale };
    case "item_given":
      return { affection: 0.06 * scale, trust: 0.04 * scale };
    case "attack":
    case "betrayal":
      return { resentment: 0.12 * scale, trust: -0.1 * scale };
    case "item_taken":
      return { resentment: 0.08 * scale, trust: -0.06 * scale };
    case "cooperation":
      return { trust: 0.04 * scale, respect: 0.03 * scale };
    case "promise":
      return { trust: 0.03 * scale };
    case "death":
      return { affection: 0.02 * scale };
    default:
      return {};
  }
}
