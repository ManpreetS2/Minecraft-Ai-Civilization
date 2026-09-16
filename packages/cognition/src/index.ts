import type { AppConfig } from "@civ/shared";
import { resolveCognitionConfig } from "./config.js";
import { HeuristicProvider } from "./heuristic.js";
import { OllamaProvider } from "./ollama.js";
import type { CognitionProvider } from "./schema.js";

export function createCognition(config: AppConfig): CognitionProvider {
  const cog = resolveCognitionConfig(config);
  if (!cog.enabled) {
    return new HeuristicProvider();
  }
  if (cog.provider === "ollama") {
    return new OllamaProvider(cog.host, cog.routineModel);
  }
  return new HeuristicProvider();
}

export { HeuristicProvider } from "./heuristic.js";
export { OllamaProvider } from "./ollama.js";
export {
  CognitionDecisionSchema,
  DecisionSchema,
  extractJson,
  normalizeDecisionInput,
  normalizeGoal,
  validateCognitionDecision,
  validateDecision,
  type CognitionDecision,
  type CognitionPrompt,
  type CognitionProvider,
  type HighLevelDecision,
} from "./schema.js";
export { GOALS, type Goal } from "./goals.js";
export { resolveCognitionConfig, type CognitionConfig } from "./config.js";
export { ModelRouter, isRareReflection, type CognitionMode, type DeliberationTrigger } from "./router.js";
export { detectEmergencyReflex, type ReflexDecision, type WorldView } from "./reflex.js";
export {
  CognitionContextBuilder,
  type ContextBuilderInput,
  type EngineAwareContext,
  type RelevantGameKnowledge,
} from "./context-builder.js";
export { trimCognitionContext, estimateTokens } from "./trim.js";
export { buildDeliberationMessages, promptContainsPersonalityInjection } from "./prompt.js";
export { CognitionService, assumptionsFrom, type DecideRequest, type DecideResult, type Deliberator } from "./service.js";
export { InferenceQueue } from "./queue.js";
export { isDecisionStale, type DecisionAssumptions } from "./stale.js";
export { shouldDeliberate, createCooldownState, markDeliberated } from "./cooldown.js";
export { validateReflectionProposal, type ReflectionProposal } from "./reflection-schema.js";
export { applyReflectionProposal } from "./reflection-apply.js";
export { heuristicDeliberation } from "./heuristic-deliberation.js";
export { DecisionLogBuffer, type DecisionLog } from "./observability.js";
