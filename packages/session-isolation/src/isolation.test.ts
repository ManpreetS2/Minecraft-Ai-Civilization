import { describe, expect, it } from "vitest";
import { cfg, errorCode, keyRef, makeRegistry, providerCases, settle } from "./test-helpers.js";

describe.each(providerCases())("isolation ($id)", ({ id, model, otherModel }) => {
  it("AT-01 independent history: B's requests and snapshot never contain A's text", async () => {
    const h = makeRegistry();
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a", communityId: "A", apiKeyRef: keyRef("A", id) }));
    const b = h.registry.open(cfg({ provider: id, sessionId: "s-b", communityId: "B", apiKeyRef: keyRef("B", id), systemPrompt: "SYS-B" }));
    await a.send({ content: "A-only: wheat plan" });
    await a.send({ content: "A-only: wheat plan" });
    await b.send({ content: "B-only: iron plan" });

    const bKey = id === "gpt" ? "sk-test-B" : "sk-ant-test-B";
    const bCalls = h.adapterFor(id).calls.filter((call) => call.apiKey === bKey);
    expect(bCalls).toHaveLength(1);
    expect(bCalls[0]?.messages.map((m) => [m.role, m.content])).toEqual([["user", "B-only: iron plan"]]);
    expect(JSON.stringify(bCalls[0])).not.toContain("A-only");
    expect(a.snapshot().history).toHaveLength(4);
    expect(b.snapshot().history).toHaveLength(2);
    expect(JSON.stringify(b.snapshot())).not.toContain("A-only");
    expect(JSON.stringify(a.snapshot())).not.toContain("B-only");
  });

  it("AT-01 snapshots are deep copies: mutating one never touches the session", async () => {
    const h = makeRegistry();
    const a = h.registry.open(cfg({ provider: id }));
    await a.send({ content: "hello" });
    const copy = a.snapshot() as unknown as { history: { content: string }[]; memory: string[]; limits: { timeoutMs: number } };
    copy.history[0]!.content = "tampered";
    copy.memory.push("x");
    copy.limits.timeoutMs = 1;
    const fresh = a.snapshot();
    expect(fresh.history[0]?.content).toBe("hello");
    expect(fresh.memory).toEqual([]);
    expect(fresh.limits.timeoutMs).toBe(1000);
  });

  it("AT-03 independent memory: notes render only into their own session's system field", async () => {
    const h = makeRegistry();
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a", apiKeyRef: keyRef("A", id), systemPrompt: "SYS-A" }));
    const b = h.registry.open(cfg({ provider: id, sessionId: "s-b", apiKeyRef: keyRef("B", id), systemPrompt: "SYS-B" }));
    a.remember("A secret-ish note");
    await b.send({ content: "hi" });
    await a.send({ content: "hi" });
    const calls = h.adapterFor(id).calls;
    const bCall = calls[0];
    const aCall = calls[1];
    expect(bCall?.system).toBe("SYS-B");
    expect(bCall?.system).not.toContain("[memory]");
    expect(JSON.stringify(bCall)).not.toContain("A secret-ish note");
    expect(aCall?.system).toBe("SYS-A\n\n[memory]\n- A secret-ish note");
    expect(a.snapshot().memory).toEqual(["A secret-ish note"]);
    expect(b.snapshot().memory).toEqual([]);
  });

  it("memory is bounded: 512 chars per note, 64 notes", () => {
    const h = makeRegistry();
    const a = h.registry.open(cfg({ provider: id }));
    expect(() => a.remember("x".repeat(513))).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    for (let i = 0; i < 64; i++) a.remember(`n${i}`);
    expect(() => a.remember("one too many")).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(a.snapshot().memory).toHaveLength(64);
  });

  it("AT-04 per-session key delivery: each call carries its own session's key, never swapped", async () => {
    const h = makeRegistry();
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a", communityId: "A", apiKeyRef: keyRef("A", id) }));
    const c = h.registry.open(cfg({ provider: id, sessionId: "s-c", communityId: "C", apiKeyRef: keyRef("C", id) }));
    await a.send({ content: "from A" });
    await c.send({ content: "from C" });
    await a.send({ content: "from A again" });
    const calls = h.adapterFor(id).calls;
    expect(calls.map((call) => [call.messages.at(-1)?.content, call.apiKey])).toEqual([
      ["from A", "sk-test-A"],
      ["from C", "sk-test-C"],
      ["from A again", "sk-test-A"],
    ]);
  });

  it("AT-06 per-session config: model, system, maxOutputTokens are per session and frozen at open()", async () => {
    const h = makeRegistry();
    const limitsA = { timeoutMs: 1000, maxOutputTokens: 32, maxRequests: 10, maxHistoryMessages: 20 };
    const configA = cfg({ provider: id, sessionId: "s-a", model, systemPrompt: "SYS-A", limits: limitsA });
    const configB = cfg({
      provider: id,
      sessionId: "s-b",
      model: otherModel,
      systemPrompt: "SYS-B",
      apiKeyRef: keyRef("B", id),
      limits: { ...limitsA, maxOutputTokens: 64 },
    });
    const a = h.registry.open(configA);
    const b = h.registry.open(configB);
    // mutate the caller's objects after open(): must change nothing
    (configA as { systemPrompt: string }).systemPrompt = "x";
    (limitsA as { timeoutMs: number }).timeoutMs = 1;
    (configA.apiKeyRef as { name: string }).name = "KEY_B_" + id.toUpperCase();
    await a.send({ content: "hi" });
    await b.send({ content: "hi" });
    const [callA, callB] = h.adapterFor(id).calls;
    expect([callA?.model, callA?.system, callA?.maxOutputTokens, callA?.apiKey]).toEqual([model, "SYS-A", 32, "sk-test-A"]);
    expect([callB?.model, callB?.system, callB?.maxOutputTokens]).toEqual([otherModel, "SYS-B", 64]);
    expect(a.snapshot().systemPrompt).toBe("SYS-A");
    expect(a.snapshot().limits.timeoutMs).toBe(1000);
    expect(a.snapshot().apiKeyRef.name).toBe(`KEY_A_${id.toUpperCase()}`);
  });

  it("AT-07 per-session limits: A's maxRequests exhausts without touching B, and the adapter is not called", async () => {
    const h = makeRegistry();
    const limits = { timeoutMs: 1000, maxOutputTokens: 64, maxRequests: 2, maxHistoryMessages: 20 };
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a", limits }));
    const b = h.registry.open(cfg({ provider: id, sessionId: "s-b", apiKeyRef: keyRef("B", id) }));
    const resultsA = [await settle(a.send({ content: "1" })), await settle(a.send({ content: "2" })), await settle(a.send({ content: "3" }))];
    const resultsB = [await settle(b.send({ content: "1" })), await settle(b.send({ content: "2" })), await settle(b.send({ content: "3" }))];
    expect(resultsA.map((r) => r.ok)).toEqual([true, true, false]);
    expect(errorCode(resultsA[2]!)).toBe("LIMIT_EXCEEDED");
    expect(resultsB.every((r) => r.ok)).toBe(true);
    const calls = h.adapterFor(id).calls;
    expect(calls.filter((call) => call.apiKey === "sk-test-A")).toHaveLength(2);
    expect(a.snapshot().requestsUsed).toBe(2);
    expect(b.snapshot().requestsUsed).toBe(3);
  });

  it("AT-13 history window per session: oldest whole pairs drop, window starts with a user message", async () => {
    const h = makeRegistry();
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a", limits: { timeoutMs: 1000, maxOutputTokens: 64, maxRequests: 50, maxHistoryMessages: 4 } }));
    const b = h.registry.open(cfg({ provider: id, sessionId: "s-b", apiKeyRef: keyRef("B", id) }));
    for (let turn = 1; turn <= 5; turn++) {
      await a.send({ content: `a${turn}` });
      await b.send({ content: `b${turn}` });
    }
    const calls = h.adapterFor(id).calls;
    const lastA = calls.filter((call) => call.apiKey === "sk-test-A").at(-1)!;
    const bKey = id === "gpt" ? "sk-test-B" : "sk-ant-test-B";
    const lastB = calls.filter((call) => call.apiKey === bKey).at(-1)!;
    expect(lastA.messages.length).toBeLessThanOrEqual(4);
    expect(lastA.messages[0]?.role).toBe("user");
    expect(lastA.messages.at(-1)?.content).toBe("a5");
    expect(lastB.messages).toHaveLength(9);
    expect(a.snapshot().history.length).toBeLessThanOrEqual(4);
    expect(b.snapshot().history).toHaveLength(10);
  });

  it("AT-14 registries are independent: same sessionId in two registries, no shared sessions, calls or store", async () => {
    const h1 = makeRegistry();
    const h2 = makeRegistry();
    const s1 = h1.registry.open(cfg({ provider: id, sessionId: "same-id" }));
    expect(h2.registry.get("same-id")).toBeUndefined();
    const s2 = h2.registry.open(cfg({ provider: id, sessionId: "same-id" }));
    await s1.send({ content: "only in registry one" });
    await s2.send({ content: "only in registry two" });
    expect(JSON.stringify(h2.adapterFor(id).calls)).not.toContain("registry one");
    expect(JSON.stringify(h1.adapterFor(id).calls)).not.toContain("registry two");
    await h1.registry.persist("same-id");
    expect(await h1.store.list()).toEqual(["same-id"]);
    expect(await h2.store.list()).toEqual([]);
    expect(s2.snapshot().history[0]?.content).toBe("only in registry two");
    expect(() => h1.registry.open(cfg({ provider: id, sessionId: "same-id" }))).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });
});

describe("AT-02 cross-provider history isolation", () => {
  it("interleaved GPT (community A) and Claude (community B) sessions share nothing", async () => {
    const h = makeRegistry();
    const a = h.registry.open(cfg({ provider: "gpt", sessionId: "s-a", communityId: "A", apiKeyRef: keyRef("A", "gpt") }));
    const b = h.registry.open(cfg({ provider: "claude", sessionId: "s-b", communityId: "B", apiKeyRef: keyRef("B", "claude"), systemPrompt: "SYS-B" }));
    for (const n of [1, 2, 3]) {
      await a.send({ content: `A-msg-${n}` });
      await b.send({ content: `B-msg-${n}` });
    }
    const userTexts = (prefix: string, upTo: number): string[] => Array.from({ length: upTo }, (_v, i) => `${prefix}-msg-${i + 1}`);
    h.gpt.calls.forEach((call, i) => {
      expect(call.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(userTexts("A", i + 1));
      expect(call.messages).toHaveLength(i * 2 + 1);
      expect(JSON.stringify(call)).not.toContain("B-msg");
    });
    h.claude.calls.forEach((call, i) => {
      expect(call.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(userTexts("B", i + 1));
      expect(call.messages).toHaveLength(i * 2 + 1);
      expect(JSON.stringify(call)).not.toContain("A-msg");
    });
    expect(h.gpt.calls).toHaveLength(3);
    expect(h.claude.calls).toHaveLength(3);
    expect(a.snapshot().turn).toBe(3);
    expect(b.snapshot().turn).toBe(3);
    expect(h.gpt.calls.every((call) => call.apiKey === "sk-test-A")).toBe(true);
    expect(h.claude.calls.every((call) => call.apiKey === "sk-ant-test-B")).toBe(true);
  });
});
