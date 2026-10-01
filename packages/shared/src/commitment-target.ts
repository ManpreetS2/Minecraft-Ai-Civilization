/**
 * Bounded commitment target payloads (Pass 5).
 * Not a universal contract engine — item transfers + optional verified-event match only.
 */

export type ItemTransferCommitmentTarget = {
  type: "item_transfer";
  item: string;
  /** Positive integer stack quantity. */
  quantity: number;
  recipientCitizenId: string;
};

export type VerifiedEventMatchTarget = {
  type: "verified_event_match";
  eventType: string;
  /** Optional exact payload equality checks (bounded). */
  match?: Record<string, string | number | boolean>;
};

export type CommitmentTarget = ItemTransferCommitmentTarget | VerifiedEventMatchTarget;

export type ParsedCommitmentPayload =
  | { ok: true; target: CommitmentTarget }
  | { ok: false; error: string };

export function parseCommitmentPayload(payload: string | undefined): ParsedCommitmentPayload {
  if (!payload || !payload.trim()) {
    return { ok: false, error: "missing structured commitment payload" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { ok: false, error: "commitment payload is not JSON" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "commitment payload must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.type === "item_transfer") {
    const item = typeof obj.item === "string" ? obj.item.trim() : "";
    const quantity = obj.quantity;
    const recipientCitizenId =
      typeof obj.recipientCitizenId === "string" ? obj.recipientCitizenId.trim() : "";
    if (!item) return { ok: false, error: "item_transfer requires item" };
    if (!Number.isInteger(quantity) || (quantity as number) <= 0) {
      return { ok: false, error: "item_transfer quantity must be a positive integer" };
    }
    if (!recipientCitizenId) return { ok: false, error: "item_transfer requires recipientCitizenId" };
    return {
      ok: true,
      target: { type: "item_transfer", item, quantity: quantity as number, recipientCitizenId },
    };
  }
  if (obj.type === "verified_event_match") {
    const eventType = typeof obj.eventType === "string" ? obj.eventType.trim() : "";
    if (!eventType) return { ok: false, error: "verified_event_match requires eventType" };
    const match =
      obj.match && typeof obj.match === "object" && !Array.isArray(obj.match)
        ? (obj.match as Record<string, string | number | boolean>)
        : undefined;
    return { ok: true, target: { type: "verified_event_match", eventType, match } };
  }
  return { ok: false, error: `unsupported commitment target type: ${String(obj.type)}` };
}

export function serializeCommitmentTarget(target: CommitmentTarget): string {
  return JSON.stringify(target);
}
