import type { DecisionCategory } from "@civ/shared";
import type { BudgetCallRecord } from "@civ/cognition";
import type { CivilizationStore } from "./store.js";

/**
 * Durable model-budget accounting policy (Pass 5):
 *
 * - Authoritative store: `llm_calls` rows with counts_toward_budget=1.
 * - NO_LLM never sets counts_toward_budget.
 * - Failed provider calls (ok=0) do NOT consume budget by default; they are
 *   logged for diagnostics only.
 * - Retries/fallbacks share the same decision_id; only one row per decision_id
 *   may have counts_toward_budget=1 (the successful counted attempt).
 * - Rolling ROUTINE windows reconstruct from durable timestamps.
 */

export type DurableLlmCallWrite = {
  citizenId?: string;
  latencyMs: number;
  ok: boolean;
  goal?: string;
  reason?: string;
  error?: string;
  decisionCategory?: DecisionCategory;
  mcDay?: number;
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  /** Groups retries/fallback attempts for one citizen decision. */
  decisionId?: string;
  /**
   * When true, this row consumes budget. Callers should set true only for the
   * single counted attempt of a decision (typically the successful primary or
   * the intentional fallback that replaced it — not both).
   */
  countsTowardBudget?: boolean;
  timestamp?: string;
  id?: string;
};

export function loadBudgetHistoryFromStore(store: CivilizationStore): BudgetCallRecord[] {
  const rows = store.listBudgetConsumingLlmCalls();
  return rows.map((r) => ({
    citizenId: r.citizenId,
    category: r.decisionCategory,
    atMs: Date.parse(r.timestamp),
    mcDay: r.mcDay,
  }));
}

/** Decide whether a finalized LLM attempt should consume budget. */
export function shouldCountTowardBudget(args: {
  category: DecisionCategory;
  ok: boolean;
  /** True if another row with same decisionId already counted. */
  alreadyCountedForDecision: boolean;
}): boolean {
  if (args.category === "NO_LLM") return false;
  if (!args.ok) return false;
  if (args.alreadyCountedForDecision) return false;
  return true;
}
