import { describe, expect, it } from "vitest";
import {
  createMinecraftKnowledge,
  minecraftKnowledge,
  villageChestImpliesOwnership,
} from "./index.js";
import { interpretVillageFeature } from "./village.js";

const knowledge = createMinecraftKnowledge();

describe("crafting knowledge", () => {
  it("plans logs -> planks", () => {
    const steps = knowledge.planFor("oak_planks", { oak_log: 1 }, []);
    expect(steps.some((step) => step.kind === "craft" && step.item === "oak_planks")).toBe(true);
    expect(steps.every((step) => step.kind !== "gather")).toBe(true);
  });

  it("plans planks -> sticks and planks -> crafting table", () => {
    const sticks = knowledge.planFor("stick", { oak_planks: 2 }, []);
    expect(sticks.some((step) => step.kind === "craft" && step.item === "stick")).toBe(true);
    const table = knowledge.planFor("crafting_table", { oak_planks: 4 }, []);
    expect(table.some((step) => step.kind === "craft" && step.item === "crafting_table")).toBe(true);
    expect(knowledge.requiresCraftingTable(knowledge.getRecipesFor("crafting_table")[0]!)).toBe(false);
  });

  it("plans wooden pickaxe with table, planks, and sticks", () => {
    const steps = knowledge.getCraftingDependencies("wooden_pickaxe", {}, false);
    expect(steps.some((step) => step.kind === "gather")).toBe(true);
    expect(steps.some((step) => step.kind === "ensure_table" || (step.kind === "craft" && step.item === "crafting_table"))).toBe(true);
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "wooden_pickaxe", needsTable: true });
  });

  it("plans stone pickaxe from cobblestone and sticks", () => {
    const steps = knowledge.planFor("stone_pickaxe", { cobblestone: 3, stick: 2 }, ["crafting_table"]);
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "stone_pickaxe", needsTable: true });
    expect(knowledge.canCraft({ cobblestone: 3, stick: 2 }, ["crafting_table"], "stone_pickaxe")).toBe(true);
  });
});

describe("block / tool knowledge", () => {
  it("requires a pickaxe to harvest stone correctly", () => {
    expect(knowledge.canHarvest("stone", undefined)).toBe(false);
    expect(knowledge.canHarvest("stone", "wooden_pickaxe")).toBe(true);
    expect(knowledge.preferredTool("oak_log")).toBe("axe");
    expect(knowledge.preferredTool("stone")).toBe("pickaxe");
  });
});

describe("food knowledge", () => {
  it("classifies edible items from game data, not just bread", () => {
    expect(knowledge.isFood("bread")).toBe(true);
    expect(knowledge.isFood("apple")).toBe(true);
    expect(knowledge.isFood("cooked_beef")).toBe(true);
    expect(knowledge.isFood("oak_log")).toBe(false);
    const options = knowledge.getFoodOptions([
      { name: "oak_log", count: 3 },
      { name: "apple", count: 1 },
      { name: "bread", count: 2 },
    ]);
    expect(options.map((food) => food.name)).toEqual(expect.arrayContaining(["apple", "bread"]));
  });
});

describe("danger classification", () => {
  it("marks lava and creepers as dangerous without implying a single action", () => {
    expect(knowledge.classifyHazard("lava").dangerous).toBe(true);
    expect(knowledge.getThreatInfo("creeper").threat).toBe("explosion");
    expect(knowledge.getThreatInfo("villager").attitude).toBe("PASSIVE");
    expect(knowledge.getThreatInfo("iron_golem").attitude).toBe("UTILITY");
  });
});

describe("village facts vs ownership", () => {
  it("does not treat a village chest as settlement property", () => {
    expect(villageChestImpliesOwnership()).toBe(false);
    const fact = interpretVillageFeature({ kind: "chest", present: true });
    expect(fact.socialClaim).toBe(false);
    expect(fact.ownership).toBe("unclaimed");
    expect(fact.fact).toMatch(/chest/i);
  });
});

describe("relevant-rule retrieval", () => {
  it("returns a compact subset for mining stone without a pickaxe", () => {
    const relevant = knowledge.getRelevantRules({
      goal: "mine_stone",
      nearbyBlocks: ["stone", "crafting_table"],
      nearbyEntities: ["cow"],
      inventory: [
        { name: "oak_planks", count: 7 },
        { name: "stick", count: 2 },
      ],
      hasPickaxe: false,
      hasCraftingTableNearby: true,
    });
    expect(relevant.source).toBe("minecraft-mechanics");
    expect(relevant.facts.length).toBeGreaterThan(0);
    expect(relevant.facts.length).toBeLessThanOrEqual(8);
    expect(relevant.facts.some((fact) => /pickaxe/i.test(fact))).toBe(true);
    expect(relevant.facts.some((fact) => /crafting table/i.test(fact))).toBe(true);
    expect(relevant.facts.join(" ")).not.toMatch(/recipe book/i);
  });
});

describe("version-aware loader", () => {
  it("loads a 1.21 family dataset", () => {
    expect(minecraftKnowledge().version.startsWith("1.21")).toBe(true);
  });
});
