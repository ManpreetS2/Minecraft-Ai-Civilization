import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { CitizenAssignment } from "./citizen-registry.js";
import type { ClaudeMessagesRequest, ClaudeMessagesResponse, ClaudeMessagesTransport } from "./claude-messages.js";
import { ClaudeTransportError } from "./claude-messages.js";
import { isClaudeApiKeyFormat, type PaidRequestGate } from "./paid-request-gate.js";

/**
 * The only code that can send a Claude request over a network. It lives behind its own import path so that nothing
 * reaches it by importing the routing package, and it refuses every send unless its PaidRequestGate approves.
 *
 * It has never reached the real API. Contract tests drive the real SDK against simulated HTTP responses.
 */
const CLAUDE_API_ORIGIN = "https://api.anthropic.com";
const CLAUDE_MESSAGES_PATH = "/v1/messages";

export type ClaudeSdkTransportOptions = {
  apiKey: string;
  gate: PaidRequestGate;
  timeoutMs: number;
  /** Replaced by tests. Production uses the platform fetch. */
  fetchImpl?: typeof fetch;
};

export type AttemptState = {
  sent: boolean;
  status?: number;
  refusal?: string;
};

function assertClaudeApiKey(apiKey: string): void {
  if (!isClaudeApiKeyFormat(apiKey)) {
    // Never include the value. This may be a subscription token someone pasted by mistake.
    throw new Error("Claude citizens need a Claude Console API key; subscription and OAuth credentials are not accepted");
  }
}

export function createClaudeSdkTransport(options: ClaudeSdkTransportOptions): ClaudeMessagesTransport {
  assertClaudeApiKey(options.apiKey);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be finite and positive");
  }
  return {
    paid: true,
    async create(request: ClaudeMessagesRequest, { signal }): Promise<ClaudeMessagesResponse> {
      // take() records the denial. It cannot claim an attempt here, because refusal() just said it would refuse.
      const preflight = environmentRefusal() ?? (options.gate.refusal() ? options.gate.take() : undefined);
      if (preflight) throw new ClaudeTransportError({ outcome: "not_sent", safeMessage: `Claude request not sent: ${preflight}` });

      const attempt: AttemptState = { sent: false };
      const client = buildClient(options, attempt);
      let message: unknown;
      try {
        message = await client.messages.create(request as unknown as Anthropic.MessageCreateParamsNonStreaming, {
          signal,
          maxRetries: 0,
          timeout: options.timeoutMs,
        });
      } catch (error) {
        throw mapError(error, attempt);
      }
      // With a non-JSON content type the SDK returns the body as text instead of throwing.
      if (typeof message !== "object" || message === null) throw unreadableSuccess(attempt.status);
      return message as ClaudeMessagesResponse;
    },
  };
}

/** Every setting the SDK would otherwise take from the environment is fixed here, on every request. */
function buildClient(options: ClaudeSdkTransportOptions, attempt: AttemptState): Anthropic {
  return new Anthropic({
    apiKey: options.apiKey,
    authToken: null,
    baseURL: CLAUDE_API_ORIGIN,
    // The provider owns retries, so it can charge and persist each attempt.
    maxRetries: 0,
    timeout: options.timeoutMs,
    fetch: guardedFetch(options, attempt),
    fetchOptions: { redirect: "error" },
    // These prevent private prompts reaching logs or trace exporters.
    logLevel: "off",
    logger: SILENT_LOGGER,
    openTelemetry: false,
  });
}

const noop = () => undefined;
const SILENT_LOGGER = { error: noop, warn: noop, info: noop, debug: noop };

/** ANTHROPIC_CUSTOM_HEADERS adds headers to every request and cannot be turned off through a client option. */
function environmentRefusal(): string | undefined {
  return process.env.ANTHROPIC_CUSTOM_HEADERS ? "ANTHROPIC_CUSTOM_HEADERS is set" : undefined;
}

/** The final checkpoint: anything the SDK sends passes through here, so each attempt is verified and counted. */
export function guardedFetch(options: ClaudeSdkTransportOptions, attempt: AttemptState): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const refusal =
      url.origin !== CLAUDE_API_ORIGIN || url.pathname !== CLAUDE_MESSAGES_PATH
        ? "the request was not for the Claude Messages endpoint"
        : headers.get("authorization") !== `Bearer ${options.apiKey}` || headers.has("x-api-key")
          ? "the request was not authenticated with the configured API key alone"
          : options.gate.take();
    if (refusal) {
      attempt.refusal = refusal;
      throw new Error(refusal);
    }
    attempt.sent = true;
    const response = await (options.fetchImpl ?? globalThis.fetch)(input, { ...init, redirect: "error" });
    attempt.status = response.status;
    return response;
  };
}

function mapError(error: unknown, attempt: AttemptState): ClaudeTransportError {
  if (!attempt.sent) {
    return new ClaudeTransportError({
      outcome: "not_sent",
      safeMessage: `Claude request not sent${attempt.refusal ? `: ${attempt.refusal}` : ""}`,
    });
  }
  // A success status followed by any failure means a billable response whose usage could not be read.
  if (attempt.status !== undefined && attempt.status >= 200 && attempt.status < 300) {
    return unreadableSuccess(attempt.status);
  }
  // SDK messages can include the response body, which may echo what was sent. Only typed fields are kept.
  if (error instanceof APIError && error.status !== undefined) {
    return new ClaudeTransportError({
      outcome: "http_error",
      status: error.status,
      requestId: safeToken(error.requestID),
      retryAfterMs: retryAfterMs(error.headers),
      safeMessage: `Claude HTTP ${error.status}${errorType(error)}`,
    });
  }
  return new ClaudeTransportError({ outcome: "no_response", safeMessage: "Claude request failed with no response" });
}

function unreadableSuccess(status: number | undefined): ClaudeTransportError {
  return new ClaudeTransportError({
    outcome: "unreadable_success",
    status,
    safeMessage: `Claude HTTP ${status ?? "success"} response could not be read`,
  });
}

function errorType(error: APIError): string {
  const type = (error.error as { error?: { type?: unknown } } | undefined)?.error?.type;
  const safe = safeToken(type);
  return safe ? ` (${safe})` : "";
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/**
 * Builds the registry's `claudeTransportFor`. Passing it to a registry is not enough to spend: the registry also needs
 * `allowPaidRequests`, and the gate must approve each attempt.
 */
export function liveClaudeTransportFactory(gate: PaidRequestGate, fetchImpl?: typeof fetch) {
  return (assignment: CitizenAssignment, apiKey: string): ClaudeMessagesTransport =>
    createClaudeSdkTransport({ apiKey, gate, timeoutMs: assignment.timeoutMs, fetchImpl });
}
