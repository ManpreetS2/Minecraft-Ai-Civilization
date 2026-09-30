import type { MemoryKind, MemoryRecord } from "@civ/shared";

export function createMemory(
  citizenId: string,
  kind: MemoryKind,
  content: string,
  importance: number,
  relatedCitizenId?: string,
): MemoryRecord {
  return {
    id: crypto.randomUUID(),
    citizenId,
    kind,
    content,
    importance: Math.max(0, Math.min(1, importance)),
    createdAt: new Date().toISOString(),
    relatedCitizenId,
  };
}

export {
  retrieveRelevant,
  retrieveRelevantMemories,
  scoreMemories,
  type MemoryQuery,
  type ScoredMemory,
} from "./retrieve.js";

export {
  summarizeLearnedBehavior,
  applyContradictoryEvidence,
  type BehaviorEvidence,
  type LearnedBehaviorOptions,
} from "./learned-behavior.js";
