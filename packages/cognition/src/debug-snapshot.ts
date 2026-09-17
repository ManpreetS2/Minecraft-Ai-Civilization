import type { BoundedDecision } from "./decision-contract.js";
import type { GuardResult } from "./fact-guards.js";
import type { CognitionMode } from "./router.js";

export type ObserverDebugSnapshot = {
  inputFacts: {
    citizenId: string;
    hunger?: number;
    health?: number;
    personalFoodCount?: number;
    settlementFoodReserve?: number;
    settlementNeeds: string[];
    nearbyHostiles: string[];
    directiveId?: string;
  };
  retrievedMemories: string[];
  retrievedLessons: string[];
  goalChosen?: string;
  followUpGoals?: string[];
  shortReason?: string;
  decisionFactors: string[];
  validation: GuardResult;
  model?: string;
  latencyMs?: number;
  mode?: CognitionMode;
};

export function observerDebugSnapshot(args: {
  citizenId: string;
  hunger?: number;
  health?: number;
  personalFoodCount?: number;
  settlementFoodReserve?: number;
  settlementNeeds?: string[];
  nearbyHostiles?: string[];
  directiveId?: string;
  memories?: string[];
  lessons?: string[];
  decision?: BoundedDecision;
  validation: GuardResult;
  factors?: string[];
  model?: string;
  latencyMs?: number;
  mode?: CognitionMode;
}): ObserverDebugSnapshot {
  return {
    inputFacts: {
      citizenId: args.citizenId,
      hunger: args.hunger,
      health: args.health,
      personalFoodCount: args.personalFoodCount,
      settlementFoodReserve: args.settlementFoodReserve,
      settlementNeeds: args.settlementNeeds ?? [],
      nearbyHostiles: args.nearbyHostiles ?? [],
      directiveId: args.directiveId,
    },
    retrievedMemories: (args.memories ?? []).slice(0, 8),
    retrievedLessons: (args.lessons ?? []).slice(0, 6),
    goalChosen: args.decision?.primaryGoal,
    followUpGoals: args.decision?.followUpGoals,
    shortReason: args.decision?.reason,
    decisionFactors: args.factors ?? [],
    validation: args.validation,
    model: args.model,
    latencyMs: args.latencyMs,
    mode: args.mode,
  };
}
