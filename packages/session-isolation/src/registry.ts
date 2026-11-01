import { randomUUID } from "node:crypto";
import { assertSessionId, validateSessionConfig } from "./config.js";
import { isSessionError, SessionError } from "./errors.js";
import { createSession, type SessionDeps } from "./session.js";
import { deepClone } from "./snapshot.js";
import type {
  Clock,
  IdFactory,
  ProviderAdapter,
  ProviderId,
  Session,
  SessionConfig,
  SessionRegistry,
  SessionRegistryOptions,
  SessionSnapshot,
} from "./types.js";

export function createSessionRegistry(options: SessionRegistryOptions): SessionRegistry {
  const adapters = new Map<ProviderId, ProviderAdapter>();
  for (const adapter of options.adapters) {
    if (adapters.has(adapter.id)) throw new SessionError("CONFIG_INVALID", `duplicate adapter for provider '${adapter.id}'`);
    adapters.set(adapter.id, adapter);
  }
  const clock: Clock = options.clock ?? { now: () => new Date() };
  const ids: IdFactory = options.ids ?? (() => `req_${randomUUID()}`);
  const sessions = new Map<string, Session>();

  function requireSecret(config: SessionConfig): void {
    const value = options.secrets.resolve(config.apiKeyRef);
    if (value === undefined || value.trim() === "") {
      throw new SessionError("SECRET_MISSING", `secret '${config.apiKeyRef.name}' is not available`, { sessionId: config.sessionId });
    }
  }

  function build(config: SessionConfig, initial?: Parameters<typeof createSession>[2]): Session {
    const adapter = adapters.get(config.provider);
    validateSessionConfig(config, adapter);
    requireSecret(config);
    if (sessions.has(config.sessionId)) {
      throw new SessionError("CONFIG_INVALID", `session '${config.sessionId}' already exists in this registry`, { sessionId: config.sessionId });
    }
    const deps: SessionDeps = { adapter: adapter as ProviderAdapter, secrets: options.secrets, clock, ids };
    return createSession(config, deps, initial);
  }

  function configFrom(snapshot: SessionSnapshot): SessionConfig {
    return {
      sessionId: snapshot.sessionId,
      communityId: snapshot.communityId,
      provider: snapshot.provider,
      model: snapshot.model,
      apiKeyRef: snapshot.apiKeyRef,
      systemPrompt: snapshot.systemPrompt,
      limits: snapshot.limits,
    };
  }

  return {
    open(config: SessionConfig): Session {
      const session = build(config);
      sessions.set(config.sessionId, session);
      return session;
    },

    async restore(sessionId: string): Promise<Session> {
      assertSessionId(sessionId);
      if (sessions.has(sessionId)) {
        throw new SessionError("CONFIG_INVALID", `session '${sessionId}' already exists in this registry`, { sessionId });
      }
      let snapshot: SessionSnapshot | undefined;
      try {
        snapshot = await options.store.load(sessionId);
      } catch (error) {
        if (isSessionError(error)) throw error;
        throw new SessionError("STORE_ERROR", `could not load session '${sessionId}'`, { sessionId, cause: error });
      }
      // Documented choice (spec Q6): a missing id rejects STORE_ERROR instead of returning undefined.
      if (snapshot === undefined) throw new SessionError("STORE_ERROR", `no persisted session '${sessionId}'`, { sessionId });
      if (snapshot.sessionId !== sessionId) {
        throw new SessionError("SNAPSHOT_CORRUPT", "snapshot sessionId does not match the requested id", { sessionId });
      }
      const session = build(configFrom(snapshot), {
        history: snapshot.history,
        memory: snapshot.memory,
        turn: snapshot.turn,
        requestsUsed: snapshot.requestsUsed,
        usageTotal: snapshot.usageTotal,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      });
      sessions.set(sessionId, session);
      return session;
    },

    async persist(sessionId: string): Promise<void> {
      const session = sessions.get(sessionId);
      if (session === undefined) throw new SessionError("CONFIG_INVALID", `unknown session '${sessionId}'`, { sessionId });
      try {
        await options.store.save(deepClone(session.snapshot()));
      } catch (error) {
        if (isSessionError(error)) throw error;
        throw new SessionError("STORE_ERROR", `could not persist session '${sessionId}'`, { sessionId, cause: error });
      }
    },

    get(sessionId: string): Session | undefined {
      return sessions.get(sessionId);
    },

    closeAll(): void {
      for (const session of sessions.values()) session.close();
    },
  };
}
