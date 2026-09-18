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

describe("authoritative recipe resolution", () => {
  it("resolves oak log -> planks", () => {
    const recipe = knowledge.getRecipe("oak_planks");
    expect(recipe?.ingredients.oak_log).toBe(1);
    expect(recipe?.resultCount).toBe(4);
    expect(recipe?.needsTable).toBe(false);
  });

  it("resolves planks -> sticks and planks -> crafting table", () => {
    expect(knowledge.getRecipeInputs("stick").any_planks ?? knowledge.getRecipeInputs("stick").oak_planks).toBe(2);
    expect(knowledge.requiredWorkstation("crafting_table")).toBeUndefined();
    expect(knowledge.getRecipe("crafting_table")?.needsTable).toBe(false);
  });

  it("resolves oak_door from minecraft-data ids: 6 oak planks, table, output 3", () => {
    const recipe = knowledge.getRecipe("oak_door");
    expect(recipe).toBeDefined();
    expect(recipe?.ingredients.oak_planks).toBe(6);
    expect(recipe?.needsTable).toBe(true);
    expect(recipe?.resultCount).toBe(3);
    expect(recipe?.shaped).toBe(true);
    expect(knowledge.getRecipeOutputCount("oak_door")).toBe(3);
    expect(knowledge.requiredWorkstation("oak_door")).toBe("crafting_table");
  });

  it("plans logs -> oak_door instead of reporting no recipe", () => {
    const analysis = knowledge.analyzeObtain("oak_door", { oak_log: 2 }, ["crafting_table"]);
    expect(analysis.known).toBe(true);
    expect(analysis.recipes.length).toBeGreaterThan(0);
    expect(analysis.steps.some((step) => step.kind === "craft" && step.item === "oak_planks")).toBe(true);
    expect(analysis.steps.at(-1)).toMatchObject({ kind: "craft", item: "oak_door", needsTable: true });
    expect(analysis.facts.join(" ")).toMatch(/oak door/i);
    expect(analysis.facts.join(" ")).not.toMatch(/no recipe/i);
  });

  it("plans logs -> wooden pickaxe and cobble -> stone pickaxe", () => {
    const wood = knowledge.planFor("wooden_pickaxe", { oak_log: 3 }, ["crafting_table"]);
    expect(wood.some((step) => step.kind === "craft" && step.item === "oak_planks")).toBe(true);
    expect(wood.at(-1)).toMatchObject({ kind: "craft", item: "wooden_pickaxe" });
    const next = knowledge.analyzeObtain("wooden_pickaxe", { oak_log: 16 }, ["crafting_table"]).next;
    expect(next).toMatchObject({ kind: "craft", item: "oak_planks" });
    expect(knowledge.canCraft({ cobblestone: 3, stick: 2 }, ["crafting_table"], "stone_pickaxe")).toBe(true);
  });

  it("does not choose cherry_planks for a wooden pickaxe when oak is in inventory", () => {
    const dataOrder = knowledge.getRecipes("wooden_pickaxe");
    expect(dataOrder.length).toBeGreaterThan(1);
    const chosen = knowledge.getRecipe("wooden_pickaxe", { oak_planks: 8, stick: 4 });
    expect(chosen?.ingredients.cherry_planks).toBeUndefined();
    expect(chosen?.ingredients.any_planks ?? chosen?.ingredients.oak_planks).toBe(3);
    const fromLogs = knowledge.analyzeObtain("wooden_pickaxe", { oak_log: 16 }, ["crafting_table"]);
    expect(fromLogs.next).toMatchObject({ kind: "craft", item: "oak_planks" });
    expect(fromLogs.next && "item" in fromLogs.next ? fromLogs.next.item : undefined).not.toBe("wooden_pickaxe");
  });

  it("resolves the chest recipe using available planks, not a random wood variant", () => {
    const analysis = knowledge.analyzeObtain("chest", { oak_planks: 8 }, ["crafting_table"]);
    expect(analysis.chosen?.ingredients.any_planks ?? analysis.chosen?.ingredients.oak_planks).toBe(8);
    expect(knowledge.isCraftable("chest", { oak_planks: 8 }, ["crafting_table"])).toBe(true);
  });

  it("distinguishes missing workstation from missing recipe", () => {
    const missingTable = knowledge.analyzeObtain("oak_door", { oak_planks: 6 }, []);
    expect(missingTable.known).toBe(true);
    expect(missingTable.needsTable).toBe(true);
    expect(missingTable.facts.some((fact) => /no crafting table/i.test(fact))).toBe(true);
    const withTable = knowledge.analyzeObtain("oak_door", { oak_planks: 6 }, ["crafting_table"]);
    expect(knowledge.isCraftable("oak_door", { oak_planks: 6 }, ["crafting_table"])).toBe(true);
    expect(withTable.facts.some((fact) => /reachable nearby/i.test(fact))).toBe(true);
  });

  it("treats already-owned results as done and reports partial ingredients", () => {
    expect(knowledge.analyzeObtain("oak_door", { oak_door: 3 }, ["crafting_table"]).alreadyOwned).toBe(true);
    const partial = knowledge.analyzeObtain("oak_door", { oak_planks: 2 }, ["crafting_table"]);
    expect(partial.missingIngredients.oak_planks).toBe(4);
    expect(partial.next?.kind).toBe("gather");
  });

  it("keeps multiple recipe variants and rejects unknown/invalid names", () => {
    expect(knowledge.getRecipes("chest").length).toBeGreaterThan(1);
    expect(knowledge.getItem("not_a_real_item")).toBeUndefined();
    expect(knowledge.analyzeObtain("not_a_real_item", {}, []).known).toBe(false);
    expect(knowledge.normalizeItemName("Oak Door")).toBe("oak_door");
    expect(knowledge.getItem("Totally Invented Block!!!")).toBeUndefined();
  });
});

describe("block interaction and entity knowledge", () => {
  it("identifies beds, doors, containers, food, tools, and harvestability", () => {
    expect(knowledge.isBed("red_bed")).toBe(true);
    expect(knowledge.isDoor("oak_door")).toBe(true);
    expect(knowledge.isContainer("chest")).toBe(true);
    expect(knowledge.isWorkstation("crafting_table")).toBe(true);
    expect(knowledge.isFood("cooked_beef")).toBe(true);
    expect(knowledge.foodValue("bread")).toBeGreaterThan(0);
    expect(knowledge.isTool("wooden_pickaxe")).toBe(true);
    expect(knowledge.stackSize("oak_log")).toBe(64);
    expect(knowledge.stackSize("snowball")).toBe(16);
    expect(knowledge.stackSize("wooden_pickaxe")).toBe(1);
    expect(knowledge.canHarvest("stone", undefined)).toBe(false);
    expect(knowledge.canHarvest("stone", "wooden_pickaxe")).toBe(true);
    expect(knowledge.preferredToolForInventory("stone", [{ name: "wooden_pickaxe", count: 1 }, { name: "oak_log", count: 3 }])).toBe(
      "wooden_pickaxe",
    );
    expect(knowledge.interactionType("chest")).toBe("open");
    expect(knowledge.interactionType("oak_log")).toBe("mine");
    expect(knowledge.isHostileEntity("creeper")).toBe(true);
    expect(knowledge.isHostileEntity("cow")).toBe(false);
    expect(knowledge.entityAttitude("enderman")).toBe("NEUTRAL");
    expect(knowledge.isDisposableScaffold("cobblestone")).toBe(true);
    expect(knowledge.isPassable("air")).toBe(true);
    expect(knowledge.isStandable("stone")).toBe(true);
    expect(knowledge.isWoodenDoor("oak_door")).toBe(true);
    expect(knowledge.isIronDoor("iron_door")).toBe(true);
    expect(knowledge.isFenceGate("oak_fence_gate")).toBe(true);
    expect(knowledge.normalizeItemName("steak")).toBe("cooked_beef");
    expect(knowledge.isFood("steak")).toBe(true);
    expect(knowledge.analyzeObtain("diamond_dirt_sword", {}, []).known).toBe(false);
  });

  it("answers sleep from world state, not the model", () => {
    const night = knowledge.sleepFacts({
      timeOfDay: 14_000,
      bedPresent: true,
      bedReachable: true,
      hostilesNearby: false,
    });
    expect(night.canAttempt).toBe(true);
    const day = knowledge.sleepFacts({ timeOfDay: 1000, bedPresent: true, bedReachable: true });
    expect(day.canAttempt).toBe(false);
    expect(day.reasons.join(" ")).toMatch(/night/i);
  });
});
