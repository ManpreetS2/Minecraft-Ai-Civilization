import type { SessionErrorCode } from "./error-codes.js";

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly sessionId?: string;
  readonly retryable: boolean;

  constructor(
    code: SessionErrorCode,
    message: string,
    opts: { sessionId?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "SessionError";
    this.code = code;
    if (opts.sessionId !== undefined) this.sessionId = opts.sessionId;
    this.retryable = opts.retryable ?? false;
  }
}

export function isSessionError(e: unknown): e is SessionError {
  return e instanceof SessionError;
}

/** Replaces every occurrence of `secret` in `text`. A blank secret redacts nothing. */
export function redact(text: string, secret: string | undefined): string {
  if (secret === undefined || secret === "") return text;
  return text.split(secret).join("[REDACTED]");
}

export type { SessionErrorCode } from "./error-codes.js";
