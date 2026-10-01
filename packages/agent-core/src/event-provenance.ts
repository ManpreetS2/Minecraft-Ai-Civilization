/**
 * Provenance helpers for brain effects derived from verified Minecraft events.
 *
 * Invariant: a synthetic effect identifier must never be mistaken for an
 * independently verified Minecraft event.
 */

export type BeliefEffectRole = "direct" | "transfer_giver" | "transfer_receiver";

/** Effect-row key stored in relationship_belief_evidence.event_id (NOT a MC event id). */
export function beliefEffectKey(sourceEventId: string, role: BeliefEffectRole): string {
  if (role === "direct") return sourceEventId;
  return `${sourceEventId}#${role}`;
}

export function isSyntheticEffectId(id: string): boolean {
  return id.includes("#") || id.endsWith(":recv");
}

export function parseBeliefEffectKey(effectKey: string): {
  sourceEventId: string;
  effectRole: BeliefEffectRole;
  synthetic: boolean;
} {
  if (effectKey.endsWith(":recv")) {
    return {
      sourceEventId: effectKey.slice(0, -":recv".length),
      effectRole: "transfer_receiver",
      synthetic: true,
    };
  }
  const hash = effectKey.indexOf("#");
  if (hash >= 0) {
    const role = effectKey.slice(hash + 1);
    const normalized: BeliefEffectRole =
      role === "transfer_giver" || role === "transfer_receiver" ? role : "direct";
    return {
      sourceEventId: effectKey.slice(0, hash),
      effectRole: normalized,
      synthetic: true,
    };
  }
  return { sourceEventId: effectKey, effectRole: "direct", synthetic: false };
}

export function memoryIdForTransfer(sourceEventId: string, side: "giver" | "receiver"): string {
  return `mem:${sourceEventId}:${side}`;
}

export function learnedEvidenceId(
  sourceEventId: string,
  citizenId: string,
  dimension: string,
): string {
  return `learned:${sourceEventId}:${citizenId}:${dimension}`;
}

export function progressLedgerId(commitmentId: string, sourceEventId: string): string {
  return `progress:${commitmentId}:${sourceEventId}`;
}
