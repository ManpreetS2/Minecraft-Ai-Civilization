import { HOSTILE_MOB_NAMES } from "./types.js";

/**
 * Civilization / colony world policy.
 * Natural hostile spawning is off. Survival hunger, animals, villagers, and day/night stay on.
 * Do not use Peaceful. Do not use `gamerule doMobSpawning false` as the colony lever
 * (that also stops animals). Use `spawn-monsters=false` plus monster spawn limits.
 */
export const COLONY_WORLD_POLICY = {
  difficulty: "easy",
  neverPeaceful: true,
  spawnMonsters: false,
  keepPassiveAnimals: true,
  keepVillagers: true,
  keepHunger: true,
  keepDayNight: true,
  /** Must stay true so animals/villagers can still spawn. */
  doMobSpawning: true,
  purgeExistingHostilesOnce: true,
} as const;

export const MONSTER_PURGE_TYPES = [
  ...HOSTILE_MOB_NAMES,
  "zombie_villager",
  "cave_spider",
  "magma_cube",
  "blaze",
  "ghast",
  "hoglin",
  "zoglin",
  "piglin_brute",
  "evoker",
  "vex",
  "silverfish",
  "endermite",
  "guardian",
  "elder_guardian",
  "shulker",
  "wither_skeleton",
  "zombified_piglin",
] as const;

export const COLONY_PROTECTED_ENTITIES = [
  "player",
  "villager",
  "wandering_trader",
  "iron_golem",
  "snow_golem",
  "cow",
  "pig",
  "chicken",
  "sheep",
  "horse",
  "donkey",
  "llama",
  "cat",
  "wolf",
  "allay",
] as const;

export function hostilePurgeCommands(): string[] {
  return [...new Set(MONSTER_PURGE_TYPES)].map((type) => `kill @e[type=minecraft:${type}]`);
}

/** Commands that would break colony survival mechanics. Test harnesses may still use them temporarily. */
export function isColonyForbiddenCommand(command: string): boolean {
  const c = command.trim().toLowerCase().replace(/\s+/g, " ");
  if (c === "difficulty peaceful" || c.startsWith("difficulty peaceful ")) return true;
  if (c.includes("gamerule domobspawning false")) return true;
  return false;
}
