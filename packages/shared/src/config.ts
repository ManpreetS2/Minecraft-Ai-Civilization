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
  SIM_CITIZEN_COUNT: z.coerce.number().int().default(5),
  SIM_TICK_MS: z.coerce.number().int().default(1500),
  AUTO_START_PAPER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LLM_PROVIDER: z.enum(["ollama", "llamacpp", "none"]).default("ollama"),
  LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  OLLAMA_HOST: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),
  LLM_COOLDOWN_MS: z.coerce.number().int().default(60_000),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
