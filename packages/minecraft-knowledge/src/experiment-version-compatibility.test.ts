import { describe, expect, it } from "vitest";
import { MinecraftKnowledge, resolveMinecraftVersion } from "./index.js";

describe("installed data compatibility only ? no Paper connection", () => {
  it.each(["1.21.6", "1.21.11"])(
    "resolves %s exactly and retains survival item/recipe/block contracts",
    (version) => {
      expect(resolveMinecraftVersion(version)).toBe(version);
      const k = new MinecraftKnowledge(version);
      expect(k.version).toBe(version);
      for (const item of [
        "oak_log",
        "oak_planks",
        "stick",
        "crafting_table",
        "wooden_pickaxe",
        "cobblestone",
        "carrot",
        "bread",
      ]) {
        expect(k.data.itemsByName[item]?.name).toBe(item);
      }
      for (const block of [
        "oak_log",
        "stone",
        "crafting_table",
        "chest",
        "oak_door",
        "red_bed",
        "water",
        "lava",
      ]) {
        expect(k.data.blocksByName[block]?.name).toBe(block);
      }
      expect(k.getRecipeOutputCount("oak_planks")).toBe(4);
      expect(k.getRecipes("wooden_pickaxe").some((recipe) => recipe.needsTable)).toBe(true);
      expect(k.canHarvest("stone", "wooden_pickaxe")).toBe(true);
      expect(k.canHarvest("stone", undefined)).toBe(false);
      expect(k.isFood("carrot")).toBe(true);
    },
  );

  it("demonstrates why numeric IDs must come from the negotiated bot registry", () => {
    const target = new MinecraftKnowledge("1.21.6");
    const historical = new MinecraftKnowledge("1.21.11");
    expect(target.data.itemsByName.crafting_table!.id).not.toBe(
      historical.data.itemsByName.crafting_table!.id,
    );
    expect(target.data.blocksByName.crafting_table!.id).not.toBe(
      historical.data.blocksByName.crafting_table!.id,
    );
  });
});
