import { SessionError } from "./errors.js";
import type { ProviderAdapter, SecretRef, SessionConfig, SessionLimits } from "./types.js";

export const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_COMMUNITY_ID_LENGTH = 64;
export const MAX_MEMORY_NOTES = 64;
export const MAX_MEMORY_NOTE_LENGTH = 512;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_PATTERN.test(id);
}

function bad(message: string, sessionId?: string): never {
  throw new SessionError("CONFIG_INVALID", message, sessionId === undefined ? {} : { sessionId });
}

export function assertSessionId(id: unknown): asserts id is string {
  if (!isValidSessionId(id)) bad("sessionId must match /^[a-z0-9][a-z0-9_-]{0,63}$/");
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function validateLimits(limits: SessionLimits, sessionId?: string): void {
  if (typeof limits !== "object" || limits === null) bad("limits are required", sessionId);
  if (!(typeof limits.timeoutMs === "number" && Number.isFinite(limits.timeoutMs) && limits.timeoutMs > 0)) {
    bad("limits.timeoutMs must be a finite number > 0", sessionId);
  }
  if (!isPositiveInt(limits.maxOutputTokens)) bad("limits.maxOutputTokens must be an integer > 0", sessionId);
  if (!isPositiveInt(limits.maxRequests)) bad("limits.maxRequests must be an integer > 0", sessionId);
  if (!(Number.isInteger(limits.maxHistoryMessages) && limits.maxHistoryMessages >= 2)) {
    bad("limits.maxHistoryMessages must be an integer >= 2", sessionId);
  }
}

export function validateSecretRef(ref: SecretRef, sessionId?: string): void {
  const ok =
    typeof ref === "object" &&
    ref !== null &&
    (ref.source === "env" || ref.source === "mock") &&
    typeof ref.name === "string" &&
    ref.name.trim() !== "";
  if (!ok) bad("apiKeyRef must be {source:'env'|'mock', name:<non-blank>}", sessionId);
}

/** Registry-level checks shared by open() and restore(). Adapter-specific checks live in adapter.validateConfig. */
export function validateSessionConfig(config: SessionConfig, adapter: ProviderAdapter | undefined): void {
  assertSessionId(config.sessionId);
  const id = config.sessionId;
  if (typeof config.communityId !== "string" || config.communityId.trim() === "" || config.communityId.length > MAX_COMMUNITY_ID_LENGTH) {
    bad("communityId must be a non-blank string of at most 64 chars", id);
  }
  if (typeof config.systemPrompt !== "string" || config.systemPrompt.trim() === "") bad("systemPrompt must not be blank", id);
  validateSecretRef(config.apiKeyRef, id);
  validateLimits(config.limits, id);
  if (adapter === undefined) bad(`no adapter registered for provider '${String(config.provider)}'`, id);
  if (adapter.id !== config.provider) bad(`provider '${String(config.provider)}' does not match adapter '${adapter.id}'`, id);
  adapter.validateConfig(config);
}
