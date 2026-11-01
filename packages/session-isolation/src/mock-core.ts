import { abortableSleep } from "./abort.js";
import { validateLimits } from "./config.js";
import { SessionError } from "./errors.js";
import { deepClone, sha256Hex } from "./snapshot.js";
import type {
  MockAdapter,
  MockAdapterOptions,
  MockReply,
  ProviderId,
  ProviderRequest,
  ProviderResponse,
  SessionConfig,
  Usage,
} from "./types.js";

/** Default reply: a pure function of the request, `ack:<8 hex of sha256(model|system|messages)>:<messages.length>`. */
export function defaultScript(req: ProviderRequest): MockReply {
  const digest = sha256Hex(`${req.model}|${req.system}|${JSON.stringify(req.messages)}`).slice(0, 8);
  return { text: `ack:${digest}:${req.messages.length}` };
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function defaultUsage(req: ProviderRequest, text: string): Usage {
  const input = req.system.length + req.messages.reduce((sum, message) => sum + message.content.length, 0);
  return { inputTokens: estimateTokens("x".repeat(input)), outputTokens: estimateTokens(text) };
}

/** Maps the abort reason set by the session ("timeout" or anything else) to the adapter error contract. */
export function abortErrorFor(signal: AbortSignal): SessionError {
  return signal.reason === "timeout"
    ? new SessionError("TIMEOUT", "mock adapter aborted: timeout", { retryable: true })
    : new SessionError("CANCELLED", "mock adapter aborted: cancelled");
}

/** What a provider-specific mock supplies. Pure functions only. */
export interface WireShape<Req, Raw> {
  readonly toWire: (req: ProviderRequest) => Req;
  /** Produces the raw provider-shaped reply for a scripted MockReply. */
  readonly makeRaw: (req: ProviderRequest, reply: MockReply, usage: Usage) => Raw;
  readonly fromWire: (raw: Raw) => ProviderResponse;
}

export function createMockAdapter<Req, Raw>(
  id: ProviderId,
  models: readonly string[],
  shape: WireShape<Req, Raw>,
  options: MockAdapterOptions = {},
): MockAdapter {
  const allowedModels: readonly string[] = Object.freeze([...models]);
  const recorded: ProviderRequest[] = [];
  const script = options.script ?? defaultScript;
  const delayMs = options.delayMs ?? 0;

  return {
    id,
    allowedModels,
    get calls(): readonly ProviderRequest[] {
      return recorded.map((call) => deepClone(call));
    },
    validateConfig(config: SessionConfig): void {
      if (config.provider !== id) {
        throw new SessionError("CONFIG_INVALID", `provider '${String(config.provider)}' is not '${id}'`, { sessionId: config.sessionId });
      }
      if (!allowedModels.includes(config.model)) {
        throw new SessionError("CONFIG_INVALID", `model '${String(config.model)}' is not allowed for ${id}`, { sessionId: config.sessionId });
      }
      validateLimits(config.limits, config.sessionId);
    },
    async complete(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
      if (signal.aborted) throw abortErrorFor(signal); // no work done, nothing recorded
      recorded.push(deepClone(req));
      // Build the provider-shaped request purely to keep the shape honest. Nothing is sent anywhere.
      shape.toWire(req);
      if (delayMs > 0) await abortableSleep(delayMs, signal, () => abortErrorFor(signal));
      if (options.expectedApiKey !== undefined && req.apiKey !== options.expectedApiKey) {
        throw new SessionError("AUTH_FAILED", "mock provider rejected the api key");
      }
      if (options.failWithStatus !== undefined) {
        const status = options.failWithStatus;
        if (status === 401 || status === 403) throw new SessionError("AUTH_FAILED", `mock provider status ${status}`);
        throw new SessionError("PROVIDER_ERROR", `mock provider status ${status}`, { retryable: status >= 500 || status === 429 });
      }
      const reply = script(req);
      const usage = reply.usage ?? defaultUsage(req, reply.text);
      return shape.fromWire(shape.makeRaw(req, reply, usage));
    },
  };
}
