import { describe, expect, it } from "vitest";
import { createMemory, retrieveRelevant } from "./index.js";

describe("memory retrieval", () => {
  it("returns important matching memories first", () => {
    const citizen = "citizen_atlas";
    const memories = [
      createMemory(citizen, "episodic", "Found a village well to the west", 0.4),
      createMemory(citizen, "episodic", "Maya shared cooked beef after a hunt", 0.9, "citizen_maya"),
      createMemory(citizen, "world", "Oak trees are plentiful near spawn", 0.3),
    ];
    const found = retrieveRelevant(memories, "maya food hunt", 2);
    expect(found[0]?.content).toMatch(/Maya/);
  });
});
