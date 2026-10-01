import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const envSchema = z.object({
  MINECRAFT_HOST: z.string().default("127.0.0.1"),
  MINECRAFT_PORT: z.coerce.number().int().default(25565),
  MINECRAFT_VERSION: z.string().default("1.21.11"),
  MINECRAFT_AUTH_MODE: z.enum(["offline", "microsoft"]).default("offline"),
  MINECRAFT_USERNAME: z.string().default("Atlas"),
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  DASHBOARD_PORT: z.coerce.number().int().default(3000),
  DATABASE_PATH: z.string().default("./data/civilization.sqlite"),
  SIM_CITIZEN_COUNT: z.coerce.number().int().default(5),
  SIM_TICK_MS: z.coerce.number().int().default(1500),
  AUTO_START_PAPER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  SIM_ASSIGN_WORK_ROLES: boolFromEnv,
  LLM_PROVIDER: z
    .enum(["ollama", "llamacpp", "nvidia", "gemini", "openai_compatible", "heuristic", "none"])
    .default("ollama"),
  LLM_MODEL: z.string().optional(),
  LLM_FALLBACK_PROVIDER: z
    .enum(["ollama", "llamacpp", "nvidia", "gemini", "openai_compatible", "heuristic", "none"])
    .optional(),
  LLM_FALLBACK_MODEL: z.string().optional(),
  LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(45_000),
  LLM_MAX_RETRIES: z.coerce.number().int().default(2),
  OLLAMA_HOST: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),
  LLM_COOLDOWN_MS: z.coerce.number().int().default(60_000),
  /** Feature flag: thin CitizenBrain adapter. Default false — do not auto-enable. */
  CITIZEN_BRAIN_V2_ENABLED: boolFromEnv,
  LLM_MAX_CALLS_PER_CITIZEN_PER_MC_DAY: z.coerce.number().int().default(24),
  LLM_MAX_ROUTINE_CALLS_PER_WINDOW: z.coerce.number().int().default(8),
  LLM_ROUTINE_WINDOW_MS: z.coerce.number().int().default(600_000),
  LLM_MAX_DEEP_REFLECTION_CALLS_PER_MC_DAY: z.coerce.number().int().default(4),
  /** Optional global LLM call cap; omit / unset for per-citizen only. */
  LLM_GLOBAL_MAX_CALLS_PER_MC_DAY: z.coerce.number().int().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_MODEL: z.string().default("meta/llama-3.1-8b-instruct"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  GEMINI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta"),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  OPENAI_COMPAT_BASE_URL: z.string().optional(),
  OPENAI_COMPAT_MODEL: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}

/** Resolve the primary model name for the configured provider. */
export function resolveLlmModel(config: AppConfig): string {
  if (config.LLM_MODEL && config.LLM_MODEL.trim()) return config.LLM_MODEL.trim();
  switch (config.LLM_PROVIDER) {
    case "ollama":
    case "llamacpp":
      return config.OLLAMA_MODEL;
    case "nvidia":
      return config.NVIDIA_MODEL;
    case "gemini":
      return config.GEMINI_MODEL;
    case "openai_compatible":
      return config.OPENAI_COMPAT_MODEL ?? "unknown";
    default:
      return "heuristic";
  }
}
