import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CognitiveStore } from "./store.js";
import type { StoredMemory } from "./types.js";

function sampleMemory(citizenId: string, id: string): StoredMemory {
  return {
    id,
    citizenId,
    memoryType: "episodic",
    eventType: "citizen_item_received",
    timestamp: "2026-09-16T12:00:00.000Z",
    summary: "Maya gave me 3 bread when I was very hungry.",
    participants: [citizenId, "citizen_maya"],
    objectiveFacts: { item: "bread", count: 3 },
    emotionalSalience: 0.7,
    importance: 0.72,
    source: "DIRECT",
    confidence: 0.95,
    tags: ["help", "food"],
    relatedEntityIds: ["citizen_maya", "bread"],
    createdAt: "2026-09-16T12:00:00.000Z",
    recallCount: 0,
    compressed: false,
    supportingMemoryIds: [],
  };
}

describe("CognitiveStore", () => {
  it("persists memories and psych state across reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "cog-"));
    const path = join(dir, "mind.sqlite");
    const store = new CognitiveStore(path);
    store.upsertIdentity("citizen_atlas", "Atlas");
    store.putMemory(sampleMemory("citizen_atlas", "mem_1"));
    store.savePsych({
      citizenId: "citizen_atlas",
      moodValence: 0.2,
      stress: 0.3,
      fear: 0.1,
      anger: 0,
      sadness: 0,
      positiveAffect: 0.5,
      confidence: 0.45,
      currentConcernsJson: "[]",
      updatedAt: "2026-09-16T12:00:00.000Z",
    });
    store.close();

    const restored = new CognitiveStore(path);
    const memories = restored.listMemories("citizen_atlas");
    expect(memories).toHaveLength(1);
    expect(memories[0]?.summary).toMatch(/bread/);
    expect(memories[0]?.participants).toContain("citizen_maya");
    expect(restored.getPsych("citizen_atlas").moodValence).toBe(0.2);
    restored.close();
  });

  it("keeps deceased citizen history readable", () => {
    const store = new CognitiveStore(":memory:");
    store.putMemory(sampleMemory("citizen_atlas", "mem_dead"));
    store.markDeceased("citizen_atlas", "2026-09-16T13:00:00.000Z");
    expect(store.getIdentity("citizen_atlas")?.deceased).toBe(true);
    expect(store.listMemories("citizen_atlas")).toHaveLength(1);
    expect(store.listDurableMemories("citizen_atlas")[0]?.summary).toMatch(/Maya/);
    store.close();
  });
});
