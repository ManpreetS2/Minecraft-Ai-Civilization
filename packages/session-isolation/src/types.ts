export type ProviderId = "gpt" | "claude";

/** A reference to a secret. NEVER the secret itself. Safe to persist and log. */
export interface SecretRef {
  readonly source: "env" | "mock";
  readonly name: string;
}

/** Injected per registry. Tests use a Map; a production resolver is out of scope. */
export interface SecretResolver {
  resolve(ref: SecretRef): string | undefined;
}

export interface SessionLimits {
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxRequests: number;
  readonly maxHistoryMessages: number;
}

export interface SessionConfig {
  readonly sessionId: string;
  readonly communityId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly apiKeyRef: SecretRef;
  readonly systemPrompt: string;
  readonly limits: SessionLimits;
  /** Informational for the mock. Adapters never open sockets regardless. */
  readonly baseUrl?: string;
}

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly at: string;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderRequest {
  readonly model: string;
  /** Resolved value. An adapter must never log, echo or store it. */
  readonly apiKey: string;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly maxOutputTokens: number;
  readonly requestId: string;
}

export interface ProviderResponse {
  readonly text: string;
  readonly usage: Usage;
  readonly providerRequestId: string;
  readonly finishReason: "stop" | "length";
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly allowedModels: readonly string[];
  /** Throws SessionError "CONFIG_INVALID" on unknown model, bad limits, wrong provider id. */
  validateConfig(config: SessionConfig): void;
  /** Rejects promptly with SessionError CANCELLED or TIMEOUT when `signal` aborts. No network I/O. */
  complete(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

export type SessionState = "idle" | "busy" | "closed";

export interface SendInput {
  readonly content: string;
  readonly signal?: AbortSignal;
  /** May only LOWER limits.timeoutMs. */
  readonly timeoutMs?: number;
}

export interface SendResult {
  readonly sessionId: string;
  readonly turn: number;
  readonly text: string;
  readonly usage: Usage;
  readonly providerRequestId: string;
  readonly finishReason: "stop" | "length";
}

export interface SessionSnapshot {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly communityId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly apiKeyRef: SecretRef;
  readonly systemPrompt: string;
  readonly limits: SessionLimits;
  readonly history: readonly ChatMessage[];
  readonly memory: readonly string[];
  readonly turn: number;
  readonly requestsUsed: number;
  readonly usageTotal: Usage;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** sha256 hex of the canonical JSON of every other field. Tamper evidence, not authentication. */
  readonly integrity: string;
}

export interface Session {
  readonly id: string;
  readonly communityId: string;
  readonly provider: ProviderId;
  readonly state: SessionState;
  send(input: SendInput): Promise<SendResult>;
  /** Aborts ONLY this session's in-flight send (CANCELLED). No-op if idle. Session stays usable. */
  cancel(reason?: string): void;
  /** Appends a per-session memory note (at most 64 notes, 512 chars each, else LIMIT_EXCEEDED). */
  remember(note: string): void;
  /** Deep copy. Mutating it never affects the session. Holds no secret value. */
  snapshot(): SessionSnapshot;
  /** Terminal and idempotent. Cancels in-flight work and clears timers. */
  close(): void;
}

export interface SessionStore {
  save(snapshot: SessionSnapshot): Promise<void>;
  load(sessionId: string): Promise<SessionSnapshot | undefined>;
  list(): Promise<readonly string[]>;
  delete(sessionId: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}
export type IdFactory = () => string;

export interface SessionRegistryOptions {
  readonly adapters: readonly ProviderAdapter[];
  readonly secrets: SecretResolver;
  readonly store: SessionStore;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
}

export interface SessionRegistry {
  open(config: SessionConfig): Session;
  restore(sessionId: string): Promise<Session>;
  persist(sessionId: string): Promise<void>;
  get(sessionId: string): Session | undefined;
  closeAll(): void;
}

export interface MockReply {
  readonly text: string;
  readonly usage?: Usage;
  readonly finishReason?: "stop" | "length";
}

export interface MockAdapterOptions {
  /** Pure function giving a deterministic reply. Default: `ack:<sha256(model|system|messages)[0..8]>:<messages.length>`. */
  readonly script?: (req: ProviderRequest) => MockReply;
  /** Simulated latency through an abort-aware setTimeout (works with fake timers). Default 0. */
  readonly delayMs?: number;
  /** When set, `complete` rejects AUTH_FAILED if req.apiKey differs. */
  readonly expectedApiKey?: string;
  /** When set, `complete` rejects with this HTTP-like status instead of replying. */
  readonly failWithStatus?: number;
}

export interface MockAdapter extends ProviderAdapter {
  /** Deep copies of every request received, in order (apiKey included: test-only introspection). */
  readonly calls: readonly ProviderRequest[];
}
