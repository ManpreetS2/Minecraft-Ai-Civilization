import type { Bot } from "mineflayer";
import { navigationBodyReady } from "./connection-health.js";

export type MovementWaitOutcome = "complete" | "cancelled" | "unavailable" | "timeout";

/** Bound physics/plugin waits, invalidate old lives, and observe late settlement. */
export function movementOperationOutcome(bot: Bot, operation: () => Promise<unknown>, signal?: AbortSignal, deadline = Infinity, timeoutMs = 1_000): Promise<MovementWaitOutcome> {
  if (signal?.aborted) return Promise.resolve("cancelled");
  if (!navigationBodyReady(bot)) return Promise.resolve("unavailable");
  if (Date.now() >= deadline) return Promise.resolve("timeout");
  return new Promise((resolve) => {
    let settled = false;
    const events = ["end", "kicked", "death", "respawn"] as const;
    const finish = (outcome: MovementWaitOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      for (const event of events) bot.removeListener?.(event, interrupted);
      resolve(signal?.aborted ? "cancelled" : !navigationBodyReady(bot) ? "unavailable" : Date.now() >= deadline ? "timeout" : outcome);
    };
    const interrupted = () => finish("unavailable");
    const aborted = () => finish("cancelled");
    const timer = setTimeout(() => finish("timeout"), Math.min(timeoutMs, deadline - Date.now()));
    signal?.addEventListener("abort", aborted, { once: true });
    for (const event of events) bot.on?.(event, interrupted);
    // Observe late completion/rejection without waiting for it during cleanup.
    try {
      void Promise.resolve(operation()).then(() => finish("complete"), interrupted);
    } catch { interrupted(); }
  });
}

export function movementTickOutcome(bot: Bot, ticks: number, signal?: AbortSignal, deadline = Infinity): Promise<MovementWaitOutcome> {
  return movementOperationOutcome(bot, () => bot.waitForTicks(ticks), signal, deadline, Math.max(250, ticks * 100 + 250));
}

export async function waitForMovementTicks(bot: Bot, ticks: number, signal?: AbortSignal, deadline = Infinity): Promise<boolean> {
  return await movementTickOutcome(bot, ticks, signal, deadline) === "complete";
}
