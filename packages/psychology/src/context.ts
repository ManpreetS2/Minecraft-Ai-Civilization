import type { CognitiveStore, RetrievalQuery, StoredMemory, WorldSnapshot } from "@civ/memory";
import { retrieveMemories } from "@civ/memory";
import { associationFromRow } from "./associations.js";
import { activityFromRow } from "./activity.js";
import { dominantAffect, psychFromRow } from "./psych.js";
import { beliefFromRow } from "./social.js";
import type { CognitionContext } from "./types.js";

export type ContextInput = {
  citizenId: string;
  name?: string;
  currentGoal?: string;
  health?: number;
  hunger?: number;
  settlementNeeds?: string[];
  snapshot?: WorldSnapshot;
  query?: string;
};

/**
 * Rich context for high-level LLM decisions.
 * Does not dump the full citizen history.
 */
export function buildCognitionContext(store: CognitiveStore, input: ContextInput): CognitionContext {
  const identity = store.getIdentity(input.citizenId);
  const psych = psychFromRow(store.getPsych(input.citizenId));
  const memories = store.listDurableMemories(input.citizenId, 80);
  const self = input.snapshot?.citizens.find((c) => c.id === input.citizenId);
  const nearby = (input.snapshot?.citizens ?? [])
    .filter((c) => c.id !== input.citizenId && !c.deceased)
    .map((c) => c.name ?? c.id);
  const query: RetrievalQuery = {
    citizenId: input.citizenId,
    currentGoal: input.currentGoal,
    nearbyEntities: nearby,
    location: self?.position,
    currentMood: { valence: psych.moodValence, fear: psych.fear, stress: psych.stress },
    query: input.query ?? input.currentGoal,
    limit: 8,
  };
  const retrieved = retrieveMemories(memories, query);
  for (const item of retrieved) store.markRecalled(item.memory.id, psych.updatedAt);

  const associations = store.listAssociations(input.citizenId).map(associationFromRow);
  const activities = Object.fromEntries(store.listActivities(input.citizenId).map((row) => [row.activity, activityFromRow(row)]));
  const beliefs = store.listBeliefs(input.citizenId).map(beliefFromRow);
  const affect = dominantAffect(psych);
  const important = [...memories]
    .filter((m) => m.importance >= 0.45)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 6);

  const memoryConfidence =
    retrieved.length === 0 ? 0.2 : retrieved.reduce((sum, item) => sum + item.memory.confidence, 0) / retrieved.length;
  const uncertainty = clampUncertainty(1 - memoryConfidence, associations.length, retrieved.length, psych.confidence);

  return {
    citizen: { id: input.citizenId, name: input.name ?? identity?.name, deceased: identity?.deceased },
    immediateNeeds: {
      health: input.health,
      hunger: input.hunger,
      concerns: psych.currentConcerns.map((c) => c.description),
    },
    currentGoal: input.currentGoal,
    nearbyWorldState: { entities: nearby, location: self?.position },
    mood: psych,
    activeAffect: affect,
    relevantMemories: retrieved.map((item) => ({
      summary: item.memory.summary,
      importance: item.memory.importance,
      source: item.memory.source,
      eventType: item.memory.eventType,
    })),
    relevantSocialBeliefs: beliefs.slice(0, 6).map((belief) => ({
      targetId: belief.targetCitizenId,
      evidenceSummary: summarizeBelief(belief),
      familiarity: belief.familiarity,
      sourceNotes: [
        ...belief.knownFacts.slice(-2).map((f) => `${f.source}: ${f.text}`),
        ...belief.rumors.slice(-1).map((r) => `HEARD from ${r.informantId}: ${r.text}`),
      ],
    })),
    activityFamiliarity: activities,
    learnedAssociations: associations.filter((a) => a.strength >= 0.2).slice(0, 8),
    recentImportantEvents: important.map((m) => ({ summary: m.summary, timestamp: m.timestamp })),
    settlementNeeds: input.settlementNeeds ?? [],
    uncertainty,
  };
}

function summarizeBelief(belief: ReturnType<typeof beliefFromRow>): string {
  const latest = belief.knownFacts.at(-1)?.text ?? belief.rumors.at(-1)?.text;
  if (latest) return latest;
  return `familiarity ${belief.familiarity.toFixed(2)}`;
}

function clampUncertainty(base: number, associationCount: number, retrievedCount: number, confidence: number): number {
  let value = base;
  if (retrievedCount === 0) value += 0.2;
  if (associationCount === 0) value += 0.1;
  value -= confidence * 0.15;
  return Math.max(0, Math.min(1, value));
}

export function toLegacyPromptMemories(ctx: CognitionContext): string[] {
  return ctx.relevantMemories.slice(0, 8).map((m) => m.summary);
}

export function formatCognitionContext(ctx: CognitionContext): string {
  const lines = [
    `Citizen: ${ctx.citizen.name ?? ctx.citizen.id}`,
    `Needs: health=${ctx.immediateNeeds.health ?? "?"} hunger=${ctx.immediateNeeds.hunger ?? "?"}`,
    `Mood: valence=${ctx.mood.moodValence.toFixed(2)} stress=${ctx.mood.stress.toFixed(2)} fear=${ctx.mood.fear.toFixed(2)} (${ctx.activeAffect.dominant})`,
    `Goal: ${ctx.currentGoal ?? "unspecified"}`,
    `Nearby: ${ctx.nearbyWorldState.entities.join(", ") || "none"}`,
    `Concerns: ${ctx.immediateNeeds.concerns.join("; ") || "none"}`,
    `Memories: ${ctx.relevantMemories.map((m) => m.summary).join(" | ") || "none"}`,
    `Associations: ${ctx.learnedAssociations.map((a) => `${a.subjectKey}:${a.associationType} ${a.strength.toFixed(2)}`).join(", ") || "none"}`,
    `Uncertainty: ${ctx.uncertainty.toFixed(2)}`,
    "Authority: survival reflex > high-level decision > planner > verified skills.",
    "Do not claim a fixed personality. Use only these memories and evidence.",
  ];
  return lines.join("\n");
}

export type { StoredMemory };
