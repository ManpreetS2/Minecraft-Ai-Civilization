import { CloudAdmissionError, type CloudBudget, type CloudUsageReport } from "../cloud-budget.js";
import { boundCloudAttemptCostUsd, hasCloudModelPrice, isAllowedClaudeModel } from "../cloud-prices.js";
import { CloudDecisionLedger, type CloudDecisionRecord } from "../decision-record.js";
import { GOALS } from "../goals.js";
import { formatPrompt } from "../ollama.js";
import { DECISION_SYSTEM_PROMPT } from "../openai-responses.js";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "../schema.js";
import { extractJson, validateDecisionForLogging } from "../schema.js";

/**
 * Claude Messages API decision provider with the same cost rules as OpenAiResponsesProvider.
 *
 * Offline status: every test uses a scripted transport, so this has never reached the real API. The shape follows the
 * Messages API reference current on 2026-11-01. See docs/AI_PROVIDER_ROUTING.md for what a live transport must add.
 */
export type ClaudeMessagesRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  output_config: {
    format: { type: "json_schema"; schema: typeof CLAUDE_DECISION_SCHEMA };
    effort?: ClaudeEffort;
  };
};

export type ClaudeMessagesResponse = {
  id?: unknown;
  model?: unknown;
  stop_reason?: unknown;
  stop_details?: unknown;
  content?: unknown;
  usage?: unknown;
};

/**
 * Sends one request with no retries of its own, so the provider can charge every attempt. Failures should throw
 * ClaudeTransportError; any error carrying a numeric `status` and optional `retryAfterMs` is also understood.
 */
export type ClaudeMessagesTransport = {
  /** Set by a transport that can spend money. A registry refuses it unless paid requests were enabled. */
  paid?: boolean;
  create(request: ClaudeMessagesRequest, options: { signal: AbortSignal }): Promise<ClaudeMessagesResponse>;
};

export type ClaudeTransportOutcome =
  /** Nothing left this process, so nothing can have been billed. */
  | "not_sent"
  /** The API answered with an error status. */
  | "http_error"
  /** Sent, with no answer: a timeout, abort or connection failure. It may have been billed. */
  | "no_response"
  /** A success status whose body could not be read, so its cost is unknown. */
  | "unreadable_success";

/** Its message is safe to log: it never contains a response body, prompt text or credential. */
export class ClaudeTransportError extends Error {
  readonly outcome: ClaudeTransportOutcome;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly requestId?: string;

  constructor(details: {
    outcome: ClaudeTransportOutcome;
    safeMessage: string;
    status?: number;
    retryAfterMs?: number;
    requestId?: string;
  }) {
    super(details.safeMessage);
    this.name = "ClaudeTransportError";
    this.outcome = details.outcome;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    this.requestId = details.requestId;
  }
}

/** The API answered and the usage was charged, but there is no decision to use. */
export class ClaudeResponseError extends Error {
  constructor(
    readonly kind: "refusal" | "max_tokens" | "unexpected_stop" | "no_text",
    message: string,
    /** The policy category of a refusal, when the API gave a plain one. Worth recording; it is not model text. */
    readonly refusalCategory?: string,
  ) {
    super(message);
    this.name = "ClaudeResponseError";
  }
}

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type ClaudeMessagesConfig = {
  model: string;
  transport: ClaudeMessagesTransport;
  /** Used only to refuse a response that echoes the key. The transport owns authentication. */
  apiKey: string;
  timeoutMs: number;
  maxInputTokens: number;
  /** Thinking counts toward this cap, so it must leave room for thinking as well as the JSON reply. */
  maxOutputTokens: number;
  maxRetries: number;
  /** First wait between attempts when the API gives no retry-after. It doubles each attempt. Default 500. */
  retryBaseDelayMs?: number;
  effort?: ClaudeEffort;
  budget: CloudBudget;
  ledger?: CloudDecisionLedger;
};

/**
 * Same fields as the OpenAI schema so both families answer the same question. Claude's structured outputs do not
 * accept numeric or string length constraints, so validateDecision enforces those ranges.
 */
export const CLAUDE_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["goal", "priority", "reason", "targetCitizenId", "communication"],
  properties: {
    goal: { type: "string", enum: [...GOALS] },
    priority: { type: "number", description: "From 0 to 1." },
    reason: { type: "string", description: "One short sentence, at most 280 characters." },
    targetCitizenId: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Citizen this goal targets, or null if none.",
    },
    communication: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "message", "toCitizen", "bulletinLine"],
          properties: {
            kind: { type: "string", enum: ["say", "announce_to_community", "share_bulletin_line"] },
            message: { type: "string", description: "Voluntary speech, at most 200 characters." },
            toCitizen: { anyOf: [{ type: "string" }, { type: "null" }] },
            bulletinLine: { anyOf: [{ type: "integer" }, { type: "null" }] },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

/**
 * Allowance for what the API adds around the serialized request, including its structured-output instructions. The
 * size is not documented, so it is deliberately generous; reported usage above the resulting bound closes the budget.
 */
const CLAUDE_REQUEST_FRAMING_TOKENS = 1024;

/** 408, 409 and 429 mean the request was not processed; 5xx may have been, so those attempts are held. */
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

type Settlement = {
  billedStatus?: number;
  usage?: CloudUsageReport;
  estimatedCostUsd?: number;
  unverifiedHoldUsd: number;
};

export class ClaudeMessagesProvider implements CognitionProvider {
  readonly name = "anthropic-messages";
  private readonly ledger: CloudDecisionLedger;
  private readonly inflight = new Set<AbortController>();
  private closed = false;

  constructor(private readonly config: ClaudeMessagesConfig) {
    this.ledger = config.ledger ?? new CloudDecisionLedger();
    if (!isAllowedClaudeModel(config.model)) {
      throw new Error(`Unsupported Claude model '${config.model}' — update allowlist intentionally`);
    }
    if (!hasCloudModelPrice(config.model)) {
      throw new Error(`No configured price for model '${config.model}'; its cost cannot be bounded`);
    }
    if (!config.apiKey.trim()) throw new Error("A Claude API key is required");
    for (const [name, value, min] of [
      ["maxOutputTokens", config.maxOutputTokens, 1],
      ["maxInputTokens", config.maxInputTokens, 1],
      ["maxRetries", config.maxRetries, 0],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`${name} must be an integer >= ${min}`);
    }
  }

  get recentDecisions(): CloudDecisionRecord[] {
    return this.ledger.recent();
  }

  permitsLocalFallback(error: unknown): boolean {
    if (this.closed) return false;
    if (this.config.budget.snapshot.closedReason) return true;
    return error instanceof CloudAdmissionError && error.code !== "concurrency" && error.code !== "closed";
  }

  /** Aborts this provider's requests only. It stays usable. */
  cancelInFlight(): void {
    for (const controller of this.inflight) controller.abort();
  }

  close(): void {
    this.closed = true;
    this.config.budget.close();
    this.cancelInFlight();
    this.inflight.clear();
  }

  async decide(prompt: CognitionPrompt, timeoutMs = this.config.timeoutMs): Promise<HighLevelDecision> {
    if (this.closed) throw new Error("Claude cognition provider is shut down");

    const request = this.buildRequest(prompt);
    const inputTokenBound = Buffer.byteLength(JSON.stringify(request), "utf8") + CLAUDE_REQUEST_FRAMING_TOKENS;
    if (inputTokenBound > this.config.maxInputTokens) {
      const reason = `cloud request input bound ${inputTokenBound} exceeds the input limit ${this.config.maxInputTokens}`;
      this.recordRefusal(prompt, reason);
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
      this.recordRefusal(prompt, admission.reason);
      throw new CloudAdmissionError(admission.reason, admission.code);
    }

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const controller = new AbortController();
    this.inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const settlement: Settlement = { unverifiedHoldUsd: 0 };
    const deadlineMs = startedMs + timeoutMs;

    try {
      for (let attempt = 1; ; attempt += 1) {
        let attemptSent = false;
        try {
          if (controller.signal.aborted || this.closed) throw new Error("Claude request cancelled");
          attemptSent = true;
          const response = await this.sendOnce(request, controller.signal, admission.reservationId, settlement);
          settlement.billedStatus = 200;
          this.settleBilledResponse(admission.reservationId, response, settlement);
          const decision = this.parseDecision(response);
          this.push(prompt, startedAt, startedMs, settlement, {
            ok: true,
            acceptedGoal: decision.goal,
            requestId: typeof response.id === "string" ? response.id : undefined,
          });
          return decision;
        } catch (error) {
          const status = statusOf(error);
          const message = error instanceof Error ? error.message : String(error);
          // A 4xx means the request was refused. Anything else sent may have been billed without reporting usage.
          const rejected = status !== undefined && status >= 400 && status < 500;
          const sent = attemptSent && !isNotSent(error);
          if (settlement.billedStatus === undefined && sent && !rejected) {
            settlement.unverifiedHoldUsd += this.config.budget.holdAttempt(admission.reservationId);
          }
          const waitMs = this.retryWaitMs(status, retryAfterOf(error), attempt, deadlineMs);
          if (waitMs === undefined || attempt >= maxAttempts || !this.config.budget.tryChargeRetry()) {
            if (settlement.billedStatus === undefined) {
              this.config.budget.reconcile(admission.reservationId, undefined, true);
            }
            this.push(prompt, startedAt, startedMs, settlement, { ok: false, failureReason: message, httpStatus: status });
            throw error instanceof Error ? error : new Error(message);
          }
          await abortableDelay(waitMs, controller.signal);
        }
      }
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
  }

  /** How long to wait before retrying, or undefined if this failure should not be retried. */
  private retryWaitMs(status: number | undefined, retryAfterMs: number | undefined, attempt: number, deadlineMs: number): number | undefined {
    if (status === undefined || !RETRYABLE_STATUSES.has(status)) return undefined;
    // A 429 with no retry-after can be a spend cap, which keeps failing until access resumes.
    if (status === 429 && retryAfterMs === undefined) return undefined;
    const base = this.config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    const waitMs = retryAfterMs ?? base * 2 ** (attempt - 1);
    // Waiting past the deadline would spend the retry on a request that is then cancelled.
    return Date.now() + waitMs >= deadlineMs ? undefined : waitMs;
  }

  /** A success whose body cannot be read is settled here, because its usage will never be known. */
  private async sendOnce(
    request: ClaudeMessagesRequest,
    signal: AbortSignal,
    reservationId: string,
    settlement: Settlement,
  ): Promise<ClaudeMessagesResponse> {
    try {
      return await this.config.transport.create(request, { signal });
    } catch (error) {
      if (error instanceof ClaudeTransportError && error.outcome === "unreadable_success") {
        settlement.billedStatus = error.status ?? 200;
        const reason = `cloud admissions closed for this run: ${error.message}, so its usage is unknown`;
        settlement.unverifiedHoldUsd += this.config.budget.settleUnknownUsage(reservationId, reason);
        throw new Error(reason);
      }
      throw error;
    }
  }

  private buildRequest(prompt: CognitionPrompt): ClaudeMessagesRequest {
    return {
      model: this.config.model,
      max_tokens: this.config.maxOutputTokens,
      system: DECISION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: formatPrompt(prompt) }],
      output_config: {
        format: { type: "json_schema", schema: CLAUDE_DECISION_SCHEMA },
        ...(this.config.effort ? { effort: this.config.effort } : {}),
      },
    };
  }

  /** Settles the reservation exactly once, before the output is interpreted. */
  private settleBilledResponse(reservationId: string, response: ClaudeMessagesResponse, settlement: Settlement): void {
    const closeFor = (detail: string): Error => {
      const reason = `cloud admissions closed for this run: Claude response ${detail}`;
      settlement.unverifiedHoldUsd += this.config.budget.settleUnknownUsage(reservationId, reason);
      return new Error(reason);
    };
    // A different model would mean a silent provider change, and this price would not apply to it.
    if (response.model !== this.config.model) throw closeFor("was served by a different model than requested");
    const usage = readClaudeUsage(response, this.config.model);
    if (usage === "missing") throw closeFor("had missing token usage");
    if (usage === "invalid") throw closeFor("had invalid token usage");
    if (usage === "nonstandard") throw closeFor("was billed at a non-standard tier or speed, so the price table does not apply");
    settlement.usage = usage;
    settlement.estimatedCostUsd = this.config.budget.reconcile(reservationId, usage, false);
  }

  private parseDecision(response: ClaudeMessagesResponse): HighLevelDecision {
    if (JSON.stringify(response).includes(this.config.apiKey)) {
      throw new Error("Refusing to process Claude payload that echoes the API key");
    }
    if (response.stop_reason === "refusal") {
      const category = refusalCategory(response.stop_details);
      throw new ClaudeResponseError("refusal", `Claude declined the request (stop_reason refusal${category ? `, category ${category}` : ""})`, category);
    }
    if (response.stop_reason === "max_tokens") {
      throw new ClaudeResponseError("max_tokens", "Claude reply was cut off at max_tokens; raise this citizen's output limit");
    }
    if (response.stop_reason !== "end_turn") throw new ClaudeResponseError("unexpected_stop", "Claude response had an unexpected stop_reason");
    const text = (Array.isArray(response.content) ? response.content : []).find(
      (block): block is { type: "text"; text: string } =>
        Boolean(block) && block.type === "text" && typeof block.text === "string" && Boolean(block.text.trim()),
    );
    if (!text) throw new ClaudeResponseError("no_text", "Claude response contained no decision text");
    return validateDecisionForLogging(extractJson(text.text));
  }

  private push(
    prompt: CognitionPrompt,
    startedAt: string,
    startedMs: number,
    settlement: Settlement,
    outcome: Pick<CloudDecisionRecord, "ok" | "acceptedGoal" | "requestId" | "failureReason" | "httpStatus">,
  ): void {
    this.ledger.push({
      id: crypto.randomUUID(),
      citizenName: prompt.citizenName,
      provider: this.name,
      model: this.config.model,
      trigger: "routine_deliberation",
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedMs,
      inputTokens: settlement.usage?.inputTokens,
      outputTokens: settlement.usage?.outputTokens,
      estimatedCostUsd: settlement.estimatedCostUsd,
      unverifiedHoldUsd: settlement.unverifiedHoldUsd || undefined,
      ...outcome,
      httpStatus: outcome.httpStatus ?? settlement.billedStatus,
    });
  }

  private recordRefusal(prompt: CognitionPrompt, failureReason: string): void {
    const at = new Date().toISOString();
    this.ledger.push({
      id: crypto.randomUUID(),
      citizenName: prompt.citizenName,
      provider: this.name,
      model: this.config.model,
      trigger: "routine_deliberation",
      startedAt: at,
      completedAt: at,
      ok: false,
      failureReason,
    });
  }
}

function isNotSent(error: unknown): boolean {
  return error instanceof ClaudeTransportError && error.outcome === "not_sent";
}

function retryAfterOf(error: unknown): number | undefined {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function refusalCategory(details: unknown): string | undefined {
  const category = (details as { category?: unknown } | null)?.category;
  return typeof category === "string" && /^[a-z_]{1,64}$/.test(category) ? category : undefined;
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

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Claude reports uncached, cache-write and cache-read input separately. These requests set no cache breakpoints, so
 * cache counts should be zero. If any appear, they are charged at or above their real rate: a cache write costs 1.25
 * times input, and a cache read costs less than input.
 */
function readClaudeUsage(response: ClaudeMessagesResponse, model: string): CloudUsageReport | "missing" | "invalid" | "nonstandard" {
  const usage = response.usage;
  if (usage === undefined || usage === null) return "missing";
  if (typeof usage !== "object") return "invalid";
  const raw = usage as Record<string, unknown>;
  const count = (value: unknown, fallback?: number): number | undefined => {
    if (value === undefined || value === null) return fallback;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const input = count(raw.input_tokens);
  const output = count(raw.output_tokens);
  const cacheWrite = count(raw.cache_creation_input_tokens, 0);
  const cacheRead = count(raw.cache_read_input_tokens, 0);
  if (input === undefined || output === undefined || cacheWrite === undefined || cacheRead === undefined) {
    return "invalid";
  }
  // These requests ask for neither, but an account setting could apply one, and the price table covers neither.
  if ((raw.service_tier ?? "standard") !== "standard" || (raw.speed ?? "standard") !== "standard") return "nonstandard";
  return { model, inputTokens: input + Math.ceil(cacheWrite * 1.25) + cacheRead, outputTokens: output };
}
