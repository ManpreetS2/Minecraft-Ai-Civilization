import type { MemoryRecord } from "@civ/shared";

export type MemoryQuery = {
  /** Owning citizen — retrieval is always citizen-specific. */
  citizenId: string;
  situation: string;
  relatedCitizenId?: string;
  activeCommitmentHints?: string[];
  unresolvedHints?: string[];
  now?: number;
  limit?: number;
  /** Half-life for recency decay in ms (default 2 days). */
  recencyHalfLifeMs?: number;
};

export type ScoredMemory = {
  memory: MemoryRecord;
  score: number;
  reasons: string[];
};

/**
 * Deterministic relevant-memory retrieval.
 * Does not cross citizen privacy boundaries.
 */
export function retrieveRelevantMemories(memories: MemoryRecord[], query: MemoryQuery): MemoryRecord[] {
  return scoreMemories(memories, query)
    .slice(0, Math.max(0, query.limit ?? 5))
    .map((s) => s.memory);
}

export function scoreMemories(memories: MemoryRecord[], query: MemoryQuery): ScoredMemory[] {
  const now = query.now ?? Date.now();
  const halfLife = query.recencyHalfLifeMs ?? 2 * 24 * 60 * 60 * 1000;
  const terms = tokenize(query.situation);
  const commitmentTerms = (query.activeCommitmentHints ?? []).flatMap(tokenize);
  const unresolvedTerms = (query.unresolvedHints ?? []).flatMap(tokenize);

  const owned = memories.filter((m) => m.citizenId === query.citizenId);
  const scored: ScoredMemory[] = [];
  const seenContent = new Set<string>();

  for (const memory of owned) {
    const norm = normalizeContent(memory.content);
    if (seenContent.has(norm)) continue; // duplicate suppression
    seenContent.add(norm);

    const reasons: string[] = [];
    let score = 0;

    const hay = memory.content.toLowerCase();
    const hits = terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
    if (hits > 0) {
      score += hits * 1.2;
      reasons.push("relevance");
    }

    score += memory.importance * 1.5;
    if (memory.importance >= 0.7) reasons.push("importance");

    const ageMs = Math.max(0, now - Date.parse(memory.createdAt));
    const recency = Math.exp(-ageMs / halfLife);
    score += recency * 0.9;
    if (recency > 0.5) reasons.push("recency");

    if (query.relatedCitizenId && memory.relatedCitizenId === query.relatedCitizenId) {
      score += 1.4;
      reasons.push("relationship");
    }

    const commitmentHits = commitmentTerms.reduce((sum, t) => sum + (hay.includes(t) ? 1 : 0), 0);
    if (commitmentHits > 0) {
      score += commitmentHits * 1.1;
      reasons.push("commitment");
    }

    const unresolvedHits = unresolvedTerms.reduce((sum, t) => sum + (hay.includes(t) ? 1 : 0), 0);
    if (unresolvedHits > 0) {
      score += unresolvedHits * 1.3;
      reasons.push("unresolved");
    }

    // Repeated experience: kind social/episodic slight boost when important.
    if (memory.kind === "episodic" || memory.kind === "social") {
      score += 0.1;
    }

    scored.push({ memory, score, reasons });
  }

  return scored.sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance);
}

/** Backward-compatible wrapper used by existing callers. */
export function retrieveRelevant(memories: MemoryRecord[], query: string, limit = 5): MemoryRecord[] {
  // Infer citizen from first memory if present; empty set returns [].
  const citizenId = memories[0]?.citizenId ?? "";
  const owned = citizenId ? memories.filter((m) => m.citizenId === citizenId) : memories;
  return retrieveRelevantMemories(owned, { citizenId: citizenId || "unknown", situation: query, limit });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

function normalizeContent(content: string): string {
  return content.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}
