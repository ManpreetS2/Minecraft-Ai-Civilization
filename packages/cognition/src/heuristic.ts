import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";

export class HeuristicProvider implements CognitionProvider {
  readonly name = "heuristic";

  async decide(prompt: CognitionPrompt): Promise<HighLevelDecision> {
    if (prompt.settlementNeeds.includes("NEED_FOOD") || (prompt.hunger ?? 20) < 12) {
      return { goal: "gather_food", priority: 0.82, reason: "Food is the most urgent remaining need" };
    }
    if (prompt.settlementNeeds.includes("NEED_HOUSING")) {
      return { goal: "build_shelter", priority: 0.78, reason: "The settlement still lacks a shared shelter" };
    }
    if (prompt.settlementNeeds.includes("NEED_WOOD")) {
      return { goal: "gather_wood", priority: 0.7, reason: "Wood is required for tools and building" };
    }
    if (prompt.settlementNeeds.includes("NEED_STONE")) {
      return { goal: "mine_stone", priority: 0.66, reason: "Stone tools and structure need cobblestone" };
    }
    if (prompt.nearbyCitizens.length > 0) {
      return { goal: "help_citizen", priority: 0.4, reason: "No crisis; help a nearby citizen if useful" };
    }
    return { goal: "explore", priority: 0.3, reason: "No urgent settlement need" };
  }
}
