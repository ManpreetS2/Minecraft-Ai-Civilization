import { LlmProviderError } from "./errors.js";
import { formatPrompt } from "./ollama.js";
import {
  normalizeProviderResult,
  type NormalizedCognitionResult,
  type ProviderAdapter,
  type ProviderChatRequest,
} from "./provider.js";
import { extractJson, validateDecision } from "./schema.js";

export type GeminiConfig = {
  apiKey?: string;
  model: string;
  baseUrl?: string;
};

/**
 * Google Gemini generateContent adapter.
 * Kept behind ProviderAdapter so planner code never imports Gemini specifics.
 */
export class GeminiProvider implements ProviderAdapter {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
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
          message: "gemini missing GEMINI_API_KEY configuration",
          provider: this.name,
          model: this.model,
          retryable: false,
          latencyMs: Date.now() - started,
        });
      }

      const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    'You are a high-level advisor for one Minecraft citizen. Reply with JSON only: {"goal","priority","reason"}.\n\n' +
                    formatPrompt(request.prompt),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 128,
            responseMimeType: "application/json",
          },
        }),
      });

      const latencyMs = Date.now() - started;
      if (response.status === 429) {
        throw new LlmProviderError({
          kind: "rate_limited",
          message: "gemini rate limited",
          provider: this.name,
          model: this.model,
          status: 429,
          latencyMs,
        });
      }
      if (!response.ok) {
        throw new LlmProviderError({
          kind: response.status === 401 || response.status === 403 ? "auth" : "provider_error",
          message: `gemini HTTP ${response.status}`,
          provider: this.name,
          model: this.model,
          status: response.status,
          latencyMs,
          retryable: response.status >= 500,
        });
      }

      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const content = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      let decision;
      try {
        decision = validateDecision(extractJson(content));
      } catch (error) {
        throw new LlmProviderError({
          kind: "invalid_output",
          message: error instanceof Error ? error.message : "Invalid gemini JSON",
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
        promptTokens: body.usageMetadata?.promptTokenCount,
        completionTokens: body.usageMetadata?.candidatesTokenCount,
        totalTokens: body.usageMetadata?.totalTokenCount,
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
