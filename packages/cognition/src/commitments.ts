import type { Commitment, CommitmentStatus } from "@civ/shared";

export type CreateCommitmentInput = {
  id?: string;
  ownerCitizenId: string;
  counterpartyId?: string;
  goal: string;
  payload?: string;
  createdAt?: string;
  expiresAt?: string;
  reconsiderAt?: string;
  evidence?: string[];
};

export function createCommitment(input: CreateCommitmentInput): Commitment {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    ownerCitizenId: input.ownerCitizenId,
    counterpartyId: input.counterpartyId,
    goal: input.goal.trim(),
    payload: input.payload,
    createdAt,
    updatedAt: createdAt,
    status: "ACTIVE",
    evidence: [...(input.evidence ?? [])],
    expiresAt: input.expiresAt,
    reconsiderAt: input.reconsiderAt,
    completionEvidence: [],
  };
}

/**
 * Only verified physical/social evidence may complete a commitment.
 * LLM proposals never mark COMPLETE.
 */
export function updateCommitmentStatus(
  commitment: Commitment,
  status: CommitmentStatus,
  evidence?: string,
  failureReason?: string,
): Commitment {
  if (status === "COMPLETED") {
    throw new Error("Use completeCommitment() with verified evidence");
  }
  const now = new Date().toISOString();
  return {
    ...commitment,
    status,
    updatedAt: now,
    failureReason: status === "FAILED" ? (failureReason ?? evidence) : commitment.failureReason,
    evidence: evidence ? [...commitment.evidence, evidence] : commitment.evidence,
  };
}

export type CompleteCommitmentOptions = {
  completionEvidenceEventId?: string;
  now?: string;
};

export function completeCommitment(
  commitment: Commitment,
  verifiedEvidence: string[],
  options: CompleteCommitmentOptions = {},
): Commitment | { error: string } {
  if (commitment.status === "COMPLETED") {
    return { error: `Commitment already COMPLETED` };
  }
  if (commitment.status !== "ACTIVE") {
    return { error: `Commitment not ACTIVE (${commitment.status})` };
  }
  const clean = verifiedEvidence.map((e) => e.trim()).filter(Boolean);
  if (clean.length === 0) {
    return { error: "Refusing COMPLETE without verified evidence" };
  }
  // Require at least one evidence string that looks like a real transfer/event id/key.
  const hasVerifiedMarker = clean.some(
    (e) =>
      e.startsWith("event:") ||
      e.startsWith("transfer:") ||
      e.startsWith("verified:") ||
      e.includes("ItemTransferred") ||
      e.includes("TaskCompleted"),
  );
  if (!hasVerifiedMarker) {
    return { error: "Evidence lacks verification marker; not inventing success" };
  }
  const fromEvidence = clean.find((e) => e.startsWith("event:"))?.slice("event:".length);
  const completionEvidenceEventId = options.completionEvidenceEventId ?? fromEvidence;
  if (!completionEvidenceEventId) {
    return { error: "Refusing COMPLETE without completionEvidenceEventId" };
  }
  const now = options.now ?? new Date().toISOString();
  return {
    ...commitment,
    status: "COMPLETED",
    updatedAt: now,
    completionEvidence: clean,
    completionEvidenceEventId,
    evidence: [...commitment.evidence, ...clean],
  };
}

export function expireCommitments(commitments: Commitment[], nowIso: string): Commitment[] {
  const now = Date.parse(nowIso);
  return commitments.map((c) => {
    if (c.status !== "ACTIVE" || !c.expiresAt) return c;
    if (Date.parse(c.expiresAt) <= now) {
      return {
        ...c,
        status: "EXPIRED" as const,
        updatedAt: nowIso,
        evidence: [...c.evidence, `expired:${nowIso}`],
      };
    }
    return c;
  });
}

export function activeCommitmentsFor(citizenId: string, commitments: Commitment[]): Commitment[] {
  return commitments.filter(
    (c) =>
      c.status === "ACTIVE" && (c.ownerCitizenId === citizenId || c.counterpartyId === citizenId),
  );
}
