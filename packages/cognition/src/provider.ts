import type { CognitionPrompt, HighLevelDecision } from "./schema.js";

export type ProviderChatRequest = {
  prompt: CognitionPrompt;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

/**
 * Normalized cognition result — planner-facing shape.
 * Provider-specific HTTP/JSON stays behind adapters.
 */
export type NormalizedCognitionResult = {
  provider: string;
  model: string;
  /** Raw textual content when available (never includes secrets). */
  content: string;
  /** Validated high-level decision (structured). */
  structured: HighLevelDecision;
  /** Backward-compatible alias of structured. */
  decision: HighLevelDecision;
  usage: TokenUsage;
  latencyMs: number;
  attemptCount: number;
  fallbackUsed: boolean;
  /** Deprecated alias retained for pass-1 callers. */
  usedFallback?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

/** @deprecated Use NormalizedCognitionResult */
export type ProviderChatResult = NormalizedCognitionResult;

/**
 * Provider-neutral adapter boundary.
 * Planner / memory / social code should depend on CognitionProvider / ModelRouter only.
 */
export type ProviderAdapter = {
  readonly name: string;
  readonly model: string;
  complete(request: ProviderChatRequest): Promise<NormalizedCognitionResult>;
};

export type ModelRouterOptions = {
  primary: ProviderAdapter;
  fallback?: ProviderAdapter;
  maxRetries?: number;
  /** Base delay for bounded retry; rate-limits may use Retry-After when available. */
  retryDelayMs?: number;
  defaultTimeoutMs?: number;
  /** Cap for Retry-After waits (ms). */
  maxRetryAfterMs?: number;
};

export function normalizeProviderResult(partial: {
  provider: string;
  model: string;
  decision: HighLevelDecision;
  content?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  attemptCount?: number;
  fallbackUsed?: boolean;
}): NormalizedCognitionResult {
  const latencyMs = Math.max(0, partial.latencyMs);
  const fallbackUsed = Boolean(partial.fallbackUsed);
  return {
    provider: partial.provider,
    model: partial.model,
    content: partial.content ?? JSON.stringify(partial.decision),
    structured: partial.decision,
    decision: partial.decision,
    usage: {
      promptTokens: partial.promptTokens,
      completionTokens: partial.completionTokens,
      totalTokens: partial.totalTokens,
    },
    latencyMs,
    attemptCount: partial.attemptCount ?? 1,
    fallbackUsed,
    usedFallback: fallbackUsed,
    promptTokens: partial.promptTokens,
    completionTokens: partial.completionTokens,
    totalTokens: partial.totalTokens,
  };
}

/** Strip likely secrets from error/log strings. */
export function redactSecrets(text: string): string {
  return text
    // Bearer tokens first so "Authorization: Bearer <secret>" does not leave a trailing secret.
    .replace(/Bearer\s+[\w.-]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|authorization|token)\s*[:=]\s*["']?[\w.-]+/gi, "$1=[REDACTED]")
    .replace(/\b(api[_-]?key|token)\b\s+[:=]?\s*["']?[\w.-]{8,}/gi, "$1 [REDACTED]")
    .replace(/key=[\w.-]+/gi, "key=[REDACTED]");
}
