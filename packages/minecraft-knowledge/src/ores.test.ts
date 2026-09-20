import { describe, expect, it } from "vitest";
import { createMinecraftKnowledge } from "./index.js";
import {
  biomeSupportsOre,
  getOreProfile,
  isOreResource,
  isYInOreRange,
  isYInPreferredSearchBand,
  listOreProfiles,
  oreBlocksFor,
  oreDropsFor,
  oreSearchHints,
  pickaxeMeetsTier,
  requiredPickaxeTier,
  resolveOreResource,
} from "./ores.js";

const knowledge = createMinecraftKnowledge();

describe("ore knowledge 1.21.x", () => {
  it("covers the eight Overworld ores", () => {
    const ids = listOreProfiles().map((profile) => profile.resource);
    expect(ids).toEqual(["coal", "iron", "copper", "gold", "redstone", "lapis", "diamond", "emerald"]);
  });

  it("resolves items, blocks, and aliases without inventing deposits", () => {
    expect(isOreResource("iron")).toBe(true);
    expect(resolveOreResource("raw_iron")).toBe("iron");
    expect(resolveOreResource("minecraft:deepslate_diamond_ore")).toBe("diamond");
    expect(resolveOreResource("lapis_lazuli")).toBe("lapis");
    expect(resolveOreResource("dirt")).toBeUndefined();
  });

  it("documents search bands as ranges, not guaranteed veins", () => {
    const coal = getOreProfile("coal")!;
    expect(coal.totalMinY).toBe(0);
    expect(isYInOreRange("coal", -8)).toBe(false);
    expect(isYInPreferredSearchBand("coal", 64)).toBe(true);
    expect(oreSearchHints("coal").join(" ")).toMatch(/not a deposit|search band/i);

    const iron = getOreProfile("iron")!;
    expect(iron.preferredSearchMinY).toBeLessThanOrEqual(16);
    expect(iron.preferredSearchMaxY).toBeGreaterThanOrEqual(16);
    expect(isYInOreRange("diamond", 40)).toBe(false);
    expect(isYInOreRange("diamond", -59)).toBe(true);
  });

  it("restricts emerald to mountain biomes and bonuses copper/gold", () => {
    expect(biomeSupportsOre("emerald", "plains")).toBe(false);
    expect(biomeSupportsOre("emerald", "minecraft:jagged_peaks")).toBe(true);
    expect(biomeSupportsOre("coal", "plains")).toBe(true);
    expect(getOreProfile("copper")?.biomeBonus).toContain("dripstone_caves");
    expect(getOreProfile("gold")?.biomeBonus).toContain("badlands");
  });

  it("lists drops a citizen can actually pick up", () => {
    expect(oreDropsFor("coal")).toEqual(expect.arrayContaining(["coal"]));
    expect(oreDropsFor("iron")).toEqual(expect.arrayContaining(["raw_iron"]));
    expect(oreDropsFor("copper")).toEqual(expect.arrayContaining(["raw_copper"]));
    expect(oreBlocksFor("iron")).toEqual(["iron_ore", "deepslate_iron_ore"]);
  });
});

describe("ore harvest tiers vs minecraft-data 1.21.x", () => {
  it("matches wiki pickaxe tiers against harvestTools", () => {
    expect(requiredPickaxeTier("coal")).toBe("wooden");
    expect(requiredPickaxeTier("iron")).toBe("stone");
    expect(requiredPickaxeTier("copper")).toBe("stone");
    expect(requiredPickaxeTier("lapis")).toBe("stone");
    expect(requiredPickaxeTier("gold")).toBe("iron");
    expect(requiredPickaxeTier("redstone")).toBe("iron");
    expect(requiredPickaxeTier("diamond")).toBe("iron");
    expect(requiredPickaxeTier("emerald")).toBe("iron");

    expect(knowledge.canHarvest("coal_ore", "wooden_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("iron_ore", "wooden_pickaxe")).toBe(false);
    expect(knowledge.canHarvest("iron_ore", "stone_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("gold_ore", "stone_pickaxe")).toBe(false);
    expect(knowledge.canHarvest("gold_ore", "iron_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("diamond_ore", "iron_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("emerald_ore", "iron_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("copper_ore", "stone_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("lapis_ore", "stone_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("redstone_ore", "iron_pickaxe")).toBe(true);
  });

  it("treats golden pickaxes as wood-tier for harvest, not stone", () => {
    expect(pickaxeMeetsTier("golden_pickaxe", "wooden")).toBe(true);
    expect(pickaxeMeetsTier("golden_pickaxe", "stone")).toBe(false);
    expect(knowledge.canHarvest("coal_ore", "golden_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("iron_ore", "golden_pickaxe")).toBe(false);
  });

  it("applies the same harvest rules to deepslate variants", () => {
    expect(knowledge.canHarvest("deepslate_iron_ore", "wooden_pickaxe")).toBe(false);
    expect(knowledge.canHarvest("deepslate_iron_ore", "stone_pickaxe")).toBe(true);
    expect(knowledge.canHarvest("deepslate_diamond_ore", "stone_pickaxe")).toBe(false);
    expect(knowledge.canHarvest("deepslate_diamond_ore", "iron_pickaxe")).toBe(true);
  });

  it("loads a 1.21 family dataset that contains the ore blocks", () => {
    expect(knowledge.version.startsWith("1.21")).toBe(true);
    for (const block of ["coal_ore", "iron_ore", "copper_ore", "gold_ore", "redstone_ore", "lapis_ore", "diamond_ore", "emerald_ore"]) {
      expect(knowledge.getBlock(block)?.name).toBe(block);
    }
  });
});
