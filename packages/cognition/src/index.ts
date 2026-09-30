import type { AppConfig } from "@civ/shared";
import { resolveLlmModel } from "@civ/shared";
import { GeminiProvider } from "./gemini.js";
import { HeuristicProvider } from "./heuristic.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";
import type { ProviderAdapter } from "./provider.js";
import { ModelRouter } from "./router.js";
import type { CognitionProvider } from "./schema.js";

export function createProviderAdapter(
  provider: AppConfig["LLM_PROVIDER"] | NonNullable<AppConfig["LLM_FALLBACK_PROVIDER"]>,
  config: AppConfig,
  modelOverride?: string,
): ProviderAdapter {
  const model = modelOverride?.trim() || resolveModelFor(provider, config);
  switch (provider) {
    case "ollama":
    case "llamacpp":
      return new OllamaProvider(config.OLLAMA_HOST, model);
    case "nvidia":
      return new OpenAiCompatibleProvider({
        name: "nvidia",
        baseUrl: config.NVIDIA_BASE_URL,
        apiKey: config.NVIDIA_API_KEY,
        model,
      });
    case "openai_compatible":
      return new OpenAiCompatibleProvider({
        name: "openai_compatible",
        baseUrl: config.OPENAI_COMPAT_BASE_URL ?? "http://127.0.0.1:8000/v1",
        apiKey: config.OPENAI_COMPAT_API_KEY,
        model,
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.GEMINI_API_KEY,
        model,
        baseUrl: config.GEMINI_BASE_URL,
      });
    case "heuristic":
    case "none":
    default:
      return new HeuristicProvider();
  }
}

function resolveModelFor(
  provider: AppConfig["LLM_PROVIDER"] | NonNullable<AppConfig["LLM_FALLBACK_PROVIDER"]>,
  config: AppConfig,
): string {
  if (config.LLM_MODEL?.trim()) return config.LLM_MODEL.trim();
  switch (provider) {
    case "nvidia":
      return config.NVIDIA_MODEL;
    case "gemini":
      return config.GEMINI_MODEL;
    case "openai_compatible":
      return config.OPENAI_COMPAT_MODEL ?? "unknown";
    case "heuristic":
    case "none":
      return "heuristic";
    default:
      return config.OLLAMA_MODEL;
  }
}

export function createCognition(config: AppConfig): CognitionProvider {
  if (!config.LLM_ENABLED || config.LLM_PROVIDER === "none") {
    return new HeuristicProvider();
  }

  const primary = createProviderAdapter(config.LLM_PROVIDER, config, config.LLM_MODEL);
  const fallback =
    config.LLM_FALLBACK_PROVIDER && config.LLM_FALLBACK_PROVIDER !== "none"
      ? createProviderAdapter(config.LLM_FALLBACK_PROVIDER, config, config.LLM_FALLBACK_MODEL)
      : new HeuristicProvider();

  return new ModelRouter({
    primary,
    fallback,
    maxRetries: config.LLM_MAX_RETRIES,
    defaultTimeoutMs: config.LLM_TIMEOUT_MS,
    log: (entry) => {
      const attr = `${entry.provider ?? "?"}/${entry.model ?? "?"}`;
      const latency = entry.latencyMs !== undefined ? ` ${entry.latencyMs}ms` : "";
      const line = `[llm ${entry.level}] ${attr}${latency} ${entry.message}`;
      if (entry.level === "error") console.error(line);
      else if (entry.level === "warn") console.warn(line);
      else console.log(line);
    },
  });
}

export { HeuristicProvider } from "./heuristic.js";
export { OllamaProvider } from "./ollama.js";
export { OpenAiCompatibleProvider } from "./openai-compatible.js";
export { GeminiProvider } from "./gemini.js";
export { ModelRouter } from "./router.js";
export { LlmProviderError, isLlmProviderError } from "./errors.js";
export type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResult,
  NormalizedCognitionResult,
  TokenUsage,
  ModelRouterOptions,
} from "./provider.js";
export { normalizeProviderResult, redactSecrets } from "./provider.js";
export { resolveFallback } from "./router.js";
export {
  DecisionSchema,
  extractJson,
  normalizeDecisionInput,
  normalizeGoal,
  validateDecision,
  type CognitionPrompt,
  type CognitionProvider,
  type HighLevelDecision,
} from "./schema.js";
export {
  StructuredDecisionSchema,
  validateStructuredDecision,
  tryValidateStructuredDecision,
  parseStructuredDecisionFromText,
  toLegacyDecision,
  looksLikeMovementInstruction,
  PRIMARY_GOALS,
  type StructuredDecision,
  type PrimaryGoal,
} from "./decision-schema.js";
export {
  buildCognitionInput,
  cognitionInputToPromptLines,
  stableSerialize,
  COGNITION_INPUT_MAX_CHARS,
  COGNITION_INPUT_MAX_MEMORIES,
  type CognitionInput,
  type BuildCognitionInputArgs,
} from "./input.js";
export {
  createCommitment,
  completeCommitment,
  updateCommitmentStatus,
  expireCommitments,
  activeCommitmentsFor,
} from "./commitments.js";
export { shouldReconsiderDecision, type CooldownState, type CooldownDecision } from "./cooldown.js";
export {
  classifyDecisionCategory,
  emptyUsageStats,
  recordUsage,
  type RoutingContext,
  type CognitionUsageStats,
} from "./routing.js";
export { updateMood, separateWorldBeliefEmotion, type MoodEvent } from "./psychology.js";
export { CitizenBrain, type BrainObserveArgs, type BrainDecisionResult } from "./brain.js";
export { formatCognitionTrace, assertNoSecretsInTrace, type CognitionTrace } from "./cognition-trace.js";
export { resolveLlmModel };
