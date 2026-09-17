import { describe, expect, it } from "vitest";
import { diversifyMemories } from "./retrieval.js";
import type { ScoredMemory, StoredMemory } from "./types.js";

function mem(id: string, summary: string, eventType = "path_failed"): StoredMemory {
  return {
    id,
    citizenId: "citizen_atlas",
    memoryType: "episodic",
    eventType,
    timestamp: "2026-09-17T00:00:00.000Z",
    summary,
    participants: ["citizen_atlas"],
    objectiveFacts: {},
    emotionalSalience: 0.4,
    importance: 0.5,
    source: "DIRECT",
    confidence: 0.8,
    tags: ["shelter"],
    relatedEntityIds: [],
    createdAt: "2026-09-17T00:00:00.000Z",
    recallCount: 0,
    compressed: false,
    supportingMemoryIds: [],
  };
}

function scored(memory: StoredMemory, score: number): ScoredMemory {
  return { memory, score, reasons: ["query"] };
}

describe("memory diversity", () => {
  it("collapses five near-identical blocked-entrance failures", () => {
    const input = [
      scored(mem("a", "Failed to use the east entrance"), 0.9),
      scored(mem("b", "Failed to use the east entrance again"), 0.88),
      scored(mem("c", "Failed to use the east entrance"), 0.86),
      scored(mem("d", "Failed to use the east entrance"), 0.84),
      scored(mem("e", "Failed to use the east entrance"), 0.82),
      scored(mem("f", "Creeper destroyed the shared chest", "explosion"), 0.8),
    ];
    const diverse = diversifyMemories(input);
    expect(diverse.filter((row) => row.memory.eventType === "path_failed").length).toBeLessThanOrEqual(2);
    expect(diverse.some((row) => row.memory.id === "f")).toBe(true);
  });
});
