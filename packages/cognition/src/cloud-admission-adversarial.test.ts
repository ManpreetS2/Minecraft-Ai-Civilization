import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAdmissionError, CloudBudgetGate } from "./cloud-budget.js";
import { OPENAI_MODEL_PRICES, boundCloudAttemptCostUsd, estimateCloudCostUsd } from "./cloud-prices.js";
import { OpenAiResponsesProvider, assertOpenAiConfig } from "./openai-responses.js";

const MODEL = "gpt-4o-mini";
const decision = JSON.stringify({ goal: "rest", priority: 0.1, reason: "x" });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const RATE_LIMITED = { error: { type: "requests", code: "rate_limit_exceeded" } };

const basePrompt = {
  citizenName: "A",
  health: 20,
  hunger: 12,
  inventory: [],
  settlementNeeds: [],
  memories: [] as string[],
  nearbyCitizens: [],
};
const promptOfBytes = (bytes: number) => ({ ...basePrompt, memories: ["m".repeat(bytes)] });

function build(
  fetchImpl: unknown,
  over: {
    allowance?: number;
    maxConcurrency?: number;
    maxRequests?: number;
    maxRetries?: number;
    maxInputTokens?: number;
    model?: string;
  } = {},
) {
  const budget = new CloudBudgetGate({
    maxConcurrency: over.maxConcurrency ?? 1,
    maxRequestsPerRun: over.maxRequests ?? 1000,
    spendAllowanceUsd: over.allowance ?? 1,
  });
  const provider = new OpenAiResponsesProvider({
    apiKey: "sk-test-offline",
    model: over.model ?? MODEL,
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 1000,
    maxInputTokens: over.maxInputTokens ?? 1_000_000,
    maxOutputTokens: 128,
    maxRetries: over.maxRetries ?? 0,
    retryBaseDelayMs: 0,
    budget,
    fetchImpl: fetchImpl as typeof fetch,
  });
  return { budget, provider };
}

const committed = (budget: CloudBudgetGate) => {
  const { spendUsd, heldUsd, reservedUsd } = budget.snapshot;
  return spendUsd + heldUsd + reservedUsd;
};

describe("cloud spend admission (mock-only)", () => {
  // Each call really consumes 500k input tokens: $0.075 at gpt-4o-mini rates.
  const callCost = estimateCloudCostUsd({ model: MODEL, inputTokens: 500_000, outputTokens: 0 });
  const expensive = () => json(200, { output_text: decision, usage: { input_tokens: 500_000, output_tokens: 0 } });

  it("documents the previous flat $0.01 policy overrunning a $1.00 allowance to $1.05", () => {
    // Same arithmetic as the replaced gate, which checked only `spend + flatReserve` before each call.
    let spend = 0;
    let calls = 0;
    while (spend + 0.01 <= 1 + 1e-9) {
      spend += callCost;
      calls += 1;
    }
    expect(callCost).toBe(0.075);
    expect(calls).toBe(14);
    expect(spend).toBeCloseTo(1.05);
  });

  it("stops the same $0.075 workload at or below $1.00 when the prompt really is that large", async () => {
    const fetchImpl = vi.fn(async () => expensive());
    const { budget, provider } = build(fetchImpl);
    const big = promptOfBytes(499_000);
    const refusals: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      await provider.decide(big).catch((error: Error) => refusals.push(error.message));
    }
    expect(fetchImpl).toHaveBeenCalledTimes(13);
    expect(budget.snapshot.spendUsd).toBeCloseTo(0.975);
    expect(budget.snapshot.spendUsd).toBeLessThanOrEqual(1);
    expect(budget.snapshot.closed).toBe(false);
    expect(refusals).toHaveLength(17);
    expect(refusals[0]).toMatch(/cannot cover the required reservation/);
  });

  it("closes after one call when reported usage shows the bound did not hold", async () => {
    const fetchImpl = vi.fn(async () => expensive());
    const { budget, provider } = build(fetchImpl);
    await expect(provider.decide(basePrompt)).resolves.toMatchObject({ goal: "rest" });
    expect(budget.snapshot.closedReason).toMatch(/exceeded the admission bound/);
    for (let i = 0; i < 30; i += 1) {
      await expect(provider.decide(basePrompt)).rejects.toThrow(/exceeded the admission bound/);
    }
    // The excess is detected only after the call, so it is recorded rather than prevented.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.snapshot.spendUsd).toBe(0.075);
  });

  it("does not let concurrent calls over-commit the allowance", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await hold;
      return expensive();
    });
    const { budget, provider } = build(fetchImpl, { maxConcurrency: 8, allowance: 0.2 });
    const big = promptOfBytes(499_000);
    const results = Array.from({ length: 8 }, () => provider.decide(big).then(() => "ok", (e: Error) => e.message));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(budget.snapshot.inFlight).toBe(2);
    expect(committed(budget)).toBeLessThanOrEqual(0.2);
    release();
    const settled = await Promise.all(results);
    expect(settled.filter((r) => r === "ok")).toHaveLength(2);
    expect(settled.filter((r) => /cannot cover/.test(r))).toHaveLength(6);
    expect(budget.snapshot.spendUsd).toBeCloseTo(0.15);
  });

  it("reserves every retry up front, so a request is refused if all its attempts cannot be covered", async () => {
    const fetchImpl = vi.fn(async () => expensive());
    const big = promptOfBytes(499_000);
    const single = build(fetchImpl, { allowance: 0.1, maxRetries: 0 });
    await expect(single.provider.decide(big)).resolves.toBeDefined();
    fetchImpl.mockClear();
    const retrying = build(fetchImpl, { allowance: 0.1, maxRetries: 1 });
    await expect(retrying.provider.decide(big)).rejects.toThrow(/cannot cover/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays within the allowance when every attempt ends in an unbilled-looking failure", async () => {
    const fetchImpl = vi.fn(async () => json(500, {}));
    const { budget, provider } = build(fetchImpl, { allowance: 0.5, maxRetries: 2, maxConcurrency: 8 });
    const big = promptOfBytes(99_000);
    for (let round = 0; round < 20; round += 1) {
      await Promise.all(Array.from({ length: 8 }, () => provider.decide(big).catch(() => undefined)));
      expect(committed(budget)).toBeLessThanOrEqual(0.5);
    }
    // Worst case each sent attempt was billed at its bound, and that sum is the hold.
    expect(budget.snapshot.heldUsd).toBeLessThanOrEqual(0.5);
    expect(budget.snapshot.spendUsd).toBe(0);
    expect(budget.snapshot.reservedUsd).toBe(0);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
  });

  it("holds a timed-out or failed attempt's bound without closing the budget", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network failure");
    });
    const { budget, provider } = build(fetchImpl, { maxRetries: 1 });
    await expect(provider.decide(basePrompt)).rejects.toThrow(/network failure/);
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
    expect(budget.snapshot).toMatchObject({ spendUsd: 0, reservedUsd: 0, inFlight: 0, closed: false });
    expect(provider.recentDecisions[0]?.unverifiedHoldUsd).toBe(budget.snapshot.heldUsd);
    expect(provider.recentDecisions[0]?.estimatedCostUsd).toBeUndefined();
  });

  it("keeps the 5xx attempt's hold when a retry then succeeds, and releases the rest", async () => {
    const usage = { input_tokens: 10, output_tokens: 5 };
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json(500, {}))
      .mockResolvedValueOnce(json(200, { output_text: decision, usage }));
    const { budget, provider } = build(fetchImpl, { maxRetries: 2 });
    await expect(provider.decide(basePrompt)).resolves.toMatchObject({ goal: "rest" });
    const snapshot = budget.snapshot;
    expect(snapshot.reservedUsd).toBe(0);
    expect(snapshot.heldUsd).toBeGreaterThan(0);
    expect(snapshot.spendUsd).toBe(estimateCloudCostUsd({ model: MODEL, inputTokens: 10, outputTokens: 5 }));
    expect(provider.recentDecisions[0]).toMatchObject({ ok: true, unverifiedHoldUsd: snapshot.heldUsd });
  });

  it("refunds a 429 attempt and funds its retry from the same reservation", async () => {
    const usage = { input_tokens: 10, output_tokens: 5 };
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json(429, RATE_LIMITED))
      .mockResolvedValueOnce(json(200, { output_text: decision, usage }));
    const { budget, provider } = build(fetchImpl, { maxRetries: 1 });
    await provider.decide(basePrompt);
    expect(budget.snapshot).toMatchObject({ heldUsd: 0, reservedUsd: 0, inFlight: 0, requestsUsed: 2 });
  });

  it("measures non-ASCII prompts in UTF-8 bytes, not characters", async () => {
    const fetchImpl = vi.fn(async () => json(200, { output_text: decision, usage: { input_tokens: 1, output_tokens: 1 } }));
    const { provider } = build(fetchImpl, { maxInputTokens: 16_000 });
    // 5,000 characters fit the cap, but at 4 bytes each they do not.
    await expect(provider.decide(promptOfBytes(5_000))).resolves.toBeDefined();
    fetchImpl.mockClear();
    const emoji = { ...basePrompt, memories: ["\u{1F600}".repeat(5_000)] };
    await expect(provider.decide(emoji)).rejects.toThrow(/exceeds CLOUD_MAX_INPUT_TOKENS/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an oversized request unsent and without consuming budget", async () => {
    const fetchImpl = vi.fn(async () => expensive());
    const { budget, provider } = build(fetchImpl, { maxInputTokens: 16_000 });
    const refused = await provider.decide(promptOfBytes(20_000)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CloudAdmissionError);
    expect((refused as CloudAdmissionError).code).toBe("input_too_large");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(budget.snapshot).toMatchObject({ requestsUsed: 0, reservedUsd: 0, closed: false });
  });

  it("never exceeds the allowance across randomized in-bound workloads", async () => {
    let seed = 20261101;
    const random = (limit: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * limit);
    };
    for (let run = 0; run < 40; run += 1) {
      const allowance = 0.05 + random(100) / 200;
      const outcomes = () => {
        switch (random(4)) {
          case 0:
            return json(500, {});
          case 1:
            return json(429, RATE_LIMITED);
          case 2:
            return json(200, { output_text: "not-json", usage: { input_tokens: 5_000, output_tokens: 128 } });
          default:
            return json(200, { output_text: decision, usage: { input_tokens: 5_000, output_tokens: 128 } });
        }
      };
      const fetchImpl = vi.fn(async () => outcomes());
      const { budget, provider } = build(fetchImpl, {
        allowance,
        maxConcurrency: 1 + random(8),
        maxRetries: random(3),
        model: "gpt-4o",
      });
      const big = promptOfBytes(5_000 + random(20_000));
      for (let batch = 0; batch < 12; batch += 1) {
        await Promise.all(Array.from({ length: 1 + random(8) }, () => provider.decide(big).catch(() => undefined)));
        expect(committed(budget)).toBeLessThanOrEqual(allowance);
        expect(budget.snapshot.closed).toBe(false);
      }
    }
  });
});

describe("costs that cannot be bounded (mock-only)", () => {
  const saved = OPENAI_MODEL_PRICES[MODEL]!;
  afterEach(() => {
    OPENAI_MODEL_PRICES[MODEL] = saved;
  });

  it("does not price unknown models from a default or inherited table entry", () => {
    for (const model of ["unknown-model", "constructor", "__proto__"]) {
      expect(boundCloudAttemptCostUsd({ model, inputTokens: 1, outputTokens: 1 })).toBeNaN();
      expect(() => estimateCloudCostUsd({ model, inputTokens: 1, outputTokens: 1 })).toThrow(/No configured price/);
    }
  });

  it("rejects an allowlisted model that has no usable price", () => {
    OPENAI_MODEL_PRICES[MODEL] = { inputPerMillionUsd: 0, outputPerMillionUsd: 0.6 };
    expect(() =>
      assertOpenAiConfig({ apiKey: "sk-x", model: MODEL, baseUrl: "https://api.openai.com/v1" }),
    ).toThrow(/cannot be bounded/);
  });

  it.each([
    ["NaN bound", { attemptBoundUsd: NaN, maxAttempts: 1 }],
    ["infinite bound", { attemptBoundUsd: Infinity, maxAttempts: 1 }],
    ["zero bound", { attemptBoundUsd: 0, maxAttempts: 1 }],
    ["fractional attempts", { attemptBoundUsd: 0.01, maxAttempts: 1.5 }],
    ["no attempts", { attemptBoundUsd: 0.01, maxAttempts: 0 }],
  ])("closes the gate on an admission estimate with %s", (_description, estimate) => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
    expect(budget.tryAdmit(estimate)).toMatchObject({ ok: false, code: "closed" });
    expect(budget.snapshot.closedReason).toMatch(/could not be bounded/);
    expect(budget.tryAdmit({ attemptBoundUsd: 0.01, maxAttempts: 1 }).ok).toBe(false);
  });

  it("keeps a hold and closes when reported usage names an unpriced model", () => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
    const admission = budget.tryAdmit({ attemptBoundUsd: 0.01, maxAttempts: 2 });
    if (!admission.ok) throw new Error(admission.reason);
    expect(() =>
      budget.reconcile(admission.reservationId, { model: "unknown-model", inputTokens: 1, outputTokens: 1 }, false),
    ).toThrow(/invalid or unpriced/);
    // One attempt stays held and the unused retry is released.
    expect(budget.snapshot).toMatchObject({ closed: true, spendUsd: 0, heldUsd: 0.01, reservedUsd: 0, inFlight: 0 });
  });

  it.each([
    ["NaN retries", { maxRetries: NaN }],
    ["negative retries", { maxRetries: -1 }],
    ["NaN output cap", { maxOutputTokens: NaN }],
    ["NaN input cap", { maxInputTokens: NaN }],
  ])("rejects a provider configured with %s", (_description, over) => {
    expect(
      () =>
        new OpenAiResponsesProvider({
          apiKey: "sk-test-offline",
          model: MODEL,
          baseUrl: "https://api.openai.com/v1",
          timeoutMs: 1000,
          maxOutputTokens: 128,
          maxRetries: 0,
          budget: new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 }),
          ...over,
        }),
    ).toThrow(RangeError);
  });
});
