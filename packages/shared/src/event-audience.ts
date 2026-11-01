/**
 * SEC-001 part A: verified event audience.
 *
 * An event that is broadcast (world_public / settlement_public) must carry an explicit audience:
 *   - { scope: "world" }                       -> every living citizen the directory knows about
 *   - { scope: "community", communityId }      -> only members of that community, checked against the directory
 * A missing, empty, malformed or unknown audience (including a community id that is not in the directory)
 * reaches NOBODY. Nothing is inferred from names, model family, scopeNote or proximity.
 *
 * Cross-community sharing is never a widening of an existing event: it is a NEW event (new id) whose audience
 * names the receiving community, created by `createCommunityShareEvent` from a sharer who could read the source.
 */
import type { SimEvent } from "./events.js";
import {
  authorizeEventForCitizen,
  readEventVisibility,
  withEventVisibility,
  type EventVisibility,
} from "./event-visibility.js";

export type EventAudience = { scope: "world" } | { scope: "community"; communityId: string };

export type CommunityDefinition = { id: string; memberIds: readonly string[] };

/** Read-only view of who belongs to which community. The store builds one from its persisted tables. */
export interface CommunityDirectory {
  hasCommunity(communityId: string): boolean;
  communityOf(citizenId: string): string | undefined;
  membersOf(communityId: string): readonly string[];
  /** True when the citizen is known to the directory at all (member of any community). */
  knowsCitizen(citizenId: string): boolean;
}

export function createCommunityDirectory(definitions: readonly CommunityDefinition[]): CommunityDirectory {
  const members = new Map<string, readonly string[]>();
  const owner = new Map<string, string>();
  for (const def of definitions) {
    if (!def.id || typeof def.id !== "string") throw new Error("community id must be a non-empty string");
    if (members.has(def.id)) throw new Error(`duplicate community id: ${def.id}`);
    const ids = [...new Set(def.memberIds)];
    for (const citizenId of ids) {
      const prior = owner.get(citizenId);
      if (prior !== undefined) {
        throw new Error(`citizen ${citizenId} is in two communities (${prior}, ${def.id})`);
      }
      owner.set(citizenId, def.id);
    }
    members.set(def.id, ids);
  }
  return {
    hasCommunity: (communityId) => members.has(communityId),
    communityOf: (citizenId) => owner.get(citizenId),
    membersOf: (communityId) => members.get(communityId) ?? [],
    knowsCitizen: (citizenId) => owner.has(citizenId),
  };
}

/** Parse an untrusted audience value. Anything that is not exactly one of the two shapes is undefined. */
export function parseEventAudience(raw: unknown): EventAudience | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.scope === "world") return { scope: "world" };
  if (record.scope === "community") {
    const id = record.communityId;
    if (typeof id === "string" && id.trim().length > 0 && id === id.trim()) {
      return { scope: "community", communityId: id };
    }
  }
  return undefined;
}

export function readEventAudience(payload: Record<string, unknown> | undefined): EventAudience | undefined {
  const vis = payload?.visibility;
  if (!vis || typeof vis !== "object" || Array.isArray(vis)) return undefined;
  return parseEventAudience((vis as Record<string, unknown>).audience);
}

export type AudienceDecision = { allowed: true; reason: string } | { allowed: false; reason: string };

/** Is this reader inside the (verified) audience? Fails closed on anything unverifiable. */
export function isReaderInAudience(
  readerCitizenId: string,
  audience: EventAudience | undefined,
  directory: CommunityDirectory,
): AudienceDecision {
  if (!audience) return { allowed: false, reason: "audience missing or malformed" };
  if (audience.scope === "world") {
    return directory.knowsCitizen(readerCitizenId)
      ? { allowed: true, reason: "audience world" }
      : { allowed: false, reason: "audience world: reader unknown to directory" };
  }
  if (!directory.hasCommunity(audience.communityId)) {
    return { allowed: false, reason: `audience community unknown: ${audience.communityId}` };
  }
  return directory.communityOf(readerCitizenId) === audience.communityId
    ? { allowed: true, reason: `audience community ${audience.communityId}` }
    : { allowed: false, reason: `audience community ${audience.communityId}: reader not a member` };
}

/**
 * Strict authorization used by the production path: the legacy visibility-class rule AND, for broadcast
 * classes, a verified audience. Unlabeled events (no visibility / no audience) fail closed.
 */
export function authorizeEventWithAudience(
  readerCitizenId: string,
  payload: Record<string, unknown> | undefined,
  directory: CommunityDirectory,
  actorCitizenId?: string,
): AudienceDecision {
  const visibility = readEventVisibility(payload);
  if (visibility.class === "settlement_public") {
    // Only a verified community audience can authorize this class (the legacy rule fails closed without a directory).
    const audience = readEventAudience(payload);
    if (audience?.scope !== "community") {
      return { allowed: false, reason: "settlement_public requires a community audience" };
    }
    return isReaderInAudience(readerCitizenId, audience, directory);
  }
  const base = authorizeEventForCitizen(readerCitizenId, visibility, actorCitizenId);
  if (!base.visible) return { allowed: false, reason: base.reason };
  if (visibility.class === "world_public") {
    return isReaderInAudience(readerCitizenId, readEventAudience(payload), directory);
  }
  return { allowed: true, reason: base.reason };
}

export function withAudience(
  payload: Record<string, unknown>,
  visibilityClass: "world_public" | "settlement_public",
  audience: EventAudience,
): Record<string, unknown> {
  const visibility: EventVisibility = { class: visibilityClass, audience } as EventVisibility;
  return withEventVisibility(payload, visibility);
}

export type CommunityShareResult =
  | { ok: true; event: SimEvent }
  | { ok: false; reason: string };

/**
 * Explicit cross-community sharing. Creates a NEW event addressed to `toCommunityId`.
 * The sharer must be able to read the source event; only the sharer-supplied `message` is copied
 * (never the source payload), and the new event records provenance (`sharedFromEventId`, `sharedBy`).
 */
export function createCommunityShareEvent(args: {
  source: SimEvent;
  sharerCitizenId: string;
  toCommunityId: string;
  message: string;
  directory: CommunityDirectory;
  now?: Date;
  id?: string;
}): CommunityShareResult {
  const { source, sharerCitizenId, toCommunityId, message, directory } = args;
  if (!message.trim()) return { ok: false, reason: "empty share message" };
  if (!directory.hasCommunity(toCommunityId)) return { ok: false, reason: "unknown receiving community" };
  if (!directory.knowsCitizen(sharerCitizenId)) return { ok: false, reason: "sharer unknown to directory" };
  const canRead = authorizeEventWithAudience(sharerCitizenId, source.payload, directory, source.citizenId);
  if (!canRead.allowed) return { ok: false, reason: `sharer cannot read the source event (${canRead.reason})` };
  return {
    ok: true,
    event: {
      id: args.id ?? crypto.randomUUID(),
      type: "ConversationOccurred",
      timestamp: (args.now ?? new Date()).toISOString(),
      citizenId: sharerCitizenId,
      payload: withAudience(
        { message, sharedFromEventId: source.id, sharedBy: sharerCitizenId },
        "settlement_public",
        { scope: "community", communityId: toCommunityId },
      ),
    },
  };
}
