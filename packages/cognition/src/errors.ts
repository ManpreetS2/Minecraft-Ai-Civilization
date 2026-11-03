import type { ErrorCode } from "@civ/shared";
import { redactSecrets } from "./provider.js";

export type LlmErrorKind =
  | "timeout"
  | "aborted"
  | "rate_limited"
  | "invalid_output"
  | "unavailable"
  | "provider_error"
  | "auth"
  | "config"
  | "unknown";

export class LlmProviderError extends Error {
  readonly kind: LlmErrorKind;
  readonly code: ErrorCode;
  readonly provider: string;
  readonly model: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly causeError?: unknown;

  constructor(opts: {
    kind: LlmErrorKind;
    message: string;
    provider: string;
    model: string;
    retryable?: boolean;
    status?: number;
    latencyMs?: number;
    cause?: unknown;
  }) {
    super(redactSecrets(opts.message));
    this.name = "LlmProviderError";
    this.kind = opts.kind;
    this.provider = opts.provider;
    this.model = opts.model;
    this.retryable = opts.retryable ?? defaultRetryable(opts.kind, opts.status);
    this.status = opts.status;
    this.latencyMs = opts.latencyMs !== undefined ? Math.max(0, opts.latencyMs) : undefined;
    this.causeError = sanitizeCause(opts.cause);
    this.code = kindToCode(opts.kind);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      code: this.code,
      message: this.message,
      provider: this.provider,
      model: this.model,
      retryable: this.retryable,
      status: this.status,
      latencyMs: this.latencyMs,
    };
  }
}

function kindToCode(kind: LlmErrorKind): ErrorCode {
  switch (kind) {
    case "timeout":
      return "LLM_TIMEOUT";
    case "rate_limited":
      return "LLM_RATE_LIMITED";
    case "invalid_output":
      return "LLM_INVALID_OUTPUT";
    case "unavailable":
    case "auth":
    case "config":
      return "LLM_UNAVAILABLE";
    default:
      return "LLM_PROVIDER_ERROR";
  }
}

function defaultRetryable(kind: LlmErrorKind, status?: number): boolean {
  if (status === 401 || status === 403) return false;
  if (kind === "auth" || kind === "config" || kind === "aborted" || kind === "invalid_output") return false;
  return kind === "timeout" || kind === "rate_limited" || kind === "unavailable" || kind === "provider_error";
}

function sanitizeCause(cause: unknown): unknown {
  if (cause == null) return cause;
  if (typeof cause === "string") return redactSecrets(cause);
  if (cause instanceof Error) {
    return { name: cause.name, message: redactSecrets(cause.message) };
  }
  if (typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (/key|token|authorization|secret|password/i.test(key)) {
        out[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        out[key] = redactSecrets(value);
      } else if (typeof value === "number" || typeof value === "boolean") {
        out[key] = value;
      }
    }
    return out;
  }
  return cause;
}

export function isLlmProviderError(error: unknown): error is LlmProviderError {
  return error instanceof LlmProviderError;
}
