import type { DeliberationTrigger } from "./router.js";

export type CooldownState = {
  lastAt: Map<string, number>;
  lastHash: Map<string, string>;
};

export function createCooldownState(): CooldownState {
  return { lastAt: new Map(), lastHash: new Map() };
}

export type DeliberateCheck = {
  citizenId: string;
  now: number;
  cooldownMs: number;
  trigger?: DeliberationTrigger;
  hasGoal: boolean;
  busy: boolean;
  consecutiveFailures: number;
  idle: boolean;
  worldHash?: string;
};

/**
 * Do not ask the model every tick. Routine physical execution stays deterministic.
 */
export function shouldDeliberate(check: DeliberateCheck, state: CooldownState): {
  allowed: boolean;
  reason: string;
} {
  if (check.trigger === "goal_completed" || check.trigger === "significant_event" || check.trigger === "reflection_updated") {
    return { allowed: true, reason: check.trigger };
  }
  if (check.trigger === "goal_failed_repeatedly" || check.consecutiveFailures >= 3) {
    return { allowed: true, reason: "goal_failed_repeatedly" };
  }
  if (check.trigger === "major_need_changed" || check.trigger === "settlement_changed") {
    return { allowed: true, reason: check.trigger };
  }
  if (check.idle && !check.hasGoal && !check.busy) {
    const last = state.lastAt.get(check.citizenId);
    if (last !== undefined && check.now - last < check.cooldownMs) {
      const hashUnchanged = !check.worldHash || state.lastHash.get(check.citizenId) === check.worldHash;
      if (hashUnchanged) return { allowed: false, reason: "idle_cooldown" };
    }
    return { allowed: true, reason: "idle" };
  }
  if (!check.trigger) {
    return { allowed: false, reason: "no_trigger" };
  }
  const last = state.lastAt.get(check.citizenId);
  if (last !== undefined && check.now - last < check.cooldownMs) {
    const hashUnchanged = !check.worldHash || state.lastHash.get(check.citizenId) === check.worldHash;
    if (hashUnchanged) return { allowed: false, reason: "cooldown" };
  }
  return { allowed: true, reason: check.trigger };
}

export function markDeliberated(state: CooldownState, citizenId: string, now: number, worldHash?: string): void {
  state.lastAt.set(citizenId, now);
  if (worldHash) state.lastHash.set(citizenId, worldHash);
}
