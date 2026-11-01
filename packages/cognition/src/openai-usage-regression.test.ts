import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { CloudBudgetGate } from "./cloud-budget.js";
import { estimateCloudCostUsd } from "./cloud-prices.js";
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
    ["missing usage", undefined, /missing token usage/],
    ["negative input", { input_tokens: -1, output_tokens: 5 }, /invalid token usage/],
    ["fractional output", { input_tokens: 10, output_tokens: 0.5 }, /invalid token usage/],
    ["string input", { input_tokens: "10", output_tokens: 5 }, /invalid token usage/],
    ["null output", { input_tokens: 10, output_tokens: null }, /invalid token usage/],
    ["missing output", { input_tokens: 10 }, /invalid token usage/],
    ["non-object usage", "lots", /invalid token usage/],
  ])("fails closed for %s rather than recording a free successful request", async (_description, usage, reason) => {
    const { budget, provider, fetchImpl } = mockProvider(usage);
    await expect(provider.decide(prompt)).rejects.toThrow(reason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.snapshot.closed).toBe(true);
    expect(budget.snapshot.closedReason).toMatch(reason);
    expect(budget.snapshot.inFlight).toBe(0);
    // The hold stays counted against the allowance but is not reported as estimated spend.
    expect(budget.snapshot.spendUsd).toBe(0);
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
    const record = provider.recentDecisions[0];
    expect(record).toMatchObject({ ok: false, httpStatus: 200, unverifiedHoldUsd: budget.snapshot.heldUsd });
    expect(record?.estimatedCostUsd).toBeUndefined();
    // Later refusals keep naming the cause instead of a generic shutdown.
    await expect(provider.decide(prompt)).rejects.toThrow(reason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
  const usage = { input_tokens: 200, output_tokens: 10 };
  const cost = estimateCloudCostUsd({ model: "gpt-4o-mini", inputTokens: 200, outputTokens: 10 });

  it.each([
    ["malformed JSON text", { output_text: "not-json", usage }],
    ["a disallowed goal", { output_text: JSON.stringify({ goal: "teleport_home", priority: 1, reason: "warp" }), usage }],
    ["no output text", { usage }],
  ])("charges actual usage when a successful response contains %s", async (_description, body) => {
    const { budget, provider } = billingProvider(async () => json(200, body));
    await expect(provider.decide(prompt)).rejects.toThrow();
    expect(budget.snapshot.spendUsd).toBe(cost);
    expect(budget.snapshot.heldUsd).toBe(0);
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.closed).toBe(false);
    expect(provider.recentDecisions[0]).toMatchObject({
      ok: false,
      inputTokens: 200,
      outputTokens: 10,
      estimatedCostUsd: cost,
      httpStatus: 200,
    });
  });

  it("keeps a hold and closes with a specific reason when a successful response body cannot be read", async () => {
    const { budget, provider } = billingProvider(
      async () => new Response("{truncated", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(provider.decide(prompt)).rejects.toThrow(/body was unreadable/);
    expect(budget.snapshot).toMatchObject({ inFlight: 0, closed: true, spendUsd: 0, reservedUsd: 0 });
    expect(budget.snapshot.closedReason).toMatch(/body was unreadable/);
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it("still refunds requests the provider rejected", async () => {
    const { budget, provider } = billingProvider(async () => json(400, { error: "bad" }));
    await expect(provider.decide(prompt)).rejects.toThrow(/400/);
    expect(budget.snapshot).toMatchObject({ inFlight: 0, spendUsd: 0, heldUsd: 0, reservedUsd: 0, closed: false });
  });

  it("releases the slot when a timeout lands between retry attempts", async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return json(429, {});
    });
    const { budget, provider } = billingProvider(fetchImpl, { maxRetries: 1, timeoutMs: 10 });
    await expect(provider.decide(prompt)).rejects.toThrow(/cancelled/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.snapshot).toMatchObject({ inFlight: 0, spendUsd: 0, heldUsd: 0, reservedUsd: 0, closed: false });
    expect(provider.recentDecisions.at(-1)).toMatchObject({ ok: false, failureReason: "OpenAI request cancelled" });
    // Nothing is held against concurrency, so the next call is admitted.
    expect(budget.tryAdmit({ attemptBoundUsd: 0.01, maxAttempts: 1 }).ok).toBe(true);
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

  it("does not deliver the prompt to a redirect target with real fetch (loopback only)", async () => {
    const delivered: string[] = [];
    const target = createServer((req, res) => {
      delivered.push(req.url ?? "");
      req.resume();
      res.writeHead(200).end(JSON.stringify({ output_text: "{}", usage }));
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const origin = createServer((req, res) => {
      req.resume();
      res.writeHead(307, { location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/elsewhere` }).end();
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    try {
      const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
      const provider = new OpenAiResponsesProvider({
        apiKey: "sk-test-offline",
        model: "gpt-4o-mini",
        baseUrl: `http://127.0.0.1:${(origin.address() as AddressInfo).port}/v1`,
        timeoutMs: 2000,
        maxOutputTokens: 128,
        maxRetries: 0,
        budget,
      });
      await expect(provider.decide(prompt)).rejects.toThrow();
      expect(delivered).toEqual([]);
      expect(budget.snapshot).toMatchObject({ inFlight: 0, reservedUsd: 0 });
    } finally {
      origin.close();
      target.close();
    }
  });
});
