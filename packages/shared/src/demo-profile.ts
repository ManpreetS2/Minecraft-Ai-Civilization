import type { AppConfig } from "./config.js";
import { DEFAULT_CITIZENS } from "./types.js";

export const THREE_CITIZEN_DEMO_ROSTER = DEFAULT_CITIZENS.slice(0, 3);

export type ThreeCitizenDemoProfile = {
  profile: "three_citizen";
  roster: typeof THREE_CITIZEN_DEMO_ROSTER;
  sharedObjective: string;
  runMinutes: number;
  permadeath: false;
  keepInventory: false;
  assignWorkRoles: false;
  governanceEnabled: false;
  economyEnabled: false;
  starterResources: "none";
  dayNight: "normal";
  personalitySeed: string;
  bulletinTargetTokens: number;
  model: {
    provider: AppConfig["LLM_PROVIDER"];
    /** Shared baseline model id when cloud/local LLM is enabled. */
    modelName: string;
    cloudEnabled: boolean;
  };
};

export type DemoProfileValidation =
  | { ok: true; profile: ThreeCitizenDemoProfile }
  | { ok: false; errors: string[] };

/**
 * Validate an opt-in three-citizen demo configuration.
 * Does not start simulation and does not prove spawn/world readiness.
 */
export function validateThreeCitizenDemo(config: AppConfig): DemoProfileValidation {
  const errors: string[] = [];
  if (config.DEMO_PROFILE !== "three_citizen") {
    return { ok: false, errors: ["DEMO_PROFILE is not three_citizen"] };
  }
  if (config.SIM_CITIZEN_COUNT !== 3) {
    errors.push(`SIM_CITIZEN_COUNT must be 3 for three_citizen demo (got ${config.SIM_CITIZEN_COUNT})`);
  }
  if (config.SIM_ASSIGN_WORK_ROLES) {
    errors.push("SIM_ASSIGN_WORK_ROLES must be false (no predefined occupations)");
  }
  if (config.SIM_PERMADEATH_ENABLED) {
    errors.push("SIM_PERMADEATH_ENABLED must be false for the first demo (vanilla respawn + persistent identity)");
  }
  if (config.DEMO_RUN_MINUTES < 1 || config.DEMO_RUN_MINUTES > 180) {
    errors.push("DEMO_RUN_MINUTES out of accepted range (1–180)");
  }
  if (!config.DEMO_PERSONALITY_SEED.trim()) {
    errors.push("DEMO_PERSONALITY_SEED must be non-empty");
  }

  const cloudOn = config.LLM_PROVIDER === "openai" && config.CLOUD_LLM_ENABLED && config.LLM_ENABLED;
  if (cloudOn) {
    if (!config.OPENAI_API_KEY?.trim()) {
      errors.push("OPENAI_API_KEY required when cloud LLM is enabled for the demo");
    }
    if (!config.OPENAI_MODEL?.trim()) {
      errors.push("OPENAI_MODEL required when cloud LLM is enabled");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const modelName =
    config.LLM_PROVIDER === "openai"
      ? config.OPENAI_MODEL
      : config.OLLAMA_ROUTINE_MODEL || config.OLLAMA_MODEL;

  return {
    ok: true,
    profile: {
      profile: "three_citizen",
      roster: THREE_CITIZEN_DEMO_ROSTER,
      sharedObjective:
        "Survive together in an unfamiliar Minecraft world: secure food and safe shelter before nightfall. Cooperate, disagree, or revise plans as circumstances develop. No mayor is appointed.",
      runMinutes: config.DEMO_RUN_MINUTES,
      permadeath: false,
      keepInventory: false,
      assignWorkRoles: false,
      governanceEnabled: false,
      economyEnabled: false,
      starterResources: "none",
      dayNight: "normal",
      personalitySeed: config.DEMO_PERSONALITY_SEED.trim(),
      bulletinTargetTokens: config.DEMO_BULLETIN_TARGET_TOKENS,
      model: {
        provider: config.LLM_PROVIDER,
        modelName,
        cloudEnabled: cloudOn,
      },
    },
  };
}

export function isThreeCitizenDemo(config: AppConfig): boolean {
  return config.DEMO_PROFILE === "three_citizen";
}
