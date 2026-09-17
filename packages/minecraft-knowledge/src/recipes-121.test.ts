import { describe, expect, it } from "vitest";
import {
  cellIngredientIds,
  cellIngredientName,
  createMinecraftKnowledge,
  recipesFromMinecraftData,
} from "./index.js";
import { loadMinecraftData } from "./data.js";

const knowledge = createMinecraftKnowledge("1.21.11");
const data = loadMinecraftData("1.21.11");

function itemId(name: string): number {
  const id = data.itemsByName[name]?.id;
  if (typeof id !== "number") throw new Error(`missing item ${name}`);
  return id;
}

describe("minecraft-data 1.21.11 recipe parser", () => {
  it("parses actual oak_door: 6 oak planks, table, output 3", () => {
    const id = itemId("oak_door");
    const parsed = recipesFromMinecraftData({
      recipes: { [id]: data.recipes?.[id] },
      items: data.items,
      itemsByName: data.itemsByName,
    });
    const door = parsed.find((recipe) => recipe.result === "oak_door");
    expect(door).toBeDefined();
    expect(door?.ingredients.oak_planks).toBe(6);
    expect(door?.resultCount).toBe(3);
    expect(door?.needsTable).toBe(true);
    expect(door?.shaped).toBe(true);
    expect(door?.source).toBe("minecraft-data");
  });

  it("parses {id} objects and alternative ID lists used by prismarine-recipe / older dumps", () => {
    const oak = itemId("oak_planks");
    const spruce = itemId("spruce_planks");
    const stick = itemId("stick");
    const parsed = recipesFromMinecraftData({
      recipes: {
        [stick]: [
          {
            inShape: [
              [{ id: oak }, [oak, spruce]],
              [null, { id: oak }],
            ],
            result: { id: stick, count: 4 },
          },
        ],
      },
      items: data.items,
      itemsByName: data.itemsByName,
    });
    expect(parsed[0]?.result).toBe("stick");
    expect(parsed[0]?.ingredients.oak_planks).toBe(2);
    expect(parsed[0]?.ingredients.any_planks).toBe(1);
    expect(cellIngredientIds([oak, spruce])).toEqual([oak, spruce]);
    expect(cellIngredientName([oak, spruce], data.items)).toBe("any_planks");
    expect(cellIngredientName({ id: oak }, data.items)).toBe("oak_planks");
  });
});

describe("1.21.11 vanilla recipe chains", () => {
  it("oak_log -> oak_planks", () => {
    const recipe = knowledge.getRecipe("oak_planks");
    expect(recipe?.ingredients.oak_log).toBe(1);
    expect(recipe?.resultCount).toBe(4);
    expect(recipe?.needsTable).toBe(false);
    expect(knowledge.recipeExists("oak_planks")).toBe(true);
    expect(knowledge.isCraftable("oak_planks", { oak_log: 1 }, [])).toBe(true);
    expect(knowledge.isCraftable("oak_planks", {}, [])).toBe(false);
  });

  it("oak_planks -> sticks and crafting table", () => {
    const sticks = knowledge.getRecipe("stick", { oak_planks: 2 });
    expect(sticks?.ingredients.any_planks ?? sticks?.ingredients.oak_planks).toBe(2);
    expect(sticks?.resultCount).toBe(4);
    expect(sticks?.needsTable).toBe(false);
    const table = knowledge.getRecipe("crafting_table", { oak_planks: 4 });
    expect(table?.ingredients.any_planks ?? table?.ingredients.oak_planks).toBe(4);
    expect(table?.needsTable).toBe(false);
  });

  it("oak_planks + table -> oak_door with output 3", () => {
    expect(knowledge.getRecipeOutputCount("oak_door")).toBe(3);
    expect(knowledge.requiredWorkstation("oak_door")).toBe("crafting_table");
    expect(knowledge.isCraftable("oak_door", { oak_planks: 6 }, ["crafting_table"])).toBe(true);
    expect(knowledge.isCraftable("oak_door", { oak_planks: 6 }, [])).toBe(false);
    const missing = knowledge.analyzeObtain("oak_door", { oak_planks: 6 }, []);
    expect(missing.known).toBe(true);
    expect(missing.needsTable).toBe(true);
  });

  it("logs -> oak_door full chain", () => {
    const steps = knowledge.planFor("oak_door", { oak_log: 4 }, []);
    expect(steps.some((step) => step.kind === "craft" && step.item === "oak_planks")).toBe(true);
    expect(steps.some((step) => step.kind === "ensure_table" || (step.kind === "craft" && step.item === "crafting_table"))).toBe(
      true,
    );
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "oak_door", needsTable: true });
    expect(steps.every((step) => step.kind !== "gather")).toBe(true);
  });

  it("logs -> wooden_pickaxe full chain", () => {
    const steps = knowledge.planFor("wooden_pickaxe", { oak_log: 3 }, []);
    expect(steps.some((step) => step.kind === "craft" && step.item === "oak_planks")).toBe(true);
    expect(steps.some((step) => step.kind === "craft" && step.item === "stick")).toBe(true);
    expect(steps.some((step) => step.kind === "ensure_table" || (step.kind === "craft" && step.item === "crafting_table"))).toBe(
      true,
    );
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "wooden_pickaxe", needsTable: true });
  });

  it("wooden pickaxe + stone -> cobblestone acquisition, then stone pickaxe", () => {
    const cobble = knowledge.analyzeObtain("cobblestone", {}, []);
    expect(cobble.known).toBe(true);
    expect(cobble.recipes.length).toBe(0);
    expect(cobble.next?.kind).toBe("gather");
    expect(knowledge.canHarvest("stone", "wooden_pickaxe")).toBe(true);
    const stone = knowledge.planFor("stone_pickaxe", { cobblestone: 3, oak_planks: 2 }, ["crafting_table"]);
    expect(stone.some((step) => step.kind === "craft" && step.item === "stick")).toBe(true);
    expect(stone.at(-1)).toMatchObject({ kind: "craft", item: "stone_pickaxe", needsTable: true });
  });

  it("chest, torch, and bread from installed data", () => {
    const chest = knowledge.getRecipe("chest", { oak_planks: 8 });
    expect(chest?.ingredients.any_planks ?? chest?.ingredients.oak_planks).toBe(8);
    expect(chest?.needsTable).toBe(true);
    const torch = knowledge.getRecipe("torch");
    expect(torch?.ingredients.stick).toBe(1);
    expect(Boolean(torch?.ingredients.coal || torch?.ingredients.charcoal)).toBe(true);
    expect(torch?.resultCount).toBe(4);
    const bread = knowledge.getRecipe("bread");
    expect(bread?.ingredients.wheat).toBe(3);
  });

  it("accepts multiple wood types where vanilla permits them", () => {
    expect(knowledge.getRecipe("spruce_planks")?.ingredients.spruce_log).toBe(1);
    expect(knowledge.getRecipe("birch_planks")?.ingredients.birch_log).toBe(1);
    expect(knowledge.isCraftable("stick", { spruce_planks: 2 }, [])).toBe(true);
    expect(knowledge.isCraftable("crafting_table", { birch_planks: 4 }, [])).toBe(true);
    expect(knowledge.isCraftable("chest", { spruce_planks: 8 }, ["crafting_table"])).toBe(true);
    expect(knowledge.getRecipes("stick").length).toBeGreaterThan(1);
  });

  it("does not treat a crafting_table item as a placed workstation", () => {
    const analysis = knowledge.analyzeObtain("oak_door", { oak_planks: 6, crafting_table: 1 }, []);
    expect(analysis.known).toBe(true);
    expect(analysis.needsTable).toBe(true);
    expect(analysis.steps.some((step) => step.kind === "ensure_table")).toBe(true);
    expect(knowledge.isCraftable("oak_door", { oak_planks: 6, crafting_table: 1 }, [])).toBe(false);
  });

  it("does not report NO_RECIPE merely because ingredients are missing", () => {
    const analysis = knowledge.analyzeObtain("oak_door", {}, []);
    expect(analysis.known).toBe(true);
    expect(analysis.recipes.length).toBeGreaterThan(0);
    expect(analysis.next?.kind).not.toBeUndefined();
    expect(analysis.facts.join(" ")).not.toMatch(/no recipe/i);
  });
});
