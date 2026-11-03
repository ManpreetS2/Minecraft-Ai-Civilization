import type { DecisionCategory } from "@civ/shared";

export type CooldownState = {
  citizenId: string;
  currentGoal?: string;
  lastDecisionAt: number;
  lastCategory: DecisionCategory;
  lastFailureAt?: number;
  majorEventAt?: number;
  requestAt?: number;
  survivalSeverity: number; // 0..1
  goalValid: boolean;
};

export type CooldownDecision = {
  allowLlm: boolean;
  reason: string;
  forceReconsider: boolean;
};

export type CooldownConfig = {
  routineCooldownMs?: number;
  importantCooldownMs?: number;
  deepCooldownMs?: number;
};

const DEFAULTS: Required<CooldownConfig> = {
  routineCooldownMs: 60_000,
  importantCooldownMs: 20_000,
  deepCooldownMs: 10_000,
};

/**
 * Anti-thrash: avoid LLM every tick in stable situations.
 * Never overrides lethal NO_LLM safety (caller checks that first).
 */
export function shouldReconsiderDecision(
  state: CooldownState,
  category: DecisionCategory,
  now = Date.now(),
  config: CooldownConfig = {},
): CooldownDecision {
  if (category === "NO_LLM") {
    return { allowLlm: false, reason: "NO_LLM category", forceReconsider: false };
  }
  if (!state.goalValid) {
    return { allowLlm: true, reason: "current goal invalid", forceReconsider: true };
  }
  if (state.survivalSeverity >= 0.85) {
    // Near-lethal but not reflex: allow early reconsider.
    return { allowLlm: true, reason: "survival state changed significantly", forceReconsider: true };
  }
  if (state.lastFailureAt !== undefined && now - state.lastFailureAt < 15_000) {
    return { allowLlm: true, reason: "recent skill failure", forceReconsider: true };
  }
  if (state.majorEventAt !== undefined && now - state.majorEventAt < 30_000) {
    return { allowLlm: true, reason: "major event", forceReconsider: true };
  }
  if (state.requestAt !== undefined && now - state.requestAt < 30_000) {
    return { allowLlm: true, reason: "new request", forceReconsider: true };
  }

  const cfg = { ...DEFAULTS, ...config };
  const minGap =
    category === "DEEP_REFLECTION"
      ? cfg.deepCooldownMs
      : category === "IMPORTANT"
        ? cfg.importantCooldownMs
        : cfg.routineCooldownMs;

  if (now - state.lastDecisionAt < minGap && state.currentGoal) {
    return {
      allowLlm: false,
      reason: "stable situation; continue current valid work",
      forceReconsider: false,
    };
  }
  return { allowLlm: true, reason: "cooldown elapsed", forceReconsider: false };
}
