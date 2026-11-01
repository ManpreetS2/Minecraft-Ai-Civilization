import { createHmac, timingSafeEqual } from "node:crypto";
import type { KnowledgeKind } from "./knowledge-provenance.js";

/**
 * An operator's approval to release one quarantined record. The key lives in the operator's environment, never in
 * SQLite, config files or prompts, so a database row, a model output or a free-text reference cannot produce a grant.
 *
 * This authenticates possession of the key, not a person: `operatorId` is the name the key holder wrote. Code already
 * running in this process could read the key, so it is trusted by definition. Issue grants from separate operator
 * tooling; no simulation path may import signKnowledgeRelease (see sec001-independent-review.test.ts).
 */
export const KNOWLEDGE_RELEASE_KEY_ENV = "KNOWLEDGE_RELEASE_KEY";
const MIN_KEY_LENGTH = 32;

export type KnowledgeReleaseTarget = {
  kind: KnowledgeKind;
  recordId: string;
  citizenId: string;
  sourceEventId: string;
};

export type KnowledgeReleaseGrant = KnowledgeReleaseTarget & {
  authorizationId: string;
  operatorId: string;
  mac: string;
};

function macFor(grant: Omit<KnowledgeReleaseGrant, "mac">, key: string): string {
  const message = JSON.stringify([
    grant.authorizationId,
    grant.operatorId,
    grant.kind,
    grant.recordId,
    grant.citizenId,
    grant.sourceEventId,
  ]);
  return createHmac("sha256", key).update(message).digest("hex");
}

export function signKnowledgeRelease(
  grant: Omit<KnowledgeReleaseGrant, "mac">,
  key: string,
): KnowledgeReleaseGrant {
  if (key.length < MIN_KEY_LENGTH) throw new Error(`release key must be at least ${MIN_KEY_LENGTH} characters`);
  return { ...grant, mac: macFor(grant, key) };
}

/** Returns why the grant does not authorize this exact release, or undefined when it does. */
export function refuseKnowledgeRelease(
  grant: KnowledgeReleaseGrant | undefined,
  target: KnowledgeReleaseTarget,
  key: string | undefined,
): string | undefined {
  if (!key || key.length < MIN_KEY_LENGTH) return `${KNOWLEDGE_RELEASE_KEY_ENV} is not configured`;
  if (
    !grant ||
    typeof grant.authorizationId !== "string" ||
    !grant.authorizationId.trim() ||
    typeof grant.operatorId !== "string" ||
    !grant.operatorId.trim() ||
    typeof grant.mac !== "string"
  ) {
    return "malformed release grant";
  }
  if (
    grant.kind !== target.kind ||
    grant.recordId !== target.recordId ||
    grant.citizenId !== target.citizenId ||
    grant.sourceEventId !== target.sourceEventId
  ) {
    return "release grant names a different citizen, record or source";
  }
  const expected = Buffer.from(macFor(grant, key), "utf8");
  const supplied = Buffer.from(grant.mac, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return "release grant failed authentication";
  }
  return undefined;
}
