import { createMockClaudeAdapter } from "./mock-claude-adapter.js";
import { createMockGptAdapter } from "./mock-gpt-adapter.js";
import { createSessionRegistry } from "./registry.js";
import { createInMemorySessionStore } from "./store-memory.js";
import type {
  Clock,
  IdFactory,
  MockAdapter,
  MockAdapterOptions,
  ProviderAdapter,
  ProviderId,
  SecretResolver,
  SessionConfig,
  SessionRegistry,
  SessionStore,
} from "./types.js";

export function createFakeClock(startIso = "2026-01-01T00:00:00.000Z", stepMs = 1000): Clock {
  const state = { next: Date.parse(startIso) };
  return {
    now: () => {
      const value = new Date(state.next);
      state.next += stepMs;
      return value;
    },
  };
}

export function createConstantClock(iso = "2026-02-02T00:00:00.000Z"): Clock {
  return { now: () => new Date(iso) };
}

/** req_1, req_2, ... `after` lets a second registry continue at the same counter. */
export function createIdFactory(after = 0): IdFactory {
  const state = { n: after };
  return () => {
    state.n += 1;
    return `req_${state.n}`;
  };
}

export function testSecrets(): Record<string, string> {
  return {
    KEY_A_GPT: "sk-test-A",
    KEY_A_CLAUDE: "sk-test-A",
    KEY_B_GPT: "sk-test-B",
    KEY_B_CLAUDE: "sk-ant-test-B",
    KEY_C_GPT: "sk-test-C",
    KEY_C_CLAUDE: "sk-test-C",
  };
}

export interface ProviderCase {
  readonly id: ProviderId;
  readonly model: string;
  readonly otherModel: string;
  readonly make: (options?: MockAdapterOptions) => MockAdapter;
}

export function providerCases(): ProviderCase[] {
  return [
    { id: "gpt", model: "gpt-4o-mini", otherModel: "gpt-4.1-mini", make: createMockGptAdapter },
    { id: "claude", model: "claude-sonnet-4-5", otherModel: "claude-haiku-4-5", make: createMockClaudeAdapter },
  ];
}

export interface RegistryOverrides {
  readonly gpt?: MockAdapterOptions;
  readonly claude?: MockAdapterOptions;
  /** Replaces the default adapters entirely (e.g. to wrap one). */
  readonly adapters?: readonly ProviderAdapter[];
  readonly store?: SessionStore;
  readonly secrets?: Record<string, string>;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
}

export interface Harness {
  readonly registry: SessionRegistry;
  readonly gpt: MockAdapter;
  readonly claude: MockAdapter;
  readonly store: SessionStore;
  readonly secrets: Map<string, string>;
  readonly adapterFor: (provider: ProviderId) => MockAdapter;
}

export function makeRegistry(overrides: RegistryOverrides = {}): Harness {
  const gpt = createMockGptAdapter(overrides.gpt);
  const claude = createMockClaudeAdapter(overrides.claude);
  const store = overrides.store ?? createInMemorySessionStore();
  const secrets = new Map<string, string>(Object.entries(overrides.secrets ?? testSecrets()));
  const resolver: SecretResolver = { resolve: (ref) => secrets.get(ref.name) };
  const registry = createSessionRegistry({
    adapters: overrides.adapters ?? [gpt, claude],
    secrets: resolver,
    store,
    clock: overrides.clock ?? createFakeClock(),
    ids: overrides.ids ?? createIdFactory(),
  });
  return { registry, gpt, claude, store, secrets, adapterFor: (provider) => (provider === "gpt" ? gpt : claude) };
}

export function modelFor(provider: ProviderId): string {
  return provider === "gpt" ? "gpt-4o-mini" : "claude-sonnet-4-5";
}

export function cfg(over: Partial<SessionConfig> = {}): SessionConfig {
  const provider = over.provider ?? "gpt";
  return {
    sessionId: "s-a",
    communityId: "community-a",
    provider,
    model: modelFor(provider),
    apiKeyRef: { source: "mock", name: `KEY_A_${provider.toUpperCase()}` },
    systemPrompt: "SYS-A",
    limits: { timeoutMs: 1000, maxOutputTokens: 64, maxRequests: 10, maxHistoryMessages: 20 },
    ...over,
  };
}

export function keyRef(who: "A" | "B" | "C", provider: ProviderId): { source: "mock"; name: string } {
  return { source: "mock", name: `KEY_${who}_${provider.toUpperCase()}` };
}

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/** Turns a promise into a value so a rejecting send never becomes an unhandled rejection. */
export function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value): Settled<T> => ({ ok: true, value }),
    (error: unknown): Settled<T> => ({ ok: false, error }),
  );
}

export function errorCode(settled: Settled<unknown>): string | undefined {
  if (settled.ok) return undefined;
  const code = (settled.error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
