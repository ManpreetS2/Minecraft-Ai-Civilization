import { describe, expect, it } from "vitest";
import { extractJson, validateDecision } from "./schema.js";
import { HeuristicProvider } from "./heuristic.js";

describe("LLM decision validation", () => {
  it("accepts structured high-level decisions", () => {
    const decision = validateDecision({
      goal: "gather_food",
      priority: 0.82,
      reason: "Food reserves are low",
    });
    expect(decision.goal).toBe("gather_food");
  });

  it("rejects hidden essays and unknown goals", () => {
    expect(() => validateDecision({ goal: "hack_server", priority: 1, reason: "nope" })).toThrow();
  });

  it("extracts JSON from noisy text", () => {
    const parsed = extractJson('Sure.\n{"goal":"rest","priority":0.2,"reason":"Night"}');
    expect(validateDecision(parsed).goal).toBe("rest");
  });
});

describe("heuristic provider", () => {
  it("prioritizes food shortages", async () => {
    const provider = new HeuristicProvider();
    const decision = await provider.decide({
      citizenName: "Maya",
      hunger: 8,
      inventory: [],
      settlementNeeds: ["NEED_FOOD"],
      memories: [],
      nearbyCitizens: ["Atlas"],
    });
    expect(decision.goal).toBe("gather_food");
  });
});
