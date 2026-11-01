import type { OpenAiResponsesProvider } from "./openai-responses.js";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";

/**
 * Serves requests from an explicitly configured non-paid provider once cost policy stops the cloud.
 * The fallback is built by createCognition, which only constructs heuristic or loopback Ollama providers.
 */
export class LocalFallbackCognitionProvider implements CognitionProvider {
  readonly name: string;

  constructor(
    private readonly primary: OpenAiResponsesProvider,
    private readonly fallback: CognitionProvider,
  ) {
    this.name = `${primary.name}+fallback:${fallback.name}`;
  }

  async decide(prompt: CognitionPrompt, timeoutMs?: number): Promise<HighLevelDecision> {
    try {
      return await this.primary.decide(prompt, timeoutMs);
    } catch (error) {
      if (!this.primary.permitsLocalFallback(error)) throw error;
      return this.fallback.decide(prompt, timeoutMs);
    }
  }

  close(): void {
    this.primary.close();
  }
}
