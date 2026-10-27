import { describe, expect, it } from "vitest";
import {
  COLONY_PROTECTED_ENTITIES,
  COLONY_WORLD_POLICY,
  hostilePurgeCommands,
  isColonyForbiddenCommand,
} from "./colony-world.js";

describe("colony world policy", () => {
  it("disables natural monsters without Peaceful or doMobSpawning false", () => {
    expect(COLONY_WORLD_POLICY.spawnMonsters).toBe(false);
    expect(COLONY_WORLD_POLICY.neverPeaceful).toBe(true);
    expect(COLONY_WORLD_POLICY.difficulty).toBe("easy");
    expect(COLONY_WORLD_POLICY.doMobSpawning).toBe(true);
    expect(COLONY_WORLD_POLICY.keepHunger).toBe(true);
    expect(COLONY_WORLD_POLICY.keepPassiveAnimals).toBe(true);
    expect(COLONY_WORLD_POLICY.keepVillagers).toBe(true);
    expect(COLONY_WORLD_POLICY.keepDayNight).toBe(true);
    expect(isColonyForbiddenCommand("difficulty peaceful")).toBe(true);
    expect(isColonyForbiddenCommand("gamerule doMobSpawning false")).toBe(true);
    expect(isColonyForbiddenCommand("difficulty easy")).toBe(false);
    expect(isColonyForbiddenCommand("gamerule doMobSpawning true")).toBe(false);
  });

  it("purges hostiles once without touching villagers or animals", () => {
    const commands = hostilePurgeCommands().join("\n");
    expect(commands).toContain("minecraft:zombie");
    expect(commands).toContain("minecraft:skeleton");
    expect(commands).toContain("minecraft:creeper");
    for (const name of COLONY_PROTECTED_ENTITIES) {
      expect(commands).not.toContain(`minecraft:${name}]`);
    }
  });
});
