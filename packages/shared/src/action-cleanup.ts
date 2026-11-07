import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A short, explicit permit for one cleanup step after an action has lost permission to mutate.
 * The packet guard allows only the named packets, and only until `until`. It is not a global exemption.
 */
export interface CleanupPermit {
  readonly until: number;
  readonly packets: ReadonlySet<string>;
}

interface CleanupFrame {
  permit?: CleanupPermit;
}

const frames = new AsyncLocalStorage<CleanupFrame>();

/** The longest a cleanup permit may last. Callers still pass their own shorter deadline. */
export const MAX_CLEANUP_MS = 500;

export function currentCleanupPermit(now = Date.now()): CleanupPermit | undefined {
  const permit = frames.getStore()?.permit;
  if (!permit || now > permit.until) return undefined;
  return permit;
}

export function runBoundedCleanup<T>(
  fn: () => T,
  options: { packets: readonly string[]; deadlineMs: number },
): T {
  const deadlineMs = options.deadlineMs;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw Object.assign(new Error("cleanup requires an explicit positive deadline"), { code: "CLEANUP_DEADLINE" });
  }
  const permit: CleanupPermit = {
    until: Date.now() + Math.min(deadlineMs, MAX_CLEANUP_MS),
    packets: new Set(options.packets),
  };
  return frames.run({ permit }, fn);
}
