import { normalizeFollowUps } from "./decision-contract.js";
import type { Goal } from "./goals.js";
import { normalizeGoal } from "./normalize.js";

export type CompoundParse =
  | { ok: true; primaryGoal: Goal; followUpGoals: Goal[] }
  | { ok: false; code: "UNKNOWN_GOAL" | "EXECUTION_LEVEL"; error: string };

const EXECUTION_LEVEL =
  /\b(walk|jump|sprint|sneak|stand at|go to coordinates|break block|mine block|place block|open (this|the) (exact )?door|path around|strafe|look at block|click|attack (the )?(block|pig|cow))\b|\b-?\d+\s*[/,]\s*-?\d+\s*[/,]\s*-?\d+\b/i;

/**
 * Safe high-level split only. Not a phrase dictionary.
 * "Gather stone and craft better tools" → craft_tools + mine_stone when a tool is missing.
 */
export function parseCompoundGoal(text: string, facts?: { hasPickaxe?: boolean }): CompoundParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, code: "UNKNOWN_GOAL", error: "Empty goal." };
  if (EXECUTION_LEVEL.test(trimmed) || isExecutionLevelObject({ goal: trimmed })) {
    return { ok: false, code: "EXECUTION_LEVEL", error: "That is a runtime/body command, not a high-level goal." };
  }

  const chunks = trimmed
    .split(/\b(?:and then|and also|then|and|,|;)\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const goals: Goal[] = [];
  for (const chunk of chunks) {
    const goal = normalizeGoal(chunk);
    if (!goal) {
      if (chunks.length === 1) return { ok: false, code: "UNKNOWN_GOAL", error: `Unknown goal: ${chunk}` };
      continue;
    }
    if (!goals.includes(goal)) goals.push(goal);
  }
  if (goals.length === 0) return { ok: false, code: "UNKNOWN_GOAL", error: "No bounded goal recognized." };

  let primary = goals[0]!;
  let followUps = goals.slice(1);
  if (goals.includes("craft_tools") && goals.includes("mine_stone") && facts?.hasPickaxe === false) {
    primary = "craft_tools";
    followUps = normalizeFollowUps(["mine_stone", ...followUps.filter((g) => g !== "craft_tools")], primary);
  } else {
    followUps = normalizeFollowUps(followUps, primary);
  }
  return { ok: true, primaryGoal: primary, followUpGoals: followUps };
}

export function isExecutionLevelObject(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const row = input as Record<string, unknown>;
  const blob = `${row.goal ?? ""} ${row.reason ?? ""} ${row.action ?? ""} ${row.command ?? ""}`;
  if (EXECUTION_LEVEL.test(blob)) return true;
  if (typeof row.x === "number" && typeof row.y === "number" && typeof row.z === "number") return true;
  if (row.walk || row.jump || row.path || row.breakBlock || row.setblock) return true;
  return false;
}

export function rejectExecutionLevel(input: unknown): void {
  if (isExecutionLevelObject(input)) {
    const error = new Error("EXECUTION_LEVEL");
    error.name = "EXECUTION_LEVEL";
    throw error;
  }
}
