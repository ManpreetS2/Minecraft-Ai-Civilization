import { describe, expect, it, vi } from "vitest";
import { LlmProviderError } from "./errors.js";
import { HeuristicProvider } from "./heuristic.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";
import {
  normalizeProviderResult,
  redactSecrets,
  type NormalizedCognitionResult,
  type ProviderAdapter,
  type ProviderChatRequest,
} from "./provider.js";
import { ModelRouter, resolveFallback } from "./router.js";
import type { HighLevelDecision } from "./schema.js";

const prompt = {
  citizenName: "Atlas",
  inventory: [],
  settlementNeeds: ["NEED_FOOD"] as string[],
  memories: [],
  nearbyCitizens: [],
};

const decision: HighLevelDecision = {
  goal: "gather_food",
  priority: 0.8,
  reason: "Hungry",
};

function adapter(
  name: string,
  impl: (req: ProviderChatRequest) => Promise<NormalizedCognitionResult>,
  model = `${name}-model`,
): ProviderAdapter {
  return { name, model, complete: impl };
}

function okResult(provider: string, model = `${provider}-model`): NormalizedCognitionResult {
  return normalizeProviderResult({
    provider,
    model,
    decision,
    content: JSON.stringify(decision),
    latencyMs: 12,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  });
}

describe("ModelRouter failure matrix", () => {
  it("primary provider succeeds with attribution", async () => {
    const primary = adapter("ollama", async () => okResult("ollama"));
    const router = new ModelRouter({ primary, maxRetries: 0 });
    const result = await router.complete({ prompt });
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("ollama-model");
    expect(result.structured.goal).toBe("gather_food");
    expect(result.decision.goal).toBe("gather_food");
    expect(result.fallbackUsed).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.totalTokens).toBe(15);
  });

  it("primary 429 → bounded fallback", async () => {
    let calls = 0;
    const primary = adapter("nvidia", async () => {
      calls += 1;
      throw new LlmProviderError({
        kind: "rate_limited",
        message: "rate limited",
        provider: "nvidia",
        model: "nvidia-model",
        status: 429,
        cause: { retryAfterMs: 5 },
      });
    });
    const fallback = adapter("heuristic", async (req) => new HeuristicProvider().complete(req));
    const router = new ModelRouter({ primary, fallback, maxRetries: 1, retryDelayMs: 1, maxRetryAfterMs: 20 });
    const result = await router.complete({ prompt });
    expect(calls).toBe(2); // attempt 0 + 1
    expect(result.fallbackUsed).toBe(true);
    expect(result.provider).toBe("heuristic");
  });

  it("primary 500 / timeout / connection error → bounded fallback", async () => {
    for (const err of [
      new LlmProviderError({ kind: "provider_error", message: "500", provider: "nvidia", model: "m", status: 500 }),
      new LlmProviderError({ kind: "timeout", message: "timeout", provider: "nvidia", model: "m" }),
      new LlmProviderError({ kind: "unavailable", message: "ECONNREFUSED", provider: "nvidia", model: "m" }),
    ]) {
      const primary = adapter("nvidia", async () => {
        throw err;
      });
      const fallback = adapter("ollama", async () => okResult("ollama"));
      const router = new ModelRouter({ primary, fallback, maxRetries: 0, retryDelayMs: 1 });
      const result = await router.complete({ prompt });
      expect(result.provider).toBe("ollama");
      expect(result.fallbackUsed).toBe(true);
    }
  });

  it("malformed structured output does not spam retries; uses fallback", async () => {
    const complete = vi.fn(async () => {
      throw new LlmProviderError({
        kind: "invalid_output",
        message: "bad json",
        provider: "gemini",
        model: "gemini-model",
        retryable: false,
      });
    });
    const primary = adapter("gemini", complete);
    const fallback = adapter("ollama", async () => okResult("ollama"));
    const router = new ModelRouter({ primary, fallback, maxRetries: 5, retryDelayMs: 1 });
    const result = await router.complete({ prompt });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("ollama");
  });

  it("fallback also fails → throws last error", async () => {
    const primary = adapter("nvidia", async () => {
      throw new LlmProviderError({ kind: "unavailable", message: "down", provider: "nvidia", model: "m" });
    });
    const fallback = adapter("ollama", async () => {
      throw new LlmProviderError({ kind: "unavailable", message: "also down", provider: "ollama", model: "m" });
    });
    const router = new ModelRouter({ primary, fallback, maxRetries: 0 });
    await expect(router.complete({ prompt })).rejects.toMatchObject({ message: "also down" });
  });

  it("AbortSignal already aborted / abort during request", async () => {
    const controller = new AbortController();
    controller.abort();
    const primary = adapter("ollama", async () => okResult("ollama"));
    const router = new ModelRouter({ primary, maxRetries: 0 });
    await expect(router.complete({ prompt, signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });

    const mid = new AbortController();
    const slow = adapter("ollama", async (req) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        req.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(
              new LlmProviderError({
                kind: "aborted",
                message: "aborted",
                provider: "ollama",
                model: "ollama-model",
                retryable: false,
              }),
            );
          },
          { once: true },
        );
      });
      return okResult("ollama");
    });
    const router2 = new ModelRouter({ primary: slow, maxRetries: 0 });
    const pending = router2.complete({ prompt, signal: mid.signal });
    mid.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
  });

  it("Retry-After respected within configured maximum; retry count bounded", async () => {
    const delays: number[] = [];
    let calls = 0;
    const primary = adapter("nvidia", async () => {
      calls += 1;
      throw new LlmProviderError({
        kind: "rate_limited",
        message: "rl",
        provider: "nvidia",
        model: "m",
        status: 429,
        cause: { retryAfterMs: 50_000 },
      });
    });
    const started = Date.now();
    const router = new ModelRouter({
      primary,
      maxRetries: 2,
      retryDelayMs: 1,
      maxRetryAfterMs: 15,
    });
    await expect(router.complete({ prompt })).rejects.toMatchObject({ kind: "rate_limited" });
    const elapsed = Date.now() - started;
    expect(calls).toBe(3);
    expect(elapsed).toBeLessThan(200); // capped, not 50s * retries
    delays.push(elapsed);
  });

  it("same provider/model is not selected as its own fallback", () => {
    const primary = adapter("ollama", async () => okResult("ollama"), "same");
    const fallback = adapter("ollama", async () => okResult("ollama"), "same");
    expect(resolveFallback(primary, fallback)).toBeUndefined();
    const other = adapter("ollama", async () => okResult("ollama"), "other");
    expect(resolveFallback(primary, other)?.model).toBe("other");
  });

  it("missing API key gives configuration error, not crash; 401/403 do not spam retries", async () => {
    const nvidia = new OpenAiCompatibleProvider({
      name: "nvidia",
      baseUrl: "https://example.invalid/v1",
      model: "meta/llama",
      // no api key
    });
    await expect(nvidia.complete({ prompt })).rejects.toMatchObject({ kind: "config" });

    let authCalls = 0;
    const primary = adapter("nvidia", async () => {
      authCalls += 1;
      throw new LlmProviderError({
        kind: "auth",
        message: "unauthorized api_key=SECRET123",
        provider: "nvidia",
        model: "m",
        status: 401,
      });
    });
    const router = new ModelRouter({ primary, maxRetries: 5, retryDelayMs: 1 });
    await expect(router.complete({ prompt })).rejects.toMatchObject({ kind: "auth" });
    expect(authCalls).toBe(1);
  });

  it("attribution reflects answering provider; latency never negative; tokens optional; secrets redacted", async () => {
    const primary = adapter("nvidia", async () => {
      throw new LlmProviderError({
        kind: "unavailable",
        message: "Authorization: Bearer super-secret-token",
        provider: "nvidia",
        model: "nvidia-model",
      });
    });
    const fallback = adapter("ollama", async () =>
      normalizeProviderResult({
        provider: "ollama",
        model: "ollama-model",
        decision,
        latencyMs: -5,
        // no tokens
      }),
    );
    const logs: string[] = [];
    const router = new ModelRouter({
      primary,
      fallback,
      maxRetries: 0,
      log: (e) => logs.push(e.message),
    });
    const result = await router.complete({ prompt });
    expect(result.provider).toBe("ollama");
    expect(result.fallbackUsed).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.totalTokens).toBeUndefined();
    expect(logs.join(" ")).not.toContain("super-secret-token");
    expect(redactSecrets("api_key=abc Bearer xyz")).toContain("[REDACTED]");
    const json = new LlmProviderError({
      kind: "auth",
      message: "token=sekrit",
      provider: "nvidia",
      model: "m",
      cause: { apiKey: "sekrit", retryAfterMs: 1 },
    }).toJSON();
    expect(JSON.stringify(json)).not.toContain("sekrit");
  });
});

describe("structured cognition contract", () => {
  it("normalizes equivalent decision shape across heuristic/mock providers", async () => {
    const heuristic = await new HeuristicProvider().complete({ prompt });
    const mockOllama = okResult("ollama");
    const mockNvidia = okResult("nvidia", "meta/llama");
    for (const result of [heuristic, mockOllama, mockNvidia]) {
      expect(result).toMatchObject({
        provider: expect.any(String),
        model: expect.any(String),
        content: expect.any(String),
        structured: expect.objectContaining({ goal: expect.any(String), priority: expect.any(Number), reason: expect.any(String) }),
        decision: expect.objectContaining({ goal: expect.any(String) }),
        usage: expect.any(Object),
        latencyMs: expect.any(Number),
        attemptCount: expect.any(Number),
        fallbackUsed: expect.any(Boolean),
      });
      expect(result.structured).toEqual(result.decision);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
