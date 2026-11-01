import { createMockAdapter, type WireShape } from "./mock-core.js";
import { sha256Hex } from "./snapshot.js";
import type { MockAdapter, MockAdapterOptions, ProviderRequest, ProviderResponse } from "./types.js";

/** OpenAI Responses-shaped request (mock; shape reflects the existing openai-responses provider, not a conformance claim). */
export interface GptWireRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly content: string }>;
  readonly max_output_tokens: number;
  readonly store: false;
}

export interface GptWireResponse {
  readonly id: string;
  readonly status: "completed" | "incomplete";
  readonly output_text: string;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
}

/** Test-only. */
export function gptToWire(req: ProviderRequest): GptWireRequest {
  return {
    model: req.model,
    instructions: req.system,
    input: req.messages.map((message) => ({ role: message.role, content: message.content })),
    max_output_tokens: req.maxOutputTokens,
    store: false,
  };
}

/** Test-only. */
export function gptFromWire(raw: GptWireResponse): ProviderResponse {
  return {
    text: raw.output_text,
    usage: { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens },
    providerRequestId: raw.id,
    finishReason: raw.status === "incomplete" ? "length" : "stop",
  };
}

const gptShape: WireShape<GptWireRequest, GptWireResponse> = {
  toWire: gptToWire,
  fromWire: gptFromWire,
  makeRaw: (req, reply, usage) => ({
    id: `resp_${sha256Hex(req.requestId).slice(0, 16)}`,
    status: reply.finishReason === "length" ? "incomplete" : "completed",
    output_text: reply.text,
    usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
  }),
};

export function createMockGptAdapter(options?: MockAdapterOptions): MockAdapter {
  return createMockAdapter("gpt", ["gpt-4o-mini", "gpt-4.1-mini"], gptShape, options);
}
