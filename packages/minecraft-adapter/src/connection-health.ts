import type { ConnectionHealth } from "@civ/shared";

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
