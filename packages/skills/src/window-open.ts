import { fail, type ActionResult, type ErrorCode } from "@civ/shared";
import type { SkillContext } from "./context.js";

/** A window request that lost the race with cancellation or the remaining deadline. */
export class WindowOpenError extends Error {
  readonly code: "CANCELLED" | "TIMEOUT";

  constructor(code: "CANCELLED" | "TIMEOUT", message: string) {
    super(message);
    this.name = "WindowOpenError";
    this.code = code;
  }
}

/**
 * Open one window, bounded by the signal and by the time this operation still has.
 * `open` is invoked once. A window that arrives after cancellation or the deadline is closed and never returned.
 */
export async function openWindowBounded<T extends { close(): void }>(
  ctx: SkillContext,
  open: () => Promise<T>,
  started: number,
): Promise<T> {
  if (ctx.signal?.aborted) throw new WindowOpenError("CANCELLED", "cancelled before opening the window");
  const remaining = (ctx.timeoutMs ?? 12_000) - (Date.now() - started);
  if (remaining <= 0) throw new WindowOpenError("TIMEOUT", "no time left to open the window");

  let discard = false;
  let opened: T | undefined;
  const opening = open().then((window) => {
    opened = window;
    if (discard || ctx.signal?.aborted) {
      try {
        window.close();
      } catch {
        // The caller is already leaving this window behind.
      }
    }
    return window;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WindowOpenError("TIMEOUT", "window did not open before the deadline")), remaining);
  });
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new WindowOpenError("CANCELLED", "cancelled while opening the window"));
    if (ctx.signal?.aborted) onAbort();
    else ctx.signal?.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const window = await Promise.race([opening, timeout, cancelled]);
    if (ctx.signal?.aborted) {
      discard = true;
      try {
        window.close();
      } catch {
        // Already closed by the late-open path.
      }
      throw new WindowOpenError("CANCELLED", "cancelled after the window opened");
    }
    return window;
  } catch (error) {
    discard = true;
    if (opened) {
      try {
        opened.close();
      } catch {
        // The late window is already closed.
      }
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) ctx.signal?.removeEventListener("abort", onAbort);
    void opening.catch(() => undefined);
    void cancelled.catch(() => undefined);
  }
}

export function cancelledResult<T>(started: number, message: string): ActionResult<T> {
  return fail("CANCELLED", message, Date.now() - started, false);
}

export function interruptionResult(
  code: ErrorCode,
  error: string,
  started: number,
  retryable: boolean,
  details?: Record<string, unknown>,
): ActionResult<never> {
  return fail(code, error, Date.now() - started, retryable, details);
}

/** Sleep that ends early when the skill is cancelled, so the next check cannot miss the abort. */
export function waitForSignal(signal: AbortSignal | undefined, ms: number): Promise<void> {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
