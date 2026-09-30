import { LlmProviderError } from "./errors.js";
import { formatPrompt } from "./ollama.js";
import {
  normalizeProviderResult,
  type NormalizedCognitionResult,
  type ProviderAdapter,
  type ProviderChatRequest,
} from "./provider.js";
import { extractJson, validateDecision } from "./schema.js";

export type OpenAiCompatibleConfig = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Extra headers (never log secrets). */
  headers?: Record<string, string>;
};

/**
 * OpenAI-compatible chat completions boundary.
 * Used for NVIDIA NIM / NVIDIA Build and other OpenAI-shaped endpoints.
 */
export class OpenAiCompatibleProvider implements ProviderAdapter {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(config: OpenAiCompatibleConfig) {
    this.name = config.name;
    this.model = config.model;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.extraHeaders = config.headers ?? {};
  }

  async complete(request: ProviderChatRequest): Promise<NormalizedCognitionResult> {
    const timeoutMs = request.timeoutMs ?? 45_000;
    const started = Date.now();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (!this.apiKey) {
        throw new LlmProviderError({
          kind: "config",
          message: `${this.name} missing API key configuration`,
          provider: this.name,
          model: this.model,
          retryable: false,
          latencyMs: Date.now() - started,
        });
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: 128,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'You are a high-level advisor for one Minecraft citizen. Reply with JSON only: {"goal","priority","reason"}. Do not include hidden chain-of-thought. Reason must be one short sentence.',
            },
            { role: "user", content: formatPrompt(request.prompt) },
          ],
        }),
      });

      const latencyMs = Date.now() - started;
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        throw new LlmProviderError({
          kind: "rate_limited",
          message: `${this.name} rate limited`,
          provider: this.name,
          model: this.model,
          status: 429,
          latencyMs,
          retryable: true,
          cause: { retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined },
        });
      }
      if (!response.ok) {
        throw new LlmProviderError({
          kind: response.status === 401 || response.status === 403 ? "auth" : "provider_error",
          message: `${this.name} HTTP ${response.status}`,
          provider: this.name,
          model: this.model,
          status: response.status,
          latencyMs,
          retryable: response.status >= 500,
        });
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = body.choices?.[0]?.message?.content ?? "";
      let decision;
      try {
        decision = validateDecision(extractJson(content));
      } catch (error) {
        throw new LlmProviderError({
          kind: "invalid_output",
          message: error instanceof Error ? error.message : "Invalid model JSON",
          provider: this.name,
          model: this.model,
          latencyMs,
          retryable: false,
          cause: error,
        });
      }

      return normalizeProviderResult({
        decision,
        content,
        provider: this.name,
        model: this.model,
        latencyMs,
        promptTokens: body.usage?.prompt_tokens,
        completionTokens: body.usage?.completion_tokens,
        totalTokens: body.usage?.total_tokens,
      });
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      const latencyMs = Date.now() - started;
      if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new LlmProviderError({
          kind: request.signal?.aborted ? "aborted" : "timeout",
          message: request.signal?.aborted ? "LLM request aborted" : `LLM timed out after ${timeoutMs}ms`,
          provider: this.name,
          model: this.model,
          latencyMs,
          retryable: !request.signal?.aborted,
          cause: error,
        });
      }
      throw new LlmProviderError({
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error),
        provider: this.name,
        model: this.model,
        latencyMs,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}
