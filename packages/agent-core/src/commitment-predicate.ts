import type { Commitment } from "@civ/shared";
import { parseCommitmentPayload, type ItemTransferCommitmentTarget } from "@civ/shared";

export type VerifiedTransferFacts = {
  eventId: string;
  giverCitizenId: string;
  receiverCitizenId: string;
  item: string;
  quantity: number;
  timestamp: string;
};

export type TransferMatchResult =
  | {
      matches: true;
      target: ItemTransferCommitmentTarget;
      creditedQuantity: number;
    }
  | {
      matches: false;
      reason: string;
    };

/**
 * A verified event is necessary but not sufficient.
 * Caller hints (candidate ids) never force completion without predicate match.
 */
export function matchItemTransferCommitment(
  commitment: Commitment,
  transfer: VerifiedTransferFacts,
): TransferMatchResult {
  if (commitment.status !== "ACTIVE") {
    return { matches: false, reason: `commitment status is ${commitment.status}` };
  }
  if (commitment.ownerCitizenId !== transfer.giverCitizenId) {
    return { matches: false, reason: "wrong giver for commitment owner" };
  }
  const parsed = parseCommitmentPayload(commitment.payload);
  if (!parsed.ok) {
    return { matches: false, reason: parsed.error };
  }
  if (parsed.target.type !== "item_transfer") {
    return { matches: false, reason: "commitment target is not item_transfer" };
  }
  const target = parsed.target;
  if (target.item !== transfer.item) {
    return { matches: false, reason: "wrong item" };
  }
  if (target.recipientCitizenId !== transfer.receiverCitizenId) {
    return { matches: false, reason: "wrong recipient" };
  }
  if (!Number.isInteger(transfer.quantity) || transfer.quantity <= 0) {
    return { matches: false, reason: "transfer quantity must be a positive integer" };
  }
  return {
    matches: true,
    target,
    creditedQuantity: transfer.quantity,
  };
}

export type CommitmentProgressView = {
  commitmentId: string;
  required: number;
  delivered: number;
  remaining: number;
  complete: boolean;
  eventIds: string[];
};

export function progressFromLedger(
  commitmentId: string,
  required: number,
  rows: Array<{ sourceEventId: string; quantity: number }>,
): CommitmentProgressView {
  const delivered = rows.reduce((sum, r) => sum + r.quantity, 0);
  return {
    commitmentId,
    required,
    delivered,
    remaining: Math.max(0, required - delivered),
    complete: delivered >= required,
    eventIds: rows.map((r) => r.sourceEventId),
  };
}
