/**
 * Perspective / information-boundary metadata for SimEvent payloads.
 * Unknown or missing visibility must NOT default to world-public for citizens.
 */

export const EVENT_VISIBILITY_KEY = "visibility" as const;

export type EventVisibilityClass =
  | "observer_only"
  | "world_public"
  | "settlement_public"
  | "nearby_speech"
  | "directed"
  | "actor_private"
  | "unknown";

export type EventVisibility = {
  class: EventVisibilityClass;
  /** Directed / private participant citizen IDs. */
  audienceIds?: string[];
  /** Speaker for nearby_speech. */
  speakerId?: string;
  /** Optional human-readable scope note (not itself a privacy grant). */
  scopeNote?: string;
  /** Evidence / observation reference IDs when available. */
  evidenceRefs?: string[];
};

export function readEventVisibility(payload: Record<string, unknown> | undefined): EventVisibility {
  if (!payload || typeof payload !== "object") {
    return { class: "unknown" };
  }
  const raw = payload[EVENT_VISIBILITY_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { class: "unknown" };
  }
  const vis = raw as Record<string, unknown>;
  const cls = vis.class;
  if (
    cls !== "observer_only" &&
    cls !== "world_public" &&
    cls !== "settlement_public" &&
    cls !== "nearby_speech" &&
    cls !== "directed" &&
    cls !== "actor_private" &&
    cls !== "unknown"
  ) {
    return { class: "unknown" };
  }
  return {
    class: cls,
    audienceIds: Array.isArray(vis.audienceIds)
      ? vis.audienceIds.filter((id): id is string => typeof id === "string")
      : undefined,
    speakerId: typeof vis.speakerId === "string" ? vis.speakerId : undefined,
    scopeNote: typeof vis.scopeNote === "string" ? vis.scopeNote : undefined,
    evidenceRefs: Array.isArray(vis.evidenceRefs)
      ? vis.evidenceRefs.filter((id): id is string => typeof id === "string")
      : undefined,
  };
}

export function withEventVisibility(
  payload: Record<string, unknown>,
  visibility: EventVisibility,
): Record<string, unknown> {
  return { ...payload, [EVENT_VISIBILITY_KEY]: visibility };
}

export type VisibilityDecision =
  | { visible: true; reason: string }
  | { visible: false; reason: string };

/**
 * Conservative authorization: unknown visibility is never citizen-visible.
 * Nearby speech without an explicit audience list fails closed (no invented proximity).
 */
export function authorizeEventForCitizen(
  readerCitizenId: string,
  visibility: EventVisibility,
  actorCitizenId?: string,
): VisibilityDecision {
  switch (visibility.class) {
    case "observer_only":
    case "unknown":
      return { visible: false, reason: `visibility=${visibility.class}` };
    case "world_public":
    case "settlement_public":
      return { visible: true, reason: visibility.class };
    case "actor_private": {
      const owner = visibility.audienceIds?.[0] ?? visibility.speakerId ?? actorCitizenId;
      if (owner && owner === readerCitizenId) {
        return { visible: true, reason: "actor_private self" };
      }
      return { visible: false, reason: "actor_private other" };
    }
    case "directed": {
      const audience = visibility.audienceIds ?? [];
      if (audience.includes(readerCitizenId)) {
        return { visible: true, reason: "directed audience" };
      }
      return { visible: false, reason: "directed not addressed" };
    }
    case "nearby_speech": {
      const audience = visibility.audienceIds;
      if (!audience || audience.length === 0) {
        return { visible: false, reason: "nearby_speech missing substantiated audience" };
      }
      if (audience.includes(readerCitizenId) || visibility.speakerId === readerCitizenId) {
        return { visible: true, reason: "nearby_speech audience" };
      }
      return { visible: false, reason: "nearby_speech out of audience" };
    }
    default:
      return { visible: false, reason: "unhandled visibility" };
  }
}
