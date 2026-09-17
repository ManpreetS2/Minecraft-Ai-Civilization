export type ChatRequest = {
  system: string;
  user: string;
  model: string;
  timeoutMs: number;
  contextSize?: number;
  numPredict?: number;
};

export type ChatResult = {
  content: string;
  provider: string;
  model: string;
  promptTokens?: number;
  evalTokens?: number;
};

export type InferenceBackend = {
  readonly name: string;
  readonly kind: "ollama" | "openai_compat";
  readonly configured: boolean;
  chat(request: ChatRequest): Promise<ChatResult>;
};

export function redactSecrets(text: string, secrets: string[]): string {
  let next = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    next = next.split(secret).join("[redacted]");
  }
  return next.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

export function sanitizeError(error: unknown, secrets: string[] = []): Error {
  const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
  const wrapped = new Error(message);
  wrapped.name = error instanceof Error ? error.name : "Error";
  return wrapped;
}
