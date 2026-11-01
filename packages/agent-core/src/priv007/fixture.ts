import { loadConfig, withEventVisibility, type EventVisibility, type SimEvent } from "@civ/shared";
import { CivilizationStore } from "../store.js";
import { buildCitizenContextPack } from "../citizen-context.js";
import { applyCommunityConfig } from "../community-config.js";

export const ids = ["GPT-A", "GPT-B", "Claude-A", "Claude-B"] as const;
export const secret = "hidden camp x=137 z=-211";
export const at = "2026-10-31T00:00:00.000Z";
export const config = loadConfig({
  DEMO_PROFILE: "none",
  SIM_CITIZEN_COUNT: "4",
  LLM_PROVIDER: "none",
  LLM_ENABLED: "true",
  CLOUD_LLM_ENABLED: "false",
  LLM_COOLDOWN_MS: "1",
  DEMO_BULLETIN_TARGET_TOKENS: "400",
  HUMAN_DIRECTIVES_ENABLED: "false",
});
export function makeStore(
  path = ":memory:",
  communities: Parameters<typeof applyCommunityConfig>[1] = {},
): CivilizationStore {
  // Actual ephemeral SQLite and production migrations; never opens a production database.
  const store = new CivilizationStore(path);
  for (const id of ids)
    store.upsertCitizen({
      id,
      name: id,
      minecraftUsername: id,
      createdAt: at,
      status: "online",
    });
  applyCommunityConfig(store, communities);
  return store;
}
export function event(
  id: string,
  visibility: EventVisibility,
  message = secret,
  actor = "GPT-A",
): SimEvent {
  return {
    id,
    citizenId: actor,
    type: "ConversationOccurred",
    timestamp: at,
    payload: withEventVisibility(
      { message },
      visibility.class === "world_public"
        ? { ...visibility, audience: { scope: "world" } }
        : visibility,
    ),
  };
}
export function context(store: CivilizationStore, citizenId: string, events?: SimEvent[]) {
  for (const source of events ?? []) {
    if (!store.getEventById(source.id)) store.appendEvent(source);
  }
  return buildCitizenContextPack({ store, config, citizenId, events });
}

/** Seed historical contamination directly: the corrected context writer no longer creates it. */
export function seedHistoricalPoison(store: CivilizationStore, reader = "Claude-A") {
  const result = poison(store, reader);
  store.db
    .prepare(
      `INSERT INTO citizen_persistent_facts
    (id,citizen_id,fact_key,content,kind,created_at,source_event_id)
    VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      `legacy-${reader}`,
      reader,
      `event:${result.leaked.id}`,
      secret,
      "observed_fact",
      at,
      result.leaked.id,
    );
  store.markEventsDelivered(reader, [result.leaked.id]);
  return result;
}
export function poison(store: CivilizationStore, reader = "Claude-A") {
  const leaked = event("settlement-secret", {
    class: "settlement_public",
    scopeNote: "intended GPT community only; no verified membership",
  });
  store.appendEvent(leaked);
  return { leaked, pack: context(store, reader) };
}
