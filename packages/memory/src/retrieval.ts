import { distance } from "@civ/shared";
import { clamp01 } from "./bounds.js";
import { cosineSimilarity } from "./embeddings.js";
import type { RetrievalQuery, ScoredMemory, StoredMemory } from "./types.js";

export type RetrievalOptions = {
  embeddings?: Map<string, number[]>;
  queryEmbedding?: number[];
};

export function retrieveMemories(
  memories: StoredMemory[],
  query: RetrievalQuery,
  options: RetrievalOptions = {},
): ScoredMemory[] {
  const limit = query.limit ?? 8;
  const now = Date.now();
  const terms = tokenize(query.query);
  const goalTerms = tokenize(query.currentGoal);
  const participants = new Set([...(query.participants ?? []), ...(query.currentEvent?.participants ?? [])]);
  const nearby = new Set(query.nearbyEntities ?? []);
  const eventTags = new Set(query.currentEvent?.tags ?? []);

  const scored = memories
    .filter((memory) => memory.citizenId === query.citizenId)
    .filter((memory) => memory.memoryType !== "immediate")
    .map((memory) => scoreOne(memory, {
      now,
      terms,
      goalTerms,
      participants,
      nearby,
      eventTags,
      query,
      embeddings: options.embeddings,
      queryEmbedding: options.queryEmbedding,
    }))
    .filter((entry) => entry.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

function scoreOne(
  memory: StoredMemory,
  ctx: {
    now: number;
    terms: string[];
    goalTerms: string[];
    participants: Set<string>;
    nearby: Set<string>;
    eventTags: Set<string>;
    query: RetrievalQuery;
    embeddings?: Map<string, number[]>;
    queryEmbedding?: number[];
  },
): ScoredMemory {
  const reasons: string[] = [];
  let score = 0;

  const recency = recencyScore(memory.timestamp, ctx.now);
  score += recency * 0.18;
  if (recency > 0.7) reasons.push("recent");

  score += memory.importance * 0.28;
  if (memory.importance >= 0.6) reasons.push("important");
  score += memory.emotionalSalience * 0.12;

  const overlap = memory.participants.filter((id) => ctx.participants.has(id)).length;
  if (overlap > 0) {
    score += Math.min(0.2, overlap * 0.1);
    reasons.push("participant");
  }

  if (memory.targetCitizenId && ctx.participants.has(memory.targetCitizenId)) {
    score += 0.08;
  }

  const hay = `${memory.summary} ${memory.tags.join(" ")} ${memory.eventType}`.toLowerCase();
  const termHits = ctx.terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
  if (ctx.terms.length > 0 && termHits > 0) {
    score += Math.min(0.22, termHits / ctx.terms.length * 0.22);
    reasons.push("query");
  }

  const goalHits = ctx.goalTerms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
  if (ctx.goalTerms.length > 0 && goalHits > 0) {
    score += 0.12;
    reasons.push("goal");
  }

  if (ctx.query.currentEvent?.category && memory.eventType === ctx.query.currentEvent.category) {
    score += 0.1;
    reasons.push("event");
  }

  for (const tag of memory.tags) {
    if (ctx.eventTags.has(tag) || ctx.nearby.has(tag)) {
      score += 0.06;
      reasons.push("association");
      break;
    }
  }
  for (const entity of memory.relatedEntityIds) {
    if (ctx.nearby.has(entity) || ctx.participants.has(entity)) {
      score += 0.08;
      reasons.push("entity");
      break;
    }
  }

  if (ctx.query.location && memory.location) {
    const d = distance(ctx.query.location, memory.location);
    if (d < 32) {
      score += clamp01(1 - d / 32) * 0.1;
      reasons.push("location");
    }
  }

  const vector = ctx.embeddings?.get(memory.id);
  if (vector && ctx.queryEmbedding) {
    const sim = cosineSimilarity(vector, ctx.queryEmbedding);
    if (sim > 0.55) {
      score += (sim - 0.55) * 0.25;
      reasons.push("semantic");
    }
  }

  if (ctx.query.currentMood?.fear && ctx.query.currentMood.fear > 0.5 && memory.tags.includes("danger")) {
    score += 0.08;
    reasons.push("mood");
  }

  return { memory, score: clamp01(score), reasons: [...new Set(reasons)] };
}

function recencyScore(timestamp: string, now: number): number {
  const then = Date.parse(timestamp);
  if (Number.isNaN(then) || Number.isNaN(now)) return 0.5;
  const hours = Math.max(0, (now - then) / 3_600_000);
  if (hours < 1) return 1;
  if (hours < 24) return 0.75;
  if (hours < 72) return 0.5;
  if (hours < 168) return 0.3;
  return 0.12;
}

function tokenize(text?: string): string[] {
  if (!text) return [];
  return text.toLowerCase().split(/\W+/).filter((part) => part.length > 1);
}
