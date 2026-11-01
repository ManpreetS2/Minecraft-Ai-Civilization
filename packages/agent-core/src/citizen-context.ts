import type { CognitionPrompt } from "@civ/cognition";
import {
  buildCitizenBulletin,
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
import type { CivilizationStore } from "./store.js";

export type CitizenContextPack = {
  citizenId: string;
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
}): CitizenContextPack {
  const { store, config, citizenId } = options;
  const demo = isThreeCitizenDemo(config) ? validateThreeCitizenDemo(config) : undefined;
  const sharedObjective = demo?.ok ? demo.profile.sharedObjective : undefined;
  const seed = config.DEMO_PERSONALITY_SEED;
  const personality = ensureCitizenPersonality(store, citizenId, seed);
  const personalityContext = personality ? formatPersonalityTendencies(personality.traits) : undefined;

  const events = options.events ?? store.listEventsAscending(400);
  const already = store.getDeliveredEventIds(citizenId);
  const bulletin = buildCitizenBulletin({
    readerCitizenId: citizenId,
    events,
    alreadyDeliveredIds: already,
    // SEC-001: always verify broadcast audiences against the persisted directory (unlabeled events reach nobody).
    directory: store.getCommunityDirectory(),
    targetTokens: config.DEMO_BULLETIN_TARGET_TOKENS,
  });

  // Persist delivery checkpoint after bulletin is built (restart-safe incremental delivery).
  store.markEventsDelivered(citizenId, bulletin.deliveredEventIds);

  for (const line of bulletin.lines) {
    if (line.urgency >= 70) {
      store.upsertPersistentFact({
        id: crypto.randomUUID(),
        citizenId,
        factKey: `event:${line.eventId}`,
        content: line.summary,
        kind: "observed_fact",
      });
    }
  }

  if (bulletin.urgentOverflow && bulletin.overflowNote) {
    console.warn(`[bulletin] ${citizenId} ${bulletin.overflowNote}`);
  }

  return {
    citizenId,
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

/** Filter citizen memories so another citizen's private content is not mixed in. */
export function filterMemoriesForCitizen(
  memories: Array<{ citizenId: string; content: string; relatedCitizenId?: string }>,
  readerCitizenId: string,
): string[] {
  return memories
    .filter((m) => m.citizenId === readerCitizenId)
    .map((m) => m.content);
}
