import type { CognitionContext } from "@civ/psychology";
import type { CognitionDecision } from "./schema.js";
import { FOOD_ITEM_NAMES } from "@civ/shared";

/**
 * Deterministic high-level fallback. Does not pick trees or block actions.
 * Idle rest is a valid outcome.
 */
export function heuristicDeliberation(ctx: CognitionContext): CognitionDecision {
  const hunger = ctx.immediateNeeds.hunger ?? 20;
  const nearby = ctx.nearbyWorldState.entities;
  const hasFood = ctx.inventorySummary.some((line) => [...FOOD_ITEM_NAMES].some((name) => line.includes(name)));

  if (hunger <= 10 && ctx.settlementNeeds.includes("NEED_FOOD") && !hasFood) {
    return { goal: "gather_food", priority: 0.8, reason: "Food is scarce and hunger is becoming a problem." };
  }
  if (ctx.settlementNeeds.includes("NEED_WOOD")) {
    return { goal: "gather_wood", priority: 0.7, reason: "The settlement still needs wood for ongoing work." };
  }
  if (ctx.settlementNeeds.includes("NEED_STONE")) {
    return { goal: "mine_stone", priority: 0.66, reason: "Stone is still needed for tools and building." };
  }
  if (ctx.settlementNeeds.includes("NEED_HOUSING") || ctx.settlementNeeds.includes("NEED_TOOLS")) {
    return { goal: "contribute_to_project", priority: 0.64, reason: "An existing settlement need can use another pair of hands." };
  }

  const helpedBy = ctx.relevantSocialBeliefs.find((b) => /gave|help/i.test(b.evidenceSummary) && nearby.includes(b.targetId));
  if (helpedBy) {
    return {
      goal: "assist_citizen",
      priority: 0.48,
      reason: "Someone nearby has evidence of having helped recently.",
      targetCitizenId: helpedBy.targetId,
    };
  }

  const creeperFear = ctx.learnedAssociations.find((a) => a.subjectKey === "creeper" && a.strength >= 0.4);
  if (creeperFear && nearby.some((n) => n.toLowerCase().includes("creeper"))) {
    return { goal: "seek_safety", priority: 0.7, reason: "A known dangerous association is present nearby." };
  }

  if (ctx.currentGoal && Object.values(ctx.activityFamiliarity).some((a) => a.failures >= 3 && a.activity === ctx.currentGoal)) {
    return { goal: "reconsider", priority: 0.55, reason: "The current task has failed repeatedly." };
  }

  if (!ctx.currentGoal) {
    return { goal: "rest", priority: 0.25, reason: "No emergency and no current goal; remaining idle is acceptable." };
  }

  return { goal: "explore", priority: 0.3, reason: "No urgent need; a short local look around is enough." };
}
