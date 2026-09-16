import { extractJson } from "./schema.js";

export type OllamaChatResult = {
  content: string;
  promptTokens?: number;
  evalTokens?: number;
  totalDurationNs?: number;
};

export async function ollamaChat(args: {
  host: string;
  model: string;
  system: string;
  user: string;
  timeoutMs: number;
  numPredict?: number;
  contextSize?: number;
}): Promise<OllamaChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch(`${args.host.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: args.model,
        stream: false,
        format: "json",
        think: false,
        options: {
          temperature: 0.2,
          num_predict: args.numPredict ?? 128,
          num_ctx: args.contextSize ?? 8192,
        },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const body = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      total_duration?: number;
    };
    return {
      content: body.message?.content ?? "",
      promptTokens: body.prompt_eval_count,
      evalTokens: body.eval_count,
      totalDurationNs: body.total_duration,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaTags(host: string, timeoutMs = 3000): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${host.replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).map((m) => m.name).filter((name): name is string => Boolean(name));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function parseModelJson(content: string): unknown {
  return extractJson(content);
}
