import { fail, type ActionResult } from "./action-result.js";

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function abortedResult(durationMs: number): ActionResult<never> {
  return fail("CANCELLED", "Operation cancelled", durationMs, false);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Aborted");
}

export async function retry<T>(
  fn: () => Promise<ActionResult<T>>,
  attempts: number,
  delayMs: number,
  signal?: AbortSignal,
): Promise<ActionResult<T>> {
  let last: ActionResult<T> | undefined;
  for (let i = 0; i < attempts; i += 1) {
    if (signal?.aborted) {
      return abortedResult(0);
    }
    last = await fn();
    if (last.success || !last.retryable) {
      return last;
    }
    if (i < attempts - 1) {
      await sleep(delayMs, signal).catch(() => undefined);
    }
  }
  return last ?? fail("UNKNOWN", "Retry loop produced no result", 0, false);
}
