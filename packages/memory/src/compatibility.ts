import type { MemoryKind, MemoryRecord } from "@civ/shared";

/**
 * Legacy helpers used by the live AgentManager.
 * Keep signatures stable while the new cognitive store lives beside them.
 */
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

export function retrieveRelevant(
  memories: MemoryRecord[],
  query: string,
  limit = 5,
): MemoryRecord[] {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  return [...memories]
    .map((memory) => {
      const hay = memory.content.toLowerCase();
      const hits = terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
      return { memory, score: hits + memory.importance };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.memory);
}
