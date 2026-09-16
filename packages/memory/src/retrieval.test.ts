import { describe, expect, it } from "vitest";
import { cosineSimilarity, NoopEmbeddingProvider } from "./embeddings.js";
import { retrieveMemories } from "./retrieval.js";
import type { StoredMemory } from "./types.js";

function memory(partial: Partial<StoredMemory> & Pick<StoredMemory, "id" | "summary" | "tags">): StoredMemory {
  return {
    citizenId: "citizen_atlas",
    memoryType: "episodic",
    eventType: "danger_encountered",
    timestamp: "2026-09-16T12:00:00.000Z",
    participants: ["citizen_atlas"],
    objectiveFacts: {},
    emotionalSalience: 0.5,
    importance: 0.6,
    source: "DIRECT",
    confidence: 0.9,
    relatedEntityIds: partial.tags,
    createdAt: "2026-09-16T12:00:00.000Z",
    recallCount: 0,
    compressed: false,
    supportingMemoryIds: [],
    ...partial,
  };
}

describe("embeddings", () => {
  it("noop provider never blocks and returns null", async () => {
    const provider = new NoopEmbeddingProvider();
    expect(provider.available).toBe(false);
    expect(await provider.embed("creeper explosion")).toBeNull();
  });

  it("cosine similarity ranks aligned vectors higher", () => {
    const a = [1, 0, 0];
    expect(cosineSimilarity(a, [1, 0, 0])).toBeGreaterThan(cosineSimilarity(a, [0, 1, 0]));
  });
});

describe("retrieval", () => {
  it("returns creeper-relevant memories without dumping history", () => {
    const memories = [
      memory({ id: "1", summary: "Chopped oak", tags: ["gather_wood"], importance: 0.2, eventType: "task_succeeded" }),
      memory({
        id: "2",
        summary: "A creeper destroyed my storage.",
        tags: ["danger", "creeper"],
        relatedEntityIds: ["creeper"],
        importance: 0.8,
      }),
      memory({ id: "3", summary: "Found berries", tags: ["food"], importance: 0.3, eventType: "resource_discovered" }),
    ];
    const found = retrieveMemories(memories, {
      citizenId: "citizen_atlas",
      query: "creeper storage",
      nearbyEntities: ["creeper"],
      limit: 2,
    });
    expect(found).toHaveLength(2);
    expect(found[0]?.memory.summary).toMatch(/creeper/i);
  });
});
