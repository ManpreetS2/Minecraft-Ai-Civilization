/**
 * Version-aware Overworld ore knowledge for Minecraft Java 1.21.x.
 *
 * Sources (generation, not coordinates of any world):
 * - https://minecraft.wiki/w/Ore — Java 1.18+ distribution table (still the
 *   current 1.21.11 table; 1.20.2 added extra diamond below Y=0).
 * - https://minecraft.wiki/w/Ore_(feature) — blob features and air-exposure discard.
 * - minecraft-data harvestTools for the loaded 1.21 family (authoritative tool tier).
 *
 * Search elevations are statistical generation bands. They are not a guarantee
 * that a given chunk contains that ore. Hidden blocks are never part of this API.
 */

export const ORE_RESOURCES = [
  "coal",
  "iron",
  "copper",
  "gold",
  "redstone",
  "lapis",
  "diamond",
  "emerald",
] as const;

export type OreResource = (typeof ORE_RESOURCES)[number];

export type PickaxeTier = "wooden" | "stone" | "iron";

export type OreSearchApproach = "surface_exposures" | "cave_explore" | "mountain_cliffs" | "deepslate_caves";

export type OreGenerationBatch = {
  /** Inclusive Y range from worldgen, not a promised vein. */
  minY: number;
  maxY: number;
  /** Empirical wiki "most found" layer. Never treat as a deposit coordinate. */
  peakY: number;
  shape: "triangle" | "uniform";
  note: string;
};

export type OreProfile = {
  resource: OreResource;
  displayName: string;
  blocks: string[];
  drops: string[];
  /** Silk Touch can drop the ore block itself. */
  silkTouchDrops: string[];
  requiredPickaxeTier: PickaxeTier;
  generation: OreGenerationBatch[];
  totalMinY: number;
  totalMaxY: number;
  preferredSearchMinY: number;
  preferredSearchMaxY: number;
  biomeRestriction?: string[];
  biomeBonus?: string[];
  approaches: OreSearchApproach[];
  hazards: string[];
  observable: string[];
  searchNotes: string[];
};

const MOUNTAIN_BIOMES = [
  "meadow",
  "cherry_grove",
  "grove",
  "snowy_slopes",
  "jagged_peaks",
  "frozen_peaks",
  "stony_peaks",
  "windswept_hills",
  "windswept_gravelly_hills",
  "windswept_forest",
];

const BADLANDS_BIOMES = ["badlands", "wooded_badlands", "eroded_badlands"];

const PROFILES: Record<OreResource, OreProfile> = {
  coal: {
    resource: "coal",
    displayName: "coal",
    blocks: ["coal_ore", "deepslate_coal_ore"],
    drops: ["coal"],
    silkTouchDrops: ["coal_ore", "deepslate_coal_ore"],
    requiredPickaxeTier: "wooden",
    generation: [
      { minY: 136, maxY: 320, peakY: 136, shape: "triangle", note: "Upper mountain batch; air exposure often culls surface veins." },
      { minY: 0, maxY: 192, peakY: 45, shape: "uniform", note: "Lower batch; wiki empirical peak near Y=45. Does not generate below Y=0." },
    ],
    totalMinY: 0,
    totalMaxY: 320,
    preferredSearchMinY: 32,
    preferredSearchMaxY: 96,
    approaches: ["surface_exposures", "cave_explore", "mountain_cliffs"],
    hazards: ["falling_gravel", "hostile_mobs"],
    observable: ["exposed coal on cliff faces, cave walls, and river cuts", "stone/deepslate terrain in the search band"],
    searchNotes: [
      "Walk hills and cave mouths near Y=45–96 looking for exposed coal.",
      "A mountain batch exists above Y=136; still not a guaranteed deposit.",
      "Do not dig below Y=0 expecting coal.",
    ],
  },
  iron: {
    resource: "iron",
    displayName: "iron",
    blocks: ["iron_ore", "deepslate_iron_ore"],
    drops: ["raw_iron"],
    silkTouchDrops: ["iron_ore", "deepslate_iron_ore"],
    requiredPickaxeTier: "stone",
    generation: [
      { minY: -24, maxY: 56, peakY: 16, shape: "triangle", note: "Small underground batch; wiki empirical peak near Y=14–16." },
      { minY: -64, maxY: 72, peakY: 16, shape: "triangle", note: "Medium batch spanning into deepslate." },
      { minY: 80, maxY: 320, peakY: 232, shape: "triangle", note: "Mountain batch; look at high stone cliffs, not underground." },
    ],
    totalMinY: -64,
    totalMaxY: 320,
    preferredSearchMinY: 8,
    preferredSearchMaxY: 24,
    approaches: ["cave_explore", "mountain_cliffs"],
    hazards: ["lava", "falls", "hostile_mobs"],
    observable: ["exposed iron in cave walls near Y=16", "iron on mountain stone faces above Y=80"],
    searchNotes: [
      "Explore caves around Y=16 or climb mountain stone above Y=80.",
      "A gap around Y=73–79 has little iron generation.",
      "Deepslate iron still requires a stone pickaxe or better.",
    ],
  },
  copper: {
    resource: "copper",
    displayName: "copper",
    blocks: ["copper_ore", "deepslate_copper_ore"],
    drops: ["raw_copper"],
    silkTouchDrops: ["copper_ore", "deepslate_copper_ore"],
    requiredPickaxeTier: "stone",
    generation: [{ minY: -16, maxY: 112, peakY: 48, shape: "triangle", note: "Triangle peaking near Y=48; larger blobs in dripstone caves." }],
    totalMinY: -16,
    totalMaxY: 112,
    preferredSearchMinY: 32,
    preferredSearchMaxY: 64,
    biomeBonus: ["dripstone_caves"],
    approaches: ["cave_explore"],
    hazards: ["lava", "dripstone", "falls"],
    observable: ["exposed copper in mid-elevation caves", "granite/tuff adjacent to copper veins"],
    searchNotes: [
      "Cave-explore around Y=48. Dripstone caves are a bonus, not a teleport target.",
      "Does not generate above Y=112 or below Y=-16.",
    ],
  },
  gold: {
    resource: "gold",
    displayName: "gold",
    blocks: ["gold_ore", "deepslate_gold_ore"],
    drops: ["raw_gold"],
    silkTouchDrops: ["gold_ore", "deepslate_gold_ore"],
    requiredPickaxeTier: "iron",
    generation: [
      { minY: -64, maxY: 32, peakY: -16, shape: "triangle", note: "All biomes; wiki empirical peak near Y=-18." },
      { minY: 32, maxY: 256, peakY: 32, shape: "uniform", note: "Extra Badlands batch from Y=32 to 256." },
    ],
    totalMinY: -64,
    totalMaxY: 256,
    preferredSearchMinY: -32,
    preferredSearchMaxY: 0,
    biomeBonus: BADLANDS_BIOMES,
    approaches: ["deepslate_caves", "cave_explore"],
    hazards: ["lava", "falls", "hostile_mobs"],
    observable: ["exposed gold in deep caves", "gold in Badlands surface stone"],
    searchNotes: [
      "In most biomes search deep caves near Y=-16, watching for lava.",
      "Badlands add high gold; plains/forest do not get that bonus.",
    ],
  },
  redstone: {
    resource: "redstone",
    displayName: "redstone",
    blocks: ["redstone_ore", "deepslate_redstone_ore"],
    drops: ["redstone"],
    silkTouchDrops: ["redstone_ore", "deepslate_redstone_ore"],
    requiredPickaxeTier: "iron",
    generation: [
      { minY: -64, maxY: 15, peakY: -59, shape: "uniform", note: "Uniform deep batch." },
      { minY: -64, maxY: -32, peakY: -64, shape: "triangle", note: "Extra deep triangle; shares the diamond floor." },
    ],
    totalMinY: -64,
    totalMaxY: 16,
    preferredSearchMinY: -64,
    preferredSearchMaxY: -48,
    approaches: ["deepslate_caves"],
    hazards: ["lava", "deepslate_slow_mining", "falls"],
    observable: ["exposed redstone on deepslate cave walls", "glow when walked on or clicked"],
    searchNotes: [
      "Deepslate caves near Y=-59. Lava lakes are common; never dig straight down.",
      "Does not generate above Y=16.",
    ],
  },
  lapis: {
    resource: "lapis",
    displayName: "lapis lazuli",
    blocks: ["lapis_ore", "deepslate_lapis_ore"],
    drops: ["lapis_lazuli"],
    silkTouchDrops: ["lapis_ore", "deepslate_lapis_ore"],
    requiredPickaxeTier: "stone",
    generation: [
      { minY: -32, maxY: 32, peakY: 0, shape: "triangle", note: "Exposed-friendly triangle peaking near Y=0." },
      { minY: -64, maxY: 64, peakY: -2, shape: "uniform", note: "Buried batch; air-exposed copies are often discarded." },
    ],
    totalMinY: -64,
    totalMaxY: 64,
    preferredSearchMinY: -16,
    preferredSearchMaxY: 16,
    approaches: ["cave_explore"],
    hazards: ["lava", "water"],
    observable: ["exposed lapis near sea-level caves"],
    searchNotes: [
      "Cave-explore around Y=0. Buried lapis is not legitimately visible until a face is exposed.",
      "Does not generate above Y=64.",
    ],
  },
  diamond: {
    resource: "diamond",
    displayName: "diamond",
    blocks: ["diamond_ore", "deepslate_diamond_ore"],
    drops: ["diamond"],
    silkTouchDrops: ["diamond_ore", "deepslate_diamond_ore"],
    requiredPickaxeTier: "iron",
    generation: [
      { minY: -64, maxY: 16, peakY: -59, shape: "triangle", note: "Main triangle peaking at bedrock. Air exposure reduces cave diamonds." },
      { minY: -64, maxY: -4, peakY: -59, shape: "uniform", note: "Extra buried diamonds added in 1.20.2; still not a coordinate leak." },
    ],
    totalMinY: -64,
    totalMaxY: 16,
    preferredSearchMinY: -64,
    preferredSearchMaxY: -48,
    approaches: ["deepslate_caves"],
    hazards: ["lava", "deepslate_slow_mining", "falls", "void_near_bedrock"],
    observable: ["exposed diamond on deepslate cave walls", "adjacent redstone at the same depth"],
    searchNotes: [
      "Search deepslate caves near Y=-59. Branch just above lava, never straight down.",
      "Air-exposed diamond is reduced; a cave trip can still fail inside the budget.",
    ],
  },
  emerald: {
    resource: "emerald",
    displayName: "emerald",
    blocks: ["emerald_ore", "deepslate_emerald_ore"],
    drops: ["emerald"],
    silkTouchDrops: ["emerald_ore", "deepslate_emerald_ore"],
    requiredPickaxeTier: "iron",
    generation: [{ minY: -16, maxY: 320, peakY: 85, shape: "triangle", note: "Scattered mountain blocks; frequency rises with height." }],
    totalMinY: -16,
    totalMaxY: 320,
    preferredSearchMinY: 64,
    preferredSearchMaxY: 256,
    biomeRestriction: MOUNTAIN_BIOMES,
    approaches: ["mountain_cliffs", "surface_exposures"],
    hazards: ["falls", "powder_snow", "hostile_mobs"],
    observable: ["single exposed emeralds on mountain stone", "mountain/windswept biome terrain"],
    searchNotes: [
      "Only mountain and windswept biomes. Plains and forest searches should be abandoned.",
      "Look at cliff faces rather than strip-mining a meadow.",
    ],
  },
};

const BLOCK_TO_RESOURCE = new Map<string, OreResource>();
for (const profile of Object.values(PROFILES)) {
  for (const block of profile.blocks) BLOCK_TO_RESOURCE.set(block, profile.resource);
}

export function isOreResource(value: string): value is OreResource {
  return (ORE_RESOURCES as readonly string[]).includes(value);
}

export function resolveOreResource(name: string): OreResource | undefined {
  const n = name.trim().toLowerCase().replace(/^minecraft:/, "");
  if (n === "lapis_lazuli" || n === "lapis_ore" || n === "deepslate_lapis_ore") return "lapis";
  if (n === "raw_iron" || n === "iron_ingot") return "iron";
  if (n === "raw_copper" || n === "copper_ingot") return "copper";
  if (n === "raw_gold" || n === "gold_ingot") return "gold";
  if (n === "redstone_dust") return "redstone";
  if (isOreResource(n)) return n;
  return BLOCK_TO_RESOURCE.get(n);
}

export function getOreProfile(resource: string): OreProfile | undefined {
  const resolved = resolveOreResource(resource);
  return resolved ? PROFILES[resolved] : undefined;
}

export function oreBlocksFor(resource: string): string[] {
  return getOreProfile(resource)?.blocks ?? [];
}

export function oreDropsFor(resource: string): string[] {
  const profile = getOreProfile(resource);
  if (!profile) return [];
  return [...profile.drops, ...profile.silkTouchDrops];
}

export function requiredPickaxeTier(resource: string): PickaxeTier | undefined {
  return getOreProfile(resource)?.requiredPickaxeTier;
}

const TIER_RANK: Record<string, number> = {
  wooden: 1,
  golden: 1,
  stone: 2,
  iron: 3,
  diamond: 4,
  netherite: 5,
};

export function pickaxeTierRank(toolName: string | undefined): number {
  if (!toolName || !toolName.includes("pickaxe")) return 0;
  const prefix = toolName.split("_")[0] ?? "";
  return TIER_RANK[prefix] ?? 0;
}

export function pickaxeMeetsTier(toolName: string | undefined, required: PickaxeTier): boolean {
  const need = TIER_RANK[required] ?? 99;
  return pickaxeTierRank(toolName) >= need;
}

export function recommendedPickaxeItem(tier: PickaxeTier): string {
  return `${tier}_pickaxe`;
}

export function isYInOreRange(resource: string, y: number): boolean {
  const profile = getOreProfile(resource);
  if (!profile) return false;
  return y >= profile.totalMinY && y <= profile.totalMaxY;
}

export function isYInPreferredSearchBand(resource: string, y: number): boolean {
  const profile = getOreProfile(resource);
  if (!profile) return false;
  return y >= profile.preferredSearchMinY && y <= profile.preferredSearchMaxY;
}

export function biomeSupportsOre(resource: string, biome?: string): boolean {
  const profile = getOreProfile(resource);
  if (!profile) return false;
  if (!profile.biomeRestriction) return true;
  if (!biome) return true;
  const n = biome.replace(/^minecraft:/, "").toLowerCase();
  return profile.biomeRestriction.some((name) => n === name || n.includes(name));
}

export function biomeBonusForOre(resource: string, biome?: string): boolean {
  const profile = getOreProfile(resource);
  if (!profile?.biomeBonus || !biome) return false;
  const n = biome.replace(/^minecraft:/, "").toLowerCase();
  return profile.biomeBonus.some((name) => n === name || n.includes(name));
}

export function oreSearchHints(resource: string, biome?: string): string[] {
  const profile = getOreProfile(resource);
  if (!profile) return [`Unknown resource ${resource}.`];
  const hints = [
    `${profile.displayName} generates between Y=${profile.totalMinY} and Y=${profile.totalMaxY}; that is a search band, not a deposit.`,
    `Need a ${profile.requiredPickaxeTier} pickaxe or better to collect drops.`,
    ...profile.searchNotes,
  ];
  if (profile.biomeRestriction && biome && !biomeSupportsOre(resource, biome)) {
    hints.push(`${profile.displayName} does not generate in ${biome}.`);
  }
  if (biomeBonusForOre(resource, biome)) {
    hints.push(`${biome} increases ${profile.displayName} frequency.`);
  }
  return hints;
}

export function listOreProfiles(): OreProfile[] {
  return ORE_RESOURCES.map((resource) => PROFILES[resource]);
}
