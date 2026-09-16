import {
  IMMEDIATE_TTL_MS,
  SOURCE_CONFIDENCE,
  locationKey,
  observersForEvent,
  periodKey,
  type Clock,
  type CognitiveStore,
  type IdFactory,
  type ObjectiveWorldEvent,
  type StoredMemory,
  type WorldSnapshot,
} from "@civ/memory";
import { parseJson } from "./json.js";
import { activityFromRow, activityToRow, normalizeActivity, recordActivityAttempt } from "./activity.js";
import { applyAssociationProposal, associationFromRow, associationToRow } from "./associations.js";
import { DeterministicAppraisal, buildAppraisalInput, type AppraisalProvider } from "./appraisal.js";
import { habitContext, habitFromRow, recordHabit, weakenUnusedHabits } from "./habits.js";
import { applyPsychDeltas, clearConcern, psychFromRow, psychToRow, upsertConcern } from "./psych.js";
import { detectReflectionTrigger } from "./reflection.js";
import {
  applySocialEvidence,
  beliefFromRow,
  beliefToRow,
  emptyBelief,
  evidenceInterpretation,
} from "./social.js";
import type { HeardClaim, IngestResult, ActivityExperience } from "./types.js";

export function ingestObjectiveEvent(
  store: CognitiveStore,
  event: ObjectiveWorldEvent,
  snapshot: WorldSnapshot,
  opts: {
    clock: Clock;
    id: IdFactory;
    appraisal?: AppraisalProvider;
  },
): IngestResult {
  const appraisal = opts.appraisal ?? new DeterministicAppraisal();
  const at = event.timestamp || opts.clock.iso();
  store.putObjectiveEvent(event);

  if (event.category === "citizen_death" && event.targetCitizenId) {
    const name = snapshot.citizens.find((c) => c.id === event.targetCitizenId)?.name;
    store.upsertIdentity(event.targetCitizenId, name, at);
    store.markDeceased(event.targetCitizenId, at);
  }

  for (const citizen of snapshot.citizens) {
    store.upsertIdentity(citizen.id, citizen.name, at);
  }

  const observers = observersForEvent(event, snapshot);
  const observerIds = new Set(observers.map((o) => o.citizenId));
  const skippedDistant = snapshot.citizens
    .map((c) => c.id)
    .filter((id) => !observerIds.has(id) && id !== event.targetCitizenId);

  const memoriesCreated: StoredMemory[] = [];
  for (const observer of observers) {
    const created = ingestForCitizen(store, event, snapshot, observer.citizenId, observer.source, {
      clock: opts.clock,
      id: opts.id,
      appraisal,
      at,
    });
    if (created) memoriesCreated.push(created);
  }

  return {
    eventId: event.id,
    memoriesCreated,
    skippedDistant,
    deceasedPreserved: event.category === "citizen_death",
  };
}

function ingestForCitizen(
  store: CognitiveStore,
  event: ObjectiveWorldEvent,
  snapshot: WorldSnapshot,
  citizenId: string,
  source: Parameters<typeof buildAppraisalInput>[0]["source"],
  opts: { clock: Clock; id: IdFactory; appraisal: AppraisalProvider; at: string },
): StoredMemory | undefined {
  const person = snapshot.citizens.find((c) => c.id === citizenId);
  if (person?.deceased && event.category !== "citizen_death") return undefined;

  store.expireImmediate(citizenId, opts.at);
  const psych = psychFromRow(store.getPsych(citizenId));
  const associations = store.listAssociations(citizenId).map(associationFromRow);
  const activities = store.listActivities(citizenId);
  const familiarity = Object.fromEntries(activities.map((row) => [row.activity, row.familiarity]));
  const other = event.participants.find((id) => id !== citizenId);
  const belief = other
    ? beliefFromRow(store.getBelief(citizenId, other) ?? beliefToRow(emptyBelief(citizenId, other, opts.at)))
    : undefined;
  const recentMemories = store.listDurableMemories(citizenId, 12);

  const input = buildAppraisalInput({
    citizenId,
    event,
    source,
    psych,
    hunger: person?.hunger,
    health: person?.health,
    memories: recentMemories,
    belief,
    associations,
    activityFamiliarity: familiarity,
  });
  const result = opts.appraisal.appraise(input);
  const memoryId = opts.id();
  const durable = result.keepDurable;
  const memory: StoredMemory = {
    id: memoryId,
    citizenId,
    memoryType: durable ? "episodic" : "immediate",
    eventType: event.category,
    timestamp: opts.at,
    gameTime: event.gameTime,
    summary: result.summary,
    participants: event.participants,
    location: event.location,
    objectiveFacts: event.facts,
    subjectiveAppraisal: result.subjectiveAppraisal,
    emotionalSalience: result.emotionalSalience,
    importance: result.memoryImportance,
    source,
    confidence: SOURCE_CONFIDENCE[source],
    tags: result.tags,
    relatedEntityIds: relatedIds(event),
    createdAt: opts.at,
    recallCount: 0,
    compressed: false,
    expiresAt: durable ? undefined : new Date(opts.clock.millis() + IMMEDIATE_TTL_MS).toISOString(),
    targetCitizenId: other,
    supportingMemoryIds: [],
  };
  store.putMemory(memory);

  const activityName = typeof event.facts.activity === "string" ? normalizeActivity(event.facts.activity) : undefined;
  if (event.category === "task_succeeded" || event.category === "task_failed") {
    const success = event.category === "task_succeeded";
    updateActivity(store, citizenId, activityName ?? "unknown", success, opts.at);
    updateHabit(store, citizenId, psych, snapshot, activityName ?? "unknown", success, opts.at, opts.id);
    updateWorkObservations(store, citizenId, activityName ?? "unknown", success, familiarity, opts.at);
    store.bumpRoutine(
      citizenId,
      `${event.category}:${activityName ?? "task"}`,
      periodKey(opts.at),
      success,
      opts.at,
    );
  }

  if (event.category === "danger_encountered") {
    const obs = store.getObservations(citizenId);
    const harmless = event.facts.outcome === "harmless" && !event.facts.harmOccurred;
    if (harmless) obs.dangerousAvoided += 1;
    else obs.dangerousAttempts += 1;
    obs.updatedAt = opts.at;
    store.saveObservations(obs);
  }
  if (event.category === "citizen_attacked_citizen") {
    const obs = store.getObservations(citizenId);
    obs.conflictActs += 1;
    obs.socialInteractions += 1;
    obs.updatedAt = opts.at;
    store.saveObservations(obs);
  }
  if (event.category === "citizen_item_received" || event.category === "citizen_helped") {
    const obs = store.getObservations(citizenId);
    obs.cooperativeActs += 1;
    obs.socialInteractions += 1;
    obs.updatedAt = opts.at;
    store.saveObservations(obs);
  }
  if (event.category === "conversation_heard") {
    const obs = store.getObservations(citizenId);
    obs.socialInteractions += 1;
    obs.updatedAt = opts.at;
    store.saveObservations(obs);
  }

  let nextPsych = applyPsychDeltas(psych, result, opts.at);
  if (event.category === "citizen_item_received" && event.targetCitizenId === citizenId) {
    nextPsych = clearConcern(nextPsych, "hunger");
  }
  if (result.emotionalSalience >= 0.45) {
    nextPsych = upsertConcern(nextPsych, {
      id: opts.id(),
      description: result.summary,
      urgency: result.emotionalSalience,
      relatedMemoryIds: [memory.id],
      createdAt: opts.at,
    });
  }
  store.savePsych(psychToRow(nextPsych));

  for (const proposal of result.associationProposals) {
    const existing = store.getAssociation(citizenId, proposal.subjectType, proposal.subjectKey, proposal.associationType);
    const updated = applyAssociationProposal(
      existing ? associationFromRow(existing) : undefined,
      proposal,
      citizenId,
      memory.id,
      opts.at,
      existing?.id ?? opts.id(),
    );
    store.saveAssociation(associationToRow(updated));
  }
  const loc = locationKey(event.location);
  if (loc && event.category === "danger_encountered" && event.facts.harmOccurred) {
    const existing = store.getAssociation(citizenId, "location", loc, "danger");
    const updated = applyAssociationProposal(
      existing ? associationFromRow(existing) : undefined,
      { subjectType: "location", subjectKey: loc, associationType: "danger", reinforce: 0.2 },
      citizenId,
      memory.id,
      opts.at,
      existing?.id ?? opts.id(),
    );
    store.saveAssociation(associationToRow(updated));
  }

  if (result.socialEvidence) {
    const targetId = result.socialEvidence.targetCitizenId;
    const current = store.getBelief(citizenId, targetId);
    const beliefState = current ? beliefFromRow(current) : emptyBelief(citizenId, targetId, opts.at);
    const evidence = {
      ...result.socialEvidence,
      id: opts.id(),
      memoryId: memory.id,
      createdAt: opts.at,
    };
    store.addEvidence(evidence);
    const interpreted = applySocialEvidence(
      beliefState,
      evidence,
      evidenceInterpretation(evidence.kind, evidence.source),
      opts.at,
    );
    store.saveBelief(beliefToRow(interpreted));
  }

  const trigger = detectReflectionTrigger({
    citizenId,
    event,
    salience: result.emotionalSalience,
    belief,
    id: opts.id(),
    at: opts.at,
  });
  if (trigger) {
    store.putReflection({ ...trigger, consumed: false });
  }

  return memory;
}

export function ingestHeardClaim(
  store: CognitiveStore,
  claim: HeardClaim,
  opts: { clock: Clock; id: IdFactory },
): StoredMemory {
  const at = claim.timestamp ?? opts.clock.iso();
  store.upsertIdentity(claim.observerId);
  store.upsertIdentity(claim.informantId);
  if (claim.aboutCitizenId) store.upsertIdentity(claim.aboutCitizenId);
  const targetId = claim.aboutCitizenId ?? claim.informantId;
  const summary = `${displayName(claim.informantId)} told me that ${claim.claim}`;
  const memory: StoredMemory = {
    id: opts.id(),
    citizenId: claim.observerId,
    memoryType: "social",
    eventType: "heard_claim",
    timestamp: at,
    summary,
    participants: [claim.observerId, claim.informantId, targetId].filter((id, i, all) => all.indexOf(id) === i),
    objectiveFacts: { claim: claim.claim, informantId: claim.informantId, aboutCitizenId: claim.aboutCitizenId },
    subjectiveAppraisal: {
      goalImpact: 0,
      materialImpact: 0,
      threatLevel: 0.1,
      helpfulness: 0,
      harm: 0,
      novelty: 0.4,
      responsibility: 0,
      socialRelevance: 0.7,
      relationshipRelevance: 0.6,
      urgency: 0.2,
      certainty: 0.45,
      summary,
    },
    emotionalSalience: 0.28,
    importance: 0.3,
    source: "HEARD",
    confidence: SOURCE_CONFIDENCE.HEARD,
    tags: ["rumor", "heard"],
    relatedEntityIds: [targetId, claim.informantId],
    createdAt: at,
    recallCount: 0,
    compressed: false,
    targetCitizenId: targetId,
    supportingMemoryIds: [],
  };
  store.putMemory(memory);
  const current = store.getBelief(claim.observerId, targetId);
  const belief = current ? beliefFromRow(current) : emptyBelief(claim.observerId, targetId, at);
  const evidence = {
    id: opts.id(),
    observerCitizenId: claim.observerId,
    targetCitizenId: targetId,
    kind: "rumor" as const,
    summary,
    source: "HEARD" as const,
    informantId: claim.informantId,
    confidence: SOURCE_CONFIDENCE.HEARD,
    memoryId: memory.id,
    createdAt: at,
  };
  store.addEvidence(evidence);
  store.saveBelief(
    beliefToRow(applySocialEvidence(belief, evidence, evidenceInterpretation("rumor", "HEARD"), at)),
  );
  return memory;
}

function updateActivity(
  store: CognitiveStore,
  citizenId: string,
  activity: string,
  success: boolean,
  at: string,
): ActivityExperience {
  const existingRow = store.getActivity(citizenId, activity);
  const recent = existingRow ? parseJson<number[]>(existingRow.recentResultsJson, []) : [];
  const next = recordActivityAttempt(
    existingRow ? activityFromRow(existingRow) : undefined,
    citizenId,
    activity,
    success,
    at,
    recent,
  );
  store.saveActivity(activityToRow(next.experience, next.recent));
  return next.experience;
}

function updateHabit(
  store: CognitiveStore,
  citizenId: string,
  psych: ReturnType<typeof psychFromRow>,
  snapshot: WorldSnapshot,
  action: string,
  success: boolean,
  at: string,
  id: IdFactory,
): void {
  const contextKey = habitContext(psych, snapshot, citizenId);
  const existing = store.getHabit(citizenId, contextKey, action);
  const updated = recordHabit(existing ? habitFromRow(existing) : undefined, citizenId, contextKey, action, success, at, existing?.id ?? id());
  store.saveHabit(updated);
  for (const habit of weakenUnusedHabits(store.listHabits(citizenId).map(habitFromRow), contextKey, action, at)) {
    store.saveHabit(habit);
  }
}

function updateWorkObservations(
  store: CognitiveStore,
  citizenId: string,
  activity: string,
  success: boolean,
  familiarity: Record<string, number>,
  at: string,
): void {
  const obs = store.getObservations(citizenId);
  obs.totalTaskChoices += 1;
  if (!success) {
    obs.taskFailures += 1;
  } else if (obs.taskFailures > 0) {
    obs.retriesAfterFailure += 1;
  }
  if (activity === "explore") obs.explorationActs += 1;
  if ((familiarity[activity] ?? 0) >= 0.45) obs.familiarTaskChoices += 1;
  if (activity === "explore" || activity === "fight") {
    if (success) obs.dangerousAttempts += 1;
  }
  obs.updatedAt = at;
  store.saveObservations(obs);
}

function relatedIds(event: ObjectiveWorldEvent): string[] {
  const ids = [...event.participants];
  const threat = typeof event.facts.threatKey === "string" ? event.facts.threatKey : undefined;
  const item = typeof event.facts.item === "string" ? event.facts.item : undefined;
  const activity = typeof event.facts.activity === "string" ? event.facts.activity : undefined;
  const loc = locationKey(event.location);
  return [...new Set([threat, item, activity, loc, ...ids].filter((value): value is string => Boolean(value)))];
}

function displayName(id: string): string {
  if (id.startsWith("citizen_")) return id.slice("citizen_".length).replace(/^\w/, (c) => c.toUpperCase());
  return id;
}
