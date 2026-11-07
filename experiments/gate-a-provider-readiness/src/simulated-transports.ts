export type FetchLike = typeof fetch;

export type RecordedOpenAiCall = {
  timestamp: number;
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
  apiKey: string;
};

export type SimulatedOpenAiResponseConfig = {
  goal?: string;
  priority?: number;
  reason?: string;
  communication?: {
    kind: "say" | "announce_to_community" | "share_bulletin_line";
    message: string;
    toCitizen: string | null;
    bulletinLine: number | null;
  } | null;
  targetCitizenId?: string | null;
  outputText?: string;
  status?: number;
  errorBody?: Record<string, unknown>;
  retryAfterMs?: number;
  hang?: boolean;
  delayMs?: number;
  usage?: { input_tokens: number; output_tokens: number } | null;
  serviceTier?: string;
  rawBody?: string;
};

export type RecordedClaudeCall = {
  timestamp: number;
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
  apiKey: string;
};

export type SimulatedClaudeResponseConfig = {
  goal?: string;
  priority?: number;
  reason?: string;
  communication?: {
    kind: "say" | "announce_to_community" | "share_bulletin_line";
    message: string;
    toCitizen: string | null;
    bulletinLine: number | null;
  } | null;
  targetCitizenId?: string | null;
  decisionText?: string;
  status?: number;
  errorBody?: Record<string, unknown>;
  retryAfterMs?: number;
  hang?: boolean;
  delayMs?: number;
  usage?: { input_tokens: number; output_tokens: number } | null;
  model?: string;
  stopReason?: string;
  refusal?: string;
  content?: Array<Record<string, unknown>>;
  rawBody?: string;
};

function abortablePromise(signal?: AbortSignal | null): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Controlled simulated fetch implementation for OpenAI Responses API.
 * Intercepts POST calls to /responses and returns structured outputs or controlled errors.
 */
export class SimulatedOpenAiTransport {
  readonly calls: RecordedOpenAiCall[] = [];
  private responder: (call: RecordedOpenAiCall, index: number) => SimulatedOpenAiResponseConfig | Promise<SimulatedOpenAiResponseConfig> = () => ({});

  setResponder(fn: (call: RecordedOpenAiCall, index: number) => SimulatedOpenAiResponseConfig | Promise<SimulatedOpenAiResponseConfig>) {
    this.responder = fn;
  }

  reset() {
    this.calls.length = 0;
    this.responder = () => ({});
  }

  readonly fetchImpl: FetchLike = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authHeader = headers.get("authorization") ?? "";
    const apiKey = authHeader.replace(/^Bearer\s+/i, "");

    let body: Record<string, unknown> = {};
    const rawInputBody = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    if (typeof rawInputBody === "string" && rawInputBody.trim()) {
      try {
        body = JSON.parse(rawInputBody) as Record<string, unknown>;
      } catch {
        body = { raw: rawInputBody };
      }
    }

    const recordedCall: RecordedOpenAiCall = {
      timestamp: Date.now(),
      url,
      method,
      headers,
      body,
      apiKey,
    };
    this.calls.push(recordedCall);

    const callIndex = this.calls.length - 1;
    const config = await this.responder(recordedCall, callIndex);

    if (config.hang) {
      await abortablePromise(init?.signal);
    }
    if (config.delayMs && config.delayMs > 0) {
      await delay(config.delayMs, init?.signal);
    }

    const status = config.status ?? 200;
    const responseHeaders: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": `resp_simulated_${callIndex}`,
    };
    if (config.retryAfterMs !== undefined) {
      responseHeaders["retry-after"] = String(Math.ceil(config.retryAfterMs / 1000));
    }

    if (config.rawBody !== undefined) {
      return new Response(config.rawBody, { status, headers: responseHeaders });
    }

    if (status !== 200) {
      const errorPayload = config.errorBody ?? {
        error: {
          message: `Simulated OpenAI HTTP ${status}`,
          type: status === 429 ? "requests" : "server_error",
          code: status === 429 ? "rate_limit_exceeded" : "internal_error",
        },
      };
      return new Response(JSON.stringify(errorPayload), { status, headers: responseHeaders });
    }

    const defaultDecision = {
      goal: config.goal ?? "gather_food",
      priority: config.priority ?? 0.8,
      reason: config.reason ?? "Simulated OpenAI decision",
      targetCitizenId: config.targetCitizenId ?? null,
      communication: config.communication ?? null,
    };

    const outputText = config.outputText ?? JSON.stringify(defaultDecision);
    const usage =
      config.usage === undefined
        ? { input_tokens: 120, output_tokens: 35 }
        : config.usage;

    const payload: Record<string, unknown> = {
      id: `resp_simulated_${callIndex}`,
      object: "response",
      created: Math.floor(Date.now() / 1000),
      model: typeof body.model === "string" ? body.model : "gpt-4o-mini",
      output_text: outputText,
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: outputText,
            },
          ],
        },
      ],
    };

    if (config.serviceTier) {
      payload.service_tier = config.serviceTier;
    }

    if (usage !== null) {
      payload.usage = usage;
    }

    return new Response(JSON.stringify(payload), { status: 200, headers: responseHeaders });
  };
}

/**
 * Controlled simulated fetch implementation for Anthropic Messages API.
 * Intercepts POST calls to https://api.anthropic.com/v1/messages and returns Messages responses or controlled errors.
 */
export class SimulatedClaudeTransport {
  readonly calls: RecordedClaudeCall[] = [];
  private responder: (call: RecordedClaudeCall, index: number) => SimulatedClaudeResponseConfig | Promise<SimulatedClaudeResponseConfig> = () => ({});

  setResponder(fn: (call: RecordedClaudeCall, index: number) => SimulatedClaudeResponseConfig | Promise<SimulatedClaudeResponseConfig>) {
    this.responder = fn;
  }

  reset() {
    this.calls.length = 0;
    this.responder = () => ({});
  }

  readonly fetchImpl: typeof fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authHeader = headers.get("authorization") ?? "";
    const apiKey = authHeader.replace(/^Bearer\s+/i, "");

    let body: Record<string, unknown> = {};
    const rawInputBody = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    if (typeof rawInputBody === "string" && rawInputBody.trim()) {
      try {
        body = JSON.parse(rawInputBody) as Record<string, unknown>;
      } catch {
        body = { raw: rawInputBody };
      }
    }

    const recordedCall: RecordedClaudeCall = {
      timestamp: Date.now(),
      url,
      method,
      headers,
      body,
      apiKey,
    };
    this.calls.push(recordedCall);

    const callIndex = this.calls.length - 1;
    const config = await this.responder(recordedCall, callIndex);

    if (config.hang) {
      await abortablePromise(init?.signal);
    }
    if (config.delayMs && config.delayMs > 0) {
      await delay(config.delayMs, init?.signal);
    }

    const status = config.status ?? 200;
    const responseHeaders: Record<string, string> = {
      "content-type": "application/json",
      "request-id": `req_simulated_claude_${callIndex}`,
    };
    if (config.retryAfterMs !== undefined) {
      responseHeaders["retry-after"] = String(Math.ceil(config.retryAfterMs / 1000));
    }

    if (config.rawBody !== undefined) {
      return new Response(config.rawBody, { status, headers: responseHeaders });
    }

    if (status !== 200) {
      const errorPayload = config.errorBody ?? {
        type: "error",
        error: {
          type:
            status === 429
              ? "rate_limit_error"
              : status === 529
                ? "overloaded_error"
                : "api_error",
          message: `Simulated Claude HTTP ${status}`,
        },
        request_id: `req_simulated_claude_${callIndex}`,
      };
      return new Response(JSON.stringify(errorPayload), { status, headers: responseHeaders });
    }

    const defaultDecision = {
      goal: config.goal ?? "mine_stone",
      priority: config.priority ?? 0.75,
      reason: config.reason ?? "Simulated Claude decision",
      targetCitizenId: config.targetCitizenId ?? null,
      communication: config.communication ?? null,
    };

    const decisionText = config.decisionText ?? JSON.stringify(defaultDecision);
    const usage =
      config.usage === undefined
        ? { input_tokens: 110, output_tokens: 28 }
        : config.usage;

    const content =
      config.content ??
      (config.refusal !== undefined
        ? []
        : [{ type: "text", text: decisionText }]);

    const payload: Record<string, unknown> = {
      id: `msg_simulated_${callIndex}`,
      type: "message",
      role: "assistant",
      model: config.model ?? (typeof body.model === "string" ? body.model : "claude-haiku-5-5"),
      stop_reason: config.stopReason ?? (config.refusal ? "refusal" : "end_turn"),
      stop_sequence: null,
      stop_details: null,
      content,
    };

    if (usage !== null) {
      payload.usage = {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
    }

    return new Response(JSON.stringify(payload), { status: 200, headers: responseHeaders });
  };
}
