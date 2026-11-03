import { isLlmProviderError, LlmProviderError } from "./errors.js";
import {
  normalizeProviderResult,
  redactSecrets,
  type ModelRouterOptions,
  type NormalizedCognitionResult,
  type ProviderAdapter,
  type ProviderChatRequest,
} from "./provider.js";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";

export type ModelRouterLog = {
  level: "info" | "warn" | "error";
  message: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  attempt?: number;
  usedFallback?: boolean;
};

/**
 * Provider-neutral router with timeout/abort, bounded retry, rate-limit handling,
 * and optional fallback provider. Attribution stays on every result.
 */
export class ModelRouter implements CognitionProvider {
  readonly name = "model-router";
  private readonly primary: ProviderAdapter;
  private readonly fallback?: ProviderAdapter;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly log?: (entry: ModelRouterLog) => void;
  lastResult?: NormalizedCognitionResult;

  constructor(options: ModelRouterOptions & { log?: (entry: ModelRouterLog) => void }) {
    this.primary = options.primary;
    this.fallback = resolveFallback(options.primary, options.fallback);
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.retryDelayMs = options.retryDelayMs ?? 400;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 45_000;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? 10_000;
    this.log = options.log
      ? (entry) =>
          options.log?.({
            ...entry,
            message: redactSecrets(entry.message),
          })
      : undefined;
  }

  get primaryProvider(): string {
    return this.primary.name;
  }

  get primaryModel(): string {
    return this.primary.model;
  }

  async decide(prompt: CognitionPrompt, timeoutMs?: number, signal?: AbortSignal): Promise<HighLevelDecision> {
    const result = await this.complete({ prompt, timeoutMs, signal });
    this.lastResult = result;
    return result.structured;
  }

  async complete(request: ProviderChatRequest): Promise<NormalizedCognitionResult> {
    if (request.signal?.aborted) {
      throw new LlmProviderError({
        kind: "aborted",
        message: "LLM request aborted before start",
        provider: this.primary.name,
        model: this.primary.model,
        retryable: false,
      });
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const primaryError = await this.tryAdapter(this.primary, { ...request, timeoutMs }, false);
    if (primaryError.ok) {
      this.lastResult = primaryError.result;
      return primaryError.result;
    }

    if (this.fallback) {
      this.log?.({
        level: "warn",
        message: "primary provider failed; trying fallback",
        provider: this.primary.name,
        model: this.primary.model,
      });
      const fallbackError = await this.tryAdapter(this.fallback, { ...request, timeoutMs }, true);
      if (fallbackError.ok) {
        this.lastResult = fallbackError.result;
        return fallbackError.result;
      }
      throw fallbackError.error;
    }

    throw primaryError.error;
  }

  private async tryAdapter(
    adapter: ProviderAdapter,
    request: ProviderChatRequest,
    usedFallback: boolean,
  ): Promise<{ ok: true; result: NormalizedCognitionResult } | { ok: false; error: LlmProviderError }> {
    let lastError: LlmProviderError | undefined;
    let attempts = 0;
    // Bounded: attempt 0..maxRetries inclusive => maxRetries+1 tries, never infinite.
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      attempts = attempt + 1;
      if (request.signal?.aborted) {
        return {
          ok: false,
          error: new LlmProviderError({
            kind: "aborted",
            message: "LLM request aborted",
            provider: adapter.name,
            model: adapter.model,
            retryable: false,
          }),
        };
      }
      try {
        const raw = await adapter.complete(request);
        const result = normalizeProviderResult({
          provider: raw.provider || adapter.name,
          model: raw.model || adapter.model,
          decision: raw.structured ?? raw.decision,
          content: raw.content,
          latencyMs: raw.latencyMs,
          promptTokens: raw.usage?.promptTokens ?? raw.promptTokens,
          completionTokens: raw.usage?.completionTokens ?? raw.completionTokens,
          totalTokens: raw.usage?.totalTokens ?? raw.totalTokens,
          attemptCount: attempts,
          fallbackUsed: usedFallback,
        });
        this.log?.({
          level: "info",
          message: "llm decision ok",
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          attempt,
          usedFallback,
        });
        return { ok: true, result };
      } catch (error) {
        const wrapped = isLlmProviderError(error)
          ? error
          : new LlmProviderError({
              kind: "unknown",
              message: error instanceof Error ? error.message : String(error),
              provider: adapter.name,
              model: adapter.model,
              cause: error,
            });
        lastError = wrapped;
        this.log?.({
          level: "warn",
          message: wrapped.message,
          provider: wrapped.provider,
          model: wrapped.model,
          latencyMs: wrapped.latencyMs,
          attempt,
          usedFallback,
        });
        if (!wrapped.retryable || attempt >= this.maxRetries || wrapped.kind === "aborted" || wrapped.kind === "auth" || wrapped.kind === "config") {
          break;
        }
        const delay = retryDelayFor(wrapped, this.retryDelayMs, attempt, this.maxRetryAfterMs);
        try {
          await sleep(delay, request.signal);
        } catch (sleepError) {
          if (isLlmProviderError(sleepError)) {
            return { ok: false, error: sleepError };
          }
          throw sleepError;
        }
      }
    }
    return {
      ok: false,
      error:
        lastError ??
        new LlmProviderError({
          kind: "unknown",
          message: "LLM provider failed without error",
          provider: adapter.name,
          model: adapter.model,
        }),
    };
  }
}

/** Same provider+model must not be selected as its own fallback (avoids infinite loops). */
export function resolveFallback(
  primary: ProviderAdapter,
  fallback?: ProviderAdapter,
): ProviderAdapter | undefined {
  if (!fallback) return undefined;
  if (fallback.name === primary.name && fallback.model === primary.model) return undefined;
  return fallback;
}

function retryDelayFor(
  error: LlmProviderError,
  base: number,
  attempt: number,
  maxRetryAfterMs: number,
): number {
  if (error.kind === "rate_limited") {
    const cause = error.causeError as { retryAfterMs?: number } | undefined;
    if (cause?.retryAfterMs && cause.retryAfterMs > 0) {
      return Math.min(cause.retryAfterMs, maxRetryAfterMs);
    }
    return Math.min(base * 2 ** attempt * 2, maxRetryAfterMs);
  }
  return Math.min(base * 2 ** attempt, 4_000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new LlmProviderError({
          kind: "aborted",
          message: "LLM retry aborted",
          provider: "model-router",
          model: "n/a",
          retryable: false,
        }),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
