import type { SkillContext } from "./context.js";

/**
 * Dig a block, but never let a hung dig pin a cancelled citizen: race `bot.dig` against `ctx.signal`. On abort the
 * in-flight dig is stopped (`bot.stopDigging`) and abandoned, and "aborted" is returned so the caller can return a
 * CANCELLED / INTERRUPTED result. If the signal is already aborted no dig is started. Real dig errors still throw.
 */
export async function digUnlessAborted(
  ctx: SkillContext,
  block: Parameters<SkillContext["bot"]["dig"]>[0],
): Promise<"aborted" | "done"> {
  const signal = ctx.signal;
  if (signal?.aborted) return "aborted";
  // Listen BEFORE starting the dig: an abort that lands while bot.dig() is being invoked must not be missed.
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<"aborted">((resolve) => {
    onAbort = () => {
      try {
        ctx.bot.stopDigging();
      } catch {
        // already stopped / bot gone
      }
      resolve("aborted");
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const dig = ctx.bot.dig(block, true).then(() => "done" as const);
    if (!signal) return await dig;
    dig.catch(() => undefined); // an abandoned dig that later rejects must not become an unhandled rejection
    return await Promise.race([dig, aborted]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
