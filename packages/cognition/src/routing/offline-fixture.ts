import { CitizenProviderRegistry, type CitizenAssignment, type CitizenRegistryOptions } from "./citizen-registry.js";
import type { ClaudeMessagesRequest, ClaudeMessagesResponse, ClaudeMessagesTransport } from "./claude-messages.js";

/**
 * Executable offline 1v1 and 2v2 fixture for integration tests. Scripted replies only: nothing here shows that a real
 * provider accepts these requests, and no network is ever used.
 */
export type ScriptedReply = {
  /** Model output text. Defaults to a valid decision. */
  text?: string;
  goal?: string;
  /** Rejects with this HTTP status. */
  status?: number;
  /** Sent with a rejection, as a real retry-after header would be. */
  retryAfterMs?: number;
  /** Never settles until aborted. */
  hang?: boolean;
  /** Settles only when the promise resolves, ignoring abort, to simulate a late reply. */
  after?: Promise<unknown>;
  /** Overrides reported usage. null omits it entirely. */
  usage?: { input: number; output: number } | null;
  stopReason?: string;
  /** Claude only: the model the response claims served it. */
  model?: string;
  /** GPT only: the `service_tier` the response reports. */
  serviceTier?: string;
};

const DEFAULT_USAGE = { input: 100, output: 20 };

function decisionText(reply: ScriptedReply, citizen: string): string {
  return (
    reply.text ??
    JSON.stringify({
      goal: reply.goal ?? "gather_food",
      priority: 0.5,
      reason: `decision for ${citizen}`,
      targetCitizenId: null,
      communication: null,
    })
  );
}

function abortable(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal?.aborted) fail();
    else signal?.addEventListener("abort", fail, { once: true });
  });
}

/** OpenAI Responses-shaped fetch. Records every request body, keyed by the API key that sent it. */
export function createScriptedOpenAiFetch(script: (apiKey: string, body: Record<string, unknown>) => ScriptedReply) {
  const calls: Array<{ apiKey: string; url: string; body: string; redirect?: string }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const apiKey = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
    const body = String(init?.body);
    calls.push({ apiKey, url: String(url), body, redirect: init?.redirect });
    const reply = script(apiKey, JSON.parse(body) as Record<string, unknown>);
    if (reply.hang) await abortable(init?.signal);
    if (reply.after) await reply.after;
    if (reply.status) {
      // A real 429 names its cause, and a rate limit usually carries retry-after, so the fixture does too.
      const body = reply.status === 429 ? { error: { type: "requests", code: "rate_limit_exceeded" } } : {};
      const headers: Record<string, string> =
        reply.retryAfterMs === undefined ? {} : { "retry-after": String(reply.retryAfterMs / 1000) };
      return new Response(JSON.stringify(body), { status: reply.status, headers });
    }
    const usage = reply.usage === undefined ? DEFAULT_USAGE : reply.usage;
    return new Response(
      JSON.stringify({
        id: `resp_${calls.length}`,
        ...(reply.serviceTier ? { service_tier: reply.serviceTier } : {}),
        output_text: decisionText(reply, "a gpt citizen"),
        ...(usage ? { usage: { input_tokens: usage.input, output_tokens: usage.output } } : {}),
      }),
      { status: 200 },
    );
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

/** Claude Messages-shaped transport, one per citizen so that calls show which session sent what. */
export function createScriptedClaudeTransport(
  script: (request: ClaudeMessagesRequest) => ScriptedReply,
): ClaudeMessagesTransport & { calls: ClaudeMessagesRequest[] } {
  const calls: ClaudeMessagesRequest[] = [];
  return {
    calls,
    async create(request, { signal }): Promise<ClaudeMessagesResponse> {
      calls.push(structuredClone(request));
      const reply = script(request);
      if (reply.hang) await abortable(signal);
      if (reply.after) await reply.after;
      if (reply.status) throw Object.assign(new Error(`Claude HTTP ${reply.status}`), { status: reply.status, retryAfterMs: reply.retryAfterMs });
      const usage = reply.usage === undefined ? DEFAULT_USAGE : reply.usage;
      return {
        id: `msg_${calls.length}`,
        model: reply.model ?? request.model,
        stop_reason: reply.stopReason ?? "end_turn",
        content: [{ type: "text", text: decisionText(reply, "a claude citizen") }],
        ...(usage ? { usage: { input_tokens: usage.input, output_tokens: usage.output } } : {}),
      };
    },
  };
}

const LIMITS = { timeoutMs: 2_000, maxInputTokens: 16_000, maxRetries: 1 };

/** Two independent GPT citizens and two independent Claude citizens, each with its own credential. */
export const OFFLINE_2V2_ASSIGNMENTS: readonly CitizenAssignment[] = [
  { citizenId: "gpt-a", citizenName: "GPT-A", family: "gpt", model: "gpt-4o-mini", credential: { env: "KEY_GPT_A" }, maxOutputTokens: 256, ...LIMITS },
  { citizenId: "gpt-b", citizenName: "GPT-B", family: "gpt", model: "gpt-4.1-mini", credential: { env: "KEY_GPT_B" }, maxOutputTokens: 256, ...LIMITS },
  { citizenId: "claude-a", citizenName: "Claude-A", family: "claude", model: "claude-haiku-5-5", credential: { env: "KEY_CLAUDE_A" }, maxOutputTokens: 1_024, effort: "low", ...LIMITS },
  { citizenId: "claude-b", citizenName: "Claude-B", family: "claude", model: "claude-sonnet-5-5", credential: { env: "KEY_CLAUDE_B" }, maxOutputTokens: 1_024, effort: "low", ...LIMITS },
];

/**
 * Builds a registry that cannot reach a network: GPT citizens use the scripted fetch, Claude citizens their own
 * scripted transports, and credentials are synthetic.
 */
export function offlineRegistry(
  over: Partial<CitizenRegistryOptions> & {
    script?: (citizen: string) => ScriptedReply;
    assignments?: readonly CitizenAssignment[];
  } = {},
) {
  const { script = () => ({}), ...options } = over;
  const assignments = options.assignments ?? OFFLINE_2V2_ASSIGNMENTS;
  const keyToCitizen = new Map(assignments.map((a) => [`synthetic-${a.credential.env}`, a.citizenId]));
  const openai = createScriptedOpenAiFetch((apiKey) => script(keyToCitizen.get(apiKey) ?? "unknown"));
  const claude = new Map<string, ReturnType<typeof createScriptedClaudeTransport>>();
  const registry = new CitizenProviderRegistry({
    runId: "offline-run",
    retryBaseDelayMs: 0,
    experiment: { maxConcurrency: 8, maxRequestsPerRun: 100, spendAllowanceUsd: 1 },
    resolveSecret: (ref) => `synthetic-${ref.env}`,
    fetchImpl: openai.fetchImpl,
    claudeTransportFor: (assignment) => {
      const transport = createScriptedClaudeTransport(() => script(assignment.citizenId));
      claude.set(assignment.citizenId, transport);
      return transport;
    },
    ...options,
    assignments,
  });
  return { registry, openai, claude };
}
