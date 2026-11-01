export type AbortCause = "timeout" | "caller" | "cancel" | "close";

export interface AbortScope {
  readonly signal: AbortSignal;
  /** Why the scope aborted, or undefined if it has not. First cause wins. */
  cause(): AbortCause | undefined;
  abort(cause: AbortCause): void;
  /** Clears the timer and listeners. Does not abort. */
  dispose(): void;
}

/**
 * One scope per send. Wires the caller signal, an explicit abort (cancel/close) and a MANUAL setTimeout
 * (not AbortSignal.timeout, which fake timers cannot control) into a single AbortSignal.
 */
export function createAbortScope(options: { callerSignal?: AbortSignal; timeoutMs: number }): AbortScope {
  const controller = new AbortController();
  const state: { cause?: AbortCause } = {};
  const abort = (cause: AbortCause): void => {
    if (state.cause !== undefined) return;
    state.cause = cause;
    controller.abort(cause);
  };
  const timer = setTimeout(() => abort("timeout"), options.timeoutMs);
  const onCaller = (): void => abort("caller");
  const caller = options.callerSignal;
  if (caller !== undefined) {
    if (caller.aborted) onCaller();
    else caller.addEventListener("abort", onCaller, { once: true });
  }
  return {
    signal: controller.signal,
    cause: () => state.cause,
    abort,
    dispose: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCaller);
    },
  };
}

/** Abort-aware sleep. Resolves after `ms`, rejects with `onAbort()` if the signal aborts first. */
export function abortableSleep(ms: number, signal: AbortSignal, onAbort: () => Error): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(onAbort());
      return;
    }
    const onSignal = (): void => {
      clearTimeout(timer);
      reject(onAbort());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onSignal);
      resolve();
    }, ms);
    signal.addEventListener("abort", onSignal, { once: true });
  });
}
