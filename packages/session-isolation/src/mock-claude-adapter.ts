import { createMockAdapter, type WireShape } from "./mock-core.js";
import { sha256Hex } from "./snapshot.js";
import type { MockAdapter, MockAdapterOptions, ProviderRequest, ProviderResponse } from "./types.js";

/** Anthropic Messages-shaped request (mock; shape NOT re-verified against current Anthropic docs). */
export interface ClaudeWireRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly content: string }>;
  readonly max_tokens: number;
}

export interface ClaudeWireResponse {
  readonly id: string;
  readonly type: "message";
  readonly role: "assistant";
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly stop_reason: "end_turn" | "max_tokens";
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
}

/** Test-only. The system prompt is a top-level field, never a message. */
export function claudeToWire(req: ProviderRequest): ClaudeWireRequest {
  return {
    model: req.model,
    system: req.system,
    messages: req.messages.map((message) => ({ role: message.role, content: message.content })),
    max_tokens: req.maxOutputTokens,
  };
}

/** Test-only. */
export function claudeFromWire(raw: ClaudeWireResponse): ProviderResponse {
  return {
    text: raw.content.map((block) => block.text).join(""),
    usage: { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens },
    providerRequestId: raw.id,
    finishReason: raw.stop_reason === "max_tokens" ? "length" : "stop",
  };
}

const claudeShape: WireShape<ClaudeWireRequest, ClaudeWireResponse> = {
  toWire: claudeToWire,
  fromWire: claudeFromWire,
  makeRaw: (req, reply, usage) => ({
    id: `msg_${sha256Hex(req.requestId).slice(0, 16)}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: reply.text }],
    stop_reason: reply.finishReason === "length" ? "max_tokens" : "end_turn",
    usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
  }),
};

export function createMockClaudeAdapter(options?: MockAdapterOptions): MockAdapter {
  return createMockAdapter("claude", ["claude-sonnet-4-5", "claude-haiku-4-5"], claudeShape, options);
}
