import { GOALS } from "./goals.js";
import { CloudAdmissionError, type CloudBudget, type CloudUsageReport } from "./cloud-budget.js";
import { CloudDecisionLedger, type CloudDecisionRecord } from "./decision-record.js";
import {
  boundCloudAttemptCostUsd,
  hasCloudModelPrice,
  isAllowedOpenAiModel,
} from "./cloud-prices.js";
import { formatPrompt } from "./ollama.js";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";
import { extractJson, validateDecisionForLogging } from "./schema.js";

export type FetchLike = typeof fetch;

export type OpenAiResponsesConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Exact host[:port] that must match a non-OpenAI OPENAI_BASE_URL. */
  customEndpointHost?: string;
  timeoutMs: number;
  /** Largest admitted request, measured as its input token bound. Oversized requests are refused unsent. */
  maxInputTokens?: number;
  maxOutputTokens: number;
  maxRetries: number;
  /** First wait between attempts when the API gives no Retry-After. It doubles each attempt. Default 500. */
  retryBaseDelayMs?: number;
  /** Longest backoff wait when the API gives no Retry-After. Default 8000. */
  retryMaxDelayMs?: number;
  /** Source of jitter in [0, 1). Tests inject a constant. */
  random?: () => number;
  budget: CloudBudget;
  ledger?: CloudDecisionLedger;
  fetchImpl?: FetchLike;
  /** Optional run/trigger label for records. */
  defaultTrigger?: string;
};

export const DEFAULT_CLOUD_MAX_INPUT_TOKENS = 16_000;

const OFFICIAL_OPENAI_HOST = "api.openai.com";

/** 408 and 409 are transient per the official SDKs; 429 is retried only for rate limits, see isRetryable429. */
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 8000;
const MAX_ERROR_BODY_BYTES = 8192;

/**
 * 429 codes OpenAI documents as rate limiting. OpenAI states that retrying billing, spend or quota errors will not
 * restore access, and those can share status 429 (and error.type insufficient_quota), so anything else is not retried.
 */
const RETRYABLE_429_CODES = new Set(["rate_limit_exceeded", "rate_limit_error", "slow_down", "requests", "tokens"]);

/** Service tier that bills at the standard rates the price table models. */
const STANDARD_SERVICE_TIER = "default";

/**
 * Allowance for message framing the provider adds around the serialized request.
 * The input bound assumes byte-level tokenizers, which emit at most one token per UTF-8 byte.
 * The whole request body is counted, so its JSON syntax adds further margin. Reported usage above
 * the resulting bound closes the budget.
 */
const REQUEST_FRAMING_TOKENS = 64;

type OpenAiHttpError = Error & {
  httpStatus?: number;
  retryAfterMs?: number;
  apiCode?: string;
  apiType?: string;
};

type RequestSettlement = {
  /** Set once the provider returns HTTP success; the reservation is then settled and never refunded. */
  billedStatus?: number;
  usage?: CloudUsageReport;
  estimatedCostUsd?: number;
  unverifiedHoldUsd: number;
};

export const DECISION_SYSTEM_PROMPT =
  "You are a high-level advisor for one Minecraft citizen. Choose exactly one allowlisted survival goal. Reply with structured JSON only. Do not include chain-of-thought, tools, code, shell commands, or Minecraft slash commands.";

/**
 * Strict Structured Outputs requires every property in `required`, so an optional field is a required
 * nullable one here. normalizeDecisionInput omits null targets and communication fields.
 * The `reason` length limits are enforced by validateDecision because strict schemas do not list them.
 */
const DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["goal", "priority", "reason", "targetCitizenId", "communication"],
  properties: {
    goal: { type: "string", enum: [...GOALS] },
    priority: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", description: "One short sentence, at most 280 characters." },
    targetCitizenId: {
      type: ["string", "null"],
      description: "Citizen this goal targets, or null if none.",
    },
    communication: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["kind", "message", "toCitizen", "bulletinLine"],
      properties: {
        kind: { type: "string", enum: ["say", "announce_to_community", "share_bulletin_line"] },
        message: { type: "string", description: "Voluntary speech, at most 200 characters." },
        toCitizen: { type: ["string", "null"] },
        bulletinLine: { type: ["integer", "null"], minimum: 1 },
      },
    },
  },
} as const;

export class OpenAiResponsesProvider implements CognitionProvider {
  readonly name = "openai-responses";
  private readonly fetchImpl: FetchLike;
  private readonly ledger: CloudDecisionLedger;
  private readonly inflight = new Set<AbortController>();
  private closed = false;

  constructor(private readonly config: OpenAiResponsesConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.ledger = config.ledger ?? new CloudDecisionLedger();
    assertOpenAiConfig(config);
    assertRequestBounds(config);
  }

  get recentDecisions(): CloudDecisionRecord[] {
    return this.ledger.recent();
  }

  get budgetSnapshot() {
    return this.config.budget.snapshot;
  }

  /**
   * True when a failure means this request cannot be served by the cloud under cost policy.
   * Transient concurrency refusals, network errors and shutdown never qualify.
   */
  permitsLocalFallback(error: unknown): boolean {
    if (this.closed) return false;
    if (this.config.budget.snapshot.closedReason) return true;
    return (
      error instanceof CloudAdmissionError &&
      error.code !== "concurrency" &&
      error.code !== "closed"
    );
  }

  /** Aborts this provider's requests only. It stays usable. */
  cancelInFlight(): void {
    for (const controller of this.inflight) {
      controller.abort();
    }
  }

  close(): void {
    this.closed = true;
    this.config.budget.close();
    this.cancelInFlight();
    this.inflight.clear();
  }

  async decide(
    prompt: CognitionPrompt,
    timeoutMs = this.config.timeoutMs,
  ): Promise<HighLevelDecision> {
    if (this.closed) {
      throw new Error("OpenAI cognition provider is shut down");
    }
    assertOpenAiConfig(this.config);

    const requestBody = this.buildRequestBody(prompt);
    const inputTokenBound = Buffer.byteLength(requestBody, "utf8") + REQUEST_FRAMING_TOKENS;
    const maxInputTokens = this.config.maxInputTokens ?? DEFAULT_CLOUD_MAX_INPUT_TOKENS;
    if (inputTokenBound > maxInputTokens) {
      const reason = `cloud request input bound ${inputTokenBound} exceeds CLOUD_MAX_INPUT_TOKENS ${maxInputTokens}`;
      this.recordFailure(prompt, { failureReason: reason, startedAt: new Date().toISOString() });
      throw new CloudAdmissionError(reason, "input_too_large");
    }

    const maxAttempts = 1 + this.config.maxRetries;
    const admission = this.config.budget.tryAdmit({
      attemptBoundUsd: boundCloudAttemptCostUsd({
        model: this.config.model,
        inputTokens: inputTokenBound,
        outputTokens: this.config.maxOutputTokens,
      }),
      maxAttempts,
    });
    if (!admission.ok) {
      this.recordFailure(prompt, {
        failureReason: admission.reason,
        startedAt: new Date().toISOString(),
      });
      throw new CloudAdmissionError(admission.reason, admission.code);
    }

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const controller = new AbortController();
    this.inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const deadlineMs = startedMs + timeoutMs;

    let lastStatus: number | undefined;
    let attempt = 0;
    const settlement: RequestSettlement = { unverifiedHoldUsd: 0 };

    try {
      while (attempt < maxAttempts) {
        attempt += 1;
        let attemptSent = false;
        try {
          if (controller.signal.aborted || this.closed) {
            throw new Error("OpenAI request cancelled");
          }
          attemptSent = true;
          const response = await this.requestOnce(requestBody, controller.signal);
          // The provider accepted the call, so it is billable whatever its output turns out to be.
          settlement.billedStatus = response.status;
          const payload = await this.settleBilledResponse(
            admission.reservationId,
            response,
            settlement,
          );
          const usage = settlement.usage!;
          const decision = this.parseDecision(payload);
          const requestId = typeof payload.id === "string" ? payload.id : undefined;
          const latencyMs = Date.now() - startedMs;
          this.ledger.push({
            id: crypto.randomUUID(),
            citizenName: prompt.citizenName,
            provider: this.name,
            model: this.config.model,
            requestId,
            trigger: this.config.defaultTrigger ?? "routine_deliberation",
            startedAt,
            completedAt: new Date().toISOString(),
            latencyMs,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimatedCostUsd: settlement.estimatedCostUsd,
            unverifiedHoldUsd: settlement.unverifiedHoldUsd || undefined,
            ok: true,
            acceptedGoal: decision.goal,
            httpStatus: response.status,
          });
          return decision;
        } catch (error) {
          lastStatus = (error as { httpStatus?: number }).httpStatus;
          let message = error instanceof Error ? error.message : String(error);
          // Only a 4xx is a provider rejection. A timeout or 5xx may have been billed without reporting usage.
          const rejected = lastStatus !== undefined && lastStatus >= 400 && lastStatus < 500;
          if (settlement.billedStatus === undefined && attemptSent && !rejected) {
            settlement.unverifiedHoldUsd += this.config.budget.holdAttempt(admission.reservationId);
          }
          const waitMs = this.retryWaitMs(error as OpenAiHttpError, attempt, deadlineMs);
          // Check cancellation first so a retry that will never be sent is not charged to the request budget.
          const cancelledDuringRetryableFailure =
            isRetryableFailure(error as OpenAiHttpError) && (controller.signal.aborted || this.closed);
          if (cancelledDuringRetryableFailure) message = "OpenAI request cancelled";
          if (
            waitMs === undefined ||
            attempt >= maxAttempts ||
            controller.signal.aborted ||
            this.closed ||
            !this.config.budget.tryChargeRetry()
          ) {
            if (settlement.billedStatus === undefined) {
              this.config.budget.reconcile(admission.reservationId, undefined, true);
            }
            this.ledger.push({
              id: crypto.randomUUID(),
              citizenName: prompt.citizenName,
              provider: this.name,
              model: this.config.model,
              trigger: this.config.defaultTrigger ?? "routine_deliberation",
              startedAt,
              completedAt: new Date().toISOString(),
              latencyMs: Date.now() - startedMs,
              inputTokens: settlement.usage?.inputTokens,
              outputTokens: settlement.usage?.outputTokens,
              estimatedCostUsd: settlement.estimatedCostUsd,
              unverifiedHoldUsd: settlement.unverifiedHoldUsd || undefined,
              ok: false,
              failureReason: message,
              rejectedGoal: undefined,
              httpStatus: lastStatus ?? settlement.billedStatus,
            });
            // A retryable failure that landed after a timeout or shutdown is reported as the cancellation it became.
            if (cancelledDuringRetryableFailure) throw new Error(message);
            throw error instanceof Error ? error : new Error(message);
          }
          await abortableDelay(waitMs, controller.signal);
        }
      }
      throw new Error("OpenAI retry exhaustion");
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
  }

  /** How long to wait before retrying, or undefined if this failure must not be retried. */
  private retryWaitMs(error: OpenAiHttpError, attempt: number, deadlineMs: number): number | undefined {
    if (!isRetryableFailure(error)) return undefined;
    const base = this.config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    const max = this.config.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    const random = this.config.random ?? Math.random;
    const jitter = Math.min(Math.max(random(), 0), 1);
    // Retry-After is a minimum, so jitter only adds to it. Backoff uses equal jitter: half fixed, half random.
    const backoff = Math.min(base * 2 ** (attempt - 1), max);
    const waitMs =
      error.retryAfterMs !== undefined
        ? error.retryAfterMs + jitter * Math.min(base, 1000)
        : backoff / 2 + (jitter * backoff) / 2;
    // Waiting past the deadline would spend the retry on a request that is then cancelled.
    return Date.now() + waitMs >= deadlineMs ? undefined : waitMs;
  }

  private buildRequestBody(prompt: CognitionPrompt): string {
    return JSON.stringify({
      model: this.config.model,
      store: false,
      // Without this, a project default of flex or priority could change the price of a request the bound assumed.
      service_tier: STANDARD_SERVICE_TIER,
      max_output_tokens: this.config.maxOutputTokens,
      input: [
        {
          role: "system",
          content: DECISION_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: formatPrompt(prompt),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "high_level_decision",
          strict: true,
          schema: DECISION_JSON_SCHEMA,
        },
      },
    });
  }

  private async requestOnce(requestBody: string, signal: AbortSignal): Promise<Response> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/responses`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      signal,
      // assertOpenAiConfig only vets the configured URL; a redirect must not carry the prompt elsewhere.
      redirect: "error",
      body: requestBody,
    });

    if (!response.ok) {
      const { code, type } = await readApiErrorCode(response);
      // Only vetted tokens reach the message: an error body can echo prompt text or model output.
      const suffix = code ?? type;
      const err = new Error(`OpenAI HTTP ${response.status}${suffix ? ` (${suffix})` : ""}`) as OpenAiHttpError;
      err.httpStatus = response.status;
      err.retryAfterMs = parseRetryAfterMs(response.headers);
      err.apiCode = code;
      err.apiType = type;
      throw err;
    }
    return response;
  }

  /** Settles the reservation exactly once, before the output is interpreted. */
  private async settleBilledResponse(
    reservationId: string,
    response: Response,
    settlement: RequestSettlement,
  ): Promise<Record<string, unknown>> {
    const closeForUnknownUsage = (detail: string): Error => {
      // A successful response may still be billable when usage is unavailable.
      // Keep a hold and refuse further calls rather than treating an unknown cost as zero.
      const reason = `cloud admissions closed for this run: OpenAI HTTP ${response.status} ${detail}`;
      settlement.unverifiedHoldUsd += this.config.budget.settleUnknownUsage(reservationId, reason);
      return new Error(reason);
    };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw closeForUnknownUsage("response body was unreadable, so usage is unknown");
    }
    const tier = (payload as { service_tier?: unknown } | null)?.service_tier;
    if (tier !== undefined && tier !== null && tier !== STANDARD_SERVICE_TIER) {
      // Flex bills below and priority above the modeled rate, so the cost of this call cannot be bounded.
      throw closeForUnknownUsage(`response used non-standard service tier '${safeToken(tier) ?? "unrecognized"}'`);
    }
    const usage = readUsage(payload, this.config.model);
    if (usage === "missing") {
      throw closeForUnknownUsage("response had missing token usage");
    }
    if (usage === "invalid") {
      throw closeForUnknownUsage("response had invalid token usage");
    }
    settlement.usage = usage;
    settlement.estimatedCostUsd = this.config.budget.reconcile(reservationId, usage, false);
    return payload as Record<string, unknown>;
  }

  private parseDecision(payload: Record<string, unknown>): HighLevelDecision {
    assertNoSecretLeak(payload, this.config.apiKey);
    const text = extractResponsesOutputText(payload);
    return validateDecisionForLogging(extractJson(text));
  }

  private recordFailure(
    prompt: CognitionPrompt,
    partial: Pick<CloudDecisionRecord, "failureReason" | "startedAt" | "httpStatus">,
  ): void {
    this.ledger.push({
      id: crypto.randomUUID(),
      citizenName: prompt.citizenName,
      provider: this.name,
      model: this.config.model,
      trigger: this.config.defaultTrigger ?? "routine_deliberation",
      startedAt: partial.startedAt,
      completedAt: new Date().toISOString(),
      ok: false,
      failureReason: partial.failureReason,
      httpStatus: partial.httpStatus,
    });
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function assertOpenAiConfig(
  config: Pick<OpenAiResponsesConfig, "apiKey" | "model" | "baseUrl" | "customEndpointHost">,
): void {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error("OPENAI_API_KEY is required when cloud OpenAI cognition is enabled");
  }
  if (!isAllowedOpenAiModel(config.model)) {
    throw new Error(`Unsupported OpenAI model '${config.model}' — update allowlist intentionally`);
  }
  if (!hasCloudModelPrice(config.model)) {
    throw new Error(`No configured price for model '${config.model}'; its cost cannot be bounded`);
  }
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error("OPENAI_BASE_URL must be a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("OPENAI_BASE_URL must not contain embedded credentials");
  }
  if (/[?#]/.test(config.baseUrl)) {
    throw new Error("OPENAI_BASE_URL must not contain a query or fragment");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("OPENAI_BASE_URL must be https (or loopback for offline mocks)");
  }
  if (isLoopbackHostname(url.hostname)) {
    return;
  }
  if (url.protocol !== "https:") {
    throw new Error("OPENAI_BASE_URL must be https (or loopback for offline mocks)");
  }
  if (url.host === OFFICIAL_OPENAI_HOST) {
    if (url.pathname !== "/v1" && url.pathname !== "/v1/") {
      throw new Error("OPENAI_BASE_URL for the official OpenAI API must use the /v1 path");
    }
    return;
  }
  // The API key goes to this host, so it must be named twice on purpose: once here and once in the URL.
  const customHost = config.customEndpointHost?.trim();
  if (!customHost) {
    throw new Error(
      "OPENAI_BASE_URL points at a non-OpenAI host; set OPENAI_CUSTOM_ENDPOINT_HOST to allow it",
    );
  }
  if (customHost.toLowerCase() !== url.host) {
    throw new Error("OPENAI_BASE_URL host does not match OPENAI_CUSTOM_ENDPOINT_HOST");
  }
}

function assertRequestBounds(config: OpenAiResponsesConfig): void {
  if (!Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 1) {
    throw new RangeError("maxOutputTokens must be a positive integer");
  }
  if (!Number.isSafeInteger(config.maxRetries) || config.maxRetries < 0) {
    throw new RangeError("maxRetries must be a non-negative integer");
  }
  if (
    config.maxInputTokens !== undefined &&
    (!Number.isSafeInteger(config.maxInputTokens) || config.maxInputTokens < 1)
  ) {
    throw new RangeError("maxInputTokens must be a positive integer");
  }
}

export function extractResponsesOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  const output = payload.output;
  if (!Array.isArray(output)) {
    throw new Error("OpenAI response missing output");
  }
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as { type?: string; content?: Array<{ type?: string; text?: string }> };
    if (row.type !== "message" || !Array.isArray(row.content)) continue;
    for (const part of row.content) {
      if (
        part &&
        (part.type === "output_text" || part.type === "text") &&
        typeof part.text === "string" &&
        part.text.trim()
      ) {
        return part.text;
      }
    }
  }
  throw new Error("OpenAI response contained no decision text");
}

function readUsage(payload: unknown, model: string): CloudUsageReport | "missing" | "invalid" {
  const usageRaw = (payload as { usage?: unknown } | null)?.usage;
  if (usageRaw === undefined || usageRaw === null) return "missing";
  if (typeof usageRaw !== "object") return "invalid";
  const raw = usageRaw as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  const inputTokens = raw.input_tokens ?? raw.prompt_tokens;
  const outputTokens = raw.output_tokens ?? raw.completion_tokens;
  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  ) {
    return "invalid";
  }
  return { model, inputTokens, outputTokens };
}

function assertNoSecretLeak(payload: unknown, apiKey: string): void {
  const blob = JSON.stringify(payload);
  if (apiKey && blob.includes(apiKey)) {
    throw new Error("Refusing to process OpenAI payload that echoes the API key");
  }
}

function isRetryableFailure(error: OpenAiHttpError): boolean {
  const status = error.httpStatus;
  if (status === undefined || !RETRYABLE_STATUSES.has(status)) return false;
  return status !== 429 || isRetryable429(error);
}

function isRetryable429(error: OpenAiHttpError): boolean {
  if (error.apiCode !== undefined) return RETRYABLE_429_CODES.has(error.apiCode);
  return error.apiType !== undefined && RETRYABLE_429_CODES.has(error.apiType);
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/** Reads at most a few KB of an error body and keeps only error.code and error.type, if they are plain tokens. */
async function readApiErrorCode(response: Response): Promise<{ code?: string; type?: string }> {
  try {
    const reader = response.body?.getReader();
    if (!reader) return {};
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    const error = (JSON.parse(text) as { error?: { code?: unknown; type?: unknown } } | null)?.error;
    return { code: safeToken(error?.code), type: safeToken(error?.type) };
  } catch {
    return {};
  }
}

/** Retry-After is delay-seconds or an HTTP date. Anything else, including negatives, is ignored. */
export function parseRetryAfterMs(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("retry-after")?.trim();
  if (!raw) return undefined;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }
  // Date.parse accepts plenty of non-dates ("-5" is a year), so require the weekday that every HTTP-date form starts with.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[, ]/.test(raw)) return undefined;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Resolves early on abort: the next attempt sees the abort and stops. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}
