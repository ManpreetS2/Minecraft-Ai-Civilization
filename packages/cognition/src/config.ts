import type { AppConfig } from "@civ/shared";
import { parseInferenceRoute, type InferenceRoute } from "./inference-route.js";

export const DEFAULT_ROUTINE_MODEL = "qwen3.5:9b";
export const DEFAULT_REFLECTION_MODEL = "gpt-oss:20b";

export type OpenAICompatSettings = {
  baseUrl: string;
  apiKey: string;
  fastModel: string;
  routineModel: string;
  reflectionModel: string;
  timeoutMs: number;
};

export type CognitionConfig = {
  enabled: boolean;
  provider: AppConfig["LLM_PROVIDER"];
  host: string;
  fastModel: string;
  routineModel: string;
  reflectionModel: string;
  contextSize: number;
  maxConcurrency: number;
  timeoutMs: number;
  cooldownMs: number;
  reflectionEnabled: boolean;
  inferenceRoute: InferenceRoute;
  openaiCompat: OpenAICompatSettings;
};

/**
 * Model names live in config, not in routers or prompt builders.
 * Ollama remains the default inference backend. Cloud is opt-in via LLM_INFERENCE_ROUTE.
 */
export function resolveCognitionConfig(config: AppConfig): CognitionConfig {
  return {
    enabled: Boolean(config.LLM_ENABLED || config.OLLAMA_ENABLED) && config.LLM_PROVIDER !== "none",
    provider: config.LLM_PROVIDER,
    host: config.OLLAMA_HOST,
    fastModel: config.OLLAMA_FAST_MODEL || "qwen3.5:4b",
    routineModel: config.OLLAMA_ROUTINE_MODEL || config.OLLAMA_MODEL || DEFAULT_ROUTINE_MODEL,
    reflectionModel: config.OLLAMA_REFLECTION_MODEL || DEFAULT_REFLECTION_MODEL,
    contextSize: config.OLLAMA_CONTEXT_SIZE,
    maxConcurrency: config.OLLAMA_MAX_CONCURRENCY,
    timeoutMs: config.OLLAMA_TIMEOUT_MS,
    cooldownMs: config.LLM_COOLDOWN_MS,
    reflectionEnabled: config.OLLAMA_REFLECTION_ENABLED,
    inferenceRoute: parseInferenceRoute(config.LLM_INFERENCE_ROUTE),
    openaiCompat: {
      baseUrl: config.OPENAI_COMPAT_BASE_URL,
      apiKey: config.OPENAI_COMPAT_API_KEY,
      fastModel: config.OPENAI_COMPAT_FAST_MODEL,
      routineModel: config.OPENAI_COMPAT_ROUTINE_MODEL,
      reflectionModel: config.OPENAI_COMPAT_REFLECTION_MODEL,
      timeoutMs: config.OPENAI_COMPAT_TIMEOUT_MS,
    },
  };
}

export function cloudConfigured(config: Pick<CognitionConfig, "openaiCompat">): boolean {
  return Boolean(config.openaiCompat.baseUrl.trim() && config.openaiCompat.routineModel.trim());
}
