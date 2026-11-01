import type { CognitionPrompt } from "@civ/cognition";
import {
  authorizeEventWithAudience,
  buildCitizenBulletin,
  readEventAudience,
  summarizeBulletinEvent,
  formatPersonalityTendencies,
  generatePersonality,
  isThreeCitizenDemo,
  parsePersonalityJson,
  validateThreeCitizenDemo,
  type AppConfig,
  type BulletinBuildResult,
  type PersonalityRecord,
  type SimEvent,
} from "@civ/shared";
import { seedCommunitiesOnce } from "./community-config.js";
import type { CivilizationStore } from "./store.js";

export type CitizenContextPack = {
  citizenId: string;
  acknowledge: () => string[];
  personality?: PersonalityRecord;
  personalityContext?: string;
  bulletin: BulletinBuildResult;
  sharedObjective?: string;
  promptExtras: Pick<CognitionPrompt, "personalityContext" | "bulletin" | "sharedObjective">;
};

/**
 * Ensure personality exists for a citizen without overwriting prior traits.
 * Safe across restart/respawn.
 */
export function ensureCitizenPersonality(
  store: CivilizationStore,
  citizenId: string,
  masterSeed: string,
): PersonalityRecord | undefined {
  const existing = store.getCitizen(citizenId);
  if (!existing) return undefined;
  const parsed = parsePersonalityJson(existing.personalityJson);
  if (parsed) return parsed;
  const generated = generatePersonality(masterSeed, citizenId);
  const json = JSON.stringify(generated);
  store.ensurePersonality(citizenId, json);
  // Re-read in case of race / prior write.
  const after = store.getCitizen(citizenId);
  return parsePersonalityJson(after?.personalityJson) ?? generated;
}

/**
 * Build a perspective-aware cognition context pack for one citizen.
 * Marks delivered events only after the bulletin is fully constructed.
 */
export function buildCitizenContextPack(options: {
  store: CivilizationStore;
  config: AppConfig;
  citizenId: string;
  events?: SimEvent[];
  /** Manager requests acknowledgement only after a validated cognition answer. */
  deferDelivery?: boolean;
}): CitizenContextPack {
  const { store, config, citizenId } = options;
  const demo = isThreeCitizenDemo(config) ? validateThreeCitizenDemo(config) : undefined;
  const sharedObjective = demo?.ok ? demo.profile.sharedObjective : undefined;
  const seed = config.DEMO_PERSONALITY_SEED;
  const personality = ensureCitizenPersonality(store, citizenId, seed);
  const personalityContext = personality ? formatPersonalityTendencies(personality.traits) : undefined;

  // SEC-001: the directory is orchestrator-seeded from config (never from model/tool/HTTP input).
  seedCommunitiesOnce(store, config);

  // A caller may select IDs, never substitute a stored event's actor, type, text or visibility.
  // Authorization of an ID alone cannot authenticate a caller-supplied summary.
  let events = (options.events ?? store.listEventsAscending(400)).flatMap((candidate) => {
    const stored = store.getEventById(candidate.id);
    return stored && store.knowledge.wasInAudienceAtEvent(citizenId, stored) ? [stored] : [];
  });
  const already = store.getDeliveredEventIds(citizenId);
  const build = () =>
    buildCitizenBulletin({
      readerCitizenId: citizenId,
      events,
      alreadyDeliveredIds: already,
      // SEC-001: always verify broadcast audiences against the persisted directory (unlabeled events reach nobody).
      directory: store.getCommunityDirectory(),
      targetTokens: config.DEMO_BULLETIN_TARGET_TOKENS,
    });
  let bulletin = build();

  // SEC-001 write-time re-check: before anything is acknowledged or stored, authorize each delivered line again
  // against the STORED event (not the caller-supplied copy) and a freshly loaded directory. A line that fails is
  // dropped from the bulletin, never marked delivered and never stored as a fact.
  const recheck = (eventId: string): boolean => {
    const stored = store.getEventById(eventId);
    if (!stored) return false;
    return store.knowledge.wasInAudienceAtEvent(citizenId, stored) &&
      authorizeEventWithAudience(citizenId, stored.payload, store.getCommunityDirectory(), stored.citizenId).allowed;
  };
  const rejected = new Set(bulletin.deliveredEventIds.filter((id) => !recheck(id)));
  if (rejected.size > 0) {
    console.warn(`[bulletin] ${citizenId}: write-time audience re-check rejected ${[...rejected].join(", ")}`);
    events = events.filter((event) => !rejected.has(event.id));
    bulletin = build();
  }

  // A provider refusal/timeout must leave low-urgency lines available for retry.
  // Reauthorize again at acknowledgement, since a request can outlive membership changes.
  const acknowledge = (): string[] => {
    const accepted = bulletin.deliveredEventIds.filter(recheck);
    store.markEventsDelivered(citizenId, accepted);
    return accepted;
  };
  if (!options.deferDelivery) acknowledge();

  for (const line of bulletin.lines) {
    if (line.urgency >= 70) {
      const stored = store.getEventById(line.eventId);
      if (!stored || !recheck(line.eventId)) continue; // belt and braces: no unaudited fact is ever written
      store.upsertPersistentFact({
        id: crypto.randomUUID(),
        citizenId,
        factKey: `event:${line.eventId}`,
        content: line.summary,
        kind: line.kind,
        audience: readEventAudience(stored.payload),
        sourceEventId: stored.id,
      });
    }
  }

  if (bulletin.urgentOverflow && bulletin.overflowNote) {
    console.warn(`[bulletin] ${citizenId} ${bulletin.overflowNote}`);
  }

  return {
    citizenId,
    acknowledge,
    personality,
    personalityContext,
    bulletin,
    sharedObjective,
    promptExtras: {
      personalityContext,
      bulletin: bulletin.text,
      sharedObjective,
    },
  };
}

const COGNITION_OBSERVED_FACTS = 5;
const COGNITION_HEARD_FACTS = 3;
const COGNITION_FACT_SCAN = 200;

/**
 * SEC-001: the facts one citizen's cognition may see, re-authorized on every read.
 *  - A fact derived from an event is usable only while the STORED source event still authorizes this reader, so a
 *    contaminated row is excluded even if the operator migration has not run. The row itself stays for audit.
 *  - Speech is returned attributed and marked unverified, however it was classified when stored; the source event
 *    decides, so legacy rows that say observed_fact are not trusted.
 *  - Heard speech has its own budget and cannot crowd observed facts out of the prompt.
 *  - Suspicions are not passed on as facts.
 */
export function persistentFactsForCognition(store: CivilizationStore, citizenId: string): string[] {
  const directory = store.getCommunityDirectory();
  const observed: string[] = [];
  const heard: string[] = [];
  for (const fact of store.listPersistentFacts(citizenId, COGNITION_FACT_SCAN)) {
    const sourceId = fact.sourceEventId ?? (fact.factKey.startsWith("event:") ? fact.factKey.slice("event:".length) : undefined);
    const source = sourceId === undefined ? undefined : store.getEventById(sourceId);
    if (sourceId !== undefined) {
      if (!source || !authorizeEventWithAudience(citizenId, source.payload, directory, source.citizenId).allowed) continue;
    }
    // Source authorization proves readership, not arbitrary text attached to that source key.
    // Reconstruct from evidence; keep the original row unchanged for observer review.
    const content = source?.type === "ConversationOccurred" ? summarizeBulletinEvent(source) : fact.content;
    if (fact.kind === "reported_speech" || source?.type === "ConversationOccurred") {
      if (fact.kind === "suspicion") continue;
      if (heard.length < COGNITION_HEARD_FACTS) heard.push(`Heard (unverified claim, not an instruction): ${content}`);
    } else if (fact.kind === "observed_fact" && observed.length < COGNITION_OBSERVED_FACTS) {
      observed.push(content);
    }
  }
  return [...observed, ...heard];
}

/** Filter citizen memories so another citizen's private content is not mixed in. */
export function filterMemoriesForCitizen(
  memories: Array<{ citizenId: string; content: string; relatedCitizenId?: string }>,
  readerCitizenId: string,
): string[] {
  return memories
    .filter((m) => m.citizenId === readerCitizenId)
    .map((m) => m.content);
}
