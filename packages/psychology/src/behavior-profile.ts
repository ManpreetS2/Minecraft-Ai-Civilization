import { clamp01, type BehaviorObservations } from "@civ/memory";
import type { BehaviorProfile } from "./types.js";

function ratio(hits: number, total: number): number {
  if (total <= 0) return 0;
  return clamp01(hits / total);
}

function hedge(value: number, high: string, mid: string): string | undefined {
  if (value >= 0.7) return `often ${high}`;
  if (value >= 0.45) return `has tended to ${mid}`;
  return undefined;
}

/**
 * Observer-facing description of past behavior.
 * These numbers are not fed back as "you are a brave person".
 */
export function deriveBehaviorProfile(obs: BehaviorObservations): BehaviorProfile {
  const riskDenom = obs.dangerousAttempts + obs.dangerousAvoided;
  const observedRiskTaking = ratio(obs.dangerousAttempts, riskDenom);
  const observedPersistence = ratio(obs.retriesAfterFailure, Math.max(1, obs.taskFailures));
  const observedSociability = clamp01(obs.socialInteractions / Math.max(6, obs.totalTaskChoices + obs.socialInteractions));
  const observedCooperation = clamp01(obs.cooperativeActs / Math.max(3, obs.socialInteractions));
  const observedExploration = clamp01(obs.explorationActs / Math.max(4, obs.totalTaskChoices));
  const observedConflictTendency = clamp01(obs.conflictActs / Math.max(3, obs.socialInteractions + obs.conflictActs));
  const observedPreferenceForFamiliarTasks = ratio(obs.familiarTaskChoices, obs.totalTaskChoices);

  const phrases = [
    hedge(observedRiskTaking, "takes risks", "take risks"),
    hedge(observedPersistence, "persists after task failures", "retry after failures"),
    hedge(observedSociability, "seeks others out", "work near other citizens"),
    hedge(observedCooperation, "cooperates", "help others"),
    hedge(observedExploration, "explores", "wander"),
    hedge(observedConflictTendency, "enters conflict", "clash with others"),
    hedge(observedPreferenceForFamiliarTasks, "prefers familiar work", "stick to known tasks"),
  ].filter((item): item is string => Boolean(item));

  if (obs.dangerousAvoided >= 2 && observedRiskTaking < 0.4) {
    phrases.push("recently avoids some previously dangerous situations");
  }

  return {
    citizenId: obs.citizenId,
    observedRiskTaking,
    observedPersistence,
    observedSociability,
    observedCooperation,
    observedExploration,
    observedConflictTendency,
    observedPreferenceForFamiliarTasks,
    evidence: {
      dangerousAttempts: obs.dangerousAttempts,
      dangerousAvoided: obs.dangerousAvoided,
      retriesAfterFailure: obs.retriesAfterFailure,
      taskFailures: obs.taskFailures,
      socialInteractions: obs.socialInteractions,
      cooperativeActs: obs.cooperativeActs,
      conflictActs: obs.conflictActs,
      explorationActs: obs.explorationActs,
      familiarTaskChoices: obs.familiarTaskChoices,
      totalTaskChoices: obs.totalTaskChoices,
    },
    phrases,
  };
}
