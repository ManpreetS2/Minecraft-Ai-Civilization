import { createCommunityShareEvent, createEvent, withAudience, type CommunityShareResult, type SimEvent } from "@civ/shared";
import type { CivilizationStore } from "./store.js";

/** Trusted runtime context: who is actually acting. Comes from the runtime that owns the citizen, not from input. */
export type ShareContext = { actingCitizenId: string };

/** Untrusted input (e.g. a model's tool call). Only these three fields are read; anything else is ignored. */
export type ShareInput = { sourceEventId: string; toCommunityId: string; message: string };

/**
 * Explicit cross-community sharing: loads the source event from the store by id, verifies the acting citizen can
 * read it against a fresh directory, and appends a NEW event whose audience is exactly the receiving community.
 */
export function shareEventWithCommunity(
  store: CivilizationStore,
  ctx: ShareContext,
  input: ShareInput,
  options: {
    /** Runs only after authorization; a refusal means nothing is published. */
    transmit?: () => { ok: true } | { ok: false; reason: string };
    /** The production event bus (which persists). Defaults to appending to the store directly. */
    emit?: (event: SimEvent) => void;
  } = {},
): CommunityShareResult {
  const result = createCommunityShareEvent({
    lookup: store,
    sourceEventId: input.sourceEventId,
    actingCitizenId: ctx.actingCitizenId,
    toCommunityId: input.toCommunityId,
    message: input.message,
    directory: store.getCommunityDirectory(),
  });
  if (!result.ok) return result;
  const transmitted = options.transmit?.() ?? { ok: true as const };
  if (!transmitted.ok) return { ok: false, reason: transmitted.reason };
  if (options.emit) options.emit(result.event);
  else store.appendEvent(result.event);
  return result;
}

/**
 * Same-community announcement. The audience is the acting citizen's own community, read from the persisted directory:
 * no input can name another community, and a citizen outside the directory cannot announce at all.
 */
export function announceToOwnCommunity(
  store: CivilizationStore,
  ctx: ShareContext,
  input: { message: string },
  emit: (event: SimEvent) => void,
): CommunityShareResult {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return { ok: false, reason: "empty announcement" };
  const communityId = store.getCommunityDirectory().communityOf(ctx.actingCitizenId);
  if (!communityId) return { ok: false, reason: "acting citizen belongs to no community" };
  const event = createEvent(
    "ConversationOccurred",
    withAudience({ message, speakerId: ctx.actingCitizenId, cause: "community_announcement" }, "settlement_public", {
      scope: "community",
      communityId,
    }),
    ctx.actingCitizenId,
  );
  emit(event);
  return { ok: true, event };
}
