import type { DecisionCategory } from "@civ/shared";

export type ModelBudgetConfig = {
  /** Max LLM calls per citizen per Minecraft-day window. */
  maxCallsPerCitizenPerMcDay: number;
  /** Max ROUTINE calls in a rolling wall-clock window. */
  maxRoutineCallsPerWindow: number;
  /** Rolling window length for routine budget (ms). */
  routineWindowMs: number;
  /** Max DEEP_REFLECTION calls per citizen per MC day. */
  maxDeepReflectionCallsPerMcDay: number;
  /** Optional global cap across all citizens; undefined = no global cap. */
  globalMaxCallsPerMcDay?: number;
};

export const DEFAULT_MODEL_BUDGET: ModelBudgetConfig = {
  maxCallsPerCitizenPerMcDay: 24,
  maxRoutineCallsPerWindow: 8,
  routineWindowMs: 10 * 60 * 1000,
  maxDeepReflectionCallsPerMcDay: 4,
};

export type BudgetCallRecord = {
  citizenId: string;
  category: DecisionCategory;
  atMs: number;
  /** Minecraft day index if known. */
  mcDay?: number;
};

export type BudgetDecision = {
  allowed: boolean;
  reason: string;
  /** Never block emergency / NO_LLM paths. */
  emergencyBypass: boolean;
};

/**
 * Per-citizen model budget. Exhaustion must not block emergency reflexes.
 * Atlas exhausting budget must not consume Maya's allowance (unless global cap set).
 */
export function checkModelBudget(
  citizenId: string,
  category: DecisionCategory,
  history: BudgetCallRecord[],
  config: ModelBudgetConfig = DEFAULT_MODEL_BUDGET,
  nowMs = Date.now(),
  mcDay = 0,
): BudgetDecision {
  if (category === "NO_LLM") {
    return { allowed: true, reason: "NO_LLM does not consume budget", emergencyBypass: true };
  }

  const mine = history.filter((h) => h.citizenId === citizenId && h.category !== "NO_LLM");
  const dayMine = mine.filter((h) => (h.mcDay ?? 0) === mcDay);
  if (dayMine.length >= config.maxCallsPerCitizenPerMcDay) {
    return {
      allowed: false,
      reason: "MODEL_BUDGET_EXHAUSTED:citizen_day",
      emergencyBypass: false,
    };
  }

  if (category === "DEEP_REFLECTION") {
    const deep = dayMine.filter((h) => h.category === "DEEP_REFLECTION");
    if (deep.length >= config.maxDeepReflectionCallsPerMcDay) {
      return {
        allowed: false,
        reason: "MODEL_BUDGET_EXHAUSTED:deep_reflection",
        emergencyBypass: false,
      };
    }
  }

  if (category === "ROUTINE") {
    const routineRecent = mine.filter(
      (h) => h.category === "ROUTINE" && nowMs - h.atMs < config.routineWindowMs,
    );
    if (routineRecent.length >= config.maxRoutineCallsPerWindow) {
      return {
        allowed: false,
        reason: "MODEL_BUDGET_EXHAUSTED:routine_window",
        emergencyBypass: false,
      };
    }
  }

  if (config.globalMaxCallsPerMcDay !== undefined) {
    const globalDay = history.filter(
      (h) => h.category !== "NO_LLM" && (h.mcDay ?? 0) === mcDay,
    );
    if (globalDay.length >= config.globalMaxCallsPerMcDay) {
      return {
        allowed: false,
        reason: "MODEL_BUDGET_EXHAUSTED:global_day",
        emergencyBypass: false,
      };
    }
  }

  return { allowed: true, reason: "within budget", emergencyBypass: false };
}

export function countCitizenBudgetUsage(
  citizenId: string,
  history: BudgetCallRecord[],
  mcDay = 0,
): number {
  return history.filter(
    (h) => h.citizenId === citizenId && h.category !== "NO_LLM" && (h.mcDay ?? 0) === mcDay,
  ).length;
}
