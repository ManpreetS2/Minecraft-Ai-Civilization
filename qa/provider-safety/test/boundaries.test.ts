import { createInMemoryCitizenSessionStore } from "@civ/cognition/routing";
import { afterEach, expect, it, vi } from "vitest";
import { createIndependentOfflineRuntime } from "../../../apps/orchestrator/src/independent-offline-runtime.js";
import { registryFor, promptFor, ONE_V_ONE, installNoNetworkGuard, sentBy } from "../../v1/src/fixture.js";
installNoNetworkGuard();
afterEach(() => vi.useRealTimers());

it.each([globalThis.fetch, globalThis.fetch.bind(globalThis), (...a: Parameters<typeof fetch>) => fetch(...a), () => ({ paid: false })])("rejects transport capabilities before reading malformed initialization", (transport) => {
  const secret = vi.fn();
  const args = Object.create({ fetchImpl: transport });
  Object.assign(args, { config: null, resolveSecret: secret });
  expect(() => createIndependentOfflineRuntime(args)).toThrow(/default-deny/);
  expect(secret).not.toHaveBeenCalled();
});

it("cancel immediately before the retry deadline leaves one sent request", async () => {
  vi.useFakeTimers();
  const fx = registryFor({ assignments: ONE_V_ONE.map(a => ({ ...a, timeoutMs: 5000, maxRetries: 1 })), script: () => ({ status: 429, retryAfterMs: 1000 }) });
  const pending = fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a")).catch(() => undefined);
  await vi.advanceTimersByTimeAsync(999);
  fx.registry.providerFor("gpt-a").cancel();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(fx.openai.calls).toHaveLength(1);
  expect(fx.registry.accounting().citizens["gpt-a"]).toMatchObject({ requests: 1, retries: 0 });
  fx.registry.closeAll();
});

it.each([{ input: -1, output: 3 }, { input: 1.5, output: 2 }])("malformed GPT usage preserves unknown spend hold: %j", async usage => {
  const fx = registryFor({ script: () => ({ usage }) });
  await fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a")).catch(() => undefined);
  const account = fx.registry.accounting();
  expect(account.citizens["gpt-a"]!.unverifiedHoldUsd).toBeGreaterThan(0);
  expect(account.experiment.closed).toBe(true);
  fx.registry.closeAll();
});

it("run shutdown rejects both late responses without leaking citizen memory", async () => {
  let release!: () => void;
  const after = new Promise<void>(r => { release = r; });
  const fx = registryFor({ script: () => ({ after }) });
  const pending = ONE_V_ONE.map(a => fx.registry.providerFor(a.citizenId).decide(promptFor(a.citizenId, [`private-${a.citizenId}`])).catch(() => undefined));
  await new Promise(r => setTimeout(r, 20));
  fx.registry.closeAll();
  release();
  await Promise.all(pending);
  expect(fx.registry.evidenceLog().some(e => e.outcome === "decided")).toBe(false);
  expect(fx.registry.accounting().experiment.requestsUsed).toBe(2);
  const sent = sentBy(fx);
  expect(sent["gpt-a"]).not.toContain("private-claude-a");
  expect(sent["claude-a"]).not.toContain("private-gpt-a");
  for (const id of ["gpt-a", "claude-a"]) expect(fx.registry.accounting().citizens[id]!.reservedUsd).toBe(0);
});

it("zero shared admission budget refuses both families without sending", async () => {
  const fx = registryFor({ experiment: { maxConcurrency: 2, maxRequestsPerRun: 0, spendAllowanceUsd: 1 } });
  await Promise.all(ONE_V_ONE.map(a => fx.registry.providerFor(a.citizenId).decide(promptFor(a.citizenId)).catch(() => undefined)));
  expect(fx.openai.calls).toHaveLength(0);
  expect([...fx.claude.values()].flatMap(t => t.calls)).toHaveLength(0);
  expect(fx.registry.accounting().experiment.requestsUsed).toBe(0);
  fx.registry.closeAll();
});

it("restart rejects a changed provider attribution before any new transport invocation", async () => {
  const store = createInMemoryCitizenSessionStore();
  const first = registryFor({ store, runId: "attribution" });
  await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
  first.registry.closeAll();
  const record = store.load("gpt-a")!;
  record.family = "claude";
  store.save(record);
  expect(() => registryFor({ store, runId: "attribution" })).toThrow(/refusing to continue/);
});
