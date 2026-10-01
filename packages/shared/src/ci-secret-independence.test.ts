import { describe, expect, it } from "vitest";
import { loadConfig, resolveLlmModel } from "./config.js";

describe("CI secret-independence", () => {
  it("loads defaults with provider keys unset and LLM disabled", () => {
    const cfg = loadConfig({
      NVIDIA_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      OPENAI_COMPAT_API_KEY: undefined,
      LLM_ENABLED: "false",
      CITIZEN_BRAIN_V2_ENABLED: "false",
      AUTO_START_PAPER: "false",
    });
    expect(cfg.LLM_ENABLED).toBe(false);
    expect(cfg.CITIZEN_BRAIN_V2_ENABLED).toBe(false);
    expect(cfg.NVIDIA_API_KEY).toBeUndefined();
    expect(cfg.GEMINI_API_KEY).toBeUndefined();
    expect(resolveLlmModel(cfg)).toBeTruthy();
  });
});
