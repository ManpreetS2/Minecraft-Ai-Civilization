import type { AppConfig } from "@civ/shared";
import { resolveLlmModel } from "@civ/shared";
import { HeuristicProvider } from "./heuristic.js";
import { OllamaProvider } from "./ollama.js";
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
export { ModelRouter, resolveFallback } from "./router.js";
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
export { resolveLlmModel };
