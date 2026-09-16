import { clamp01, type ActivityRow } from "@civ/memory";
import { parseJson, toJson } from "./json.js";
import { ACTIVITIES, type ActivityExperience } from "./types.js";

const RECENT_WINDOW = 8;

export function activityFromRow(row: ActivityRow): ActivityExperience {
  const recent = parseJson<number[]>(row.recentResultsJson, []);
  const hits = recent.reduce((sum, value) => sum + value, 0);
  const recentSuccessRate = recent.length === 0 ? 0 : hits / recent.length;
  return {
    citizenId: row.citizenId,
    activity: row.activity,
    attempts: row.attempts,
    successes: row.successes,
    failures: row.failures,
    recentSuccessRate,
    familiarity: row.familiarity,
    confidence: row.confidence,
    lastPerformedAt: row.lastPerformedAt,
  };
}

export function activityToRow(value: ActivityExperience, recent: number[]): ActivityRow {
  return {
    citizenId: value.citizenId,
    activity: value.activity,
    attempts: value.attempts,
    successes: value.successes,
    failures: value.failures,
    recentResultsJson: toJson(recent),
    familiarity: value.familiarity,
    confidence: value.confidence,
    lastPerformedAt: value.lastPerformedAt,
  };
}

export function recordActivityAttempt(
  existing: ActivityExperience | undefined,
  citizenId: string,
  activity: string,
  success: boolean,
  at: string,
  recent: number[] = [],
): { experience: ActivityExperience; recent: number[] } {
  const current = existing ?? {
    citizenId,
    activity,
    attempts: 0,
    successes: 0,
    failures: 0,
    recentSuccessRate: 0,
    familiarity: 0,
    confidence: 0.4,
  };
  const nextRecent = [...recent, success ? 1 : 0].slice(-RECENT_WINDOW);
  const attempts = current.attempts + 1;
  const successes = current.successes + (success ? 1 : 0);
  const failures = current.failures + (success ? 0 : 1);
  const recentSuccessRate = nextRecent.reduce((sum, value) => sum + value, 0) / nextRecent.length;
  const familiarity = clamp01(1 - Math.exp(-attempts / 8));
  const successRate = attempts === 0 ? 0 : successes / attempts;
  const confidence = clamp01(0.25 + familiarity * 0.35 + recentSuccessRate * 0.3 + successRate * 0.1);
  return {
    experience: {
      citizenId,
      activity,
      attempts,
      successes,
      failures,
      recentSuccessRate,
      familiarity,
      confidence,
      lastPerformedAt: at,
    },
    recent: nextRecent,
  };
}

export function normalizeActivity(raw: string): string {
  const key = raw.toLowerCase().replaceAll(/[\s-]+/g, "_");
  if (key.includes("wood") || key.includes("lumber") || key.includes("log")) return "gather_wood";
  if (key.includes("food") || key.includes("hunt") || key.includes("fish") || key.includes("eat")) return "gather_food";
  if (key.includes("mine") || key.includes("stone") || key.includes("ore")) return "mine_stone";
  if (key.includes("craft") || key.includes("tool")) return "craft_tools";
  if (key.includes("build") || key.includes("shelter") || key.includes("construct")) return "build";
  if (key.includes("explore") || key.includes("scout")) return "explore";
  if (key.includes("fight") || key.includes("attack") || key.includes("defend") || key.includes("combat")) return "fight";
  if (key.includes("trade") || key.includes("give") || key.includes("share")) return "trade";
  if (key.includes("farm") || key.includes("crop") || key.includes("plant") || key.includes("harvest")) return "farm";
  if ((ACTIVITIES as readonly string[]).includes(key)) return key;
  return key;
}
