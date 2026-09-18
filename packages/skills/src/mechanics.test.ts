import { describe, expect, it } from "vitest";
import { classifySkill } from "./skill-result.js";
import { fail } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { NORMAL_NAVIGATION_CAN_DIG, movementAllowsDig } from "@civ/minecraft-adapter";

describe("mechanics skill classification", () => {
  it("treats missing ingredients and unknown items as prerequisites, not citizen incompetence", () => {
    expect(classifySkill(fail("MISSING_INGREDIENT", "Need oak planks", 1, true))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("UNKNOWN_ITEM", "Unknown item diamond_dirt_sword", 1, false))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("INVENTORY_FULL", "Inventory is full", 1, true))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("ITEM_RESERVED", "planks reserved", 1, true))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("RECIPIENT_FULL", "maya full", 1, true))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("CANCELLED", "preempted", 1, false))).toBe("INTERRUPTED");
  });
});

describe("navigation never mines by default", () => {
  it("keeps SAFE_NAVIGATION canDig off", () => {
    expect(NORMAL_NAVIGATION_CAN_DIG).toBe(false);
    expect(movementAllowsDig("SAFE_NAVIGATION")).toBe(false);
    expect(movementAllowsDig("RESOURCE_APPROACH")).toBe(false);
  });
});

describe("recipe existence vs craftability", () => {
  it("does not treat missing ingredients as an unknown recipe", () => {
    const knowledge = minecraftKnowledge();
    expect(knowledge.recipeExists("oak_door")).toBe(true);
    expect(knowledge.recipeExists("stone_pickaxe")).toBe(true);
    expect(knowledge.isCraftable("oak_door", {}, [])).toBe(false);
    const analysis = knowledge.analyzeObtain("oak_door", {}, []);
    expect(analysis.known).toBe(true);
    expect(classifySkill(fail("MISSING_INGREDIENT", "Need oak planks", 1, true))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("UNKNOWN_RECIPE", "no such recipe", 1, false))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("PURPOSELESS_PLACEMENT", "open field bed", 1, false))).toBe("BLOCKED");
    expect(classifySkill(fail("BED_UNREACHABLE", "cannot reach bed", 1, true))).toBe("BLOCKED");
    expect(classifySkill(fail("NAV_NO_INITIAL_PROGRESS", "no first step", 1, true))).toBe("BLOCKED");
  });
});
