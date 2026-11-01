import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeFromWire, claudeToWire } from "./mock-claude-adapter.js";
import { gptFromWire, gptToWire } from "./mock-gpt-adapter.js";
import { createJsonFileSessionStore } from "./store-file.js";
import { isSessionError, redact, SessionError } from "./errors.js";
import { cfg, createFakeClock, createIdFactory, errorCode, keyRef, makeRegistry, providerCases, settle } from "./test-helpers.js";
import type { ProviderAdapter, ProviderRequest, SessionConfig } from "./types.js";

const request: ProviderRequest = {
  model: "m",
  apiKey: "k",
  system: "SYS",
  messages: [
    { role: "user", content: "hi", at: "2026-01-01T00:00:00.000Z" },
    { role: "assistant", content: "yo", at: "2026-01-01T00:00:01.000Z" },
    { role: "user", content: "again", at: "2026-01-01T00:00:02.000Z" },
  ],
  maxOutputTokens: 7,
  requestId: "req_1",
};

describe.each(providerCases())("adapters ($id)", ({ id, make }) => {
  it("AT-05 a wrong key fails only the session that holds it, and nothing of A changes", async () => {
    const h = makeRegistry({ gpt: { expectedApiKey: "sk-test-A" }, claude: { expectedApiKey: "sk-test-A" } });
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a", apiKeyRef: keyRef("A", id) }));
    const b = h.registry.open(cfg({ provider: id, sessionId: "s-b", apiKeyRef: keyRef("B", id) }));
    const okA = await settle(a.send({ content: "a1" }));
    const badB = await settle(b.send({ content: "b1" }));
    expect(okA.ok).toBe(true);
    expect(errorCode(badB)).toBe("AUTH_FAILED");
    expect(!badB.ok && isSessionError(badB.error) && badB.error.retryable).toBe(false);
    expect(b.snapshot().history).toEqual([]);
    expect(b.snapshot().turn).toBe(0);
    expect(a.snapshot().turn).toBe(1);
    expect((await settle(a.send({ content: "a2" }))).ok).toBe(true);
    expect(a.snapshot().turn).toBe(2);
  });

  it("AT-12 determinism: identical registries, ids and clocks give identical calls and snapshots", async () => {
    const run = async () => {
      const h = makeRegistry({ clock: createFakeClock(), ids: createIdFactory() });
      const s = h.registry.open(cfg({ provider: id }));
      s.remember("note");
      const replies = [];
      for (const text of ["one", "two", "three"]) replies.push(await s.send({ content: text }));
      return { calls: h.adapterFor(id).calls, snapshot: s.snapshot(), replies };
    };
    const [first, second] = [await run(), await run()];
    expect(first.calls).toEqual(second.calls);
    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.replies).toEqual(second.replies);
    expect(first.replies[0]?.text).toMatch(/^ack:[0-9a-f]{8}:1$/);
    expect(first.replies[2]?.text).toMatch(/^ack:[0-9a-f]{8}:5$/);
    expect(first.calls.map((c) => c.requestId)).toEqual(["req_1", "req_2", "req_3"]);
  });

  it("AT-12 the provider request id is derived from the injected request id, never random", async () => {
    const h = makeRegistry();
    const s = h.registry.open(cfg({ provider: id }));
    const r = await s.send({ content: "x" });
    expect(r.providerRequestId).toMatch(id === "gpt" ? /^resp_[0-9a-f]{16}$/ : /^msg_[0-9a-f]{16}$/);
    const again = makeRegistry().registry.open(cfg({ provider: id }));
    expect((await again.send({ content: "x" })).providerRequestId).toBe(r.providerRequestId);
  });

  it("AT-18 secrets never appear in errors, snapshots, JSON of the session, or the persisted file", async () => {
    const boom = (): never => {
      throw new Error("bad key sk-test-A");
    };
    const dir = await mkdtemp(join(tmpdir(), "civ-sess-"));
    try {
      const store = createJsonFileSessionStore(dir);
      const h = makeRegistry({ gpt: { script: boom }, claude: { script: boom }, store });
      const s = h.registry.open(cfg({ provider: id }));
      const result = await settle(s.send({ content: "x" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const error = result.error as Error & { cause?: unknown };
      expect(isSessionError(error)).toBe(true);
      expect(error.message).toContain("[REDACTED]");
      expect(error.message).not.toContain("sk-test-A");
      expect(String(error)).not.toContain("sk-test-A");
      expect(String(error.cause)).not.toContain("sk-test-A");
      expect(JSON.stringify(error)).not.toContain("sk-test-A");
      expect(error.stack ?? "").not.toContain("sk-test-A");
      expect(JSON.stringify(s.snapshot())).not.toContain("sk-test-A");
      expect(JSON.stringify(s)).not.toContain("sk-test-A");
      expect(JSON.stringify(s)).not.toContain("SYS-A"); // toJSON exposes identity only
      await h.registry.persist("s-a");
      expect(await readFile(join(dir, "s-a.json"), "utf8")).not.toContain("sk-test-A");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("AT-18 an adapter-thrown SessionError (message and cause) is redacted too", async () => {
    const base = make();
    const leaky: ProviderAdapter = {
      id: base.id,
      allowedModels: base.allowedModels,
      validateConfig: (config) => base.validateConfig(config),
      complete: async () => {
        throw new SessionError("PROVIDER_ERROR", "upstream rejected sk-test-A", { retryable: true, cause: new Error("sk-test-A") });
      },
    };
    const h = makeRegistry({ adapters: [leaky] });
    const s = h.registry.open(cfg({ provider: id }));
    const result = await settle(s.send({ content: "x" }));
    expect(errorCode(result)).toBe("PROVIDER_ERROR");
    if (result.ok) return;
    const error = result.error as SessionError;
    expect(error.retryable).toBe(true); // semantics survive redaction
    expect(error.message).toBe("upstream rejected [REDACTED]");
    expect(String(error.cause ?? "")).not.toContain("sk-test-A");
  });

  it("redact() replaces every occurrence and ignores blank secrets", () => {
    expect(redact("a sk-test-A b sk-test-A", "sk-test-A")).toBe("a [REDACTED] b [REDACTED]");
    expect(redact("nothing", "")).toBe("nothing");
    expect(redact("nothing", undefined)).toBe("nothing");
  });

  it("the adapter itself rejects a config for the other provider", () => {
    const adapter = make();
    const other = id === "gpt" ? "claude" : "gpt";
    expect(() => adapter.validateConfig(cfg({ provider: other }))).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });

  it("AT-26 validateConfig rejects bad configs synchronously and registers nothing", () => {
    const h = makeRegistry();
    const wrongModel = id === "gpt" ? "claude-sonnet-4-5" : "gpt-4o-mini";
    const limits = cfg({ provider: id }).limits;
    const bad: Array<[string, Partial<SessionConfig>]> = [
      ["unknown model", { model: "nope" }],
      ["model of the other provider", { model: wrongModel }],
      ["timeoutMs <= 0", { limits: { ...limits, timeoutMs: 0 } }],
      ["timeoutMs NaN", { limits: { ...limits, timeoutMs: Number.NaN } }],
      ["maxHistoryMessages < 2", { limits: { ...limits, maxHistoryMessages: 1 } }],
      ["maxRequests 0", { limits: { ...limits, maxRequests: 0 } }],
      ["maxOutputTokens fractional", { limits: { ...limits, maxOutputTokens: 1.5 } }],
      ["blank systemPrompt", { systemPrompt: "   " }],
      ["blank communityId", { communityId: " " }],
      ["overlong communityId", { communityId: "c".repeat(65) }],
      ["invalid sessionId", { sessionId: "Bad Id" }],
      ["blank key ref name", { apiKeyRef: { source: "mock", name: " " } }],
    ];
    for (const [label, over] of bad) {
      const config = cfg({ provider: id, sessionId: "s-bad", ...over });
      expect(() => h.registry.open(config), label).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
      expect(h.registry.get("s-bad"), label).toBeUndefined();
    }
    const config = cfg({ provider: id, sessionId: "s-nokey", apiKeyRef: { source: "mock", name: "KEY_MISSING" } });
    expect(() => h.registry.open(config)).toThrowError(expect.objectContaining({ code: "SECRET_MISSING" }));
    expect(h.registry.get("s-nokey")).toBeUndefined();
    expect(() => h.registry.open(cfg({ provider: id }))).not.toThrow();
  });

  it("AT-26 an adapter with no registered provider is CONFIG_INVALID", () => {
    const only = make();
    const h = makeRegistry({ adapters: [only] });
    const other = id === "gpt" ? "claude" : "gpt";
    expect(() => h.registry.open(cfg({ provider: other }))).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });

  it("allowed model lists are frozen and carry the documented placeholder names", () => {
    const adapter = make();
    expect(Object.isFrozen(adapter.allowedModels)).toBe(true);
    expect(adapter.allowedModels).toEqual(id === "gpt" ? ["gpt-4o-mini", "gpt-4.1-mini"] : ["claude-sonnet-4-5", "claude-haiku-4-5"]);
    expect(() => (adapter.allowedModels as string[]).push("x")).toThrow();
  });
});

describe("AT-27 provider wire-shape mocks", () => {
  it("GPT: Responses-shaped request and reply, ids resp_, output_text and input/output token names", async () => {
    const wire = gptToWire(request);
    expect(wire).toMatchObject({ model: "m", instructions: "SYS", max_output_tokens: 7, store: false });
    expect(wire.input.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(wire.input.some((m) => (m as { role: string }).role === "system")).toBe(false);
    const raw = { id: "resp_abc", status: "completed" as const, output_text: "hello", usage: { input_tokens: 3, output_tokens: 5 } };
    expect(gptFromWire(raw)).toEqual({ text: "hello", usage: { inputTokens: 3, outputTokens: 5 }, providerRequestId: "resp_abc", finishReason: "stop" });
    expect(gptFromWire({ ...raw, status: "incomplete" }).finishReason).toBe("length");
  });

  it("Claude: system is a top-level field, content is a text block array, ids msg_, stop_reason maps", () => {
    const wire = claudeToWire(request);
    expect(wire).toMatchObject({ model: "m", system: "SYS", max_tokens: 7 });
    expect(wire.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const raw = {
      id: "msg_abc",
      type: "message" as const,
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "hello" }],
      stop_reason: "end_turn" as const,
      usage: { input_tokens: 3, output_tokens: 5 },
    };
    expect(raw.content[0]?.type).toBe("text");
    expect(claudeFromWire(raw)).toEqual({ text: "hello", usage: { inputTokens: 3, outputTokens: 5 }, providerRequestId: "msg_abc", finishReason: "stop" });
    expect(claudeFromWire({ ...raw, stop_reason: "max_tokens" }).finishReason).toBe("length");
  });

  it("round-trips a scripted reply through each wire shape, including finishReason and usage", async () => {
    const script = () => ({ text: "scripted text", usage: { inputTokens: 11, outputTokens: 13 }, finishReason: "length" as const });
    const h = makeRegistry({ gpt: { script }, claude: { script } });
    const g = h.registry.open(cfg({ provider: "gpt", sessionId: "s-g" }));
    const c = h.registry.open(cfg({ provider: "claude", sessionId: "s-c" }));
    for (const session of [g, c]) {
      const r = await session.send({ content: "x" });
      expect(r.text).toBe("scripted text");
      expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 13 });
      expect(r.finishReason).toBe("length");
    }
    expect((await g.send({ content: "y" })).providerRequestId).toMatch(/^resp_/);
    expect((await c.send({ content: "y" })).providerRequestId).toMatch(/^msg_/);
    expect(g.snapshot().usageTotal).toEqual({ inputTokens: 22, outputTokens: 26 });
  });
});
