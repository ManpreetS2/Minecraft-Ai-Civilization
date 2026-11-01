import type { CommunicationIntent } from "@civ/cognition";
import { createEvent, type ActionResult, type PlayerInfo, type SettlementState, type SimEvent } from "@civ/shared";
import { announceToOwnCommunity, shareEventWithCommunity } from "./community-share.js";
import type { DiscoveredSite } from "./discovered-sites.js";
import type { CivilizationStore } from "./store.js";
import { communityPhysicalState } from "./community-physical-state.js";

/**
 * SEC-001 part B: every way a citizen's words leave its head at runtime.
 *
 * Who is speaking, who can hear and which community is involved always come from runtime state (the citizen the tick
 * belongs to, positions from the speaker's Minecraft client, the persisted directory). A model supplies only the words
 * and a name, and the name only selects among citizens already within hearing.
 */

/** The same distance the manager already treats as working together. Minecraft has no built-in speech range. */
export const HEARING_RADIUS_BLOCKS = 8;

export const COMMUNICATION_GUIDE =
  'Optional: you may add "communication" to your reply, or say nothing. ' +
  '{"kind":"say","message":"..."} is heard only by citizens near you. ' +
  '{"kind":"announce_to_community","message":"..."} reaches your own community. ' +
  '{"kind":"share_bulletin_line","bulletinLine":1,"toCitizen":"<nearby citizen>","message":"..."} tells that citizen and their community about a numbered bulletin line.';

export type SpeakerBody = {
  nearbyPlayers(maxDistance?: number): PlayerInfo[];
  whisperTo(usernames: readonly string[], message: string): ActionResult<{ sent: string[] }>;
};

export type Hearer = { id: string; username: string };

/** Living citizens the speaker's own client currently places within hearing, excluding the speaker. */
export function hearersOf(
  speakerId: string,
  body: Pick<SpeakerBody, "nearbyPlayers">,
  resolve: (username: string) => { id: string; alive: boolean } | undefined,
): Hearer[] {
  const hearers: Hearer[] = [];
  for (const player of body.nearbyPlayers(HEARING_RADIUS_BLOCKS)) {
    const citizen = resolve(player.username);
    if (citizen?.alive && citizen.id !== speakerId) hearers.push({ id: citizen.id, username: player.username });
  }
  return hearers;
}

export type SpeechResult = { ok: true; event: SimEvent } | { ok: false; reason: string };

/**
 * Nearby speech. Goes out as /tell to each hearer, and the event's audience is exactly who it was sent to. If it could
 * not be sent nothing was said: no conversation event exists, and only the observer log records the attempt.
 */
export function speakNearby(args: {
  speakerId: string;
  body: Pick<SpeakerBody, "whisperTo">;
  hearers: readonly Hearer[];
  message: string;
  emit: (event: SimEvent) => void;
  detail?: Record<string, unknown>;
}): SpeechResult {
  const { speakerId, body, hearers, message, emit, detail } = args;
  if (hearers.length === 0) return refuse(emit, speakerId, "NO_LISTENER", "nobody within hearing");
  const sent = body.whisperTo(hearers.map((hearer) => hearer.username), message);
  if (!sent.success) return refuse(emit, speakerId, sent.code, sent.error);
  const reached = hearers.filter((hearer) => sent.data.sent.includes(hearer.username));
  if (reached.length === 0) return refuse(emit, speakerId, "NO_LISTENER", "no valid recipient");
  const listenerIds = reached.map((hearer) => hearer.id);
  const event = createEvent(
    "ConversationOccurred",
    {
      ...detail,
      message,
      speakerId,
      listenerIds,
      visibility: { class: "nearby_speech", audienceIds: listenerIds, speakerId },
    },
    speakerId,
  );
  emit(event);
  return { ok: true, event };
}

/**
 * Carry out a model's communication intent. `bulletinEventIds` is what this citizen was actually shown in the prompt
 * that produced the intent, so a share can only name a line it saw, never an arbitrary event id.
 */
export function performCommunicationIntent(args: {
  store: CivilizationStore;
  speakerId: string;
  body: SpeakerBody;
  resolve: (username: string) => { id: string; alive: boolean } | undefined;
  intent: CommunicationIntent;
  bulletinEventIds: readonly string[];
  emit: (event: SimEvent) => void;
}): SpeechResult {
  const { store, speakerId, body, resolve, intent, bulletinEventIds, emit } = args;
  if (intent.kind === "announce_to_community") {
    const result = announceToOwnCommunity(store, { actingCitizenId: speakerId }, { message: intent.message }, emit);
    return result.ok ? result : refuse(emit, speakerId, "ANNOUNCE_REFUSED", result.reason);
  }

  const hearers = hearersOf(speakerId, body, resolve);
  if (intent.kind === "say") {
    if (intent.toCitizen && !findByName(hearers, intent.toCitizen)) {
      return refuse(emit, speakerId, "TARGET_OUT_OF_HEARING", "addressee is not within hearing");
    }
    return speakNearby({
      speakerId,
      body,
      hearers,
      message: intent.message,
      emit,
      detail: { cause: "citizen_choice", other: intent.toCitizen },
    });
  }

  const target = findByName(hearers, intent.toCitizen);
  if (!target) return refuse(emit, speakerId, "TARGET_OUT_OF_HEARING", "share target is not within hearing");
  const sourceEventId = bulletinEventIds[intent.bulletinLine - 1];
  if (!sourceEventId) return refuse(emit, speakerId, "UNKNOWN_BULLETIN_LINE", "no such line in the bulletin shown");
  const toCommunityId = store.getCommunityDirectory().communityOf(target.id);
  if (!toCommunityId) return refuse(emit, speakerId, "SHARE_REFUSED", "target belongs to no community");
  const result = shareEventWithCommunity(
    store,
    { actingCitizenId: speakerId },
    { sourceEventId, toCommunityId, message: intent.message },
    {
      emit,
      transmit: () => {
        const sent = body.whisperTo([target.username], intent.message);
        return sent.success ? { ok: true } : { ok: false, reason: `${sent.code}: ${sent.error}` };
      },
    },
  );
  return result.ok ? result : refuse(emit, speakerId, "SHARE_REFUSED", result.reason);
}

function findByName(hearers: readonly Hearer[], name: string): Hearer | undefined {
  const wanted = name.toLowerCase();
  return hearers.find((hearer) => hearer.username.toLowerCase() === wanted);
}

function refuse(emit: (event: SimEvent) => void, citizenId: string, code: string, reason: string): SpeechResult {
  emit(createEvent("ActionFailed", { action: "communicate", code, error: reason, visibility: { class: "observer_only" } }, citizenId));
  return { ok: false, reason };
}

export type SettlementScope = { scoped: boolean; settlement: SettlementState };

/**
 * The store holds one settlement row, written by every citizen's actions. Once communities exist that row belongs to no
 * one community: it mixes both groups' stocks and locations, so reading it would be an omniscient shortcut. Per-community observations are read through the authenticated physical-state facade;
 * unaffiliated citizens get a neutral view. Without
 * communities the world really has one settlement and nothing changes.
 */
export function scopeSettlementForCitizen(
  store: CivilizationStore,
  citizenId: string,
  settlement: SettlementState,
): SettlementScope {
  if (!store.hasCommunities()) return { scoped: false, settlement };
  const communityId = store.getCommunityDirectory().communityOf(citizenId);
  if (communityId && store.getCitizen(citizenId)) {
    return { scoped: true, settlement: communityPhysicalState(store).forCitizen(citizenId).read().state };
  }
  const id = "no_community";
  return {
    scoped: true,
    settlement: {
      id,
      name: id,
      food: 0,
      wood: 0,
      stone: 0,
      beds: 0,
      housingCapacity: 0,
      tools: 0,
      shelterComplete: false,
      needs: [],
    },
  };
}

/** Community membership is not communication: only this body's own observations are implicit planner knowledge. */
export function sitesKnownTo(
  _store: CivilizationStore,
  citizenId: string,
  sites: readonly DiscoveredSite[],
  scoped: boolean,
): DiscoveredSite[] {
  if (!scoped) return [...sites];
  return sites.filter((site) => site.citizenId === citizenId);
}
