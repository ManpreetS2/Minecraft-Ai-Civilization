import type { CognitiveStore, StoredMemory } from "@civ/memory";
import { CONSOLIDATION_ROUTINE_MIN, periodKey } from "@civ/memory";
import { normalizeActivity } from "./activity.js";

export type ConsolidationResult = {
  citizenId: string;
  summariesCreated: StoredMemory[];
  compressedIds: string[];
};

export function consolidateCitizen(
  store: CognitiveStore,
  citizenId: string,
  at: string,
  idFactory: () => string,
): ConsolidationResult {
  const routines = store.listRoutines(citizenId, periodKey(at));
  const compressedIds: string[] = [];
  const summariesCreated: StoredMemory[] = [];

  for (const routine of routines) {
    if (routine.count < CONSOLIDATION_ROUTINE_MIN) continue;
    const activity = normalizeActivity(routine.bucketKey.split(":")[1] ?? routine.bucketKey);
    const existing = store.listMemories(citizenId, { includeCompressed: true, limit: 120 });
    const matching = existing.filter(
      (memory) =>
        !memory.compressed &&
        memory.importance < 0.4 &&
        (memory.tags.includes(activity) || memory.eventType.startsWith("task_")),
    );
    const already = existing.some(
      (memory) => memory.memoryType === "semantic" && memory.tags.includes(activity) && memory.tags.includes("summary"),
    );
    if (already) continue;
    const success = routine.successCount >= routine.count * 0.6;
    const summary: StoredMemory = {
      id: idFactory(),
      citizenId,
      memoryType: "semantic",
      eventType: "routine_summary",
      timestamp: at,
      summary: success
        ? `Spent much of the day on ${activity.replaceAll("_", " ")} successfully.`
        : `Spent much of the day struggling with ${activity.replaceAll("_", " ")}.`,
      participants: [citizenId],
      objectiveFacts: {
        activity,
        count: routine.count,
        successCount: routine.successCount,
        period: routine.period,
      },
      emotionalSalience: 0.2,
      importance: 0.32,
      source: "INFERRED",
      confidence: 0.75,
      tags: [activity, "summary", "routine"],
      relatedEntityIds: [activity],
      createdAt: at,
      recallCount: 0,
      compressed: false,
      supportingMemoryIds: matching.map((m) => m.id),
    };
    store.putMemory(summary);
    if (matching.length > 0) store.markCompressed(matching.map((m) => m.id));
    summariesCreated.push(summary);
    compressedIds.push(...matching.map((m) => m.id));
  }

  return { citizenId, summariesCreated, compressedIds };
}
