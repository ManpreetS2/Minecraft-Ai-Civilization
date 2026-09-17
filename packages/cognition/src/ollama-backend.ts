import { ollamaChat } from "./ollama-client.js";
import type { ChatRequest, ChatResult, InferenceBackend } from "./chat-backend.js";
import { sanitizeError } from "./chat-backend.js";

export class OllamaBackend implements InferenceBackend {
  readonly name = "ollama";
  readonly kind = "ollama" as const;

  constructor(
    private readonly host: string,
    private readonly configuredFlag = true,
  ) {}

  get configured(): boolean {
    return this.configuredFlag && Boolean(this.host.trim());
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    try {
      const chat = await ollamaChat({
        host: this.host,
        model: request.model,
        system: request.system,
        user: request.user,
        timeoutMs: request.timeoutMs,
        numPredict: request.numPredict,
        contextSize: request.contextSize,
      });
      return {
        content: chat.content,
        provider: this.name,
        model: request.model,
        promptTokens: chat.promptTokens,
        evalTokens: chat.evalTokens,
      };
    } catch (error) {
      throw sanitizeError(error);
    }
  }
}
