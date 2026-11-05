import { afterEach, describe, expect, it, vi } from "vitest";
import { CivilizationStore } from "@civ/agent-core";
import { createInMemoryCitizenSessionStore, OFFLINE_2V2_ASSIGNMENTS } from "@civ/cognition/routing";
import { loadConfig } from "@civ/shared";
import { createIndependentOfflineRuntime } from "../../../apps/orchestrator/src/independent-offline-runtime.js";
import { caseTitle } from "../src/scenario.js";
import { AUDIT, installNoNetworkGuard } from "../src/fixture.js";

/**
 * Trust-boundary evidence for the offline composition root (PR #48, ae784fd). Authored by QA that also authored #48:
 * this is evidence for an independent reviewer, not an acceptance verdict.
 *
 * Trust model asserted here: the root removes the SUPPORTED route for injecting a model transport. It does not and
 * cannot sandbox in-process code: `script` and `createBody` are trusted TypeScript functions.
 */
const network = installNoNetworkGuard();
const stores: CivilizationStore[] = [];
const managers: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.stop().catch(() => undefined);
  for (const s of stores.splice(0)) if (s.isOpen()) s.close();
});

function args(over: Record<string, unknown> = {}) {
  const store = new CivilizationStore(":memory:");
  stores.push(store);
  const assignments = OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.citizenId.endsWith("-a")).map((a) => ({ ...a, citizenName: a.citizenName.replaceAll("-", "_") }));
  store.upsertCommunity("north", "North", AUDIT);
  store.upsertCommunity("south", "South", AUDIT);
  store.addCommunityMember("north", "gpt-a", AUDIT);
  store.addCommunityMember("south", "claude-a", AUDIT);
  const config = loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: "2", SIM_RUN_ID: "qa-boundary-run", LLM_ENABLED: "true", LLM_PROVIDER: "none", CLOUD_LLM_ENABLED: "false", CLOUD_MAX_CONCURRENCY: "4", HUMAN_DIRECTIVES_ENABLED: "false" });
  const resolveSecret = vi.fn((ref: { env: string }) => `synthetic-${ref.env}`);
  const createBody = vi.fn(() => {
    throw new Error("qa: no body is ever built in this test");
  });
  return {
    resolveSecret,
    createBody,
    value: { config, store, assignmentsJson: JSON.stringify(assignments), sessionStore: createInMemoryCitizenSessionStore(), resolveSecret, script: () => ({ goal: "gather_wood" }), createBody, ...over } as Parameters<typeof createIndependentOfflineRuntime>[0],
  };
}

describe("startup refusal", () => {
  it.each([
    ["fetchImpl", () => globalThis.fetch],
    ["claudeTransportFor", () => () => ({ paid: false })],
    ["allowPaidRequests", () => true],
    ["transport", () => ({})],
  ])(caseTitle("ADV-09", "an injected %s is refused before any secret is resolved or body created"), (key, make) => {
    const a = args({ [key]: make() });
    expect(() => createIndependentOfflineRuntime(a.value)).toThrow(/default-deny/);
    expect(a.resolveSecret).not.toHaveBeenCalled();
    expect(a.createBody).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it(caseTitle("ADV-09", "a missing run id, wrong citizen count and single-family roster are each refused before any secret or body"), () => {
    const base = args();
    const wrongRun = { ...base.value, config: { ...base.value.config, SIM_RUN_ID: undefined } } as typeof base.value;
    const oneFamily = { ...base.value, assignmentsJson: JSON.stringify(OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.family === "gpt")) };
    const wrongCount = { ...base.value, config: { ...base.value.config, SIM_CITIZEN_COUNT: 4 } } as typeof base.value;
    for (const bad of [wrongRun, oneFamily, wrongCount]) expect(() => createIndependentOfflineRuntime(bad)).toThrow();
    expect(base.resolveSecret).not.toHaveBeenCalled();
    expect(base.createBody).not.toHaveBeenCalled();
  });
});

describe("trust boundary: what the offline root does and does not prevent (evidence for an independent reviewer)", () => {
  it(caseTitle("ADV-14", "script is trusted code: a script that calls global fetch reaches it (the doc comment 'Data only' is inaccurate)"), async () => {
    const a = args({ script: () => { void fetch("https://api.openai.com/v1/responses").catch(() => undefined); return { goal: "gather_wood" }; } });
    const { openai } = createIndependentOfflineRuntime(a.value);
    await openai.fetchImpl("https://api.openai.com/v1/responses", { headers: { authorization: "Bearer synthetic-KEY_GPT_A" }, body: "{}", method: "POST" } as RequestInit).catch(() => undefined);
    // The guarded fetch spy was reached by the script. Nothing left the process only because the guard stubbed it.
    expect(network).toHaveBeenCalledTimes(1);
    network.mockClear();
  });

  it(caseTitle("ADV-14", "the supported route answers from the script and sends nothing: scripted GPT fetch makes no global fetch call"), async () => {
    const a = args();
    const { openai } = createIndependentOfflineRuntime(a.value);
    const res = await openai.fetchImpl("https://api.openai.com/v1/responses", { headers: { authorization: "Bearer synthetic-KEY_GPT_A" }, body: "{}", method: "POST" } as RequestInit);
    expect(res.status).toBe(200);
    expect(network).not.toHaveBeenCalled();
  });

  it(caseTitle("ADV-09", "unknown extra keys are ignored rather than refused (denylist), so a future spread of args would need its own guard"), () => {
    const outcomes: Record<string, boolean> = {};
    for (const key of ["fetch", "baseUrl", "openaiBaseUrl", "registry", "providerOverrides"]) {
      const a = args({ [key]: () => 0 });
      try {
        const r = createIndependentOfflineRuntime(a.value);
        managers.push(r.manager);
        outcomes[key] = false;
      } catch {
        outcomes[key] = true;
      }
    }
    // Current verified behaviour: none is refused, and none is read (the resolved registry still uses scripted doubles).
    expect(Object.values(outcomes)).toEqual([false, false, false, false, false]);
  });

  it(caseTitle("ADV-09", "an inherited forbidden property is refused (the check uses `in`, not own keys)"), () => {
    const a = args();
    const proto = { fetchImpl: globalThis.fetch };
    const inherited = Object.assign(Object.create(proto) as object, a.value) as typeof a.value;
    expect(() => createIndependentOfflineRuntime(inherited)).toThrow(/default-deny/);
  });

  it(caseTitle("ADV-09", "a forbidden key supplied through a getter is refused, and the getter is not left observing later reads"), () => {
    const a = args();
    let reads = 0;
    const withGetter = { ...a.value } as Record<string, unknown>;
    Object.defineProperty(withGetter, "fetchImpl", { enumerable: true, get: () => (reads++, globalThis.fetch) });
    expect(() => createIndependentOfflineRuntime(withGetter as typeof a.value)).toThrow(/default-deny/);
    expect(reads).toBe(0); // `in` does not invoke the getter, so a getter cannot have side effects here
  });

  it(caseTitle("ADV-09", "createBody is a trusted dependency: the root hands it options and neither restricts them nor wraps what it returns"), async () => {
    const seen: unknown[] = [];
    const a = args({ createBody: (o: unknown) => { seen.push(o); throw new Error("qa: no body"); } });
    const { manager } = createIndependentOfflineRuntime(a.value);
    managers.push(manager);
    await manager.start(undefined, { deferTicks: true }).catch(() => undefined);
    expect(seen.length).toBeGreaterThan(0);
    const keys = Object.keys(seen[0] as object);
    // Recorded for the reviewer: which connection-related options reach the factory. The test asserts the factory is
    // reached at all (so the root cannot claim to control sockets created inside it).
    expect(keys.length).toBeGreaterThan(0);
    console.log("QA-evidence createBody option keys:", JSON.stringify(keys));
    expect(network).not.toHaveBeenCalled();
  });
});
