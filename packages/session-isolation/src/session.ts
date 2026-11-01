import { createAbortScope, type AbortCause, type AbortScope } from "./abort.js";
import { MAX_MEMORY_NOTE_LENGTH, MAX_MEMORY_NOTES } from "./config.js";
import { isSessionError, redact, SessionError } from "./errors.js";
import { deepClone, deepFreeze, sealSnapshot } from "./snapshot.js";
import type {
  ChatMessage,
  Clock,
  IdFactory,
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  SecretResolver,
  SendInput,
  SendResult,
  Session,
  SessionConfig,
  SessionSnapshot,
  SessionState,
  Usage,
} from "./types.js";

export interface SessionDeps {
  readonly adapter: ProviderAdapter;
  readonly secrets: SecretResolver;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

/** Mutable per-session state. Restored sessions start from a snapshot. */
export interface SessionInitialState {
  readonly history: readonly ChatMessage[];
  readonly memory: readonly string[];
  readonly turn: number;
  readonly requestsUsed: number;
  readonly usageTotal: Usage;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Renders the system field exactly as the spec's I-7. */
export function renderSystem(systemPrompt: string, memory: readonly string[]): string {
  return memory.length === 0 ? systemPrompt : `${systemPrompt}\n\n[memory]\n- ${memory.join("\n- ")}`;
}

/** Drops the oldest whole user/assistant pairs until the window fits. */
function trimWindow(messages: readonly ChatMessage[], max: number): ChatMessage[] {
  let start = 0;
  while (messages.length - start > max && start + 2 <= messages.length) start += 2;
  return messages.slice(start);
}

function abortError(cause: AbortCause | undefined, sessionId: string): SessionError {
  if (cause === "timeout") return new SessionError("TIMEOUT", "session send timed out", { sessionId, retryable: true });
  return new SessionError("CANCELLED", `session send cancelled${cause === undefined ? "" : ` (${cause})`}`, { sessionId });
}

function validResponse(response: ProviderResponse): boolean {
  const usage = response.usage as Usage | undefined;
  return (
    typeof response.text === "string" &&
    response.text.trim() !== "" &&
    usage !== undefined &&
    Number.isInteger(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isInteger(usage.outputTokens) &&
    usage.outputTokens >= 0 &&
    typeof response.providerRequestId === "string" &&
    (response.finishReason === "stop" || response.finishReason === "length")
  );
}

export function createSession(rawConfig: SessionConfig, deps: SessionDeps, initial?: SessionInitialState): Session {
  // Own, frozen copy: later mutation of the caller's object has no effect.
  const config: SessionConfig = deepFreeze(deepClone(rawConfig));
  const sessionId = config.sessionId;
  const now = (): string => deps.clock.now().toISOString();

  const created = initial?.createdAt ?? now();
  const mem = {
    history: initial ? [...deepClone(initial.history)] : ([] as ChatMessage[]),
    memory: initial ? [...initial.memory] : ([] as string[]),
    turn: initial?.turn ?? 0,
    requestsUsed: initial?.requestsUsed ?? 0,
    usage: initial ? { ...initial.usageTotal } : { inputTokens: 0, outputTokens: 0 },
    updatedAt: initial?.updatedAt ?? created,
    closed: false,
    scope: undefined as AbortScope | undefined,
  };

  const stateOf = (): SessionState => (mem.closed ? "closed" : mem.scope !== undefined ? "busy" : "idle");

  async function send(input: SendInput): Promise<SendResult> {
    if (mem.closed) throw new SessionError("SESSION_CLOSED", "session is closed", { sessionId });
    if (mem.scope !== undefined) throw new SessionError("SESSION_BUSY", "a send is already in flight on this session", { sessionId });
    if (mem.requestsUsed >= config.limits.maxRequests) {
      throw new SessionError("LIMIT_EXCEEDED", `maxRequests (${config.limits.maxRequests}) reached`, { sessionId });
    }
    if (typeof input.content !== "string" || input.content.trim() === "") {
      throw new SessionError("CONFIG_INVALID", "send content must be a non-blank string", { sessionId });
    }
    if (input.timeoutMs !== undefined && !(typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0)) {
      throw new SessionError("CONFIG_INVALID", "send timeoutMs must be a finite number > 0", { sessionId });
    }
    const apiKey = deps.secrets.resolve(config.apiKeyRef);
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new SessionError("SECRET_MISSING", `secret '${config.apiKeyRef.name}' is not available`, { sessionId });
    }
    if (input.signal?.aborted) throw new SessionError("CANCELLED", "caller signal already aborted", { sessionId });

    const timeoutMs = Math.min(input.timeoutMs ?? Number.POSITIVE_INFINITY, config.limits.timeoutMs);
    const scope = createAbortScope({ ...(input.signal ? { callerSignal: input.signal } : {}), timeoutMs });
    mem.scope = scope;
    let abortListener: (() => void) | undefined;
    try {
      const userMessage: ChatMessage = { role: "user", content: input.content, at: now() };
      const messages = trimWindow([...mem.history, userMessage], config.limits.maxHistoryMessages);
      const request: ProviderRequest = {
        model: config.model,
        apiKey,
        system: renderSystem(config.systemPrompt, mem.memory),
        messages: deepClone(messages),
        maxOutputTokens: config.limits.maxOutputTokens,
        requestId: deps.ids(),
      };

      // The adapter is invoked now, so this call counts toward maxRequests even if it fails.
      mem.requestsUsed += 1;
      const pending = new Promise<ProviderResponse>((resolve) => resolve(deps.adapter.complete(request, scope.signal)));
      pending.catch(() => undefined); // a reply that loses the race must not become an unhandled rejection
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(abortError(scope.cause(), sessionId));
        if (scope.signal.aborted) abortListener();
        else scope.signal.addEventListener("abort", abortListener, { once: true });
      });
      let response: ProviderResponse;
      try {
        response = await Promise.race([pending, aborted]);
      } catch (error) {
        if (scope.cause() !== undefined) throw abortError(scope.cause(), sessionId);
        throw mapProviderError(error, apiKey, sessionId);
      }
      if (scope.cause() !== undefined) throw abortError(scope.cause(), sessionId); // late reply is discarded
      if (!validResponse(response)) {
        throw new SessionError("RESPONSE_INVALID", "provider returned an empty or malformed response", { sessionId });
      }

      // Commit atomically, only now.
      const at = now();
      const assistant: ChatMessage = { role: "assistant", content: response.text, at };
      mem.history = trimWindow([...mem.history, userMessage, assistant], config.limits.maxHistoryMessages);
      mem.turn += 1;
      mem.usage = {
        inputTokens: mem.usage.inputTokens + response.usage.inputTokens,
        outputTokens: mem.usage.outputTokens + response.usage.outputTokens,
      };
      mem.updatedAt = at;
      return {
        sessionId,
        turn: mem.turn,
        text: response.text,
        usage: { ...response.usage },
        providerRequestId: response.providerRequestId,
        finishReason: response.finishReason,
      };
    } finally {
      scope.dispose();
      if (abortListener) scope.signal.removeEventListener("abort", abortListener);
      mem.scope = undefined;
    }
  }

  function mapProviderError(error: unknown, apiKey: string, id: string): SessionError {
    const raw = error instanceof Error ? error.message : String(error);
    const message = redact(raw, apiKey);
    if (isSessionError(error)) {
      return new SessionError(error.code, message, { sessionId: id, retryable: error.retryable });
    }
    return new SessionError("PROVIDER_ERROR", message, { sessionId: id, cause: new Error(message) });
  }

  function remember(note: string): void {
    if (mem.closed) throw new SessionError("SESSION_CLOSED", "session is closed", { sessionId });
    if (typeof note !== "string" || note.trim() === "") {
      throw new SessionError("CONFIG_INVALID", "memory note must be a non-blank string", { sessionId });
    }
    if (note.length > MAX_MEMORY_NOTE_LENGTH) {
      throw new SessionError("LIMIT_EXCEEDED", `memory note exceeds ${MAX_MEMORY_NOTE_LENGTH} chars`, { sessionId });
    }
    if (mem.memory.length >= MAX_MEMORY_NOTES) {
      throw new SessionError("LIMIT_EXCEEDED", `memory holds at most ${MAX_MEMORY_NOTES} notes`, { sessionId });
    }
    mem.memory.push(note);
    mem.updatedAt = now();
  }

  function snapshot(): SessionSnapshot {
    return sealSnapshot(
      deepClone({
        schemaVersion: 1 as const,
        sessionId,
        communityId: config.communityId,
        provider: config.provider,
        model: config.model,
        apiKeyRef: config.apiKeyRef,
        systemPrompt: config.systemPrompt,
        limits: config.limits,
        history: mem.history,
        memory: mem.memory,
        turn: mem.turn,
        requestsUsed: mem.requestsUsed,
        usageTotal: mem.usage,
        createdAt: created,
        updatedAt: mem.updatedAt,
      }),
    );
  }

  return {
    id: sessionId,
    communityId: config.communityId,
    provider: config.provider,
    get state(): SessionState {
      return stateOf();
    },
    send,
    cancel(): void {
      mem.scope?.abort("cancel");
    },
    remember,
    snapshot,
    close(): void {
      mem.closed = true;
      mem.scope?.abort("close");
    },
    /** Never serialises config, history or secrets. */
    toJSON(): Record<string, unknown> {
      return { id: sessionId, communityId: config.communityId, provider: config.provider, state: stateOf() };
    },
  } as Session;
}
