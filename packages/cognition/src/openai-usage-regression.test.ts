import { describe, expect, it, vi } from "vitest";
import { CloudBudgetGate } from "./cloud-budget.js";
import { OpenAiResponsesProvider } from "./openai-responses.js";

const prompt = {
  citizenName: "GPT-A",
  health: 20,
  hunger: 12,
  inventory: [],
  settlementNeeds: [],
  memories: [],
  nearbyCitizens: [],
};

function mockProvider(rawUsage?: unknown) {
  const budget = new CloudBudgetGate({
    maxConcurrency: 1,
    maxRequestsPerRun: 5,
    spendAllowanceUsd: 1,
  });
  const body = {
    id: "resp_mock",
    output_text: JSON.stringify({
      goal: "gather_food",
      priority: 0.9,
      reason: "Hungry",
    }),
    ...(rawUsage === undefined ? {} : { usage: rawUsage }),
  };
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const provider = new OpenAiResponsesProvider({
    apiKey: "sk-test-offline",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 1000,
    maxOutputTokens: 128,
    maxRetries: 0,
    budget,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { budget, provider, fetchImpl };
}

describe("OpenAI Responses metered usage validation (mock-only)", () => {
  it.each([
    ["missing usage", undefined],
    ["negative input", { input_tokens: -1, output_tokens: 5 }],
    ["fractional output", { input_tokens: 10, output_tokens: 0.5 }],
    ["string input", { input_tokens: "10", output_tokens: 5 }],
    ["null output", { input_tokens: 10, output_tokens: null }],
    ["missing output", { input_tokens: 10 }],
    ["non-object usage", "lots"],
  ])("fails closed for %s rather than recording a free successful request", async (_description, usage) => {
    const { budget, provider, fetchImpl } = mockProvider(usage);
    await expect(provider.decide(prompt)).rejects.toThrow(/missing or invalid token usage/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.snapshot.closed).toBe(true);
    expect(budget.snapshot.inFlight).toBe(0);
    // The default reserve stays counted because the unknown-cost call may have been billed.
    expect(budget.snapshot.spendUsd).toBeCloseTo(0.01);
    expect(budget.tryAdmit()).toMatchObject({ ok: false, reason: "cloud cognition shut down" });
    expect(provider.recentDecisions[0]).toMatchObject({ ok: false, estimatedCostUsd: 0.01, httpStatus: 200 });
  });
});

function billingProvider(fetchImpl: unknown, over: { maxRetries?: number; timeoutMs?: number; maxRequestsPerRun?: number } = {}) {
  const budget = new CloudBudgetGate({
    maxConcurrency: 1,
    maxRequestsPerRun: over.maxRequestsPerRun ?? 100,
    spendAllowanceUsd: 1,
  });
  const provider = new OpenAiResponsesProvider({
    apiKey: "sk-test-offline",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: over.timeoutMs ?? 1000,
    maxOutputTokens: 128,
    maxRetries: over.maxRetries ?? 0,
    budget,
    fetchImpl: fetchImpl as typeof fetch,
  });
  return { budget, provider };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("OpenAI Responses billing settlement (mock-only)", () => {
  // Enough tokens that each call costs ~$0.075 at gpt-4o-mini rates.
  const usage = { input_tokens: 500_000, output_tokens: 0 };

  it.each([
    ["malformed JSON text", { output_text: "not-json", usage }],
    ["a disallowed goal", { output_text: JSON.stringify({ goal: "teleport_home", priority: 1, reason: "warp" }), usage }],
    ["no output text", { usage }],
  ])("charges actual usage when a successful response contains %s", async (_description, body) => {
    const { budget, provider } = billingProvider(async () => json(200, body));
    await expect(provider.decide(prompt)).rejects.toThrow();
    expect(budget.snapshot.spendUsd).toBeCloseTo(0.075);
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.closed).toBe(false);
    expect(provider.recentDecisions[0]).toMatchObject({
      ok: false,
      inputTokens: 500_000,
      outputTokens: 0,
      estimatedCostUsd: 0.075,
      httpStatus: 200,
    });
  });

  it("stops paid calls at the allowance when every billed response is unusable", async () => {
    const fetchImpl = vi.fn(async () => json(200, { output_text: "not-json", usage }));
    const { budget, provider } = billingProvider(fetchImpl);
    for (let i = 0; i < 30; i += 1) {
      await provider.decide(prompt).catch(() => undefined);
    }
    // Admission only sees the reserve, so the last admitted call may overshoot by its actual cost.
    expect(fetchImpl.mock.calls.length).toBe(14);
    expect(budget.snapshot.spendUsd).toBeCloseTo(1.05);
  });

  it("keeps the reserve and closes when a successful response body cannot be read", async () => {
    const { budget, provider } = billingProvider(
      async () => new Response("{truncated", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(provider.decide(prompt)).rejects.toThrow();
    expect(budget.snapshot).toMatchObject({ inFlight: 0, closed: true });
    expect(budget.snapshot.spendUsd).toBeCloseTo(0.01);
  });

  it("still refunds requests the provider rejected", async () => {
    const { budget, provider } = billingProvider(async () => json(400, { error: "bad" }));
    await expect(provider.decide(prompt)).rejects.toThrow(/400/);
    expect(budget.snapshot).toMatchObject({ inFlight: 0, spendUsd: 0, closed: false });
  });

  it("releases the slot when a timeout lands between retry attempts", async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return json(429, {});
    });
    const { budget, provider } = billingProvider(fetchImpl, { maxRetries: 1, timeoutMs: 10 });
    await expect(provider.decide(prompt)).rejects.toThrow(/cancelled/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.snapshot).toMatchObject({ inFlight: 0, spendUsd: 0, closed: false });
    expect(provider.recentDecisions.at(-1)).toMatchObject({ ok: false, failureReason: "OpenAI request cancelled" });
    // Nothing is held against concurrency, so the next call is admitted.
    expect(budget.tryAdmit().ok).toBe(true);
  });

  it("counts retries against the request budget", async () => {
    const fetchImpl = vi.fn(async () => json(500, {}));
    const { budget, provider } = billingProvider(fetchImpl, { maxRetries: 2, maxRequestsPerRun: 2 });
    await expect(provider.decide(prompt)).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.snapshot).toMatchObject({ requestsUsed: 2, inFlight: 0 });
    await expect(provider.decide(prompt)).rejects.toThrow(/request budget/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses redirects so the prompt stays on the validated host", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return json(200, { output_text: JSON.stringify({ goal: "rest", priority: 0.1, reason: "x" }), usage });
    });
    const { provider } = billingProvider(fetchImpl);
    await provider.decide(prompt);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
