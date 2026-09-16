import { describe, expect, it } from "vitest";
import { nextCraftStep, planCraft, recipeNeedsTable } from "./recipes.js";

describe("recipe dependency planning", () => {
  it("plans logs -> planks -> crafting table", () => {
    const steps = planCraft("crafting_table", 1, { oak_log: 1 }, false);
    expect(steps.some((step) => step.kind === "craft" && step.item === "oak_planks")).toBe(true);
    expect(steps.some((step) => step.kind === "craft" && step.item === "crafting_table")).toBe(true);
    expect(steps.every((step) => step.kind !== "gather")).toBe(true);
  });

  it("requires a table for wooden tools and crafts prerequisites first", () => {
    expect(recipeNeedsTable("wooden_pickaxe")).toBe(true);
    const steps = planCraft("wooden_pickaxe", 1, {}, false);
    expect(steps[0]).toMatchObject({ kind: "gather", item: "oak_log" });
    expect(steps.some((step) => step.kind === "craft" && step.item === "stick")).toBe(true);
    expect(steps.some((step) => step.kind === "ensure_table")).toBe(true);
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "wooden_pickaxe", needsTable: true });
  });

  it("does not craft another table when one is already available", () => {
    const steps = planCraft(
      "wooden_pickaxe",
      1,
      { oak_planks: 8, stick: 4 },
      true,
    );
    expect(steps.some((step) => step.kind === "ensure_table")).toBe(false);
    expect(steps.some((step) => step.kind === "craft" && step.item === "crafting_table")).toBe(false);
    expect(nextCraftStep("wooden_pickaxe", 1, { oak_planks: 8, stick: 4 }, true)).toMatchObject({
      kind: "craft",
      item: "wooden_pickaxe",
    });
  });

  it("recovers from missing ingredients instead of treating the final recipe as the only step", () => {
    const next = nextCraftStep("wooden_pickaxe", 1, { oak_log: 2 }, false);
    expect(next?.kind).toBe("craft");
    if (next?.kind === "craft") expect(next.item).toBe("oak_planks");
  });

  it("plans stone tools from cobblestone and sticks", () => {
    const steps = planCraft("stone_pickaxe", 1, { cobblestone: 3, stick: 2, oak_planks: 4 }, true);
    expect(steps.at(-1)).toMatchObject({ kind: "craft", item: "stone_pickaxe", needsTable: true });
    expect(steps.some((step) => step.kind === "ensure_table")).toBe(false);
  });

  it("does not attempt a wooden pickaxe after spending the last planks on a table", () => {
    const afterTable = planCraft("wooden_pickaxe", 1, { oak_planks: 0, crafting_table: 1 }, true);
    expect(afterTable[0]?.kind).toBe("gather");
  });
});
