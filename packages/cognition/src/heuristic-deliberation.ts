import { FOOD_ITEM_NAMES } from "@civ/shared";
import type { CognitionContext } from "@civ/psychology";
import type { CognitionDecision } from "./schema.js";
import { personalEdibleCount } from "./fact-guards.js";

function inventoryLinesToItems(lines: string[]): Array<{ name: string; count: number }> {
  return lines.map((line) => {
    const match = line.match(/^(.*?)(?:\s+x(\d+))?$/i);
    return { name: (match?.[1] ?? line).trim(), count: Number(match?.[2] ?? 1) };
  });
}

/**
 * Deterministic high-level fallback. Does not pick trees or block actions.
 * Personal edible inventory is never confused with settlement food reserves.
 */
export function heuristicDeliberation(ctx: CognitionContext, peerGoals: string[] = []): CognitionDecision {
  const hunger = ctx.immediateNeeds.hunger ?? 20;
  const nearby = ctx.nearbyWorldState.entities;
  const items = inventoryLinesToItems(ctx.inventorySummary);
  const personalFood = personalEdibleCount(items) > 0 || ctx.inventorySummary.some((line) => [...FOOD_ITEM_NAMES].some((name) => line.includes(name)));

  if (hunger <= 10 && !personalFood) {
    return { goal: "gather_food", priority: 0.8, reason: "Personal hunger is rising and no edible items are carried." };
  }
  if (hunger <= 10 && personalFood) {
    return { goal: "rest", priority: 0.7, reason: "Hunger is low but edible food is already carried; eating is a reflex/runtime concern." };
  }
  if (ctx.settlementNeeds.includes("NEED_FOOD") && personalFood) {
    const alternative = pickUnused(
      ["gather_wood", "mine_stone", "contribute_to_project", "craft_tools"],
      peerGoals,
      ctx,
    );
    return {
      goal: alternative,
      priority: 0.62,
      reason: "Settlement food reserves are low, but this citizen already carries food, so they can do other work.",
    };
  }
  if (ctx.settlementNeeds.includes("NEED_WOOD")) {
    return {
      goal: pickUnused(["gather_wood", "contribute_to_project", "craft_tools"], peerGoals, ctx),
      priority: 0.7,
      reason: "The settlement still needs wood for ongoing work.",
    };
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

function pickUnused(
  candidates: CognitionDecision["goal"][],
  peerGoals: string[],
  ctx: CognitionContext,
): CognitionDecision["goal"] {
  const familiar = Object.values(ctx.activityFamiliarity).sort((a, b) => b.familiarity - a.familiarity)[0]?.activity;
  const preferred = candidates.find((goal) => goal === familiar && !peerGoals.includes(goal));
  if (preferred) return preferred;
  const unused = candidates.find((goal) => !peerGoals.includes(goal));
  return unused ?? candidates[0] ?? "reconsider";
}
