import { clamp01 } from "./bounds.js";
import type { AppraisalDimensions, ObjectiveWorldEvent } from "./types.js";

export type SalienceHints = {
  physicalDanger?: boolean;
  resourceLoss?: boolean;
  resourceGain?: boolean;
  socialRelevance?: boolean;
  death?: boolean;
  betrayal?: boolean;
  rescue?: boolean;
  achievement?: boolean;
  novelty?: boolean;
  goalRelevance?: boolean;
  emotionalIntensity?: number;
};

export function scoreSalience(
  event: ObjectiveWorldEvent,
  dimensions: AppraisalDimensions,
  hints: SalienceHints = {},
): number {
  let score = 0;
  score += dimensions.threatLevel * 0.22;
  score += Math.abs(dimensions.materialImpact) * 0.12;
  score += Math.abs(dimensions.goalImpact) * 0.1;
  score += dimensions.harm * 0.12;
  score += dimensions.helpfulness > 0 ? dimensions.helpfulness * 0.1 : 0;
  score += dimensions.socialRelevance * 0.1;
  score += dimensions.novelty * 0.08;
  score += dimensions.urgency * 0.08;
  score += (hints.emotionalIntensity ?? Math.abs(dimensions.goalImpact) * 0.5) * 0.08;

  if (hints.physicalDanger || event.category === "citizen_damaged") score += 0.18;
  if (hints.death || event.category === "citizen_death") score += 0.35;
  if (hints.betrayal) score += 0.22;
  if (hints.rescue || event.category === "citizen_helped") score += 0.16;
  if (hints.resourceLoss || event.category === "citizen_item_lost") score += 0.14;
  if (hints.resourceGain || event.category === "citizen_item_received") score += 0.08;
  if (hints.achievement || event.category === "construction_completed") score += 0.1;
  if (event.category === "citizen_attacked_citizen") score += 0.28;
  if (event.category === "danger_encountered" && Boolean(event.facts.harmOccurred)) score += 0.2;
  if (event.category === "promise_agreement") score += 0.12;

  return clamp01(score);
}

export function isRoutineEvent(event: ObjectiveWorldEvent, importance: number): boolean {
  if (importance >= 0.35) return false;
  return (
    event.category === "task_succeeded" ||
    event.category === "resource_discovered" ||
    (event.category === "task_failed" && importance < 0.3)
  );
}
