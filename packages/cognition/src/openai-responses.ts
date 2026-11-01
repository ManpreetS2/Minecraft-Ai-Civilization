import { GOALS } from "./goals.js";
import { CloudBudgetGate, type CloudUsageReport } from "./cloud-budget.js";
import { CloudDecisionLedger, type CloudDecisionRecord } from "./decision-record.js";
import { isAllowedOpenAiModel } from "./cloud-prices.js";
import { formatPrompt } from "./ollama.js";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";
import { extractJson, validateDecision } from "./schema.js";

export type FetchLike = typeof fetch;

export type OpenAiResponsesConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxRetries: number;
  budget: CloudBudgetGate;
  ledger?: CloudDecisionLedger;
  fetchImpl?: FetchLike;
  /** Optional run/trigger label for records. */
  defaultTrigger?: string;
};

/** Set once the provider returns HTTP success; its reservation is then settled and never refunded. */
type BilledAttempt = {
  httpStatus: number;
  estimatedCostUsd: number;
  usage?: CloudUsageReport;
};

const DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["goal", "priority", "reason"],
  properties: {
    goal: { type: "string", enum: [...GOALS] },
    priority: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 280 },
    targetCitizenId: { type: "string" },
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
  }

  get recentDecisions(): CloudDecisionRecord[] {
    return this.ledger.recent();
  }

  get budgetSnapshot() {
    return this.config.budget.snapshot;
  }

  close(): void {
    this.closed = true;
    this.config.budget.close();
    for (const controller of this.inflight) {
      controller.abort();
    }
    this.inflight.clear();
  }

  async decide(prompt: CognitionPrompt, timeoutMs = this.config.timeoutMs): Promise<HighLevelDecision> {
    if (this.closed) {
      throw new Error("OpenAI cognition provider is shut down");
    }
    assertOpenAiConfig(this.config);

    const admission = this.config.budget.tryAdmit();
    if (!admission.ok) {
      this.recordFailure(prompt, {
        failureReason: admission.reason,
        startedAt: new Date().toISOString(),
      });
      throw new Error(admission.reason);
    }

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const controller = new AbortController();
    this.inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let lastStatus: number | undefined;
    let attempt = 0;
    const maxAttempts = 1 + Math.max(0, this.config.maxRetries);
    let billed: BilledAttempt | undefined;

    try {
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          if (controller.signal.aborted || this.closed) {
            throw new Error("OpenAI request cancelled");
          }
          const response = await this.requestOnce(prompt, controller.signal);
          // The provider accepted the call, so it is billable whatever its output turns out to be.
          billed = { httpStatus: response.status, estimatedCostUsd: admission.reservedUsd };
          const payload = await this.settleBilledResponse(admission.reservationId, response, billed);
          const usage = billed.usage!;
          const estimatedCostUsd = billed.estimatedCostUsd;
          const httpStatus = billed.httpStatus;
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
            estimatedCostUsd,
            ok: true,
            acceptedGoal: decision.goal,
            httpStatus,
          });
          return decision;
        } catch (error) {
          lastStatus = (error as { httpStatus?: number }).httpStatus;
          const message = error instanceof Error ? error.message : String(error);
          const retryable = lastStatus === 429 || lastStatus === 500 || lastStatus === 503;
          if (!retryable || attempt >= maxAttempts || lastStatus === 401 || !this.config.budget.tryChargeRetry()) {
            if (!billed) {
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
              inputTokens: billed?.usage?.inputTokens,
              outputTokens: billed?.usage?.outputTokens,
              estimatedCostUsd: billed?.estimatedCostUsd,
              ok: false,
              failureReason: message,
              rejectedGoal: undefined,
              httpStatus: lastStatus ?? billed?.httpStatus,
            });
            throw error instanceof Error ? error : new Error(message);
          }
        }
      }
      throw new Error("OpenAI retry exhaustion");
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
  }

  private async requestOnce(prompt: CognitionPrompt, signal: AbortSignal): Promise<Response> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/responses`;
    const body = {
      model: this.config.model,
      store: false,
      max_output_tokens: this.config.maxOutputTokens,
      input: [
        {
          role: "system",
          content:
            "You are a high-level advisor for one Minecraft citizen. Choose exactly one allowlisted survival goal. Reply with structured JSON only. Do not include chain-of-thought, tools, code, shell commands, or Minecraft slash commands.",
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
    };

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      signal,
      // assertOpenAiConfig only vets the configured URL; a redirect must not carry the prompt elsewhere.
      redirect: "error",
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = new Error(`OpenAI HTTP ${response.status}`) as Error & { httpStatus?: number };
      err.httpStatus = response.status;
      throw err;
    }
    return response;
  }

  /** Settles the reservation exactly once, before the output is interpreted. */
  private async settleBilledResponse(
    reservationId: string,
    response: Response,
    billed: BilledAttempt,
  ): Promise<Record<string, unknown>> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.config.budget.settleUnknownUsage(reservationId);
      throw error;
    }
    const usage = readUsage(payload, this.config.model);
    if (!usage) {
      // A successful response may still be billable when usage is absent.
      // Keep the reserve as spend and refuse further calls rather than treating an unknown cost as zero.
      this.config.budget.settleUnknownUsage(reservationId);
      throw new Error("OpenAI response missing or invalid token usage; cloud admissions disabled");
    }
    billed.usage = usage;
    billed.estimatedCostUsd = this.config.budget.reconcile(reservationId, usage, false);
    return payload as Record<string, unknown>;
  }

  private parseDecision(payload: Record<string, unknown>): HighLevelDecision {
    assertNoSecretLeak(payload, this.config.apiKey);
    const text = extractResponsesOutputText(payload);
    return validateDecision(extractJson(text));
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

export function assertOpenAiConfig(config: Pick<OpenAiResponsesConfig, "apiKey" | "model" | "baseUrl">): void {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error("OPENAI_API_KEY is required when cloud OpenAI cognition is enabled");
  }
  if (!isAllowedOpenAiModel(config.model)) {
    throw new Error(`Unsupported OpenAI model '${config.model}' — update allowlist intentionally`);
  }
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error("OPENAI_BASE_URL must be a valid URL");
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("OPENAI_BASE_URL must be https (or localhost for offline mocks)");
  }
  if (url.username || url.password) {
    throw new Error("OPENAI_BASE_URL must not contain embedded credentials");
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
      if (part && (part.type === "output_text" || part.type === "text") && typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }
  throw new Error("OpenAI response contained no decision text");
}

function readUsage(payload: unknown, model: string): CloudUsageReport | undefined {
  const usageRaw = (payload as { usage?: unknown } | null)?.usage;
  if (typeof usageRaw !== "object" || usageRaw === null) return undefined;
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
    return undefined;
  }
  return { model, inputTokens, outputTokens };
}

function assertNoSecretLeak(payload: unknown, apiKey: string): void {
  const blob = JSON.stringify(payload);
  if (apiKey && blob.includes(apiKey)) {
    throw new Error("Refusing to process OpenAI payload that echoes the API key");
  }
}
