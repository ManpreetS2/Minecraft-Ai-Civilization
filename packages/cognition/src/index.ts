import type { AppConfig } from "@civ/shared";
import { resolveCognitionConfig } from "./config.js";
import { CloudBudgetGate } from "./cloud-budget.js";
import { CloudDecisionLedger } from "./decision-record.js";
import { HeuristicProvider } from "./heuristic.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAiResponsesProvider } from "./openai-responses.js";
import type { CognitionProvider } from "./schema.js";

export type CreateCognitionOptions = {
  /** Injected fetch for offline tests — never hits a paid network when provided as a mock. */
  fetchImpl?: typeof fetch;
  ledger?: CloudDecisionLedger;
  budget?: CloudBudgetGate;
};

export function createCognition(config: AppConfig, options: CreateCognitionOptions = {}): CognitionProvider {
  const cog = resolveCognitionConfig(config);
  if (!cog.enabled) {
    return new HeuristicProvider();
  }
  if (cog.provider === "openai") {
    if (!cog.cloud.enabled) {
      return new HeuristicProvider();
    }
    const budget =
      options.budget ??
      new CloudBudgetGate({
        maxConcurrency: cog.cloud.maxConcurrency,
        maxRequestsPerRun: cog.cloud.maxRequestsPerRun,
        spendAllowanceUsd: cog.cloud.spendAllowanceUsd,
      });
    return new OpenAiResponsesProvider({
      apiKey: cog.cloud.apiKey,
      model: cog.cloud.model,
      baseUrl: cog.cloud.baseUrl,
      timeoutMs: cog.cloud.timeoutMs,
      maxOutputTokens: cog.cloud.maxOutputTokens,
      maxRetries: cog.cloud.maxRetries,
      budget,
      ledger: options.ledger,
      fetchImpl: options.fetchImpl,
    });
  }
  if (cog.provider === "ollama") {
    return new OllamaProvider(cog.host, cog.routineModel);
  }
  return new HeuristicProvider();
}

export { HeuristicProvider } from "./heuristic.js";
export { OllamaProvider, formatPrompt } from "./ollama.js";
export {
  OpenAiResponsesProvider,
  assertOpenAiConfig,
  extractResponsesOutputText,
} from "./openai-responses.js";
export { CloudBudgetGate } from "./cloud-budget.js";
export { CloudDecisionLedger, type CloudDecisionRecord } from "./decision-record.js";
export {
  OPENAI_ALLOWED_MODELS,
  OPENAI_MODEL_PRICES,
  estimateCloudCostUsd,
  isAllowedOpenAiModel,
} from "./cloud-prices.js";
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
export { GOALS, GOAL_ALIASES, GOAL_SET, type Goal } from "./goals.js";
export { resolveCognitionConfig, type CognitionConfig, type CloudCognitionConfig } from "./config.js";
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
export { classifyFailure, isSystemFailure, type FailureSignal } from "./classify.js";
export { ExperienceLedger, type AttemptInput } from "./experience-ledger.js";
export { validateLessonProposal, validateDecisionEvaluation, type LessonProposal } from "./lesson-schema.js";
export { adaptMinecraftKnowledge, decisionContradictsMechanics, type GameKnowledgeProvider } from "./game-knowledge.js";
export { renderLearningJournal, writeLearningJournal } from "./journal.js";
