import { describe, expect, it } from "vitest";
import { createMemory, retrieveRelevant, retrieveRelevantMemories, scoreMemories } from "./index.js";
import { summarizeLearnedBehavior, type BehaviorEvidence } from "./learned-behavior.js";

describe("memory retrieval", () => {
  it("returns important matching memories first (legacy API)", () => {
    const citizen = "citizen_atlas";
    const memories = [
      createMemory(citizen, "episodic", "Found a village well to the west", 0.4),
      createMemory(citizen, "episodic", "Maya shared cooked beef after a hunt", 0.9, "citizen_maya"),
      createMemory(citizen, "world", "Oak trees are plentiful near spawn", 0.3),
    ];
    const found = retrieveRelevant(memories, "maya food hunt", 2);
    expect(found[0]?.content).toMatch(/Maya/);
  });

  it("relevant old memory can outrank irrelevant recent memory", () => {
    const citizen = "citizen_atlas";
    const now = Date.parse("2026-09-30T12:00:00.000Z");
    const memories = [
      {
        ...createMemory(citizen, "episodic", "Maya promised to bring food to Atlas", 0.95, "citizen_maya"),
        createdAt: "2026-09-20T12:00:00.000Z",
      },
      {
        ...createMemory(citizen, "episodic", "Saw a pretty cloud near the hill", 0.2),
        createdAt: "2026-09-30T11:50:00.000Z",
      },
    ];
    const scored = scoreMemories(memories, {
      citizenId: citizen,
      situation: "food promise maya",
      relatedCitizenId: "citizen_maya",
      unresolvedHints: ["food", "promise"],
      now,
      limit: 2,
    });
    expect(scored[0]?.memory.content).toMatch(/promised/);
  });

  it("keeps retrieval citizen-specific and excludes unrelated citizen memory", () => {
    const memories = [
      createMemory("citizen_atlas", "social", "I asked Maya for food", 0.8, "citizen_maya"),
      createMemory("citizen_maya", "social", "Atlas looked hungry today", 0.9, "citizen_atlas"),
    ];
    const atlasOnly = retrieveRelevantMemories(memories, {
      citizenId: "citizen_atlas",
      situation: "food maya",
      limit: 5,
    });
    expect(atlasOnly.every((m) => m.citizenId === "citizen_atlas")).toBe(true);
    expect(atlasOnly.some((m) => m.content.includes("looked hungry"))).toBe(false);
  });

  it("suppresses duplicates, supports empty set, and caps count", () => {
    expect(retrieveRelevantMemories([], { citizenId: "citizen_atlas", situation: "food", limit: 3 })).toEqual([]);
    const citizen = "citizen_kai";
    const memories = [
      createMemory(citizen, "episodic", "Failed mining coal near the ravine", 0.6),
      createMemory(citizen, "episodic", "Failed mining coal near the ravine", 0.6),
      createMemory(citizen, "episodic", "Theo helped me climb out", 0.7, "citizen_theo"),
      createMemory(citizen, "world", "Coal vein on west slope", 0.5),
    ];
    const found = retrieveRelevantMemories(memories, {
      citizenId: citizen,
      situation: "mining failure theo",
      relatedCitizenId: "citizen_theo",
      limit: 2,
    });
    expect(found).toHaveLength(2);
    const contents = found.map((m) => m.content);
    expect(contents.filter((c) => c.includes("Failed mining")).length).toBe(1);
  });
});

describe("learned behavior", () => {
  it("one event produces low confidence; repeats raise; contradictions shift; decay applies; none = unknown", () => {
    const t0 = "2026-09-30T10:00:00.000Z";
    const once: BehaviorEvidence[] = [{ dimension: "resource_sharing", direction: 1, at: t0 }];
    const onceSummary = summarizeLearnedBehavior(once, { now: Date.parse(t0) });
    const sharing = onceSummary.find((d) => d.dimension === "resource_sharing")!;
    expect(sharing.evidenceCount).toBe(1);
    expect(sharing.confidence).toBeLessThan(0.4);
    expect(sharing.score).toBeGreaterThan(0);

    const many: BehaviorEvidence[] = [
      { dimension: "resource_sharing", direction: 1, at: t0 },
      { dimension: "resource_sharing", direction: 1, at: "2026-09-30T11:00:00.000Z" },
      { dimension: "resource_sharing", direction: 1, at: "2026-09-30T12:00:00.000Z" },
    ];
    const raised = summarizeLearnedBehavior(many, { now: Date.parse("2026-09-30T12:00:00.000Z") }).find(
      (d) => d.dimension === "resource_sharing",
    )!;
    expect(raised.confidence).toBeGreaterThan(sharing.confidence);

    const contradicted = summarizeLearnedBehavior(
      [...many, { dimension: "resource_sharing", direction: -1, at: "2026-09-30T12:30:00.000Z", weight: 2 }],
      { now: Date.parse("2026-09-30T12:30:00.000Z") },
    ).find((d) => d.dimension === "resource_sharing")!;
    expect(contradicted.score).toBeLessThan(raised.score);

    const decayed = summarizeLearnedBehavior(many, {
      now: Date.parse("2026-10-20T12:00:00.000Z"),
      halfLifeMs: 24 * 60 * 60 * 1000,
    }).find((d) => d.dimension === "resource_sharing")!;
    expect(decayed.confidence).toBeLessThan(raised.confidence);

    const none = summarizeLearnedBehavior([], { now: Date.parse(t0) }).find((d) => d.dimension === "help_tendency")!;
    expect(none.confidence).toBe(0);
    expect(none.evidenceCount).toBe(0);
  });
});
