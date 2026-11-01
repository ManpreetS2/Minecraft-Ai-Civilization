import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudBudgetGate } from "../cloud-budget.js";
import { estimateCloudCostUsd } from "../cloud-prices.js";
import { CloudDecisionLedger } from "../decision-record.js";
import type { CognitionPrompt } from "../schema.js";
import { CitizenProviderRegistry, createInMemoryCitizenSessionStore, type CitizenAssignment } from "./citizen-registry.js";
import { CLAUDE_DECISION_SCHEMA, ClaudeMessagesProvider, ClaudeResponseError, ClaudeTransportError } from "./claude-messages.js";
import { createClaudeSdkTransport, guardedFetch, liveClaudeTransportFactory } from "./claude-sdk-transport.js";
import { isClaudeApiKeyFormat, PAID_RUN_APPROVAL_ENV, PaidRequestGate, type PaidRequestApproval } from "./paid-request-gate.js";

/**
 * Executable contract: the real @anthropic-ai/sdk client and real provider against simulated HTTP responses shaped from
 * the official documentation. No request leaves this process and no key is real. This shows how this code uses the SDK.
 * It does not show that the live API accepts these requests.
 */
const API_KEY = "sk-ant-api03-synthetic-offline-key";
const RUN = "contract-run";
const MODEL = "claude-haiku-5-5";
const DECISION = JSON.stringify({ goal: "gather_food", priority: 0.5, reason: "hungry", targetCitizenId: null, communication: null });
const prompt: CognitionPrompt = { citizenName: "Claude-A", health: 20, hunger: 10, inventory: [], settlementNeeds: [], memories: ["PRIVATE-MEMORY-TEXT"], nearbyCitizens: [] };

type Sent = { url: string; method?: string; headers: Headers; body: Record<string, unknown>; redirect?: string; signal?: AbortSignal | null };

function message(over: Record<string, unknown> = {}) {
  return {
    id: "msg_simulated",
    type: "message",
    role: "assistant",
    model: MODEL,
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    content: [{ type: "text", text: DECISION }],
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...over,
  };
}
const ok = (body: unknown = message()) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "request-id": "req_simulated" } });
function apiError(status: number, type: string, headers: Record<string, string> = {}, text = "simulated") {
  return new Response(JSON.stringify({ type: "error", error: { type, message: text }, request_id: "req_simulated" }), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_simulated", ...headers },
  });
}

function simulator(respond: (call: number, sent: Sent) => Response | Promise<Response> = () => ok()) {
  const calls: Sent[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const sent: Sent = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      redirect: init?.redirect,
      signal: init?.signal,
    };
    calls.push(sent);
    return respond(calls.length, sent);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const expiry = () => new Date(Date.now() + 3_600_000).toISOString();
const approval = (over: Partial<PaidRequestApproval> = {}): PaidRequestApproval => ({
  ownerApprovalReference: "synthetic-owner-approval",
  runId: RUN,
  maxRequests: 100,
  expiresAt: expiry(),
  ...over,
});
const approvedGate = (over: Partial<PaidRequestApproval> = {}) => PaidRequestGate.fromApproval(approval(over), { env: { [PAID_RUN_APPROVAL_ENV]: RUN } });

function live(
  respond?: Parameters<typeof simulator>[0],
  over: { gate?: PaidRequestGate; maxRetries?: number; timeoutMs?: number; allowance?: number; retryBaseDelayMs?: number; effort?: "low" } = {},
) {
  const sim = simulator(respond);
  const budget = new CloudBudgetGate({ maxConcurrency: 4, maxRequestsPerRun: 50, spendAllowanceUsd: over.allowance ?? 1 });
  const ledger = new CloudDecisionLedger();
  const gate = over.gate ?? approvedGate();
  const timeoutMs = over.timeoutMs ?? 5_000;
  const transport = createClaudeSdkTransport({ apiKey: API_KEY, gate, timeoutMs, fetchImpl: sim.fetchImpl });
  const provider = new ClaudeMessagesProvider({
    model: MODEL,
    transport,
    apiKey: API_KEY,
    timeoutMs,
    maxInputTokens: 16_000,
    maxOutputTokens: 1024,
    maxRetries: over.maxRetries ?? 0,
    retryBaseDelayMs: over.retryBaseDelayMs ?? 0,
    effort: over.effort,
    budget,
    ledger,
  });
  return { ...sim, budget, provider, ledger, gate };
}

const SDK_ENV = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_LOG", "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_OPEN_TELEMETRY", "ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE", "ANTHROPIC_PROFILE", PAID_RUN_APPROVAL_ENV];
const networkGuard = vi.fn(async () => {
  throw new Error("REAL NETWORK ATTEMPT");
});
beforeEach(() => {
  networkGuard.mockClear();
  vi.stubGlobal("fetch", networkGuard);
  for (const name of SDK_ENV) vi.stubEnv(name, undefined as unknown as string);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const noRealNetwork = () => expect(networkGuard).not.toHaveBeenCalled();

describe("request contract through the real SDK", () => {
  it("sends one POST to the official endpoint with the documented headers and body", async () => {
    const { provider, calls } = live(undefined, { effort: "low" });
    await expect(provider.decide(prompt)).resolves.toMatchObject({ goal: "gather_food" });
    expect(calls).toHaveLength(1);
    const [sent] = calls;
    expect(sent!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent!.method).toBe("POST");
    // API keys are sent as a bearer token. x-api-key is the documented legacy form.
    expect(sent!.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(sent!.headers.has("x-api-key")).toBe(false);
    // Set by the pinned SDK. If an upgrade changes it, review the version's migration notes before updating this.
    expect(sent!.headers.get("anthropic-version")).toBe("2026-10-21");
    expect(sent!.headers.get("content-type")).toBe("application/json");
    expect(sent!.redirect).toBe("error");
    expect(sent!.body.model).toBe(MODEL);
    expect(sent!.body.max_tokens).toBe(1024);
    expect(typeof sent!.body.system).toBe("string");
    expect(sent!.body.messages).toEqual([{ role: "user", content: expect.stringContaining("Citizen: Claude-A") }]);
    expect(sent!.body.output_config).toEqual({ format: { type: "json_schema", schema: CLAUDE_DECISION_SCHEMA }, effort: "low" });
    noRealNetwork();
  });

  it("sends nothing that would change model, retry or storage behavior", async () => {
    const { provider, calls } = live();
    await provider.decide(prompt);
    expect(Object.keys(calls[0]!.body).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
    expect(calls[0]!.headers.has("anthropic-beta")).toBe(false);
  });

  it("the schema is inside the documented structured-output limits", () => {
    const text = JSON.stringify(CLAUDE_DECISION_SCHEMA);
    for (const keyword of ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "$ref", "pattern"]) expect(text).not.toContain(`"${keyword}"`);
    let unions = 0;
    let optional = 0;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const schema = node as { anyOf?: unknown[]; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; type?: unknown };
      if (schema.anyOf) unions += 1;
      if (schema.type === "object" || schema.properties) expect(schema.additionalProperties).toBe(false);
      if (schema.properties) {
        optional += Object.keys(schema.properties).length - (schema.required?.length ?? 0);
        Object.values(schema.properties).forEach(walk);
      }
      schema.anyOf?.forEach(walk);
    };
    walk(CLAUDE_DECISION_SCHEMA);
    expect(unions).toBeLessThanOrEqual(16);
    expect(optional).toBe(0);
  });
});

describe("hostile environment", () => {
  it("ignores every SDK environment setting that could redirect, reauthenticate, log or export", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://evil.example");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api03-other-key");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "sk-ant-oat01-subscription-token");
    vi.stubEnv("ANTHROPIC_PROFILE", "someone-else");
    vi.stubEnv("ANTHROPIC_LOG", "debug");
    vi.stubEnv("ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE", "content");
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const { provider, calls } = live();
    await provider.decide(prompt);
    const [sent] = calls;
    expect(sent!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent!.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(sent!.headers.has("x-api-key")).toBe(false);
    expect(JSON.stringify(consoles.flatMap((spy) => spy.mock.calls))).not.toMatch(/PRIVATE-MEMORY-TEXT|sk-ant/);
    expect(consoles.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });

  it("refuses to send when ANTHROPIC_CUSTOM_HEADERS is set, because it would add headers to every request", async () => {
    vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "x-exfiltrate: yes");
    const { provider, calls, budget } = live();
    const error = await provider.decide(prompt).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClaudeTransportError);
    expect((error as ClaudeTransportError).outcome).toBe("not_sent");
    expect(calls).toEqual([]);
    expect(budget.snapshot).toMatchObject({ heldUsd: 0, reservedUsd: 0, inFlight: 0 });
  });
});

describe("the paid-request gate denies by default", () => {
  const denied = async (gate: PaidRequestGate, reason: RegExp) => {
    const { provider, calls, budget } = live(undefined, { gate });
    const error = await provider.decide(prompt).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClaudeTransportError);
    expect((error as ClaudeTransportError).outcome).toBe("not_sent");
    expect((error as Error).message).toMatch(reason);
    expect(calls).toEqual([]);
    // Nothing was sent, so nothing is held against the budget.
    expect(budget.snapshot).toMatchObject({ spendUsd: 0, heldUsd: 0, reservedUsd: 0, inFlight: 0, closed: false });
    noRealNetwork();
  };

  it("denyAll refuses", () => denied(PaidRequestGate.denyAll(), /not approved/));
  it("no approval refuses", () => denied(PaidRequestGate.fromApproval(undefined, { env: { [PAID_RUN_APPROVAL_ENV]: RUN } }), /not approved/));
  it("an approval without the launch variable refuses", () => denied(PaidRequestGate.fromApproval(approval(), { env: {} }), new RegExp(PAID_RUN_APPROVAL_ENV)));
  it("the launch variable naming another run refuses", () => denied(PaidRequestGate.fromApproval(approval(), { env: { [PAID_RUN_APPROVAL_ENV]: "other-run" } }), new RegExp(PAID_RUN_APPROVAL_ENV)));
  it("the real process environment is the default, and is unset here", () => denied(PaidRequestGate.fromApproval(approval()), new RegExp(PAID_RUN_APPROVAL_ENV)));
  it("a blank reference refuses", () => denied(approvedGate({ ownerApprovalReference: "  " }), /approval reference/));
  it("a blank run refuses", () => denied(PaidRequestGate.fromApproval(approval({ runId: "" }), { env: { [PAID_RUN_APPROVAL_ENV]: "" } }), /names no run/));
  it("an expired approval refuses", () => denied(approvedGate({ expiresAt: new Date(Date.now() - 1000).toISOString() }), /expired/));
  it("a malformed expiry refuses", () => denied(approvedGate({ expiresAt: "soon" }), /expiry/));
  it("a missing ceiling refuses", () => denied(approvedGate({ maxRequests: 0 }), /ceiling/));
  it("a NaN ceiling refuses", () => denied(approvedGate({ maxRequests: Number.NaN }), /ceiling/));

  it("the ceiling counts every attempt, including retries, across calls", async () => {
    const gate = approvedGate({ maxRequests: 2 });
    const { provider, calls } = live(() => apiError(503, "api_error"), { gate, maxRetries: 2 });
    const error = await provider.decide(prompt).catch((e: unknown) => e);
    expect(calls).toHaveLength(2);
    expect((error as ClaudeTransportError).outcome).toBe("not_sent");
    expect(gate.snapshot).toMatchObject({ requestsTaken: 2, denied: 1 });
  });

  it("revoking stops the next attempt, and cannot be undone", async () => {
    const gate = approvedGate();
    const { provider, calls } = live(undefined, { gate });
    await provider.decide(prompt);
    gate.revoke("operator stop");
    gate.revoke("a later reason");
    await expect(provider.decide(prompt)).rejects.toThrow(/revoked: operator stop/);
    expect(calls).toHaveLength(1);
  });

  it("expiry is checked per attempt, not once at construction", async () => {
    let now = new Date("2026-11-01T00:00:00.000Z");
    const gate = PaidRequestGate.fromApproval(approval({ expiresAt: "2026-11-01T01:00:00.000Z" }), { env: { [PAID_RUN_APPROVAL_ENV]: RUN }, now: () => now });
    const { provider, calls } = live(undefined, { gate });
    await provider.decide(prompt);
    now = new Date("2026-11-01T02:00:00.000Z");
    await expect(provider.decide(prompt)).rejects.toThrow(/expired/);
    expect(calls).toHaveLength(1);
  });

  it("the snapshot records the approval reference and counts, and never a key", async () => {
    const gate = approvedGate();
    const { provider } = live(undefined, { gate });
    await provider.decide(prompt);
    expect(gate.snapshot).toMatchObject({ approved: true, ownerApprovalReference: "synthetic-owner-approval", runId: RUN, requestsTaken: 1, denied: 0 });
    expect(JSON.stringify(gate.snapshot)).not.toContain("sk-ant");
  });
});

describe("no real network", () => {
  it("with no injected fetch, an approved request reaches only the platform fetch, which these tests replace", async () => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
    const provider = new ClaudeMessagesProvider({
      model: MODEL,
      apiKey: API_KEY,
      transport: createClaudeSdkTransport({ apiKey: API_KEY, gate: approvedGate(), timeoutMs: 1000 }),
      timeoutMs: 1000,
      maxInputTokens: 16_000,
      maxOutputTokens: 1024,
      maxRetries: 0,
      budget,
    });
    await expect(provider.decide(prompt)).rejects.toBeInstanceOf(ClaudeTransportError);
    expect(networkGuard).toHaveBeenCalledTimes(1);
  });

  it("the default gate refuses before even the platform fetch", async () => {
    const transport = createClaudeSdkTransport({ apiKey: API_KEY, gate: PaidRequestGate.denyAll(), timeoutMs: 1000 });
    await expect(transport.create({} as never, { signal: new AbortController().signal })).rejects.toMatchObject({ outcome: "not_sent" });
    noRealNetwork();
  });

  it("the live transport is reachable only through its own import path, and no production code imports it", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(join(here, "index.ts"), "utf8")).not.toContain("claude-sdk-transport");
    const root = join(here, "..", "..", "..", "..");
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) visit(path);
        else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "claude-sdk-transport.ts") {
          if (/claude-sdk-transport|routing\/claude-live|@anthropic-ai\/sdk/.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    visit(join(root, "packages"));
    visit(join(root, "apps"));
    expect(offenders).toEqual([]);
  });
});

describe("the final fetch checkpoint", () => {
  const MESSAGES = "https://api.anthropic.com/v1/messages";
  const AUTH = { authorization: `Bearer ${API_KEY}` };
  const guard = () => {
    const sim = simulator();
    const gate = approvedGate();
    const attempt: { sent: boolean; refusal?: string } = { sent: false };
    const send = guardedFetch({ apiKey: API_KEY, gate, timeoutMs: 1000, fetchImpl: sim.fetchImpl }, attempt);
    return { sim, gate, attempt, send };
  };

  it.each([
    ["another host", "https://evil.example/v1/messages", AUTH],
    ["a lookalike host", "https://api.anthropic.com.evil.example/v1/messages", AUTH],
    ["plain HTTP", "http://api.anthropic.com/v1/messages", AUTH],
    ["another port", "https://api.anthropic.com:8443/v1/messages", AUTH],
    ["another endpoint", "https://api.anthropic.com/v1/files", AUTH],
    ["no credential", MESSAGES, {}],
    ["another credential", MESSAGES, { authorization: "Bearer sk-ant-oat01-synthetic" }],
    ["a second credential header", MESSAGES, { ...AUTH, "x-api-key": "sk-ant-api03-other" }],
  ])("refuses %s, sends nothing and claims no attempt", async (_name, url, headers) => {
    const { sim, gate, attempt, send } = guard();
    await expect(send(url, { method: "POST", headers, body: "{}" })).rejects.toThrow();
    expect(sim.calls).toEqual([]);
    expect(attempt.sent).toBe(false);
    expect(attempt.refusal).toBeTruthy();
    expect(gate.snapshot.requestsTaken).toBe(0);
  });

  it("sends a correct request, claims one attempt and forces redirects off", async () => {
    const { sim, gate, attempt, send } = guard();
    await send(MESSAGES, { method: "POST", headers: AUTH, body: "{}", redirect: "follow" });
    expect(sim.calls).toHaveLength(1);
    expect(sim.calls[0]!.redirect).toBe("error");
    expect(attempt).toMatchObject({ sent: true, status: 200 });
    expect(gate.snapshot.requestsTaken).toBe(1);
  });

  it("a gate denied at the last moment stops the send", async () => {
    const { sim, gate, attempt, send } = guard();
    gate.revoke("operator stop");
    await expect(send(MESSAGES, { method: "POST", headers: AUTH, body: "{}" })).rejects.toThrow(/revoked/);
    expect(sim.calls).toEqual([]);
    expect(attempt.sent).toBe(false);
    expect(gate.snapshot.denied).toBe(1);
  });
});

describe("credentials", () => {
  it.each([
    ["a subscription OAuth token", "sk-ant-oat01-synthetic-token"],
    ["an admin key", "sk-ant-admin01-synthetic-key"],
    ["an OpenAI-style key", "sk-synthetic-key"],
    ["an empty value", ""],
    ["a key with a space", "sk-ant-api03-a b"],
  ])("refuses %s, without echoing it", (_name, value) => {
    let message = "";
    try {
      createClaudeSdkTransport({ apiKey: value, gate: approvedGate(), timeoutMs: 1000 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Claude Console API key/);
    if (value) expect(message).not.toContain(value);
  });

  it("recognizes the documented key prefix", () => {
    expect(isClaudeApiKeyFormat(API_KEY)).toBe(true);
    expect(isClaudeApiKeyFormat(undefined)).toBe(false);
  });
});

describe("HTTP status handling through the real SDK", () => {
  it.each([
    [400, "invalid_request_error"],
    [401, "authentication_error"],
    [402, "billing_error"],
    [403, "permission_error"],
    [404, "not_found_error"],
    [413, "request_too_large"],
  ])("%i is refunded and not retried", async (status, type) => {
    const { provider, calls, budget } = live(() => apiError(status, type), { maxRetries: 2 });
    const error = (await provider.decide(prompt).catch((e: unknown) => e)) as ClaudeTransportError;
    expect(error).toBeInstanceOf(ClaudeTransportError);
    expect(error).toMatchObject({ outcome: "http_error", status, requestId: "req_simulated", message: `Claude HTTP ${status} (${type})` });
    expect(calls).toHaveLength(1);
    expect(budget.snapshot).toMatchObject({ heldUsd: 0, spendUsd: 0, reservedUsd: 0, inFlight: 0, closed: false });
  });

  it.each([
    [500, "api_error"],
    [503, "api_error"],
    [504, "timeout_error"],
    [529, "overloaded_error"],
  ])("%i holds each attempt and retries up to the limit", async (status, type) => {
    const { provider, calls, budget } = live(() => apiError(status, type), { maxRetries: 2 });
    await expect(provider.decide(prompt)).rejects.toMatchObject({ outcome: "http_error", status });
    expect(calls).toHaveLength(3);
    expect(budget.snapshot).toMatchObject({ requestsUsed: 3, inFlight: 0, reservedUsd: 0, spendUsd: 0 });
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it("the SDK adds no hidden retry, even when the server asks for one", async () => {
    const { provider, calls } = live(() => apiError(500, "api_error", { "x-should-retry": "true" }));
    await expect(provider.decide(prompt)).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it("a 429 with retry-after waits that long, is refunded, and then succeeds", async () => {
    const started: number[] = [];
    const { provider, budget } = live(
      (call) => {
        started.push(Date.now());
        return call === 1 ? apiError(429, "rate_limit_error", { "retry-after": "0.05" }) : ok();
      },
      { maxRetries: 1 },
    );
    await expect(provider.decide(prompt)).resolves.toBeDefined();
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(45);
    expect(budget.snapshot).toMatchObject({ requestsUsed: 2, heldUsd: 0, reservedUsd: 0 });
    expect(budget.snapshot.spendUsd).toBeGreaterThan(0);
  });

  it("a 429 with no retry-after is not retried, because it can be a spend cap that keeps failing", async () => {
    const { provider, calls, budget } = live(() => apiError(429, "rate_limit_error"), { maxRetries: 2 });
    await expect(provider.decide(prompt)).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(1);
    expect(budget.snapshot).toMatchObject({ heldUsd: 0, requestsUsed: 1 });
  });

  it("a retry-after past the deadline is not waited for", async () => {
    const started = Date.now();
    const { provider, calls } = live(() => apiError(429, "rate_limit_error", { "retry-after": "60" }), { maxRetries: 2, timeoutMs: 2_000 });
    await expect(provider.decide(prompt)).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("backs off exponentially when a 5xx gives no retry-after", async () => {
    const started: number[] = [];
    const { provider } = live(
      () => {
        started.push(Date.now());
        return apiError(529, "overloaded_error");
      },
      { maxRetries: 2, retryBaseDelayMs: 40 },
    );
    await expect(provider.decide(prompt)).rejects.toMatchObject({ status: 529 });
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(35);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(75);
  });

  it("the request budget can stop a retry before it is sent", async () => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 1, spendAllowanceUsd: 1 });
    const sim = simulator(() => apiError(503, "api_error"));
    const provider = new ClaudeMessagesProvider({
      model: MODEL,
      apiKey: API_KEY,
      transport: createClaudeSdkTransport({ apiKey: API_KEY, gate: approvedGate(), timeoutMs: 1000, fetchImpl: sim.fetchImpl }),
      timeoutMs: 1000,
      maxInputTokens: 16_000,
      maxOutputTokens: 1024,
      maxRetries: 2,
      retryBaseDelayMs: 0,
      budget,
    });
    await expect(provider.decide(prompt)).rejects.toMatchObject({ status: 503 });
    expect(sim.calls).toHaveLength(1);
  });
});

describe("timeouts, cancellation and late replies", () => {
  const hanging = (_call: number, sent: Sent) =>
    new Promise<Response>((_resolve, reject) => {
      sent.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

  it("a timeout holds the attempt, reports no response, and keeps the budget open", async () => {
    const { provider, budget, calls } = live(hanging, { timeoutMs: 30 });
    await expect(provider.decide(prompt)).rejects.toMatchObject({ outcome: "no_response" });
    expect(calls).toHaveLength(1);
    expect(budget.snapshot).toMatchObject({ inFlight: 0, reservedUsd: 0, spendUsd: 0, closed: false });
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it("cancel aborts the real SDK request at once and holds the attempt", async () => {
    const { provider, budget, calls } = live(hanging, { timeoutMs: 3_600_000 });
    const pending = provider.decide(prompt);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    provider.cancelInFlight();
    await expect(pending).rejects.toMatchObject({ outcome: "no_response" });
    expect(budget.snapshot).toMatchObject({ inFlight: 0, reservedUsd: 0 });
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it("cancelling during a retry wait stops before another request is sent", async () => {
    const { provider, calls } = live(() => apiError(529, "overloaded_error"), { maxRetries: 2, retryBaseDelayMs: 60_000, timeoutMs: 3_600_000 });
    const pending = provider.decide(prompt);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    provider.cancelInFlight();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(calls).toHaveLength(1);
  });

  it("a connection failure holds the attempt and does not leak the underlying error", async () => {
    const { provider, budget } = live(() => {
      throw new Error(`connect failed with ${API_KEY}`);
    });
    const error = (await provider.decide(prompt).catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ outcome: "no_response", message: "Claude request failed with no response" });
    expect(error.message).not.toContain(API_KEY);
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it("a registry session discards a reply that arrives after cancel", async () => {
    let release!: (response: Response) => void;
    const reply = new Promise<Response>((resolve) => (release = resolve));
    const sim = simulator(() => reply);
    const registry = new CitizenProviderRegistry({
      runId: RUN,
      assignments: [assignment()],
      experiment: { maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 },
      resolveSecret: () => API_KEY,
      allowPaidRequests: true,
      claudeTransportFor: lateTransport(sim.fetchImpl),
    });
    const session = registry.providerFor("claude-a");
    const pending = session.decide(prompt);
    await vi.waitFor(() => expect(sim.calls).toHaveLength(1));
    session.cancel();
    release(ok());
    await expect(pending).rejects.toMatchObject({ code: "STALE_RESPONSE" });
  });
});

/** Ignores the abort signal, like a reply already on its way when the cancel happens. */
function lateTransport(fetchImpl: typeof fetch) {
  return (_assignment: CitizenAssignment, apiKey: string) => {
    const gate = approvedGate();
    return createClaudeSdkTransport({
      apiKey,
      gate,
      timeoutMs: 60_000,
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => fetchImpl(input, { ...init, signal: undefined })) as typeof fetch,
    });
  };
}

function assignment(over: Partial<CitizenAssignment> = {}): CitizenAssignment {
  return {
    citizenId: "claude-a",
    citizenName: "Claude-A",
    family: "claude",
    model: MODEL,
    credential: { env: "KEY_CLAUDE_A" },
    timeoutMs: 5_000,
    maxInputTokens: 16_000,
    maxOutputTokens: 1024,
    maxRetries: 1,
    ...over,
  };
}

describe("responses and settlement", () => {
  it("charges reported usage at the configured price", async () => {
    const { provider, budget, ledger } = live();
    await provider.decide(prompt);
    const cost = estimateCloudCostUsd({ model: MODEL, inputTokens: 100, outputTokens: 20 });
    expect(budget.snapshot).toMatchObject({ spendUsd: cost, heldUsd: 0, reservedUsd: 0, inFlight: 0, closed: false });
    expect(ledger.recent()[0]).toMatchObject({ ok: true, inputTokens: 100, outputTokens: 20, estimatedCostUsd: cost, requestId: "msg_simulated" });
  });

  it("accepts usage that reports the standard tier and speed", async () => {
    const usage = { input_tokens: 10, output_tokens: 5, service_tier: "standard", speed: "standard", inference_geo: "global", output_tokens_details: { reasoning_tokens: 2 } };
    const { provider, budget } = live(() => ok(message({ usage })));
    await expect(provider.decide(prompt)).resolves.toBeDefined();
    expect(budget.snapshot.closed).toBe(false);
  });

  it("skips thinking blocks when reading the reply", async () => {
    const { provider } = live(() => ok(message({ content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: DECISION }] })));
    await expect(provider.decide(prompt)).resolves.toMatchObject({ goal: "gather_food" });
  });

  it("a truncated success body closes the budget with a hold", async () => {
    const { provider, budget } = live(() => new Response('{"id":"msg_', { status: 200, headers: { "content-type": "application/json" } }));
    await expect(provider.decide(prompt)).rejects.toThrow(/could not be read/);
    expect(budget.snapshot).toMatchObject({ closed: true, spendUsd: 0, reservedUsd: 0, inFlight: 0 });
    expect(budget.snapshot.closedReason).toMatch(/usage is unknown/);
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it("a success with the wrong content type closes the budget with a hold", async () => {
    const { provider, budget } = live(() => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(provider.decide(prompt)).rejects.toThrow(/could not be read/);
    expect(budget.snapshot).toMatchObject({ closed: true, spendUsd: 0 });
  });

  it.each([
    ["missing usage", message({ usage: undefined }), /missing token usage/],
    ["null usage", message({ usage: null }), /missing token usage/],
    ["string counts", message({ usage: { input_tokens: "100", output_tokens: 20 } }), /invalid token usage/],
    ["another model", message({ model: "claude-opus-5-5" }), /different model/],
    ["priority billing", message({ usage: { input_tokens: 1, output_tokens: 1, service_tier: "priority" } }), /non-standard tier/],
    ["fast mode billing", message({ usage: { input_tokens: 1, output_tokens: 1, speed: "fast" } }), /non-standard tier/],
  ])("%s closes the budget with a hold and returns no decision", async (_name, body, reason) => {
    const { provider, budget } = live(() => ok(body));
    await expect(provider.decide(prompt)).rejects.toThrow(reason);
    expect(budget.snapshot).toMatchObject({ closed: true, spendUsd: 0, inFlight: 0 });
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
    await expect(provider.decide(prompt)).rejects.toThrow(reason);
  });

  it("a refusal is typed, charged as reported, keeps the budget open, and is not retried on any other model", async () => {
    const { provider, budget, calls } = live(
      () => ok(message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "declined" }, content: [] })),
      { maxRetries: 2 },
    );
    const error = (await provider.decide(prompt).catch((e: unknown) => e)) as ClaudeResponseError;
    expect(error).toBeInstanceOf(ClaudeResponseError);
    expect(error).toMatchObject({ kind: "refusal", refusalCategory: "cyber" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.model).toBe(MODEL);
    expect(calls[0]!.body.fallbacks).toBeUndefined();
    expect(budget.snapshot.closed).toBe(false);
    expect(budget.snapshot.spendUsd).toBeGreaterThan(0);
  });

  it("an unexpected refusal category is not echoed", async () => {
    const { provider } = live(() => ok(message({ stop_reason: "refusal", stop_details: { category: "PRIVATE-MEMORY-TEXT said so" }, content: [] })));
    const error = (await provider.decide(prompt).catch((e: unknown) => e)) as ClaudeResponseError;
    expect(error.message).not.toContain("PRIVATE-MEMORY-TEXT");
    expect(error.refusalCategory).toBeUndefined();
  });

  it.each([
    ["max_tokens", "max_tokens"],
    ["pause_turn", "unexpected_stop"],
    ["tool_use", "unexpected_stop"],
  ])("stop_reason %s is typed and charged", async (stop, kind) => {
    const { provider, budget } = live(() => ok(message({ stop_reason: stop })));
    await expect(provider.decide(prompt)).rejects.toMatchObject({ kind });
    expect(budget.snapshot.spendUsd).toBeGreaterThan(0);
  });

  it("empty content is typed and charged", async () => {
    const { provider, budget } = live(() => ok(message({ content: [] })));
    await expect(provider.decide(prompt)).rejects.toMatchObject({ kind: "no_text" });
    expect(budget.snapshot.spendUsd).toBeGreaterThan(0);
  });

  it("schema-invalid output is charged, and no decision reaches the caller", async () => {
    const { provider, budget } = live(() => ok(message({ content: [{ type: "text", text: '{"goal":"teleport_home","priority":1,"reason":"x"}' }] })));
    await expect(provider.decide(prompt)).rejects.toThrow(/failed decision validation/);
    expect(budget.snapshot.spendUsd).toBeGreaterThan(0);
  });

  it("a usage report above the admission bound closes the budget", async () => {
    const { provider, budget } = live(() => ok(message({ usage: { input_tokens: 5_000_000, output_tokens: 0 } })));
    await provider.decide(prompt);
    expect(budget.snapshot.closedReason).toMatch(/exceeded the admission bound/);
  });
});

describe("nothing private or secret reaches an error, ledger or evidence record", () => {
  const SECRETS = /PRIVATE-MEMORY-TEXT|sk-ant-api03-synthetic/;

  it("an API error body echoing the prompt and key is not repeated", async () => {
    const echo = `bad request: PRIVATE-MEMORY-TEXT ${API_KEY}`;
    const { provider, ledger } = live(() => apiError(400, "invalid_request_error", {}, echo));
    const error = (await provider.decide(prompt).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe("Claude HTTP 400 (invalid_request_error)");
    expect(ledger.toRedactedJson()).not.toMatch(SECRETS);
  });

  it("a hostile error type or request ID is dropped", async () => {
    const { provider } = live(
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "PRIVATE-MEMORY-TEXT with spaces", message: "x" } }), {
          status: 400,
          headers: { "content-type": "application/json", "request-id": "PRIVATE MEMORY" },
        }),
    );
    const error = (await provider.decide(prompt).catch((e: unknown) => e)) as ClaudeTransportError;
    expect(error.message).toBe("Claude HTTP 400");
    expect(error.requestId).toBeUndefined();
  });

  it("a model echoing its private prompt into a rejected field is not logged", async () => {
    const { provider, ledger } = live(() => ok(message({ content: [{ type: "text", text: '{"goal":"PRIVATE-MEMORY-TEXT","priority":1,"reason":"x"}' }] })));
    const error = (await provider.decide(prompt).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toMatch(SECRETS);
    expect(ledger.toRedactedJson()).not.toMatch(SECRETS);
  });

  it("evidence and session records through a registry hold neither", async () => {
    const store = createInMemoryCitizenSessionStore();
    const sim = simulator(() => apiError(400, "invalid_request_error", {}, `echo PRIVATE-MEMORY-TEXT ${API_KEY}`));
    const registry = new CitizenProviderRegistry({
      runId: RUN,
      assignments: [assignment()],
      experiment: { maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 },
      resolveSecret: () => API_KEY,
      allowPaidRequests: true,
      store,
      claudeTransportFor: liveClaudeTransportFactory(approvedGate(), sim.fetchImpl),
    });
    await expect(registry.providerFor("claude-a").decide(prompt)).rejects.toThrow();
    expect(JSON.stringify(registry.evidenceLog())).not.toMatch(SECRETS);
    expect(JSON.stringify(store.load("claude-a"))).not.toMatch(SECRETS);
    expect(JSON.stringify(registry.accounting())).not.toMatch(SECRETS);
  });
});

describe("through the citizen registry", () => {
  const options = (sim: ReturnType<typeof simulator>, gate = approvedGate()) => ({
    runId: RUN,
    experiment: { maxConcurrency: 4, maxRequestsPerRun: 20, spendAllowanceUsd: 1 },
    resolveSecret: (ref: { env: string }) => `sk-ant-api03-synthetic-${ref.env}`,
    allowPaidRequests: true,
    retryBaseDelayMs: 0,
    claudeTransportFor: liveClaudeTransportFactory(gate, sim.fetchImpl),
  });
  const two = [assignment(), assignment({ citizenId: "claude-b", citizenName: "Claude-B", model: "claude-sonnet-5-5", credential: { env: "KEY_CLAUDE_B" }, effort: "low" })];

  it("a live transport is refused unless paid requests were enabled on the registry", () => {
    const sim = simulator();
    expect(() => new CitizenProviderRegistry({ ...options(sim), assignments: two, allowPaidRequests: false })).toThrow(/needs allowPaidRequests/);
    expect(sim.calls).toEqual([]);
  });

  it("a subscription token stops the registry from starting", () => {
    const sim = simulator();
    expect(() => new CitizenProviderRegistry({ ...options(sim), assignments: two, resolveSecret: () => "sk-ant-oat01-synthetic" })).toThrow(/Claude Console API key/);
  });

  it("each citizen sends its own credential, model and settings, and its own prompt only", async () => {
    const sim = simulator((_call, sent) => ok(message({ model: sent.body.model })));
    const registry = new CitizenProviderRegistry({ ...options(sim), assignments: two });
    await Promise.all([
      registry.providerFor("claude-a").decide({ ...prompt, memories: ["SECRET-OF-A"] }),
      registry.providerFor("claude-b").decide({ ...prompt, citizenName: "Claude-B", memories: ["SECRET-OF-B"] }),
    ]);
    const a = sim.calls.find((c) => c.headers.get("authorization")!.endsWith("KEY_CLAUDE_A"))!;
    const b = sim.calls.find((c) => c.headers.get("authorization")!.endsWith("KEY_CLAUDE_B"))!;
    expect(a.body.model).toBe(MODEL);
    expect(b.body.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(a.body)).toContain("SECRET-OF-A");
    expect(JSON.stringify(a.body)).not.toContain("SECRET-OF-B");
    expect(JSON.stringify(b.body)).not.toContain("SECRET-OF-A");
    expect((b.body.output_config as { effort?: string }).effort).toBe("low");
    expect((a.body.output_config as { effort?: string }).effort).toBeUndefined();
  });

  it("the gate's ceiling covers all citizens together", async () => {
    const sim = simulator((_call, sent) => ok(message({ model: sent.body.model })));
    const gate = approvedGate({ maxRequests: 1 });
    const registry = new CitizenProviderRegistry({ ...options(sim, gate), assignments: two });
    await registry.providerFor("claude-a").decide(prompt);
    await expect(registry.providerFor("claude-b").decide({ ...prompt, citizenName: "Claude-B" })).rejects.toThrow(/ceiling/);
    expect(sim.calls).toHaveLength(1);
  });

  it("a reservation that cannot be saved is refused before the SDK sends anything", async () => {
    const sim = simulator();
    const store = createInMemoryCitizenSessionStore();
    const registry = new CitizenProviderRegistry({ ...options(sim), assignments: two, store });
    vi.spyOn(store, "save").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(registry.providerFor("claude-a").decide(prompt)).rejects.toThrow(/could not be persisted/);
    expect(sim.calls).toEqual([]);
  });

  it("one citizen's unknown usage closes the budget for all, and a restart keeps it closed", async () => {
    const sim = simulator(() => ok(message({ usage: null })));
    const store = createInMemoryCitizenSessionStore();
    const first = new CitizenProviderRegistry({ ...options(sim), assignments: two, store });
    await expect(first.providerFor("claude-a").decide(prompt)).rejects.toThrow(/missing token usage/);
    await expect(first.providerFor("claude-b").decide({ ...prompt, citizenName: "Claude-B" })).rejects.toThrow(/missing token usage/);
    const restarted = new CitizenProviderRegistry({ ...options(sim), assignments: two, store });
    await expect(restarted.providerFor("claude-a").decide(prompt)).rejects.toThrow(/missing token usage/);
    expect(sim.calls).toHaveLength(1);
  });

  it("a denied gate does not trigger the local fallback as if the budget had stopped, unless the citizen opted in", async () => {
    const sim = simulator();
    const denied = new CitizenProviderRegistry({ ...options(sim, PaidRequestGate.denyAll()), assignments: two });
    await expect(denied.providerFor("claude-a").decide(prompt)).rejects.toThrow(/not approved/);
    expect(denied.accounting().experiment).toMatchObject({ heldUsd: 0, spendUsd: 0, closed: false });
    expect(denied.evidenceLog().at(-1)).toMatchObject({ outcome: "failed", decidedBy: "none" });
  });
});
