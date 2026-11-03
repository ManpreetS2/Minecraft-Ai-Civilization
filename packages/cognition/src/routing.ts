import type { DecisionCategory } from "@civ/shared";

export type RoutingContext = {
  lethalDanger: boolean;
  continuingObviousSkill: boolean;
  ordinaryChoice: boolean;
  majorResourceConflict?: boolean;
  occupationChange?: boolean;
  migration?: boolean;
  seriousRelationshipEvent?: boolean;
  difficultTradeoff?: boolean;
  betrayal?: boolean;
  deathOfCloseRelationship?: boolean;
  majorIdentityChange?: boolean;
  institutionalCrisis?: boolean;
};

export type RoutingDecision = {
  category: DecisionCategory;
  reason: string;
  /** Capability profile hint — not a hard-coded provider name. */
  profile: "none" | "fast" | "balanced" | "deep";
};

/**
 * Classify cognition request cost/depth.
 * Provider selection stays inside ModelRouter via profiles — no provider names here.
 */
export function classifyDecisionCategory(ctx: RoutingContext): RoutingDecision {
  if (ctx.lethalDanger || ctx.continuingObviousSkill) {
    return {
      category: "NO_LLM",
      reason: ctx.lethalDanger ? "immediate lethal reflex" : "obvious skill continuation",
      profile: "none",
    };
  }
  if (
    ctx.betrayal ||
    ctx.deathOfCloseRelationship ||
    ctx.majorIdentityChange ||
    ctx.institutionalCrisis
  ) {
    return { category: "DEEP_REFLECTION", reason: "rare high-stakes reflection", profile: "deep" };
  }
  if (
    ctx.majorResourceConflict ||
    ctx.occupationChange ||
    ctx.migration ||
    ctx.seriousRelationshipEvent ||
    ctx.difficultTradeoff
  ) {
    return { category: "IMPORTANT", reason: "major tradeoff / relationship / migration", profile: "balanced" };
  }
  return { category: "ROUTINE", reason: "ordinary high-level choice", profile: "fast" };
}

export type CognitionUsageStats = {
  citizenId: string;
  calls: number;
  byCategory: Record<DecisionCategory, number>;
  estimatedTokens: number;
  lastProvider?: string;
  lastModel?: string;
  fallbackUsedCount: number;
};

export function emptyUsageStats(citizenId: string): CognitionUsageStats {
  return {
    citizenId,
    calls: 0,
    byCategory: { NO_LLM: 0, ROUTINE: 0, IMPORTANT: 0, DEEP_REFLECTION: 0 },
    estimatedTokens: 0,
    fallbackUsedCount: 0,
  };
}

export function recordUsage(
  stats: CognitionUsageStats,
  patch: {
    category: DecisionCategory;
    estimatedTokens?: number;
    provider?: string;
    model?: string;
    fallbackUsed?: boolean;
  },
): CognitionUsageStats {
  const next = {
    ...stats,
    byCategory: { ...stats.byCategory },
    calls: stats.calls + (patch.category === "NO_LLM" ? 0 : 1),
    estimatedTokens: stats.estimatedTokens + (patch.estimatedTokens ?? 0),
    lastProvider: patch.provider ?? stats.lastProvider,
    lastModel: patch.model ?? stats.lastModel,
    fallbackUsedCount: stats.fallbackUsedCount + (patch.fallbackUsed ? 1 : 0),
  };
  next.byCategory[patch.category] += 1;
  return next;
}
