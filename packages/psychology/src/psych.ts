import {
  clamp01,
  clampDelta,
  clampSigned,
  DEFAULT_PSYCH,
  type PsychRow,
} from "@civ/memory";
import { parseJson, toJson } from "./json.js";
import type { CitizenPsychState, CurrentConcern, PsychDeltas } from "./types.js";

export function psychFromRow(row: PsychRow): CitizenPsychState {
  return {
    citizenId: row.citizenId,
    moodValence: row.moodValence,
    stress: row.stress,
    fear: row.fear,
    anger: row.anger,
    sadness: row.sadness,
    positiveAffect: row.positiveAffect,
    confidence: row.confidence,
    currentConcerns: parseJson<CurrentConcern[]>(row.currentConcernsJson, []),
    updatedAt: row.updatedAt,
  };
}

export function psychToRow(state: CitizenPsychState): PsychRow {
  return {
    citizenId: state.citizenId,
    moodValence: state.moodValence,
    stress: state.stress,
    fear: state.fear,
    anger: state.anger,
    sadness: state.sadness,
    positiveAffect: state.positiveAffect,
    confidence: state.confidence,
    currentConcernsJson: toJson(state.currentConcerns),
    updatedAt: state.updatedAt,
  };
}

export function defaultPsych(citizenId: string, at: string): CitizenPsychState {
  return {
    citizenId,
    ...DEFAULT_PSYCH,
    currentConcerns: [],
    updatedAt: at,
  };
}

export function applyPsychDeltas(state: CitizenPsychState, deltas: PsychDeltas, at: string): CitizenPsychState {
  return {
    ...state,
    moodValence: clampSigned(state.moodValence + clampDelta(deltas.moodDelta ?? 0)),
    stress: clamp01(state.stress + clampDelta(deltas.stressDelta ?? 0)),
    fear: clamp01(state.fear + clampDelta(deltas.fearDelta ?? 0)),
    anger: clamp01(state.anger + clampDelta(deltas.angerDelta ?? 0)),
    sadness: clamp01(state.sadness + clampDelta(deltas.sadnessDelta ?? 0)),
    positiveAffect: clamp01(state.positiveAffect + clampDelta(deltas.positiveAffectDelta ?? 0)),
    confidence: clamp01(state.confidence + clampDelta(deltas.confidenceDelta ?? 0)),
    updatedAt: at,
  };
}

export function dominantAffect(state: CitizenPsychState): { dominant: string; intensity: number } {
  const candidates: Array<[string, number]> = [
    ["fear", state.fear],
    ["anger", state.anger],
    ["sadness", state.sadness],
    ["stress", state.stress],
    ["positive", state.positiveAffect],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  const top = candidates[0] ?? ["neutral", 0];
  if ((top[1] ?? 0) < 0.25) return { dominant: "neutral", intensity: top[1] ?? 0 };
  return { dominant: top[0] ?? "neutral", intensity: top[1] ?? 0 };
}

export function upsertConcern(state: CitizenPsychState, concern: CurrentConcern): CitizenPsychState {
  const rest = state.currentConcerns.filter((item) => item.description !== concern.description);
  const next = [...rest, concern].sort((a, b) => b.urgency - a.urgency).slice(0, 6);
  return { ...state, currentConcerns: next };
}

export function clearConcern(state: CitizenPsychState, match: string): CitizenPsychState {
  return {
    ...state,
    currentConcerns: state.currentConcerns.filter((item) => !item.description.toLowerCase().includes(match.toLowerCase())),
  };
}

export function describeMood(state: CitizenPsychState): string {
  if (state.fear > 0.55 && state.stress > 0.5) return "fearful and stressed";
  if (state.stress > 0.55 && state.moodValence < 0) return "stressed but recovering";
  if (state.stress > 0.55) return "stressed";
  if (state.sadness > 0.5) return "low mood";
  if (state.anger > 0.5) return "angry";
  if (state.positiveAffect > 0.6 && state.moodValence > 0.2) return "in good spirits";
  if (state.moodValence < -0.3) return "subdued";
  return "steady";
}
