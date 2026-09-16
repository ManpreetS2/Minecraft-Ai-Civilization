/** Simulation-state bounds. These are not clinical scales. */

export const UNIT = { min: 0, max: 1 } as const;
export const SIGNED_UNIT = { min: -1, max: 1 } as const;

/** Per-event psych deltas stay small so one event cannot rewrite a citizen. */
export const DELTA = { min: -0.2, max: 0.2 } as const;

export const DEFAULT_PSYCH = {
  moodValence: 0,
  stress: 0.2,
  fear: 0,
  anger: 0,
  sadness: 0,
  positiveAffect: 0.4,
  confidence: 0.4,
} as const;

export const DURABLE_IMPORTANCE = 0.35;
export const ROUTINE_IMPORTANCE = 0.25;
export const DEFAULT_NEARBY_RADIUS = 24;
export const IMMEDIATE_TTL_MS = 6 * 60 * 60 * 1000;
export const CONSOLIDATION_ROUTINE_MIN = 5;
export const HABIT_FORM_OCCURRENCES = 3;
export const ASSOCIATION_DECAY_PER_DAY = 0.02;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function clampSigned(value: number): number {
  return clamp(value, -1, 1);
}

export function clampDelta(value: number): number {
  return clamp(value, DELTA.min, DELTA.max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** Asymptotic reinforce so strength never freezes at 1. */
export function reinforce(current: number, amount: number): number {
  const a = clamp01(amount);
  return clamp01(current + a * (1 - current));
}

export function weaken(current: number, amount: number): number {
  return clamp01(current - clamp01(amount));
}
