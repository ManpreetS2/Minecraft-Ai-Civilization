import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_2V2_ASSIGNMENTS, offlineRegistry } from "./offline-fixture.js";
import { createInMemoryCitizenSessionStore } from "./citizen-registry.js";
import type { CognitionPrompt } from "../schema.js";

/**
 * Fault injection across one GPT and one Claude citizen sharing a bounded spending gate. Real OpenAiResponsesProvider and
 * ClaudeMessagesProvider against scripted transports and an in-memory session store: no network, no real credentials.
 * Cases already proven in citizen-routing.test.ts are not repeated here.
 */
const prompt = (name: string): CognitionPrompt => ({
  citizenName: name,
  health: 20,
  hunger: 14,
  inventory: [],
  settlementNeeds: [],
  memories: [],
  nearbyCitizens: [],
});
const NAME = { "gpt-a": "GPT-A", "claude-a": "Claude-A", "gpt-b": "GPT-B", "claude-b": "Claude-B" } as const;
const networkGuard = vi.fn(() => {
  throw new Error("real network reached");
});
beforeEach(() => vi.stubGlobal("fetch", networkGuard));
afterEach(() => {
  vi.unstubAllGlobals();
  expect(networkGuard).not.toHaveBeenCalled();
});

/** Long deadline so a retry wait fits inside it. */
const patient = OFFLINE_2V2_ASSIGNMENTS.map((a) => ({ ...a, timeoutMs: 60_000, maxRetries: 2 }));

describe("cancellation during a retry wait", () => {
  it.each(["gpt-a", "claude-a"] as const)("%s: cancelling while waiting sends nothing more and does not charge a retry that never went out", async (id) => {
    let calls = 0;
    const { registry } = offlineRegistry({
      assignments: patient,
      retryBaseDelayMs: 5_000,
      script: () => (calls++ === 0 ? { status: 503 } : {}),
    });
    const session = registry.providerFor(id);
    const pending = session.decide(prompt(NAME[id]));
    pending.catch(() => undefined);
    await vi.waitFor(() => expect(calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    session.cancel();
    await expect(pending).rejects.toThrow();
    expect(calls).toBe(1);
    const { experiment, citizens } = registry.accounting();
    expect(experiment).toMatchObject({ inFlight: 0, reservedUsd: 0 });
    // The 503 may have been billed, so one attempt's bound stays held. The retry was never sent.
    expect(experiment.heldUsd).toBeGreaterThan(0);
    expect(citizens[id]).toMatchObject({ requests: 1, retries: 0 });
    expect(experiment.requestsUsed).toBe(1);
  });
});

describe("non-default service tier", () => {
  it("a GPT response on the flex tier closes the shared run for both families, and stays closed after a same-run restart", async () => {
    const store = createInMemoryCitizenSessionStore();
    const first = offlineRegistry({ store, script: (c) => (c === "gpt-a" ? { serviceTier: "flex" } : {}) });
    await expect(first.registry.providerFor("gpt-a").decide(prompt("GPT-A"))).rejects.toThrow(/service tier/);
    expect(first.registry.accounting().experiment.closed).toBe(true);
    await expect(first.registry.providerFor("claude-a").decide(prompt("Claude-A"))).rejects.toThrow();
    expect([...first.claude.values()].flatMap((t) => t.calls)).toEqual([]);
    first.registry.closeAll();

    const restarted = offlineRegistry({ store });
    expect(restarted.registry.accounting().experiment).toMatchObject({ closed: true });
    expect(restarted.registry.accounting().experiment.closedReason).toMatch(/service tier/);
    for (const id of ["gpt-a", "claude-a"] as const) await expect(restarted.registry.providerFor(id).decide(prompt(NAME[id]))).rejects.toThrow();
    expect(restarted.openai.calls).toEqual([]);
    expect([...restarted.claude.values()].flatMap((t) => t.calls)).toEqual([]);
  });
});

describe("mixed retries sharing one request ceiling", () => {
  it("GPT and Claude retrying together never send more requests than the run allows, and attribution sums to the total", async () => {
    const attempts: Record<string, number> = { "gpt-a": 0, "claude-a": 0 };
    const { registry, openai, claude } = offlineRegistry({
      assignments: patient,
      experiment: { maxConcurrency: 8, maxRequestsPerRun: 3, spendAllowanceUsd: 1 },
      script: (c) => {
        attempts[c] = (attempts[c] ?? 0) + 1;
        return { status: 503 };
      },
    });
    const results = await Promise.allSettled([
      registry.providerFor("gpt-a").decide(prompt("GPT-A")),
      registry.providerFor("claude-a").decide(prompt("Claude-A")),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const sent = openai.calls.length + [...claude.values()].reduce((n, t) => n + t.calls.length, 0);
    const { experiment, citizens } = registry.accounting();
    expect(sent).toBeLessThanOrEqual(3);
    expect(experiment.requestsUsed).toBeLessThanOrEqual(3);
    expect(citizens["gpt-a"]!.requests + citizens["claude-a"]!.requests).toBe(experiment.requestsUsed);
    expect(sent).toBe(experiment.requestsUsed);
    expect(experiment).toMatchObject({ inFlight: 0, reservedUsd: 0 });
  });
});

describe("a late reply after the run was closed", () => {
  it("is rejected for both families, and its billed usage is still charged exactly once", async () => {
    let release!: () => void;
    const late = new Promise<void>((resolve) => (release = resolve));
    const { registry } = offlineRegistry({ script: () => ({ after: late }) });
    const pending = (["gpt-a", "claude-a"] as const).map((id) => registry.providerFor(id).decide(prompt(NAME[id])));
    const settled = Promise.allSettled(pending);
    await vi.waitFor(() => expect(registry.accounting().experiment.inFlight).toBe(2));
    registry.closeAll();
    release();
    const results = await settled;
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    for (const r of results) expect((r as PromiseRejectedResult).reason.message).toMatch(/after it was cancelled/);
    const { experiment, citizens } = registry.accounting();
    expect(experiment).toMatchObject({ inFlight: 0, reservedUsd: 0, heldUsd: 0 });
    expect(experiment.spendUsd).toBeGreaterThan(0);
    expect(citizens["gpt-a"]!.estimatedSpendUsd + citizens["claude-a"]!.estimatedSpendUsd).toBeCloseTo(experiment.spendUsd, 10);
    expect(citizens["gpt-b"]).toMatchObject({ requests: 0, estimatedSpendUsd: 0 });
  });
});

describe("a crash during a retry wait", () => {
  it.each(["gpt-a", "claude-a"] as const)("%s: after restart the unresolved request stays held, the shared run keeps its totals, and the other family is unaffected", async (id) => {
    const store = createInMemoryCitizenSessionStore();
    let calls = 0;
    const first = offlineRegistry({ store, assignments: patient, retryBaseDelayMs: 60_000, script: () => (calls++ === 0 ? { status: 503 } : {}) });
    const pending = first.registry.providerFor(id).decide(prompt(NAME[id]));
    pending.catch(() => undefined);
    await vi.waitFor(() => expect(calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const persisted = first.registry.accounting();
    // The process dies here: nothing is closed, and no further write reaches the store.
    const restarted = offlineRegistry({ store });
    const after = restarted.registry.accounting();
    expect(after.experiment.requestsUsed).toBe(persisted.experiment.requestsUsed);
    expect(after.experiment.heldUsd + after.experiment.reservedUsd).toBeGreaterThanOrEqual(persisted.experiment.heldUsd);
    expect(after.experiment.inFlight).toBe(0);
    expect(after.citizens[id]!.requests).toBe(1);
    const other = id === "gpt-a" ? "claude-a" : "gpt-a";
    await expect(restarted.registry.providerFor(other).decide(prompt(NAME[other]))).resolves.toBeDefined();
    first.registry.providerFor(id).cancel();
  });
});
