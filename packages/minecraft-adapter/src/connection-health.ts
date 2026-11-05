import type { ConnectionHealth, Vec3 } from "@civ/shared";
import type { Bot } from "mineflayer";

/** A retained entity does not prove that its protocol client or life is usable. */
export function navigationBodyReady(bot: Bot): boolean {
  const pos = bot.entity?.position;
  const client = (bot as unknown as { _client?: { state?: string; ended?: boolean } })._client;
  return Boolean(pos && [pos.x, pos.y, pos.z].every(Number.isFinite) &&
    (typeof bot.health !== "number" || bot.health > 0) &&
    !client?.ended && (!client?.state || client.state === "play"));
}

export function navigationParametersValid(target: Vec3, range: number, timeoutMs: number): boolean {
  return [target.x, target.y, target.z, range, timeoutMs].every(Number.isFinite) && range >= 0 && timeoutMs > 0;
}

export type ConnectionTelemetry = {
  health: ConnectionHealth;
  lastPacketRxAt?: number;
  lastPacketTxAt?: number;
  lastKeepaliveAt?: number;
  lastPhysicsAt?: number;
  reconnectReason?: string;
  keepaliveTimeouts: number;
  reconnects: number;
  disconnects: number;
};

export function emptyTelemetry(): ConnectionTelemetry {
  return { health: "OFFLINE", keepaliveTimeouts: 0, reconnects: 0, disconnects: 0 };
}

export function deriveConnectionHealth(input: {
  connected: boolean;
  spawned: boolean;
  reconnecting: boolean;
  deceased: boolean;
  now?: number;
  lastPacketRxAt?: number;
  lastPhysicsAt?: number;
  eventLoopLagMs?: number;
}): ConnectionHealth {
  if (input.deceased) return "OFFLINE";
  if (input.reconnecting) return "RECONNECTING";
  if (!input.connected && !input.spawned) return "OFFLINE";
  const now = input.now ?? Date.now();
  const quiet =
    (input.lastPacketRxAt !== undefined && now - input.lastPacketRxAt > 8_000) ||
    (input.lastPhysicsAt !== undefined && now - input.lastPhysicsAt > 4_000);
  if (quiet || (input.eventLoopLagMs ?? 0) >= 250) return "DEGRADED";
  if (input.connected && input.spawned) return "CONNECTED";
  return "RECONNECTING";
}

export function isKeepaliveTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out after \d+ milliseconds/i.test(message) || /client timed out/i.test(message);
}

/** TCP / protocol resets from minecraft-protocol (observed as unhandled ECONNRESET on Day 1). */
export function isTransportReset(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return /ECONNRESET|EPIPE|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTCONN/i.test(`${code} ${message}`);
}

export type KeepalivePolicy = "swallow_shutdown" | "fail_active_task" | "propagate";

/**
 * Shutdown keepalives must not crash the harness.
 * Mid-task keepalives and transport resets must fail the active action / disconnect path —
 * never become an unhandled EventEmitter `error` that kills Node.
 */
export function keepalivePolicy(input: { shuttingDown: boolean; error: unknown }): KeepalivePolicy {
  if (isKeepaliveTimeout(input.error) || isTransportReset(input.error)) {
    return input.shuttingDown ? "swallow_shutdown" : "fail_active_task";
  }
  return "propagate";
}

export function armShutdownClient(
  client:
    | {
        removeAllListeners?: () => void;
        on?: (event: string, listener: (error: unknown) => void) => void;
        end?: (reason?: string) => void;
      }
    | undefined,
  reason?: string,
): void {
  if (!client) return;
  try {
    client.removeAllListeners?.();
  } catch {
    // already closed
  }
  try {
    client.on?.("error", () => undefined);
  } catch {
    // ignore
  }
  try {
    client.end?.(reason);
  } catch {
    // ignore
  }
}
