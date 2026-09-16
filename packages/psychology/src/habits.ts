import { clamp01, reinforce, weaken, type HabitRow } from "@civ/memory";
import type { CitizenPsychState, Habit } from "./types.js";
import type { WorldSnapshot } from "@civ/memory";
import { distance } from "@civ/shared";

export function habitFromRow(row: HabitRow): Habit {
  return { ...row };
}

export function habitToRow(value: Habit): HabitRow {
  return { ...value };
}

export function habitContext(psych: CitizenPsychState, snapshot: WorldSnapshot, citizenId: string): string {
  const parts: string[] = [];
  if (psych.stress >= 0.6) parts.push("stress_high");
  else if (psych.stress <= 0.25) parts.push("stress_low");
  if (psych.fear >= 0.5) parts.push("fear_high");
  if (psych.sadness >= 0.5) parts.push("low_mood");
  const self = snapshot.citizens.find((c) => c.id === citizenId);
  if (self?.position && snapshot.settlementOrigin) {
    if (distance(self.position, snapshot.settlementOrigin) <= 32) parts.push("settlement_safe");
    else parts.push("away_from_settlement");
  }
  if (snapshot.isNight) parts.push("night");
  return parts.join("|") || "neutral";
}

export function recordHabit(
  existing: Habit | undefined,
  citizenId: string,
  contextKey: string,
  action: string,
  success: boolean,
  at: string,
  id: string,
): Habit {
  const current = existing ?? {
    id,
    citizenId,
    contextKey,
    action,
    occurrences: 0,
    successes: 0,
    failures: 0,
    strength: 0,
    lastReinforcedAt: at,
  };
  const occurrences = current.occurrences + 1;
  const successes = current.successes + (success ? 1 : 0);
  const failures = current.failures + (success ? 0 : 1);
  const formed = occurrences >= 3;
  const nextStrength = success
    ? reinforce(current.strength, formed ? 0.18 : 0.08)
    : weaken(current.strength, 0.1);
  return {
    ...current,
    occurrences,
    successes,
    failures,
    strength: clamp01(nextStrength),
    lastReinforcedAt: at,
  };
}

export function weakenUnusedHabits(habits: Habit[], usedKey: string, usedAction: string, at: string): Habit[] {
  return habits.map((habit) => {
    if (habit.contextKey !== usedKey || habit.action === usedAction) return habit;
    if (habit.strength <= 0.05) return habit;
    return { ...habit, strength: weaken(habit.strength, 0.04), lastReinforcedAt: habit.lastReinforcedAt ?? at };
  });
}
