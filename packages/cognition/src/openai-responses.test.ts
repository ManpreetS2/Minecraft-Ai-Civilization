import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";
import { CloudBudgetGate } from "./cloud-budget.js";
import { createCognition } from "./index.js";
import { resolveCognitionConfig } from "./config.js";
import { estimateCloudCostUsd } from "./cloud-prices.js";
import {
  OpenAiResponsesProvider,
  assertOpenAiConfig,
  extractResponsesOutputText,
} from "./openai-responses.js";
import { GOALS } from "./goals.js";
import { validateDecision } from "./schema.js";

const prompt = {
  citizenName: "Atlas",
  health: 20,
  hunger: 14,
  inventory: ["oak_log x4"],
  settlementNeeds: ["NEED_FOOD"],
  memories: [],
  nearbyCitizens: ["Maya"],
};

function okResponse(goal = "gather_food") {
  return {
    id: "resp_test_1",
    output_text: JSON.stringify({ goal, priority: 0.8, reason: "Need food for survival" }),
    usage: { input_tokens: 120, output_tokens: 40 },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof OpenAiResponsesProvider>[0]> = {}) {
  const budget =
    over.budget ??
    new CloudBudgetGate({
      maxConcurrency: 2,
      maxRequestsPerRun: 10,
      spendAllowanceUsd: 1,
    });
  return new OpenAiResponsesProvider({
    apiKey: "sk-test-not-real",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 5_000,
    maxOutputTokens: 128,
    maxRetries: 1,
    retryBaseDelayMs: 0,
    budget,
    fetchImpl,
    ...over,
  });
}

describe("Mission 011 — OpenAI Responses cloud provider (mocked)", () => {
  it("1. cloud provider is disabled by default", () => {
    const cfg = resolveCognitionConfig(loadConfig({}));
    expect(cfg.cloud.enabled).toBe(false);
    expect(cfg.enabled).toBe(false);
    const cognition = createCognition(loadConfig({}));
    expect(cognition.name).toBe("heuristic");
  });

  it("does not enable cloud when only OLLAMA_ENABLED is true", () => {
    const cfg = resolveCognitionConfig(
      loadConfig({
        LLM_PROVIDER: "openai",
        OLLAMA_ENABLED: "true",
        LLM_ENABLED: "false",
        CLOUD_LLM_ENABLED: "false",
      }),
    );
    expect(cfg.cloud.enabled).toBe(false);
    expect(createCognition(loadConfig({ LLM_PROVIDER: "openai", OLLAMA_ENABLED: "true" })).name).toBe("heuristic");
  });

  it("2. valid model response becomes HighLevelDecision", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okResponse("gather_food")));
    const p = provider(fetchImpl as unknown as typeof fetch);
    const decision = await p.decide(prompt);
    expect(decision.goal).toBe("gather_food");
    expect(decision.reason).toMatch(/food/i);
    expect(p.recentDecisions[0]?.ok).toBe(true);
    expect(p.recentDecisions[0]?.acceptedGoal).toBe("gather_food");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("3. malformed JSON fails closed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { id: "resp_bad", output_text: "not-json", usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    const p = provider(fetchImpl as unknown as typeof fetch);
    await expect(p.decide(prompt)).rejects.toThrow(/JSON|No JSON/i);
  });

  it("4. invalid cognition goal fails validation", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: "resp_bad_goal",
        output_text: JSON.stringify({ goal: "teleport_home", priority: 1, reason: "warp" }),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const p = provider(fetchImpl as unknown as typeof fetch);
    await expect(p.decide(prompt)).rejects.toThrow();
  });

  it("5. missing credential rejects before network", () => {
    expect(() =>
      assertOpenAiConfig({ apiKey: "", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" }),
    ).toThrow(/OPENAI_API_KEY/);
    const fetchImpl = vi.fn();
    expect(() => provider(fetchImpl as unknown as typeof fetch, { apiKey: "   " })).toThrow(/OPENAI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("6. HTTP 401 does not retry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "unauthorized" }));
    const p = provider(fetchImpl as unknown as typeof fetch, { maxRetries: 2 });
    await expect(p.decide(prompt)).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("7. HTTP 429 retries then fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { error: { type: "requests", code: "rate_limit_exceeded" } }));
    const p = provider(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });
    await expect(p.decide(prompt)).rejects.toThrow(/429/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("8. HTTP 500 retries then fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: "boom" }));
    const p = provider(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });
    await expect(p.decide(prompt)).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("9. timeout/cancellation aborts in-flight work", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const p = provider(fetchImpl as unknown as typeof fetch, { timeoutMs: 30, maxRetries: 0 });
    await expect(p.decide(prompt, 30)).rejects.toThrow();
  });

  it("10. retry exhaustion after transient failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: "unavailable" }));
    const p = provider(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });
    await expect(p.decide(prompt)).rejects.toThrow();
    expect(fetchImpl.mock.calls.length).toBe(2);
  });

  it("11. request budget exhaustion blocks further calls", async () => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 1, spendAllowanceUsd: 5 });
    const fetchImpl = vi.fn(async () => jsonResponse(200, okResponse()));
    const p = provider(fetchImpl as unknown as typeof fetch, { budget, maxRetries: 0 });
    await p.decide(prompt);
    await expect(p.decide({ ...prompt, citizenName: "Maya" })).rejects.toThrow(/request budget/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("12. output-token limit is sent on the request body", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.max_output_tokens).toBe(64);
      expect(body.tools).toBeUndefined();
      return jsonResponse(200, okResponse());
    });
    const p = provider(fetchImpl as unknown as typeof fetch, { maxOutputTokens: 64, maxRetries: 0 });
    await p.decide(prompt);
  });

  it("13. token usage and cost accounting are recorded", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okResponse()));
    const p = provider(fetchImpl as unknown as typeof fetch);
    await p.decide(prompt);
    const rec = p.recentDecisions[0];
    expect(rec?.inputTokens).toBe(120);
    expect(rec?.outputTokens).toBe(40);
    expect(rec?.estimatedCostUsd).toBe(
      estimateCloudCostUsd({ model: "gpt-4o-mini", inputTokens: 120, outputTokens: 40 }),
    );
  });

  it("14. no credential leakage in ledger JSON", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okResponse()));
    const p = provider(fetchImpl as unknown as typeof fetch, { apiKey: "sk-super-secret-key" });
    await p.decide(prompt);
    const blob = JSON.stringify(p.recentDecisions);
    expect(blob).not.toContain("sk-super-secret-key");
  });

  it("15. concurrent independent citizen requests respect concurrency gate", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await hold;
      active -= 1;
      return jsonResponse(200, okResponse());
    });
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 5 });
    const p = provider(fetchImpl as unknown as typeof fetch, { budget, maxRetries: 0 });
    const a = p.decide({ ...prompt, citizenName: "Atlas" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await expect(p.decide({ ...prompt, citizenName: "Maya" })).rejects.toThrow(/concurrency/);
    release();
    await a;
    expect(maxActive).toBe(1);
  });

  it("16. delayed/stale aborted responses do not resolve after cancel", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          resolveFetch = resolve;
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    const p = provider(fetchImpl as unknown as typeof fetch, { timeoutMs: 20, maxRetries: 0 });
    const pending = p.decide(prompt, 20);
    await expect(pending).rejects.toThrow();
    resolveFetch?.(jsonResponse(200, okResponse("build_shelter")));
    await new Promise((r) => setTimeout(r, 30));
    expect(p.recentDecisions.some((r) => r.acceptedGoal === "build_shelter")).toBe(false);
  });

  it("17. shutdown aborts in-flight requests", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("shutdown")));
        }),
    );
    const p = provider(fetchImpl as unknown as typeof fetch, { timeoutMs: 5_000, maxRetries: 0 });
    const pending = p.decide(prompt);
    p.close();
    await expect(pending).rejects.toThrow();
    await expect(p.decide(prompt)).rejects.toThrow(/shut down/);
  });

  it("18. returned decisions must be valid cognition goals (executor allowlist upstream)", () => {
    for (const goal of GOALS) {
      expect(validateDecision({ goal, priority: 0.5, reason: "ok" }).goal).toBe(goal);
    }
    expect(() => validateDecision({ goal: "shell_exec", priority: 0.5, reason: "hack" })).toThrow();
  });

  it("19. existing Ollama/heuristic compatibility via factory", () => {
    expect(createCognition(loadConfig({ LLM_ENABLED: "false" })).name).toBe("heuristic");
    expect(
      createCognition(
        loadConfig({
          LLM_PROVIDER: "ollama",
          LLM_ENABLED: "true",
          OLLAMA_ENABLED: "true",
        }),
      ).name,
    ).toBe("ollama");
  });

  it("20. test suite never issues silent paid-network calls (mock-only fetch)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okResponse()));
    const cognition = createCognition(
      loadConfig({
        LLM_PROVIDER: "openai",
        LLM_ENABLED: "true",
        CLOUD_LLM_ENABLED: "true",
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "gpt-4o-mini",
      }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(cognition.name).toBe("openai-responses");
    await cognition.decide(prompt);
    expect(fetchImpl).toHaveBeenCalled();
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(String(calls[0]?.[0] ?? "")).toContain("/responses");
  });

  it("extracts structured output_text and nested message content", () => {
    expect(extractResponsesOutputText({ output_text: '{"goal":"explore","priority":0.2,"reason":"look"}' })).toContain(
      "explore",
    );
    expect(
      extractResponsesOutputText({
        output: [{ type: "message", content: [{ type: "output_text", text: '{"goal":"rest","priority":0.1,"reason":"wait"}' }] }],
      }),
    ).toContain("rest");
  });

  it("rejects unknown models before billing", () => {
    expect(() =>
      assertOpenAiConfig({ apiKey: "sk-x", model: "totally-unknown-model", baseUrl: "https://api.openai.com/v1" }),
    ).toThrow(/Unsupported OpenAI model/);
  });
});
