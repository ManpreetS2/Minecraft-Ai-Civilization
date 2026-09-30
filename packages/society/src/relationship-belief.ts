import type { RelationshipBelief } from "@civ/shared";

export type BeliefEventKind =
  | "helped" // observer helped subject
  | "was_helped" // observer received help from subject
  | "shared_resource"
  | "cooperated"
  | "request_made"
  | "promise_made"
  | "promise_broken"
  | "conflict"
  | "talked"
  | "heard_about"; // second-hand — must NOT grant first-person certainty

export type BeliefEvent = {
  kind: BeliefEventKind;
  /** Who is updating their belief (first-person observer). */
  observerId: string;
  /** Who the belief is about. */
  subjectId: string;
  detail?: string;
  at?: string;
  /** When true, observer directly experienced the event. */
  firstPerson: boolean;
};

const CLAMP01 = (n: number) => Math.max(0, Math.min(1, n));

export function blankBelief(observerId: string, subjectId: string, at = new Date().toISOString()): RelationshipBelief {
  return {
    observerId,
    subjectId,
    trust: 0.5,
    familiarity: 0,
    recentPositive: 0,
    recentNegative: 0,
    unresolvedRequests: [],
    unresolvedPromises: [],
    resourceTransfers: 0,
    cooperationCount: 0,
    evidenceCount: 0,
    updatedAt: at,
  };
}

/**
 * Asymmetric relationship beliefs from observed evidence only.
 * Atlas→Maya is independent of Maya→Atlas.
 * Hearing ABOUT an event does not create first-person certainty.
 */
export function applyBeliefEvent(belief: RelationshipBelief, event: BeliefEvent): RelationshipBelief {
  if (belief.observerId !== event.observerId || belief.subjectId !== event.subjectId) {
    return belief;
  }
  const at = event.at ?? new Date().toISOString();
  const next: RelationshipBelief = {
    ...belief,
    unresolvedRequests: [...belief.unresolvedRequests],
    unresolvedPromises: [...belief.unresolvedPromises],
    updatedAt: at,
  };

  if (!event.firstPerson || event.kind === "heard_about") {
    // Second-hand rumor: tiny familiarity only, no trust certainty.
    next.familiarity = CLAMP01(next.familiarity + 0.01);
    next.evidenceCount += 1;
    return next;
  }

  switch (event.kind) {
    case "helped":
      // Actor view: familiarity rises more than trust.
      next.familiarity = CLAMP01(next.familiarity + 0.08);
      next.trust = CLAMP01(next.trust + 0.03);
      next.recentPositive += 1;
      break;
    case "was_helped":
      // Recipient view: trust rises more.
      next.trust = CLAMP01(next.trust + 0.1);
      next.familiarity = CLAMP01(next.familiarity + 0.04);
      next.recentPositive += 1;
      break;
    case "shared_resource":
      next.trust = CLAMP01(next.trust + 0.06);
      next.recentPositive += 1;
      next.resourceTransfers += 1;
      break;
    case "cooperated":
      next.cooperationCount += 1;
      next.familiarity = CLAMP01(next.familiarity + 0.07);
      next.recentPositive += 1;
      break;
    case "request_made":
      if (event.detail) next.unresolvedRequests.push(event.detail);
      next.familiarity = CLAMP01(next.familiarity + 0.03);
      break;
    case "promise_made":
      if (event.detail) next.unresolvedPromises.push(event.detail);
      break;
    case "promise_broken":
      next.trust = CLAMP01(next.trust - 0.12);
      next.recentNegative += 1;
      if (event.detail) {
        next.unresolvedPromises = next.unresolvedPromises.filter((p) => p !== event.detail);
      }
      break;
    case "conflict":
      next.trust = CLAMP01(next.trust - 0.1);
      next.recentNegative += 1;
      break;
    case "talked":
      next.familiarity = CLAMP01(next.familiarity + 0.04);
      break;
    default:
      break;
  }
  next.evidenceCount += 1;
  return next;
}

export function resolveRequest(belief: RelationshipBelief, detail: string): RelationshipBelief {
  return {
    ...belief,
    unresolvedRequests: belief.unresolvedRequests.filter((r) => r !== detail),
    updatedAt: new Date().toISOString(),
  };
}

export function resolvePromise(belief: RelationshipBelief, detail: string, kept: boolean): RelationshipBelief {
  const base = {
    ...belief,
    unresolvedPromises: belief.unresolvedPromises.filter((p) => p !== detail),
    updatedAt: new Date().toISOString(),
  };
  if (kept) {
    return {
      ...base,
      trust: CLAMP01(base.trust + 0.05),
      recentPositive: base.recentPositive + 1,
      evidenceCount: base.evidenceCount + 1,
    };
  }
  return applyBeliefEvent(base, {
    kind: "promise_broken",
    observerId: belief.observerId,
    subjectId: belief.subjectId,
    detail,
    firstPerson: true,
  });
}
