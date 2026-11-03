import type { DecisionCategory } from "@civ/shared";
import { redactTraceValue } from "@civ/shared";

export type CognitionTrace = {
  citizenId: string;
  citizenName?: string;
  category: DecisionCategory;
  llmCalled: boolean;
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  memoryCount: number;
  relationshipCount: number;
  commitmentsConsidered: number;
  availableActions: string[];
  selectedGoal?: string;
  latencyMs?: number;
  tokenUsage?: number;
  validationOk: boolean;
  validationError?: string;
  reason?: string;
};

export function formatCognitionTrace(trace: CognitionTrace): string {
  const safe = redactTraceValue(trace) as CognitionTrace;
  const model =
    safe.provider || safe.model
      ? ` ${safe.provider ?? "?"}/${safe.model ?? "?"}${safe.fallbackUsed ? "(fallback)" : ""}`
      : "";
  return `[COGNITION ${safe.category}] ${safe.citizenId} llm=${safe.llmCalled ? "yes" : "no"}${model} goal=${safe.selectedGoal ?? "none"} mem=${safe.memoryCount} rel=${safe.relationshipCount} valid=${safe.validationOk}`;
}

export function assertNoSecretsInTrace(trace: CognitionTrace): boolean {
  const blob = JSON.stringify(trace);
  return !/api[_-]?key|Bearer\s+\w{8,}|sk-[A-Za-z0-9]+/i.test(blob);
}
