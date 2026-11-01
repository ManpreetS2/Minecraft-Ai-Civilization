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
  ])("fails closed for %s rather than recording a free successful request", async (_description, usage) => {
    const { budget, provider, fetchImpl } = mockProvider(usage);
    await expect(provider.decide(prompt)).rejects.toThrow(/missing or invalid token usage/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.snapshot.closed).toBe(true);
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.spendUsd).toBe(0);
    expect(budget.tryAdmit()).toMatchObject({ ok: false, reason: "cloud cognition shut down" });
    expect(provider.recentDecisions[0]?.ok).toBe(false);
  });
});
