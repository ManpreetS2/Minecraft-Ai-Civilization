import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";
import { extractJson, validateDecision } from "./schema.js";
import { formatPrompt } from "./ollama.js";
import type { ChatRequest, ChatResult, InferenceBackend } from "./chat-backend.js";
import { redactSecrets, sanitizeError } from "./chat-backend.js";

export type OpenAICompatConfig = {
  baseUrl: string;
  apiKey?: string;
  fastModel?: string;
  routineModel: string;
  reflectionModel?: string;
};

/**
 * Generic OpenAI Chat Completions adapter.
 * Not bound to a specific hosted vendor. Empty base URL means unconfigured.
 */
export class OpenAICompatibleBackend implements InferenceBackend {
  readonly name = "openai_compat";
  readonly kind = "openai_compat" as const;

  constructor(private readonly config: OpenAICompatConfig) {}

  get configured(): boolean {
    return Boolean(this.config.baseUrl.trim());
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (!this.configured) {
      throw new Error("OpenAI-compatible backend is not configured.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const headers: Record<string, string> = { "content-type": "application/json" };
    const key = this.config.apiKey?.trim();
    if (key) headers.authorization = `Bearer ${key}`;
    try {
      const response = await fetch(chatCompletionsUrl(this.config.baseUrl), {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: request.model,
          temperature: 0.2,
          max_tokens: request.numPredict ?? 128,
          stream: false,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI-compatible HTTP ${response.status}: ${raw.slice(0, 180)}`);
      }
      const body = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = messageContent(body.choices?.[0]?.message?.content);
      return {
        content,
        provider: this.name,
        model: request.model,
        promptTokens: body.usage?.prompt_tokens,
        evalTokens: body.usage?.completion_tokens,
      };
    } catch (error) {
      throw sanitizeError(error, [this.config.apiKey ?? ""]);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OpenAICompatibleProvider implements CognitionProvider {
  readonly name = "openai_compat";
  private readonly backend: OpenAICompatibleBackend;
  private readonly routineModel: string;

  constructor(config: OpenAICompatConfig) {
    this.backend = new OpenAICompatibleBackend(config);
    this.routineModel = config.routineModel;
  }

  async decide(prompt: CognitionPrompt, timeoutMs = 45_000): Promise<HighLevelDecision> {
    const chat = await this.backend.chat({
      system:
        "You are a high-level advisor for one Minecraft citizen. Reply with JSON only: {\"goal\",\"priority\",\"reason\"}. Do not include hidden chain-of-thought. Reason must be one short sentence.",
      user: formatPrompt(prompt),
      model: this.routineModel,
      timeoutMs,
      numPredict: 96,
    });
    return validateDecision(extractJson(chat.content));
  }
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

export function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return "[redacted]";
  return `${key.slice(0, 3)}…${key.slice(-2)}`;
}

function messageContent(content: string | Array<{ text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }
  return "";
}

export { redactSecrets };
