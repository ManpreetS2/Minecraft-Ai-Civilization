import { LlmProviderError } from "./errors.js";
import {
  normalizeProviderResult,
  type NormalizedCognitionResult,
  type ProviderAdapter,
  type ProviderChatRequest,
} from "./provider.js";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";
import { extractJson, validateDecision } from "./schema.js";

export class OllamaProvider implements CognitionProvider, ProviderAdapter {
  readonly name = "ollama";
  readonly model: string;

  constructor(
    private readonly host: string,
    model: string,
  ) {
    this.model = model;
  }

  async decide(prompt: CognitionPrompt, timeoutMs = 45_000): Promise<HighLevelDecision> {
    const result = await this.complete({ prompt, timeoutMs });
    return result.decision;
  }

  async complete(request: ProviderChatRequest): Promise<NormalizedCognitionResult> {
    const timeoutMs = request.timeoutMs ?? 45_000;
    const started = Date.now();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.host.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          think: false,
          options: { temperature: 0.2, num_predict: 96 },
          messages: [
            {
              role: "system",
              content:
                'You are a high-level advisor for one Minecraft citizen. Reply with JSON only: {"goal","priority","reason"}. Do not include hidden chain-of-thought. Reason must be one short sentence.',
            },
            {
              role: "user",
              content: formatPrompt(request.prompt),
            },
          ],
        }),
      });

      const latencyMs = Date.now() - started;
      if (response.status === 429) {
        throw new LlmProviderError({
          kind: "rate_limited",
          message: "ollama rate limited",
          provider: this.name,
          model: this.model,
          status: 429,
          latencyMs,
        });
      }
      if (!response.ok) {
        throw new LlmProviderError({
          kind: "provider_error",
          message: `Ollama HTTP ${response.status}`,
          provider: this.name,
          model: this.model,
          status: response.status,
          latencyMs,
          retryable: response.status >= 500,
        });
      }

      const body = (await response.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const content = body.message?.content ?? "";
      let decision;
      try {
        decision = validateDecision(extractJson(content));
      } catch (error) {
        throw new LlmProviderError({
          kind: "invalid_output",
          message: error instanceof Error ? error.message : "Invalid ollama JSON",
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
        promptTokens: body.prompt_eval_count,
        completionTokens: body.eval_count,
        totalTokens:
          body.prompt_eval_count !== undefined && body.eval_count !== undefined
            ? body.prompt_eval_count + body.eval_count
            : undefined,
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

export function formatPrompt(prompt: CognitionPrompt): string {
  return [
    `Citizen: ${prompt.citizenName}`,
    `Health: ${prompt.health ?? "unknown"} Hunger: ${prompt.hunger ?? "unknown"}`,
    `Occupation: ${prompt.occupation ?? "unassigned"}`,
    `Inventory: ${prompt.inventory.slice(0, 12).join(", ") || "empty"}`,
    `Settlement needs: ${prompt.settlementNeeds.join(", ") || "none"}`,
    `Nearby citizens: ${prompt.nearbyCitizens.join(", ") || "none"}`,
    `Relevant memories: ${prompt.memories.slice(0, 5).join(" | ") || "none"}`,
    "Choose the single most useful high-level goal.",
  ].join("\n");
}
