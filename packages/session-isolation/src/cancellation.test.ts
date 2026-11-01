import { afterEach, describe, expect, it, vi } from "vitest";
import { cfg, errorCode, keyRef, makeRegistry, providerCases, settle } from "./test-helpers.js";
import { isSessionError } from "./errors.js";
import type { ProviderAdapter } from "./types.js";

afterEach(() => {
  vi.useRealTimers();
});

describe.each(providerCases())("cancellation & timeout ($id)", ({ id, make }) => {
  it("AT-08 cancel() is scoped to one session and the session stays usable", async () => {
    vi.useFakeTimers();
    const h = makeRegistry({ gpt: { delayMs: 500 }, claude: { delayMs: 500 } });
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a" }));
    const b = h.registry.open(cfg({ provider: id, sessionId: "s-b", apiKeyRef: keyRef("B", id) }));
    const pa = settle(a.send({ content: "a1" }));
    const pb = settle(b.send({ content: "b1" }));
    expect([a.state, b.state]).toEqual(["busy", "busy"]);
    a.cancel("test");
    await vi.advanceTimersByTimeAsync(500);
    const [ra, rb] = [await pa, await pb];
    expect(errorCode(ra)).toBe("CANCELLED");
    expect(rb.ok).toBe(true);
    expect(a.state).toBe("idle");
    expect(a.snapshot().history).toHaveLength(0);
    expect(a.snapshot().turn).toBe(0);
    expect(b.snapshot().turn).toBe(1);
    const again = settle(a.send({ content: "a2" }));
    await vi.advanceTimersByTimeAsync(500);
    expect((await again).ok).toBe(true);
    expect(a.snapshot().turn).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("AT-09 timeout fires at exactly limits.timeoutMs, commits nothing, and a late reply is discarded", async () => {
    vi.useFakeTimers();
    const h = makeRegistry({ gpt: { delayMs: 5000 }, claude: { delayMs: 5000 } });
    const s = h.registry.open(cfg({ provider: id }));
    const before = s.snapshot();
    const p = settle(s.send({ content: "slow" }));
    let done = false;
    void p.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await p;
    expect(errorCode(result)).toBe("TIMEOUT");
    expect(!result.ok && isSessionError(result.error) && result.error.retryable).toBe(true);
    const after = s.snapshot();
    expect([after.history, after.turn, after.usageTotal]).toEqual([before.history, before.turn, before.usageTotal]);
    expect(after.requestsUsed).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.snapshot()).toEqual(after);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.state).toBe("idle");
  });

  it("AT-10 session enforces the timeout even if the adapter ignores abort; input.timeoutMs only lowers the limit", async () => {
    vi.useFakeTimers();
    const base = make();
    const ignoring: ProviderAdapter = {
      id: base.id,
      allowedModels: base.allowedModels,
      validateConfig: (config) => base.validateConfig(config),
      // ignores `signal` entirely and replies after 5000 ms
      complete: (req) => new Promise((resolve) => setTimeout(() => void base.complete(req, new AbortController().signal).then(resolve), 5000)),
    };
    const h = makeRegistry({ adapters: [ignoring] });
    const s = h.registry.open(cfg({ provider: id }));

    const lowered = settle(s.send({ content: "x", timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(errorCode(await lowered)).toBe("TIMEOUT");

    let clampedDone = false;
    const clamped = settle(s.send({ content: "y", timeoutMs: 999_999 }));
    void clamped.then(() => {
      clampedDone = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(clampedDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(errorCode(await clamped)).toBe("TIMEOUT"); // clamped to limits.timeoutMs = 1000
    await vi.advanceTimersByTimeAsync(10_000); // both late replies arrive and are ignored
    expect(s.snapshot().turn).toBe(0);
    expect(s.snapshot().history).toEqual([]);
  });

  it("AT-11 caller AbortSignal aborts only that send; a pre-aborted signal never reaches the adapter", async () => {
    vi.useFakeTimers();
    const h = makeRegistry({ gpt: { delayMs: 500 }, claude: { delayMs: 500 } });
    const s = h.registry.open(cfg({ provider: id }));
    const controller = new AbortController();
    const p = settle(s.send({ content: "x", signal: controller.signal }));
    controller.abort();
    expect(errorCode(await p)).toBe("CANCELLED");
    expect(s.snapshot().history).toEqual([]);
    expect(s.snapshot().turn).toBe(0);
    expect(s.snapshot().requestsUsed).toBe(1); // the adapter was invoked once

    const callsBefore = h.adapterFor(id).calls.length;
    const usedBefore = s.snapshot().requestsUsed;
    const pre = new AbortController();
    pre.abort();
    expect(errorCode(await settle(s.send({ content: "never", signal: pre.signal })))).toBe("CANCELLED");
    expect(h.adapterFor(id).calls.length).toBe(callsBefore);
    expect(s.snapshot().requestsUsed).toBe(usedBefore);
    expect(s.state).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("AT-11b close() cancels in-flight work, is idempotent, and rejects later sends; closeAll() closes everything", async () => {
    vi.useFakeTimers();
    const h = makeRegistry({ gpt: { delayMs: 500 }, claude: { delayMs: 500 } });
    const a = h.registry.open(cfg({ provider: id, sessionId: "s-a" }));
    const b = h.registry.open(cfg({ provider: id, sessionId: "s-b", apiKeyRef: keyRef("B", id) }));
    const pa = settle(a.send({ content: "x" }));
    a.close();
    a.close();
    expect(errorCode(await pa)).toBe("CANCELLED");
    expect(a.state).toBe("closed");
    expect(errorCode(await settle(a.send({ content: "later" })))).toBe("SESSION_CLOSED");
    expect(() => a.remember("late note")).toThrowError(expect.objectContaining({ code: "SESSION_CLOSED" }));

    const pb = settle(b.send({ content: "y" }));
    h.registry.closeAll();
    expect(errorCode(await pb)).toBe("CANCELLED");
    expect(b.state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.snapshot().turn).toBe(0);
  });

  it("AT-19 a concurrent send rejects SESSION_BUSY immediately and the first still completes", async () => {
    vi.useFakeTimers();
    const h = makeRegistry({ gpt: { delayMs: 500 }, claude: { delayMs: 500 } });
    const s = h.registry.open(cfg({ provider: id }));
    const first = settle(s.send({ content: "first" }));
    const second = await settle(s.send({ content: "second" })); // no timers advanced
    expect(errorCode(second)).toBe("SESSION_BUSY");
    await vi.advanceTimersByTimeAsync(500);
    const done = await first;
    expect(done.ok && done.value.turn).toBe(1);
    expect(s.snapshot().history.map((m) => m.content)[0]).toBe("first");
    expect(s.snapshot().history).toHaveLength(2);
  });

  it("AT-19 provider errors map to codes and retryability and never touch history", async () => {
    const cases: Array<[number, string, boolean]> = [
      [503, "PROVIDER_ERROR", true],
      [429, "PROVIDER_ERROR", true],
      [400, "PROVIDER_ERROR", false],
      [401, "AUTH_FAILED", false],
    ];
    for (const [status, code, retryable] of cases) {
      const h = makeRegistry({ gpt: { failWithStatus: status }, claude: { failWithStatus: status } });
      const s = h.registry.open(cfg({ provider: id }));
      const result = await settle(s.send({ content: "x" }));
      expect(errorCode(result), `status ${status}`).toBe(code);
      expect(!result.ok && isSessionError(result.error) && result.error.retryable, `status ${status}`).toBe(retryable);
      expect(s.snapshot().history).toEqual([]);
      expect(s.snapshot().turn).toBe(0);
      expect(s.snapshot().usageTotal).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
  });

  it("AT-19 an empty or malformed reply is RESPONSE_INVALID and commits nothing", async () => {
    const blank = makeRegistry({ gpt: { script: () => ({ text: "" }) }, claude: { script: () => ({ text: "   " }) } });
    const s = blank.registry.open(cfg({ provider: id }));
    expect(errorCode(await settle(s.send({ content: "x" })))).toBe("RESPONSE_INVALID");
    expect(s.snapshot().history).toEqual([]);
    const badUsage = makeRegistry({
      gpt: { script: () => ({ text: "ok", usage: { inputTokens: -1, outputTokens: 1 } }) },
      claude: { script: () => ({ text: "ok", usage: { inputTokens: 1.5, outputTokens: 1 } }) },
    });
    const t = badUsage.registry.open(cfg({ provider: id }));
    expect(errorCode(await settle(t.send({ content: "x" })))).toBe("RESPONSE_INVALID");
    expect(t.snapshot().turn).toBe(0);
  });
});

describe("late reply is discarded when it wins the promise race (AI-001 review)", () => {
  /**
   * Deterministic microtask ordering: the adapter returns a thenable whose `then` fulfils the reply FIRST and aborts
   * the caller's signal immediately AFTER, in the same synchronous step. Promise.race therefore settles with the
   * (valid) reply, not the abort rejection; only the explicit `scope.cause()` check after the race can reject it.
   * Without that check this would commit history, a turn and usage for a call the caller already cancelled.
   */
  const lateAdapter = (inner: ProviderAdapter, controller: AbortController): ProviderAdapter => ({
    id: inner.id,
    allowedModels: inner.allowedModels,
    validateConfig: (c) => inner.validateConfig(c),
    complete: (req, _signal) =>
      ({
        then(resolve: (r: unknown) => void) {
          void inner.complete(req, new AbortController().signal).then((reply) => {
            resolve(reply); // reply wins the race...
            controller.abort("caller"); // ...and the abort lands in the same step
          });
        },
      }) as unknown as Promise<Awaited<ReturnType<ProviderAdapter["complete"]>>>,
  });

  it.each(providerCases())("($id) a valid reply that settles before the abort is handled is still discarded: CANCELLED, nothing committed", async ({ id, make }) => {
    const controller = new AbortController();
    const h = makeRegistry({ adapters: [lateAdapter(make({ script: () => ({ text: "too late", usage: { inputTokens: 5, outputTokens: 5 } }) }), controller)] });
    const s = h.registry.open(cfg({ provider: id }));
    const before = s.snapshot();
    const result = await settle(s.send({ content: "hi", signal: controller.signal }));
    expect(errorCode(result)).toBe("CANCELLED");
    const after = s.snapshot();
    expect(after.history).toEqual(before.history);
    expect(after.turn).toBe(0);
    expect(after.usageTotal).toEqual(before.usageTotal);
    expect(after.requestsUsed).toBe(1); // the adapter was invoked, so it still counts
    expect(s.state).toBe("idle");
  });
});
