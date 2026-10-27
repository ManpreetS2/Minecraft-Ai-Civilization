import type { AppConfig } from "@civ/shared";

export const DEFAULT_ROUTINE_MODEL = "qwen3.5:9b";
export const DEFAULT_REFLECTION_MODEL = "gpt-oss:20b";

export type CloudCognitionConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxConcurrency: number;
  maxRequestsPerRun: number;
  spendAllowanceUsd: number;
  maxRetries: number;
};

export type CognitionConfig = {
  enabled: boolean;
  provider: AppConfig["LLM_PROVIDER"];
  host: string;
  routineModel: string;
  reflectionModel: string;
  contextSize: number;
  maxConcurrency: number;
  timeoutMs: number;
  cooldownMs: number;
  reflectionEnabled: boolean;
  cloud: CloudCognitionConfig;
};

/**
 * Model names live in config, not in routers or prompt builders.
 * CLOUD_LLM_ENABLED is required for OpenAI — OLLAMA_ENABLED never enables cloud billing.
 */
export function resolveCognitionConfig(config: AppConfig): CognitionConfig {
  const provider = config.LLM_PROVIDER;
  const cloudRequested = provider === "openai";
  const cloudEnabled = cloudRequested && config.CLOUD_LLM_ENABLED === true && config.LLM_ENABLED === true;
  const localEnabled =
    !cloudRequested && provider !== "none" && Boolean(config.LLM_ENABLED || config.OLLAMA_ENABLED);

  return {
    enabled: cloudEnabled || localEnabled,
    provider,
    host: config.OLLAMA_HOST,
    routineModel: config.OLLAMA_ROUTINE_MODEL || config.OLLAMA_MODEL || DEFAULT_ROUTINE_MODEL,
    reflectionModel: config.OLLAMA_REFLECTION_MODEL || DEFAULT_REFLECTION_MODEL,
    contextSize: config.OLLAMA_CONTEXT_SIZE,
    maxConcurrency: cloudEnabled ? config.CLOUD_MAX_CONCURRENCY : config.OLLAMA_MAX_CONCURRENCY,
    timeoutMs: cloudEnabled ? config.CLOUD_TIMEOUT_MS : config.OLLAMA_TIMEOUT_MS,
    cooldownMs: config.LLM_COOLDOWN_MS,
    reflectionEnabled: config.OLLAMA_REFLECTION_ENABLED,
    cloud: {
      enabled: cloudEnabled,
      apiKey: config.OPENAI_API_KEY ?? "",
      model: config.OPENAI_MODEL,
      baseUrl: config.OPENAI_BASE_URL,
      timeoutMs: config.CLOUD_TIMEOUT_MS,
      maxOutputTokens: config.CLOUD_MAX_OUTPUT_TOKENS,
      maxConcurrency: config.CLOUD_MAX_CONCURRENCY,
      maxRequestsPerRun: config.CLOUD_MAX_REQUESTS_PER_RUN,
      spendAllowanceUsd: config.CLOUD_SPEND_ALLOWANCE_USD,
      maxRetries: config.CLOUD_MAX_RETRIES,
    },
  };
}
