import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GateAOfflineHarness,
  DEFAULT_1V1_ASSIGNMENTS,
} from "../src/provider-harness.js";

const networkGuard = vi.fn(() => {
  throw new Error("REAL NETWORK ATTEMPTED: Test failed security invariant");
});

describe("Section 4 — Budgets, Faults & Failure Handling", () => {
  const harnesses: GateAOfflineHarness[] = [];

  beforeEach(() => {
    networkGuard.mockClear();
    vi.stubGlobal("fetch", networkGuard);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    expect(networkGuard).not.toHaveBeenCalled();

    for (const h of harnesses.splice(0)) {
      await h.stop().catch(() => undefined);
    }
  });

  function createHarness(options = {}) {
    const h = new GateAOfflineHarness(options);
    harnesses.push(h);
    return h;
  }

  it("1. Concurrency limits prevent simultaneous requests above ceiling", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({ ...a, timeoutMs: 30_000 }));
    const h = createHarness({
      assignments,
      maxConcurrency: 1,
    });
    await h.init();

    h.openaiTransport.setResponder(() => ({ hang: true }));
    h.claudeTransport.setResponder(() => ({ goal: "gather_food" }));

    await h.tickCitizenOnly("gpt-a");
    expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(true);

    await h.tickCitizenOnly("claude-a");

    await vi.waitFor(() => {
      expect(h.skips().some((s) => s.includes("concurrency"))).toBe(true);
    });
    expect(h.claudeTransport.calls).toHaveLength(0);

    h.registry.providerFor("gpt-a").cancel();
    await vi.waitFor(() => expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(false));

    await h.tickCitizen("claude-a");
    expect(h.claudeTransport.calls).toHaveLength(1);
    expect(h.getCitizenRuntime("claude-a")?.pendingLlm?.goal).toBe("gather_food");
  });

  it("2. Request counts enforce experiment ceiling and citizen allowance", async () => {
    const h = createHarness({
      maxRequestsPerRun: 2,
    });
    await h.init();

    h.openaiTransport.setResponder(() => ({ goal: "gather_food" }));
    h.claudeTransport.setResponder(() => ({ goal: "mine_stone" }));

    await h.tickCitizen("gpt-a");
    await h.tickCitizen("claude-a");

    expect(h.registry.accounting().experiment.requestsUsed).toBe(2);

    await h.tickCitizen("gpt-a");

    const skips = h.skips();
    expect(skips.some((s) => s.includes("request budget exhausted") || s.includes("cloud request budget"))).toBe(true);
    expect(h.openaiTransport.calls).toHaveLength(1);
    expect(h.claudeTransport.calls).toHaveLength(1);
  });

  it("3. Token accounting tracks input and output tokens per citizen and across providers", async () => {
    const h = createHarness();
    await h.init();

    h.openaiTransport.setResponder(() => ({
      goal: "gather_food",
      usage: { input_tokens: 150, output_tokens: 45 },
    }));
    h.claudeTransport.setResponder(() => ({
      goal: "mine_stone",
      usage: { input_tokens: 210, output_tokens: 75 },
    }));

    await h.tickBoth();

    const accounting = h.registry.accounting();
    const gptAcct = accounting.citizens["gpt-a"]!;
    const claudeAcct = accounting.citizens["claude-a"]!;

    expect(gptAcct.inputTokens).toBe(150);
    expect(gptAcct.outputTokens).toBe(45);

    expect(claudeAcct.inputTokens).toBe(210);
    expect(claudeAcct.outputTokens).toBe(75);
  });

  it("4. Estimated versus confirmed charges: reservations settle to confirmed cost", async () => {
    const h = createHarness();
    await h.init();

    h.openaiTransport.setResponder(() => ({
      goal: "gather_food",
      usage: { input_tokens: 1000, output_tokens: 100 },
    }));
    h.claudeTransport.setResponder(() => ({
      goal: "mine_stone",
      usage: { input_tokens: 1000, output_tokens: 100 },
    }));

    await h.tickBoth();

    const accounting = h.registry.accounting();
    const gptAcct = accounting.citizens["gpt-a"]!;
    const claudeAcct = accounting.citizens["claude-a"]!;

    // gpt-4o-mini: $0.15/1M input ($0.00015), $0.60/1M output ($0.00006) = $0.00021
    expect(gptAcct.reservedUsd).toBe(0);
    expect(gptAcct.estimatedSpendUsd).toBeCloseTo(0.00021, 5);

    // claude-haiku-5-5: $0.10/1M input ($0.0001), $0.50/1M output ($0.00005) = $0.00015
    expect(claudeAcct.reservedUsd).toBe(0);
    expect(claudeAcct.estimatedSpendUsd).toBeCloseTo(0.00015, 5);
  });

  it("5. Unknown usage closes the budget fail-closed and prevents unmeasured inference", async () => {
    const h = createHarness();
    await h.init();

    h.openaiTransport.setResponder(() => ({
      goal: "gather_food",
      usage: null,
    }));

    await h.tickCitizen("gpt-a");

    const skips = h.skips();
    expect(skips.some((s) => s.includes("usage is unknown") || s.includes("missing token usage") || s.includes("cloud admissions closed"))).toBe(true);

    const snapshot = h.registry.accounting().experiment;
    expect(snapshot.closedReason).toBeDefined();
    expect(snapshot.closedReason).toMatch(/usage|unverified/i);

    h.claudeTransport.setResponder(() => ({ goal: "mine_stone" }));
    await h.tickCitizen("claude-a");

    expect(h.claudeTransport.calls).toHaveLength(0);
  });

  it("6. Retry accounting records every attempt against quotas", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({ ...a, maxRetries: 2 }));
    const h = createHarness({ assignments });
    await h.init();

    let attempts = 0;
    h.claudeTransport.setResponder(() => {
      attempts++;
      if (attempts === 1) {
        return { status: 503 };
      }
      return { goal: "mine_stone", usage: { input_tokens: 100, output_tokens: 20 } };
    });

    await h.tickCitizen("claude-a");

    expect(h.claudeTransport.calls).toHaveLength(2);
    const claudeAcct = h.registry.accounting().citizens["claude-a"]!;
    expect(claudeAcct.requests).toBe(2);
    expect(claudeAcct.retries).toBe(1);
    expect(h.getCitizenRuntime("claude-a")?.pendingLlm?.goal).toBe("mine_stone");
  });

  it("7. Timeouts abort the in-flight request, hold attempt cost, and allow future decisions", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({
      ...a,
      timeoutMs: 100,
      maxRetries: 0,
    }));
    const h = createHarness({ assignments });
    await h.init();

    h.openaiTransport.setResponder(() => ({ hang: true }));

    await h.tickCitizen("gpt-a");

    expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(false);
    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm).toBeUndefined();

    const gptAcct = h.registry.accounting().citizens["gpt-a"]!;
    expect(gptAcct.unverifiedHoldUsd).toBeGreaterThan(0);

    h.openaiTransport.setResponder(() => ({ goal: "gather_wood" }));
    await h.tickCitizen("gpt-a");

    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm?.goal).toBe("gather_wood");
  });

  it("8. Rate limits: 429 with retry-after retries and succeeds, 429 without retry-after is non-retryable", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({
      ...a,
      maxRetries: 1,
      timeoutMs: 10_000,
    }));
    const h = createHarness({ assignments });
    await h.init();

    // Part A: 429 with retry-after
    let gptCalls = 0;
    h.openaiTransport.setResponder(() => {
      gptCalls++;
      if (gptCalls === 1) {
        return {
          status: 429,
          retryAfterMs: 50,
          errorBody: { error: { code: "rate_limit_exceeded", type: "requests", message: "Rate limit reached" } },
        };
      }
      return { goal: "gather_food" };
    });

    await h.tickCitizen("gpt-a");

    expect(h.openaiTransport.calls).toHaveLength(2);
    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm?.goal).toBe("gather_food");

    // Part B: 429 without retry-after
    h.claudeTransport.setResponder(() => ({
      status: 429,
      errorBody: { type: "error", error: { type: "rate_limit_error", message: "Quota exceeded" } },
    }));

    await h.tickCitizen("claude-a");

    // Must NOT retry when no retry-after is given (could be spend cap)
    expect(h.claudeTransport.calls).toHaveLength(1);
    expect(h.getCitizenRuntime("claude-a")?.pendingLlm).toBeUndefined();
  });

  it("9. Provider outages: 5xx retries up to maxRetries then fails cleanly without corrupting state", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({
      ...a,
      maxRetries: 1,
      timeoutMs: 10_000,
    }));
    const h = createHarness({ assignments });
    await h.init();

    h.openaiTransport.setResponder(() => ({
      status: 500,
      errorBody: { error: { message: "Internal server error" } },
    }));

    await h.tickCitizen("gpt-a");

    expect(h.openaiTransport.calls).toHaveLength(2);
    expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(false);
    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm).toBeUndefined();

    const skips = h.skips();
    expect(skips.some((s) => s.includes("500"))).toBe(true);
  });

  it("10. Cancellation during retries prevents further requests and refunds unsent reservations", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({
      ...a,
      maxRetries: 2,
      timeoutMs: 60_000,
    }));
    const h = createHarness({
      assignments,
      retryBaseDelayMs: 5_000,
    });
    await h.init();

    let attempts = 0;
    h.openaiTransport.setResponder(() => {
      attempts++;
      return { status: 503 };
    });

    await h.tickCitizenOnly("gpt-a");
    await vi.waitFor(() => expect(attempts).toBe(1));

    h.registry.providerFor("gpt-a").cancel();

    await new Promise((r) => setTimeout(r, 200));

    expect(h.openaiTransport.calls).toHaveLength(1);
    const gptAcct = h.registry.accounting().citizens["gpt-a"]!;
    expect(gptAcct.reservedUsd).toBe(0);
  });

  it("11. Budget exhaustion fails closed with no silent cross-family fallback or misattributed inference", async () => {
    const assignments = [
      {
        ...DEFAULT_1V1_ASSIGNMENTS[0]!,
        fallback: { kind: "heuristic" as const },
      },
      DEFAULT_1V1_ASSIGNMENTS[1]!,
    ];
    const h = createHarness({
      assignments,
      spendAllowanceUsd: 0.0001,
    });
    await h.init();

    // Decision 1 consumes the tiny spend allowance
    h.openaiTransport.setResponder(() => ({
      goal: "gather_food",
      usage: { input_tokens: 1000, output_tokens: 100 },
    }));

    await h.tickCitizen("gpt-a");
    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm?.goal).toBe("gather_food");

    // Decision 2: spend allowance is exhausted
    await h.tickCitizen("gpt-a");

    // Fallback took over because budget is exhausted
    const evidence = h.registry.evidenceLog();
    const fallbackEv = evidence[evidence.length - 1]!;

    expect(fallbackEv.citizenId).toBe("gpt-a");
    expect(fallbackEv.outcome).toBe("fallback");
    expect(fallbackEv.decidedBy).toBe("heuristic");
    expect(fallbackEv.decidedBy).not.toBe("claude-haiku-5-5");
    expect(fallbackEv.family).toBe("gpt");

    // Claude was NEVER called as fallback for GPT
    expect(h.claudeTransport.calls).toHaveLength(0);
  });
});
