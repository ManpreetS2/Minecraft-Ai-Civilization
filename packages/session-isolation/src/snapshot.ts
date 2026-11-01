import { createHash } from "node:crypto";
import { MAX_MEMORY_NOTE_LENGTH, MAX_MEMORY_NOTES, SESSION_ID_PATTERN } from "./config.js";
import { SessionError } from "./errors.js";
import type { ChatMessage, SessionLimits, SessionSnapshot, Usage } from "./types.js";

/** Deterministic JSON: object keys sorted, arrays in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function computeIntegrity(snapshot: Omit<SessionSnapshot, "integrity">): string {
  return sha256Hex(canonicalJson(snapshot));
}

export function sealSnapshot(fields: Omit<SessionSnapshot, "integrity">): SessionSnapshot {
  return { ...fields, integrity: computeIntegrity(fields) };
}

function corrupt(message: string, sessionId?: string): never {
  throw new SessionError("SNAPSHOT_CORRUPT", message, sessionId === undefined ? {} : { sessionId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") corrupt(`snapshot field '${key}' must be a string`);
  return value;
}

function nonNegInt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) corrupt(`snapshot field '${key}' must be a non-negative integer`);
  return value;
}

function parseUsage(value: unknown): Usage {
  if (!isRecord(value)) return corrupt("snapshot usageTotal must be an object");
  return { inputTokens: nonNegInt(value, "inputTokens"), outputTokens: nonNegInt(value, "outputTokens") };
}

function parseLimits(value: unknown): SessionLimits {
  if (!isRecord(value)) return corrupt("snapshot limits must be an object");
  const timeoutMs = value["timeoutMs"];
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) corrupt("snapshot limits.timeoutMs invalid");
  return {
    timeoutMs,
    maxOutputTokens: nonNegInt(value, "maxOutputTokens"),
    maxRequests: nonNegInt(value, "maxRequests"),
    maxHistoryMessages: nonNegInt(value, "maxHistoryMessages"),
  };
}

function parseHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return corrupt("snapshot history must be an array");
  if (value.length % 2 !== 0) corrupt("snapshot history must hold whole user/assistant pairs");
  return value.map((entry, index) => {
    if (!isRecord(entry)) return corrupt("snapshot history entry must be an object");
    const role = entry["role"];
    const expected = index % 2 === 0 ? "user" : "assistant";
    if (role !== expected) corrupt(`snapshot history role at ${index} must be ${expected}`);
    return { role: expected, content: str(entry, "content"), at: str(entry, "at") };
  });
}

function parseMemory(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_MEMORY_NOTES) return corrupt("snapshot memory invalid");
  return value.map((note) => {
    if (typeof note !== "string" || note.length > MAX_MEMORY_NOTE_LENGTH) return corrupt("snapshot memory note invalid");
    return note;
  });
}

/**
 * Validates untrusted data into a SessionSnapshot.
 * Order: schemaVersion (SNAPSHOT_VERSION) -> structure (SNAPSHOT_CORRUPT) -> integrity (SNAPSHOT_CORRUPT).
 */
export function parseSnapshot(raw: unknown): SessionSnapshot {
  if (!isRecord(raw)) return corrupt("snapshot must be an object");
  if (raw["schemaVersion"] !== 1) {
    throw new SessionError("SNAPSHOT_VERSION", `unsupported snapshot schemaVersion ${JSON.stringify(raw["schemaVersion"])}`);
  }
  const sessionId = str(raw, "sessionId");
  if (!SESSION_ID_PATTERN.test(sessionId)) corrupt("snapshot sessionId is invalid");
  const provider = raw["provider"];
  if (provider !== "gpt" && provider !== "claude") corrupt("snapshot provider is invalid", sessionId);
  const ref = raw["apiKeyRef"];
  if (!isRecord(ref) || (ref["source"] !== "env" && ref["source"] !== "mock") || typeof ref["name"] !== "string") {
    corrupt("snapshot apiKeyRef is invalid", sessionId);
  }
  const fields: Omit<SessionSnapshot, "integrity"> = {
    schemaVersion: 1,
    sessionId,
    communityId: str(raw, "communityId"),
    provider: provider as "gpt" | "claude",
    model: str(raw, "model"),
    apiKeyRef: { source: (ref as Record<string, unknown>)["source"] as "env" | "mock", name: (ref as Record<string, unknown>)["name"] as string },
    systemPrompt: str(raw, "systemPrompt"),
    limits: parseLimits(raw["limits"]),
    history: parseHistory(raw["history"]),
    memory: parseMemory(raw["memory"]),
    turn: nonNegInt(raw, "turn"),
    requestsUsed: nonNegInt(raw, "requestsUsed"),
    usageTotal: parseUsage(raw["usageTotal"]),
    createdAt: str(raw, "createdAt"),
    updatedAt: str(raw, "updatedAt"),
  };
  const integrity = str(raw, "integrity");
  if (integrity !== computeIntegrity(fields)) corrupt("snapshot integrity check failed", sessionId);
  return { ...fields, integrity };
}
