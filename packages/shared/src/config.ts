import { z } from "zod";

const envSchema = z.object({
  MINECRAFT_HOST: z.string().default("127.0.0.1"),
  MINECRAFT_PORT: z.coerce.number().int().default(25565),
  MINECRAFT_VERSION: z.string().default("1.21.11"),
  MINECRAFT_AUTH_MODE: z.enum(["offline", "microsoft"]).default("offline"),
  MINECRAFT_USERNAME: z.string().default("Atlas"),
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  DASHBOARD_PORT: z.coerce.number().int().default(3000),
  DATABASE_PATH: z.string().default("./data/civilization.sqlite"),
  /** SEC-001: orchestrator-owned community directory seed, JSON: [{"id":"gpt","name":"GPT","memberIds":["a","b"]}]. Never read from LLM/tool/HTTP input. */
  COMMUNITIES_JSON: z.string().optional(),
  SIM_CITIZEN_COUNT: z.coerce.number().int().default(5),
  SIM_TICK_MS: z.coerce.number().int().default(1500),
  SIM_RUN_ID: z.string().optional(),
  SIM_PERMADEATH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SIM_ASSIGN_WORK_ROLES: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  HUMAN_DIRECTIVES_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  AUTO_START_PAPER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LLM_PROVIDER: z.enum(["ollama", "llamacpp", "openai", "none"]).default("ollama"),
  LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  OLLAMA_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  OLLAMA_HOST: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen3.5:9b"),
  OLLAMA_ROUTINE_MODEL: z.string().default("qwen3.5:9b"),
  OLLAMA_REFLECTION_MODEL: z.string().default("gpt-oss:20b"),
  OLLAMA_CONTEXT_SIZE: z.coerce.number().int().positive().default(8192),
  OLLAMA_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  OLLAMA_REFLECTION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LLM_COOLDOWN_MS: z.coerce.number().int().default(60_000),
  /** Explicit cloud enable. OLLAMA_ENABLED must never turn this on. Default false. */
  CLOUD_LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  /** Exact host[:port] required before the API key may be sent to a non-OpenAI HTTPS endpoint. */
  OPENAI_CUSTOM_ENDPOINT_HOST: z.string().default(""),
  CLOUD_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Largest request admitted, as an upper bound on input tokens. Oversized requests are refused unsent. */
  CLOUD_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(16_000),
  CLOUD_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(512).default(128),
  CLOUD_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  CLOUD_MAX_REQUESTS_PER_RUN: z.coerce.number().int().min(0).default(60),
  CLOUD_SPEND_ALLOWANCE_USD: z.coerce.number().nonnegative().default(1.0),
  CLOUD_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  /** Used when cost policy stops cloud calls. Only non-paid providers are valid; default is no fallback. */
  CLOUD_FALLBACK_PROVIDER: z.enum(["none", "heuristic", "ollama"]).default("none"),
  /**
   * Opt-in demonstration profile. `none` preserves historical five-citizen defaults.
   * `three_citizen` selects Atlas/Maya/Theo with charter demo constraints (validated separately).
   */
  DEMO_PROFILE: z.enum(["none", "three_citizen"]).default("none"),
  DEMO_PERSONALITY_SEED: z.string().default("civ-demo-2026"),
  DEMO_RUN_MINUTES: z.coerce.number().int().positive().default(60),
  DEMO_BULLETIN_TARGET_TOKENS: z.coerce.number().int().positive().max(400).default(200),
  MECHANICS_PROBE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MECHANICS_PROBE_KEEP_ALIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MECHANICS_PROBE_USERNAME: z.string().default("MechProbe"),
  MECHANICS_PROBE_PRESERVE_FIXTURES: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type AppConfig = z.infer<typeof envSchema>;

export const RESERVED_MECHANICS_PROBE_NAMES = [
  "MechProbe",
  "MechProbeB",
  "CivPathProbe",
  "MindcraftProbe",
  "PhoenixProbe",
  "CollectblockProbe",
  "FarmProbe",
  "HomeProbe",
  "HomeProbeB",
  "MineProbe",
  "MineProbeB",
  "FishProbe",
  "FishProbeB",
] as const;

export function isMechanicsProbeUsername(name: string | undefined): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return RESERVED_MECHANICS_PROBE_NAMES.some((entry) => entry.toLowerCase() === normalized);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
