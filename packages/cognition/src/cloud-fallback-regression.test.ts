import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";
import { CloudBudgetGate } from "./cloud-budget.js";
import { LocalFallbackCognitionProvider } from "./cloud-fallback.js";
import { HeuristicProvider } from "./heuristic.js";
import { createCognition } from "./index.js";
import { OpenAiResponsesProvider } from "./openai-responses.js";

const prompt = {
  citizenName: "A",
  health: 20,
  hunger: 12,
  inventory: [],
  settlementNeeds: ["NEED_WOOD"],
  memories: [] as string[],
  nearbyCitizens: [],
};
const cloudEnv = { LLM_PROVIDER: "openai", LLM_ENABLED: "true", CLOUD_LLM_ENABLED: "true", OPENAI_API_KEY: "sk-test" };
const missingUsage = () => new Response(JSON.stringify({ output_text: '{"goal":"rest","priority":0.1,"reason":"x"}' }), { status: 200 });

function wrapped(fetchImpl: unknown, budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 10, spendAllowanceUsd: 1 })) {
  const primary = new OpenAiResponsesProvider({
    apiKey: "sk-test-offline",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 1000,
    maxOutputTokens: 128,
    maxRetries: 0,
    budget,
    fetchImpl: fetchImpl as typeof fetch,
  });
  const fallback = new HeuristicProvider();
  const decide = vi.spyOn(fallback, "decide");
  return { primary, budget, fallbackDecide: decide, provider: new LocalFallbackCognitionProvider(primary, fallback) };
}

describe("cloud fallback policy (mock-only)", () => {
  it("defaults to no fallback: a closed budget keeps failing with its specific reason", async () => {
    const fetchImpl = vi.fn(async () => missingUsage());
    const cognition = createCognition(loadConfig(cloudEnv), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(cognition.name).toBe("openai-responses");
    await expect(cognition.decide(prompt)).rejects.toThrow(/missing token usage/);
    await expect(cognition.decide(prompt)).rejects.toThrow(/missing token usage/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the configured heuristic fallback after closure, with no further paid requests", async () => {
    const fetchImpl = vi.fn(async () => missingUsage());
    const cognition = createCognition(loadConfig({ ...cloudEnv, CLOUD_FALLBACK_PROVIDER: "heuristic" }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(cognition.name).toBe("openai-responses+fallback:heuristic");
    await expect(cognition.decide(prompt)).resolves.toMatchObject({ goal: "gather_wood" });
    await expect(cognition.decide(prompt)).resolves.toMatchObject({ goal: "gather_wood" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back when the budget cannot cover a request or the request cap is reached", async () => {
    const fetchImpl = vi.fn(async () => missingUsage());
    const poor = wrapped(fetchImpl, new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 10, spendAllowanceUsd: 0 }));
    await expect(poor.provider.decide(prompt)).resolves.toMatchObject({ goal: "gather_wood" });
    const capped = wrapped(fetchImpl, new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 0, spendAllowanceUsd: 1 }));
    await expect(capped.provider.decide(prompt)).resolves.toMatchObject({ goal: "gather_wood" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fall back on transient concurrency refusals or ordinary failures", async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const { provider, fallbackDecide } = wrapped(fetchImpl);
    const first = provider.decide(prompt);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await expect(provider.decide(prompt)).rejects.toThrow(/concurrency/);
    release(new Response("{}", { status: 400 }));
    await expect(first).rejects.toThrow(/400/);
    expect(fallbackDecide).not.toHaveBeenCalled();
  });

  it("does not fall back after shutdown", async () => {
    const { provider, fallbackDecide } = wrapped(vi.fn());
    provider.close();
    await expect(provider.decide(prompt)).rejects.toThrow(/shut down/);
    expect(fallbackDecide).not.toHaveBeenCalled();
  });

  it("does not treat a plain gate shutdown as a cost-policy stop", async () => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 10, spendAllowanceUsd: 1 });
    budget.close();
    const { provider, fallbackDecide } = wrapped(vi.fn(), budget);
    await expect(provider.decide(prompt)).rejects.toThrow("cloud cognition shut down");
    expect(fallbackDecide).not.toHaveBeenCalled();
  });

  it("cannot be configured with a paid provider", () => {
    for (const value of ["openai", "anthropic", "llamacpp"]) {
      expect(() => loadConfig({ ...cloudEnv, CLOUD_FALLBACK_PROVIDER: value })).toThrow();
    }
  });

  it("accepts Ollama as a fallback only on a loopback host", () => {
    const ollama = { ...cloudEnv, CLOUD_FALLBACK_PROVIDER: "ollama" };
    expect(createCognition(loadConfig({ ...ollama, OLLAMA_HOST: "http://127.0.0.1:11434" })).name).toBe(
      "openai-responses+fallback:ollama",
    );
    for (const host of ["https://ollama.example.test", "http://localhost.attacker.test:11434", "not a url"]) {
      expect(() => createCognition(loadConfig({ ...ollama, OLLAMA_HOST: host }))).toThrow(/OLLAMA_HOST/);
    }
  });
});
