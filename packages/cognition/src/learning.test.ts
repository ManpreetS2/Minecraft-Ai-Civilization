import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CognitiveStore, createIdFactory } from "@civ/memory";
import { classifyFailure } from "./classify.js";
import { ExperienceLedger } from "./experience-ledger.js";
import { renderLearningJournal } from "./journal.js";
import { decisionContradictsMechanics } from "./game-knowledge.js";

describe("failure classification", () => {
  it("keeps network timeouts as system incidents, not citizen lessons", () => {
    const classified = classifyFailure({
      errorCode: "TIMEOUT",
      errorMessage: "Mineflayer keepalive timed out after 30000 milliseconds",
      goal: "gather_wood",
    });
    expect(classified.track).toBe("SYSTEM");
    expect(classified.citizenLearns).toBe(false);
    expect(classified.category).toBe("NETWORK");
  });

  it("treats mining stone without a pickaxe as a citizen knowledge error", () => {
    const classified = classifyFailure({ goal: "mine_stone", missingTool: true });
    expect(classified.category).toBe("KNOWLEDGE_ERROR");
    expect(classified.citizenLearns).toBe(true);
  });

  it("keeps purposeless functional placement as a system bug, not a citizen lesson", () => {
    const classified = classifyFailure({
      errorCode: "PURPOSELESS_PLACEMENT",
      errorMessage: "FunctionalBlockPlacedWithoutPurpose: beds belong under a roof",
      goal: "place_bed",
    });
    expect(classified.track).toBe("SYSTEM");
    expect(classified.citizenLearns).toBe(false);
    expect(classified.code).toBe("PURPOSELESS_PLACEMENT");
  });
});

describe("experience ledger", () => {
  it("forms a pickaxe lesson, retrieves it, and persists across SQLite reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const path = join(dir, "mind.sqlite");
    const store = new CognitiveStore(path);
    const ledger = new ExperienceLedger(store, createIdFactory("e"));
    const first = ledger.recordAttempt({
      citizenId: "citizen_atlas",
      goal: "mine_stone",
      contextSummary: "Tried to collect stone with empty hands.",
      signal: { missingTool: true, goal: "mine_stone" },
      inventory: ["bread x1"],
    });
    expect(first.track).toBe("CITIZEN");
    expect(first.lesson?.lesson).toMatch(/pickaxe/i);
    const retrieved = ledger.retrieveRelevant({ citizenId: "citizen_atlas", goal: "mine_stone" });
    expect(retrieved.some((item) => /pickaxe/i.test(item.lesson.lesson))).toBe(true);
    store.close();

    const restored = new CognitiveStore(path);
    expect(restored.listLessons("citizen_atlas")[0]?.lesson).toMatch(/pickaxe/i);
    restored.close();
  });

  it("records a keepalive timeout as a system incident with zero citizen lessons", () => {
    const store = new CognitiveStore(":memory:");
    const ledger = new ExperienceLedger(store, createIdFactory("n"));
    const result = ledger.recordAttempt({
      citizenId: "citizen_atlas",
      goal: "gather_wood",
      contextSummary: "Connection dropped while walking to a tree.",
      signal: { errorMessage: "client timed out after 30000 milliseconds" },
    });
    expect(result.track).toBe("SYSTEM");
    expect(result.createdLesson).toBe(false);
    expect(store.listLessons("citizen_atlas")).toHaveLength(0);
    expect(store.listSystemIncidents()[0]?.errorCategory).toBe("NETWORK");
    expect(renderLearningJournal(store)).toMatch(/Citizen learning: NONE/);
    store.close();
  });

  it("does not write a citizen lesson for purposeless functional placement", () => {
    const store = new CognitiveStore(":memory:");
    const ledger = new ExperienceLedger(store, createIdFactory("p"));
    const result = ledger.recordAttempt({
      citizenId: "citizen_atlas",
      goal: "place_bed",
      contextSummary: "Tried to dump a bed in an open field.",
      signal: { errorCode: "PURPOSELESS_PLACEMENT", errorMessage: "FunctionalBlockPlacedWithoutPurpose" },
    });
    expect(result.track).toBe("SYSTEM");
    expect(result.createdLesson).toBe(false);
    expect(store.listLessons("citizen_atlas")).toHaveLength(0);
    expect(store.listSystemIncidents()[0]?.errorCode).toBe("PURPOSELESS_PLACEMENT");
    store.close();
  });

  it("does not turn a single unlucky unknown event into a strong universal rule", () => {
    const store = new CognitiveStore(":memory:");
    const ledger = new ExperienceLedger(store, createIdFactory("u"));
    ledger.recordAttempt({
      citizenId: "citizen_atlas",
      goal: "gather_wood",
      contextSummary: "A creeper exploded five seconds after chopping a tree.",
      signal: { errorCode: "UNKNOWN", errorMessage: "explosion nearby" },
    });
    expect(store.listLessons("citizen_atlas")).toHaveLength(0);
    store.close();
  });

  it("lowers confidence when an applied lesson later fails", () => {
    const store = new CognitiveStore(":memory:");
    const ledger = new ExperienceLedger(store, createIdFactory("c"));
    const recorded = ledger.recordAttempt({
      citizenId: "citizen_atlas",
      goal: "mine_stone",
      contextSummary: "No pickaxe.",
      signal: { missingTool: true },
    });
    const lessonId = recorded.lesson!.id;
    const before = store.getLesson(lessonId)!.confidence;
    ledger.evaluateDecision({
      citizenId: "citizen_atlas",
      goal: "craft_tools",
      outcome: "FAILURE",
      relevantLessonIds: [lessonId],
      shortExplanation: "Tried to follow the pickaxe lesson but still failed.",
    });
    expect(store.getLesson(lessonId)!.confidence).toBeLessThan(before);
    store.close();
  });

  it("flags mine_stone without a pickaxe as a mechanics contradiction", () => {
    const result = decisionContradictsMechanics("mine_stone", [{ name: "stick", count: 2 }]);
    expect(result.contradicts).toBe(true);
    expect(result.suggestedGoal).toBe("craft_tools");
  });
});
