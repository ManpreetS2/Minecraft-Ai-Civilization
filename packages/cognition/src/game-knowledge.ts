import type { RelevantGameKnowledge } from "./context-builder.js";
import type { Goal } from "./goals.js";

export type GameKnowledgeQuery = {
  goal?: string;
  nearbyBlocks?: string[];
  nearbyEntities?: string[];
  inventory?: Array<{ name: string; count: number }>;
  hunger?: number;
  hasPickaxe?: boolean;
  hasCraftingTableNearby?: boolean;
};

/**
 * Injected after merge with @civ/minecraft-knowledge.
 * Cognition does not duplicate mechanics tables.
 */
export type GameKnowledgeProvider = {
  getRelevantRules(query: GameKnowledgeQuery): RelevantGameKnowledge;
};

export function inventoryHasPickaxe(inventory: Array<{ name: string; count: number }> | string[]): boolean {
  return inventory.some((item) => {
    const name = typeof item === "string" ? item : item.name;
    const count = typeof item === "string" ? 1 : item.count;
    return count > 0 && /pickaxe/i.test(name);
  });
}

export function adaptMinecraftKnowledge(source: {
  getRelevantRules(query: GameKnowledgeQuery): RelevantGameKnowledge;
}): GameKnowledgeProvider {
  return { getRelevantRules: (query) => source.getRelevantRules(query) };
}

export type MechanicsContradiction = {
  contradicts: boolean;
  reason?: string;
  suggestedGoal?: Goal;
};

/**
 * Reject or reconsider a high-level goal that fights known mechanics.
 * The planner still owns prerequisite expansion after this flag.
 */
export function decisionContradictsMechanics(
  goal: string,
  inventory: Array<{ name: string; count: number }>,
  knowledge?: GameKnowledgeProvider,
): MechanicsContradiction {
  const hasPickaxe = inventoryHasPickaxe(inventory);
  if ((goal === "mine_stone" || goal.includes("stone")) && !hasPickaxe) {
    const facts = knowledge?.getRelevantRules({ goal, inventory, hasPickaxe }).facts ?? [
      "Stone normally requires a pickaxe to collect.",
    ];
    return {
      contradicts: true,
      reason: facts.find((fact) => /pickaxe/i.test(fact)) ?? "Stone collection needs a usable pickaxe.",
      suggestedGoal: "craft_tools",
    };
  }
  return { contradicts: false };
}
