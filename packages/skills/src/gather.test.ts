import { describe, expect, it } from "vitest";
import { classifyStaleTarget } from "./gather.js";
import { missingPrerequisites } from "./obtain.js";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";

describe("stale target revalidation", () => {
  it("classifies disappeared and replaced blocks instead of retrying the same cell as success", () => {
    expect(classifyStaleTarget("oak_log", "air")).toBe("TARGET_GONE");
    expect(classifyStaleTarget("oak_log", undefined)).toBe("TARGET_GONE");
    expect(classifyStaleTarget("oak_log", "oak_leaves")).toBe("TARGET_CHANGED");
    expect(classifyStaleTarget("oak_log", "oak_log")).toBeUndefined();
  });
});

describe("recursive obtain-item chains", () => {
  it("plans oak_door from logs without calling that an unknown recipe", () => {
    const knowledge = minecraftKnowledge();
    const steps = knowledge.planFor("oak_door", { oak_log: 4 }, []);
    expect(knowledge.recipeExists("oak_door")).toBe(true);
    expect(steps.some((step) => step.kind === "craft" && step.item === "oak_planks")).toBe(true);
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "oak_door" });
    const missing = missingPrerequisites({}, "oak_door");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing).not.toContain("UNKNOWN_RECIPE");
  });

  it("plans stone_pickaxe through sticks and a table", () => {
    const knowledge = minecraftKnowledge();
    const steps = knowledge.planFor("stone_pickaxe", { cobblestone: 3, oak_planks: 2 }, ["crafting_table"]);
    expect(knowledge.recipeExists("stone_pickaxe")).toBe(true);
    expect(steps.some((step) => step.kind === "craft" && step.item === "stick")).toBe(true);
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "stone_pickaxe", needsTable: true });
  });
});
