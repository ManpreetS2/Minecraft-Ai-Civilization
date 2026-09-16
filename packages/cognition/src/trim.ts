import type { CognitionContext } from "@civ/psychology";

export type TrimmedContext = CognitionContext & {
  charCount: number;
  trimmed: boolean;
};

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Deterministic context budget. Favors urgent state over background history.
 * Never dumps lifetime memory, full event logs, or raw SQLite.
 */
export function trimCognitionContext(ctx: CognitionContext, contextSize = 8192): TrimmedContext {
  const inputBudgetChars = Math.max(480, Math.floor(contextSize * 0.4 * CHARS_PER_TOKEN));
  const next: CognitionContext = {
    ...ctx,
    inventorySummary: ctx.inventorySummary.slice(0, 8),
    relevantMemories: [...ctx.relevantMemories]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 6),
    relevantSocialBeliefs: ctx.relevantSocialBeliefs.slice(0, 4),
    learnedAssociations: [...ctx.learnedAssociations]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5),
    habits: ctx.habits.slice(0, 4),
    recentImportantEvents: ctx.recentImportantEvents.slice(0, 4),
    settlementNeeds: ctx.settlementNeeds.slice(0, 6),
    immediateNeeds: {
      ...ctx.immediateNeeds,
      concerns: ctx.immediateNeeds.concerns.slice(0, 4),
    },
  };

  let packed = pack(next);
  const overBudget = packed.length > inputBudgetChars;
  if (overBudget) {
    next.habits = [];
    next.activityFamiliarity = pickTopActivities(next.activityFamiliarity, 3);
    next.relevantMemories = next.relevantMemories.slice(0, 4);
    next.relevantSocialBeliefs = next.relevantSocialBeliefs.slice(0, 2);
    packed = pack(next);
  }
  if (packed.length > inputBudgetChars) {
    next.recentImportantEvents = next.recentImportantEvents.slice(0, 2);
    next.learnedAssociations = next.learnedAssociations.slice(0, 3);
    next.inventorySummary = next.inventorySummary.slice(0, 4);
  }

  return { ...next, charCount: pack(next).length, trimmed: overBudget || packed.length > inputBudgetChars };
}

function pack(ctx: CognitionContext): string {
  return JSON.stringify({
    citizen: ctx.citizen,
    needs: ctx.immediateNeeds,
    goal: ctx.currentGoal,
    task: ctx.currentTask,
    inventory: ctx.inventorySummary,
    nearby: ctx.nearbyWorldState.entities,
    mood: {
      valence: ctx.mood.moodValence,
      stress: ctx.mood.stress,
      fear: ctx.mood.fear,
      anger: ctx.mood.anger,
      sadness: ctx.mood.sadness,
      positive: ctx.mood.positiveAffect,
      confidence: ctx.mood.confidence,
    },
    memories: ctx.relevantMemories,
    social: ctx.relevantSocialBeliefs,
    associations: ctx.learnedAssociations.map((a) => `${a.subjectKey}:${a.associationType}:${a.strength.toFixed(2)}`),
    habits: ctx.habits,
    events: ctx.recentImportantEvents,
    settlement: ctx.settlementNeeds,
    uncertainties: ctx.uncertainties,
  });
}

function pickTopActivities(
  activities: CognitionContext["activityFamiliarity"],
  limit: number,
): CognitionContext["activityFamiliarity"] {
  return Object.fromEntries(
    Object.entries(activities)
      .sort((a, b) => b[1].familiarity - a[1].familiarity)
      .slice(0, limit),
  );
}
