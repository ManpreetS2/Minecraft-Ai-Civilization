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
import { z } from "zod";
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

/** Trusted event lookup (the store). The share path never accepts a caller-supplied source event. */
export interface TrustedEventLookup {
  getEventById(id: string): SimEvent | undefined;
}

/**
 * Explicit cross-community sharing. Creates a NEW event addressed to `toCommunityId`.
 *  - The source event is LOADED BY ID from the trusted lookup; a caller cannot hand in its own copy.
 *  - `actingCitizenId` is the citizen actually acting, supplied by the caller's trusted context (the runtime that
 *    owns the citizen), never read from model/tool/HTTP input. It must be known to the directory and able to read
 *    the stored source event.
 *  - Only the supplied `message` is copied (never the source payload); provenance is recorded.
 */
export function createCommunityShareEvent(args: {
  lookup: TrustedEventLookup;
  sourceEventId: string;
  actingCitizenId: string;
  toCommunityId: string;
  message: string;
  directory: CommunityDirectory;
  now?: Date;
  id?: string;
}): CommunityShareResult {
  const { lookup, sourceEventId, actingCitizenId, toCommunityId, message, directory } = args;
  if (typeof message !== "string" || !message.trim()) return { ok: false, reason: "empty share message" };
  if (typeof toCommunityId !== "string" || !directory.hasCommunity(toCommunityId)) {
    return { ok: false, reason: "unknown receiving community" };
  }
  if (typeof actingCitizenId !== "string" || !directory.knowsCitizen(actingCitizenId)) {
    return { ok: false, reason: "acting citizen unknown to directory" };
  }
  const source = typeof sourceEventId === "string" ? lookup.getEventById(sourceEventId) : undefined;
  if (!source) return { ok: false, reason: "source event not found" };
  const canRead = authorizeEventWithAudience(actingCitizenId, source.payload, directory, source.citizenId);
  if (!canRead.allowed) return { ok: false, reason: `acting citizen cannot read the source event (${canRead.reason})` };
  return {
    ok: true,
    event: {
      id: args.id ?? crypto.randomUUID(),
      type: "ConversationOccurred",
      timestamp: (args.now ?? new Date()).toISOString(),
      citizenId: actingCitizenId,
      payload: withAudience(
        { message, sharedFromEventId: source.id, sharedBy: actingCitizenId },
        "settlement_public",
        { scope: "community", communityId: toCommunityId },
      ),
    },
  };
}

const idString = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const communityConfigSchema = z
  .array(
    z
      .object({
        id: idString,
        name: z.string().min(1).max(120).optional(),
        memberIds: z.array(idString).max(200),
      })
      .strict(),
  )
  .max(50);

export type CommunityConfigEntry = { id: string; name: string; memberIds: string[] };

/**
 * Parse the orchestrator's COMMUNITIES_JSON. Strict: unknown keys, bad ids, a citizen in two communities or a
 * duplicate community id all throw (the caller keeps the existing directory = fail closed).
 */
export function parseCommunityConfig(json: string | undefined): CommunityConfigEntry[] {
  if (json === undefined || json.trim() === "") return [];
  const parsed = communityConfigSchema.parse(JSON.parse(json));
  const entries = parsed.map((c) => ({ id: c.id, name: c.name ?? c.id, memberIds: [...new Set(c.memberIds)] }));
  createCommunityDirectory(entries); // validates uniqueness (throws)
  return entries;
}
