import type { AppConfig } from "@civ/shared";

export const DEFAULT_ROUTINE_MODEL = "qwen3.5:9b";
export const DEFAULT_REFLECTION_MODEL = "gpt-oss:20b";

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
};

/**
 * Model names live in config, not in routers or prompt builders.
 */
export function resolveCognitionConfig(config: AppConfig): CognitionConfig {
  return {
    enabled: Boolean(config.LLM_ENABLED || config.OLLAMA_ENABLED) && config.LLM_PROVIDER !== "none",
    provider: config.LLM_PROVIDER,
    host: config.OLLAMA_HOST,
    routineModel: config.OLLAMA_ROUTINE_MODEL || config.OLLAMA_MODEL || DEFAULT_ROUTINE_MODEL,
    reflectionModel: config.OLLAMA_REFLECTION_MODEL || DEFAULT_REFLECTION_MODEL,
    contextSize: config.OLLAMA_CONTEXT_SIZE,
    maxConcurrency: config.OLLAMA_MAX_CONCURRENCY,
    timeoutMs: config.OLLAMA_TIMEOUT_MS,
    cooldownMs: config.LLM_COOLDOWN_MS,
    reflectionEnabled: config.OLLAMA_REFLECTION_ENABLED,
  };
}
