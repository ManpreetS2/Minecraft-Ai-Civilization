import { describe, expect, it } from "vitest";
import { isAttackAllowed } from "./combat.js";
import { isMatureCrop, cropAge, CROP_BLOCKS } from "./farm.js";
import { classifyStructureBlock } from "./structure.js";
import { durabilityFromItem } from "./inventory-service.js";

describe("body gauntlet helpers", () => {
  it("forbids attacking players, villagers, citizens, and creepers via attackHostile", () => {
    expect(isAttackAllowed("zombie", "hostile")).toBe(true);
    expect(isAttackAllowed("skeleton", "hostile")).toBe(true);
    expect(isAttackAllowed("spider", "hostile")).toBe(true);
    expect(isAttackAllowed("creeper", "hostile")).toBe(false);
    expect(isAttackAllowed("villager", "hostile")).toBe(false);
    expect(isAttackAllowed("player", "hostile")).toBe(false);
    expect(isAttackAllowed("cow", "animal")).toBe(true);
    expect(isAttackAllowed("villager", "animal")).toBe(false);
  });

  it("treats wheat age 7 as mature and age 3 as immature", () => {
    expect(CROP_BLOCKS.wheat.matureAge).toBe(7);
    expect(isMatureCrop({ name: "wheat", getProperties: () => ({ age: 7 }) }, "wheat")).toBe(true);
    expect(isMatureCrop({ name: "wheat", getProperties: () => ({ age: 3 }) }, "wheat")).toBe(false);
    expect(cropAge({ name: "wheat", getProperties: () => ({ age: 3 }) })).toBe(3);
    expect(cropAge({ name: "wheat", getProperties: () => ({ age: "7" }) })).toBe(7);
    expect(isMatureCrop({ name: "wheat", getProperties: () => ({ age: "7" }) }, "wheat")).toBe(true);
  });

  it("classifies blueprint blocks without calling them complete when missing", () => {
    expect(classifyStructureBlock("oak_planks", "oak_planks")).toBe("PLACED");
    expect(classifyStructureBlock("oak_planks", "air")).toBe("MISSING");
    expect(classifyStructureBlock("oak_planks", "dirt")).toBe("WRONG_BLOCK");
    expect(classifyStructureBlock("oak_door", "oak_door")).toBe("PLACED");
  });

  it("does not invent tool durability when Mineflayer omits it", () => {
    expect(durabilityFromItem({ name: "iron_pickaxe" })).toEqual({
      tool: "iron_pickaxe",
      nearBreaking: false,
      known: false,
    });
    expect(durabilityFromItem({ name: "iron_pickaxe", durabilityUsed: 240, maxDurability: 250 })).toMatchObject({
      remaining: 10,
      nearBreaking: true,
      known: true,
    });
  });
});
