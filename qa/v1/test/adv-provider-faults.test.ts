import { describe, expect, it } from "vitest";
import { createInMemoryCitizenSessionStore } from "@civ/cognition/routing";
import { caseTitle } from "../src/scenario.js";
import { installNoNetworkGuard, ONE_V_ONE, promptFor, registryFor, uniqueRunId } from "../src/fixture.js";

installNoNetworkGuard();

const FAST = ONE_V_ONE.map((a) => ({ ...a, timeoutMs: 80, maxRetries: 1 }));
const SLOW = ONE_V_ONE.map((a) => ({ ...a, timeoutMs: 5_000, maxRetries: 1 }));
type Fx = ReturnType<typeof registryFor>;
const sends = (fx: Fx, id: string) => (id === "gpt-a" ? fx.openai.calls.length : (fx.claude.get(id)?.calls.length ?? 0));
const outcomes = (fx: Fx, id: string) => fx.registry.evidenceLog().filter((e) => e.citizenId === id).map((e) => e.outcome);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const ceiling = (maxRequestsPerRun: number) => ({ maxConcurrency: 8, maxRequestsPerRun, spendAllowanceUsd: 1 });

describe("provider faults: mixed GPT and Claude under one shared ceiling", () => {
  it.each(["gpt-a", "claude-a"])(caseTitle("ADV-10", "%s request timeout fails that citizen only and records an honest outcome"), async (victim) => {
    const other = victim === "gpt-a" ? "claude-a" : "gpt-a";
    const fx = registryFor({ assignments: FAST, script: (c) => (c === victim ? { hang: true } : { goal: "gather_wood" }) });
    await expect(fx.registry.providerFor(victim).decide(promptFor(victim))).rejects.toBeDefined();
    const ok = await fx.registry.providerFor(other).decide(promptFor(other));
    expect(ok.goal).toBe("gather_wood");
    expect(outcomes(fx, victim).every((o) => o !== "decided")).toBe(true);
    expect(outcomes(fx, other)).toEqual(["decided"]);
  });

  it(caseTitle("ADV-10", "simultaneous 429 pressure on both families stays within each citizen's retry bound and the shared count"), async () => {
    const fx = registryFor({ assignments: FAST, script: () => ({ status: 429, retryAfterMs: 1 }), experiment: ceiling(100) });
    const results = await Promise.allSettled([
      fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a")),
      fx.registry.providerFor("claude-a").decide(promptFor("claude-a")),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    for (const id of ["gpt-a", "claude-a"]) expect(sends(fx, id)).toBeLessThanOrEqual(2); // 1 attempt + maxRetries 1
    expect(fx.registry.accounting().experiment.requestsUsed).toBe(sends(fx, "gpt-a") + sends(fx, "claude-a"));
  });

  // Red on any source without PR #42 (1a690f6): the retry is charged before its wait. Flip DEFECT off when integrated.
  it.fails.each(["gpt-a", "claude-a"])(caseTitle("ADV-10", "%s cancelled during Retry-After is not charged for a retry that was never sent", { defect: true }), async (id) => {
    const fx = registryFor({ assignments: SLOW, script: () => ({ status: 429, retryAfterMs: 4_000 }) });
    const p = fx.registry.providerFor(id).decide(promptFor(id));
    p.catch(() => undefined);
    await tick(80);
    expect(sends(fx, id)).toBe(1);
    fx.registry.providerFor(id).cancel();
    await expect(p).rejects.toBeDefined();
    expect(sends(fx, id)).toBe(1);
    const a = fx.registry.accounting().citizens[id]!;
    expect(a.requests, "requests charged must equal requests actually sent").toBe(1);
    expect(a.retries).toBe(0);
    expect(fx.registry.accounting().experiment.requestsUsed).toBe(1);
  });

  it(caseTitle("ADV-10", "the shared request ceiling is exact: request N+1 is refused unsent, whichever family asks"), async () => {
    const fx = registryFor({ experiment: ceiling(2) });
    await fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    await fx.registry.providerFor("claude-a").decide(promptFor("claude-a"));
    await expect(fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toBeDefined();
    await expect(fx.registry.providerFor("claude-a").decide(promptFor("claude-a"))).rejects.toBeDefined();
    expect(sends(fx, "gpt-a") + sends(fx, "claude-a")).toBe(2);
    expect(fx.registry.accounting().experiment.requestsUsed).toBe(2);
  });

  it(caseTitle("ADV-10", "repeated failures cannot exceed the approved request budget"), async () => {
    const fx = registryFor({ assignments: FAST, script: () => ({ status: 500 }), experiment: ceiling(3) });
    for (let i = 0; i < 6; i++) {
      await fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a")).catch(() => undefined);
      await fx.registry.providerFor("claude-a").decide(promptFor("claude-a")).catch(() => undefined);
    }
    expect(sends(fx, "gpt-a") + sends(fx, "claude-a")).toBeLessThanOrEqual(3);
    expect(fx.registry.accounting().experiment.requestsUsed).toBeLessThanOrEqual(3);
  });

  it.each([-5, Number.NaN, 1e12])(caseTitle("ADV-10", "an invalid Retry-After of %s neither hangs past the timeout nor retries without bound"), async (retryAfterMs) => {
    const fx = registryFor({ assignments: FAST, script: () => ({ status: 429, retryAfterMs }) });
    const started = Date.now();
    await expect(fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(sends(fx, "gpt-a")).toBeLessThanOrEqual(2);
  });

  it(caseTitle("ADV-10", "a reply that arrives after cancellation is not recorded as a decision and adds no second charge"), async () => {
    let release!: () => void;
    const late = new Promise<void>((r) => {
      release = r;
    });
    const fx = registryFor({ assignments: SLOW, script: () => ({ after: late, goal: "gather_wood" }) });
    const p = fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    p.catch(() => undefined);
    await tick(60);
    fx.registry.providerFor("gpt-a").cancel();
    release();
    await p.catch(() => undefined);
    await tick(40);
    expect(outcomes(fx, "gpt-a")).not.toContain("decided");
    expect(fx.registry.accounting().citizens["gpt-a"]!.requests).toBe(1);
  });
});

describe("usage honesty", () => {
  it.each(["gpt-a", "claude-a"])(caseTitle("ADV-11", "%s reply with unknown usage fails closed: no fabricated zero usage and the run's spend is held, not cleared"), async (id) => {
    const fx = registryFor({ script: () => ({ usage: null }) });
    await fx.registry.providerFor(id).decide(promptFor(id)).catch(() => undefined);
    const acct = fx.registry.accounting();
    const e = fx.registry.evidenceLog().find((x) => x.citizenId === id);
    // Whatever the outcome label, the record must not claim known-zero usage or a known cost.
    expect(e?.inputTokens ?? undefined).toBeUndefined();
    expect(e?.estimatedCostUsd ?? undefined).toBeUndefined();
    expect(acct.citizens[id]!.inputTokens).toBe(0);
    expect(acct.citizens[id]!.estimatedSpendUsd).toBe(0);
    expect(acct.citizens[id]!.unverifiedHoldUsd, "unknown usage must leave an unverified hold").toBeGreaterThan(0);
    expect(acct.experiment.closed, "an unmeasurable spend must stop further paid admissions").toBe(true);
  });

  it(caseTitle("ADV-11", "known usage is recorded as the reported counts per citizen, with model id and family"), async () => {
    const fx = registryFor({ script: (c) => ({ usage: c === "gpt-a" ? { input: 321, output: 12 } : { input: 77, output: 9 } }) });
    for (const id of ["gpt-a", "claude-a"]) await fx.registry.providerFor(id).decide(promptFor(id));
    const log = fx.registry.evidenceLog();
    expect(log.find((e) => e.citizenId === "gpt-a")).toMatchObject({ inputTokens: 321, outputTokens: 12, family: "gpt", model: "gpt-4o-mini" });
    expect(log.find((e) => e.citizenId === "claude-a")).toMatchObject({ inputTokens: 77, outputTokens: 9, family: "claude" });
  });
});

describe("restart", () => {
  it(caseTitle("ADV-08", "a restart with an unsettled in-flight reservation keeps it as an unverified hold and keeps the request count"), async () => {
    const sessions = createInMemoryCitizenSessionStore();
    const runId = uniqueRunId();
    const first = registryFor({ runId, store: sessions, assignments: SLOW, script: () => ({ hang: true }) });
    const inFlight = first.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    inFlight.catch(() => undefined);
    await tick(60);
    const mid = sessions.load("gpt-a");
    expect(mid?.account.requests).toBe(1);
    const reserved = mid!.account.reservedUsd;
    expect(reserved).toBeGreaterThan(0);
    // The process dies without settling anything; a second registry opens the same persisted store.
    const second = registryFor({ runId, store: sessions, assignments: FAST });
    const acct = second.registry.accounting().citizens["gpt-a"]!;
    expect(acct.requests).toBe(1);
    expect(acct.reservedUsd).toBe(0);
    expect(acct.unverifiedHoldUsd).toBeGreaterThanOrEqual(reserved);
    first.registry.closeAll();
    second.registry.closeAll();
  });

  it(caseTitle("ADV-08", "a new run id does not silently inherit another run's accounting for the same persisted citizen"), async () => {
    const sessions = createInMemoryCitizenSessionStore();
    const a = registryFor({ runId: uniqueRunId("run-a"), store: sessions });
    await a.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    a.registry.closeAll();
    const b = registryFor({ runId: uniqueRunId("run-b"), store: sessions });
    expect(b.registry.accounting().citizens["gpt-a"]!.requests).toBe(0);
  });
});
