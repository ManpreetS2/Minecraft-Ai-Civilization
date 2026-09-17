import type { CitizenCognitiveSnapshot } from "./mind.js";
import type { LearnedAssociation, Habit, SocialBelief, CitizenPsychState } from "./types.js";

export type MindSnapshot = {
  citizenId: string;
  deceased: boolean;
  mood: Pick<CitizenPsychState, "moodValence" | "stress" | "fear" | "confidence" | "currentConcerns">;
  activeEmotions: { dominant: string; intensity: number };
  topAssociations: Array<Pick<LearnedAssociation, "subjectKey" | "associationType" | "strength" | "confidence">>;
  habits: Array<Pick<Habit, "contextKey" | "action" | "strength">>;
  importantGoals: string[];
  activeObligationIds: string[];
  relevantRelationships: Array<Pick<SocialBelief, "targetCitizenId" | "familiarity" | "confidence">>;
  recentMeaningfulMemoryIds: string[];
};

export function compactMindSnapshot(
  snap: CitizenCognitiveSnapshot,
  extras: { obligationIds?: string[]; currentGoal?: string } = {},
): MindSnapshot {
  const intensity = Math.max(snap.psych.fear, snap.psych.stress, snap.psych.anger, snap.psych.sadness, snap.psych.positiveAffect);
  return {
    citizenId: snap.citizenId,
    deceased: snap.deceased,
    mood: {
      moodValence: snap.psych.moodValence,
      stress: snap.psych.stress,
      fear: snap.psych.fear,
      confidence: snap.psych.confidence,
      currentConcerns: snap.psych.currentConcerns.slice(0, 3),
    },
    activeEmotions: { dominant: intensityDominant(snap.psych), intensity },
    topAssociations: [...snap.associations]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5)
      .map((row) => ({
        subjectKey: row.subjectKey,
        associationType: row.associationType,
        strength: row.strength,
        confidence: row.confidence,
      })),
    habits: snap.habits
      .slice()
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .map((row) => ({ contextKey: row.contextKey, action: row.action, strength: row.strength })),
    importantGoals: extras.currentGoal ? [extras.currentGoal] : [],
    activeObligationIds: extras.obligationIds ?? [],
    relevantRelationships: snap.beliefs
      .filter((b) => b.familiarity > 0.05 || b.confidence > 0.05)
      .slice(0, 6)
      .map((b) => ({ targetCitizenId: b.targetCitizenId, familiarity: b.familiarity, confidence: b.confidence })),
    recentMeaningfulMemoryIds: snap.memories.filter((m) => m.importance >= 0.45).slice(0, 6).map((m) => m.id),
  };
}

function intensityDominant(psych: CitizenPsychState): string {
  const entries: Array<[string, number]> = [
    ["fear", psych.fear],
    ["stress", psych.stress],
    ["anger", psych.anger],
    ["sadness", psych.sadness],
    ["joy", psych.positiveAffect],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return (entries[0]?.[1] ?? 0) > 0.25 ? entries[0]![0] : "neutral";
}
