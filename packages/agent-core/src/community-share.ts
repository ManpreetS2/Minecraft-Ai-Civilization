import { createCommunityShareEvent, type CommunityShareResult } from "@civ/shared";
import type { CivilizationStore } from "./store.js";

/** Trusted runtime context: who is actually acting. Comes from the runtime that owns the citizen, not from input. */
export type ShareContext = { actingCitizenId: string };

/** Untrusted input (e.g. a model's tool call). Only these three fields are read; anything else is ignored. */
export type ShareInput = { sourceEventId: string; toCommunityId: string; message: string };

/**
 * Explicit cross-community sharing: loads the source event from the store by id, verifies the acting citizen can
 * read it against a fresh directory, and appends a NEW event whose audience is exactly the receiving community.
 */
export function shareEventWithCommunity(store: CivilizationStore, ctx: ShareContext, input: ShareInput): CommunityShareResult {
  const result = createCommunityShareEvent({
    lookup: store,
    sourceEventId: input.sourceEventId,
    actingCitizenId: ctx.actingCitizenId,
    toCommunityId: input.toCommunityId,
    message: input.message,
    directory: store.getCommunityDirectory(),
  });
  if (result.ok) store.appendEvent(result.event);
  return result;
}
