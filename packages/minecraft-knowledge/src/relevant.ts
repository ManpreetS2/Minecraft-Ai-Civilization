export type RelevantGameKnowledge = {
  goal?: string;
  facts: string[];
  source: "minecraft-mechanics";
};

export type RelevantQuery = {
  goal?: string;
  nearbyBlocks?: string[];
  nearbyEntities?: string[];
  inventory?: Array<{ name: string; count: number }>;
  hunger?: number;
  hasPickaxe?: boolean;
  hasCraftingTableNearby?: boolean;
};

export function compactFacts(facts: string[], limit = 8): string[] {
  return [...new Set(facts.filter(Boolean))].slice(0, limit);
}
