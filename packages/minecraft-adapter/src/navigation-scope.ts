import type { Bot } from "mineflayer";
import { fail, type ActionResult } from "@civ/shared";
import { releaseMovementControls } from "./step-jump.js";

/** Bound a multi-phase action even when a backend ignores cancellation. */
export async function runNavigationScope<T>(
  bot: Bot,
  options: { timeoutMs: number; signal?: AbortSignal },
  work: (signal: AbortSignal) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const started = Date.now();
  if (options.signal?.aborted) return fail("CANCELLED", "Navigation cancelled", 0, true);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) return fail("INVALID_ARGUMENT", "Invalid navigation timeout", 0);
  const controller = new AbortController();
  let reason: "CANCELLED" | "NOT_CONNECTED" | "TIMEOUT" | undefined;
  let settle!: (result: ActionResult<T>) => void;
  const interrupted = new Promise<ActionResult<T>>(resolve => { settle = resolve; });
  const stop = () => {
    const pf = (bot as unknown as { pathfinder?: { stop?: () => void; setGoal?: (goal: null) => void } }).pathfinder;
    try { pf?.stop?.(); } catch { /* continue cleanup */ }
    try { pf?.setGoal?.(null); } catch { /* continue cleanup */ }
    releaseMovementControls(bot);
  };
  const interrupt = (code: NonNullable<typeof reason>) => {
    reason ??= code;
    controller.abort();
    stop();
    settle(fail(reason, "Navigation action interrupted", Date.now() - started, true));
  };
  const aborted = () => interrupt("CANCELLED");
  const lost = () => interrupt("NOT_CONNECTED");
  const timer = setTimeout(() => interrupt("TIMEOUT"), options.timeoutMs);
  const events = ["end", "kicked", "death", "respawn"] as const;
  options.signal?.addEventListener("abort", aborted, { once: true });
  for (const event of events) bot.on?.(event, lost);
  try {
    // Promise.race observes late rejection; every later phase receives the aborted signal.
    const result = await Promise.race([work(controller.signal), interrupted]);
    if (options.signal?.aborted) return fail("CANCELLED", "Navigation cancelled", Date.now() - started, true);
    if (reason) return fail(reason, "Navigation action interrupted", Date.now() - started, true);
    return result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", aborted);
    for (const event of events) bot.removeListener?.(event, lost);
    if (controller.signal.aborted) stop();
  }
}
