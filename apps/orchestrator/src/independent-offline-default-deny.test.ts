import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CivilizationStore } from "@civ/agent-core";
import { OFFLINE_2V2_ASSIGNMENTS, createInMemoryCitizenSessionStore, createScriptedOpenAiFetch } from "@civ/cognition/routing";
import { createMineflayerCraftFixture, createSharedCraftWorld } from "@civ/skills/testing";
import { createNavigationBackend, setNavigationBackend, type MinecraftBody, type NavigationBackend } from "@civ/minecraft-adapter";
import { loadConfig, ok, type BodyObservation } from "@civ/shared";
import { createIndependentOfflineRuntime } from "./independent-offline-runtime.js";

/**
 * Default-deny regression for the offline composition root. Originally the failing reproduction from QA PR #46: any
 * injected function was accepted as the GPT network transport. Nothing here sends a request; the global fetch is a spy
 * that must stay uncalled, and the Vitest network guard backs that up.
 */
// The real fetch as the test setup installed it, before this file stubs it.
const realFetchReference = globalThis.fetch;
const managers: ReturnType<typeof createIndependentOfflineRuntime>["manager"][] = [];
const stores: CivilizationStore[] = [];
const network = vi.fn(() => { throw new Error("real network forbidden"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.stop();
  for (const store of stores.splice(0)) if (store.isOpen()) store.close();
  setNavigationBackend(createNavigationBackend("pathfinder"));
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});
function fixture(count: 2 | 4 = 2) {
  const store = new CivilizationStore(":memory:"); stores.push(store);
  const assignments = OFFLINE_2V2_ASSIGNMENTS.filter((a) => count === 4 || a.citizenId.endsWith("-a")).map((a) => ({ ...a, citizenName: a.citizenName.replaceAll("-", "_") }));
  const audit = { actor: "orchestrator-config" as const, reason: "disposable independent runtime fixture" };
  store.upsertCommunity("north", "North", audit); store.upsertCommunity("south", "South", audit);
  store.addCommunityMember("north", "gpt-a", audit); store.addCommunityMember("south", "claude-a", audit);
  if (count === 4) { store.addCommunityMember("south", "gpt-b", audit); store.addCommunityMember("north", "claude-b", audit); }
  const config = loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: String(count), SIM_RUN_ID: "offline-composed-run", LLM_ENABLED: "true", LLM_PROVIDER: "none", CLOUD_LLM_ENABLED: "false", LLM_COOLDOWN_MS: "1", CLOUD_MAX_CONCURRENCY: "4", HUMAN_DIRECTIVES_ENABLED: "false" });
  const shared = createSharedCraftWorld();
  const bodies = new Map(assignments.map((a, i) => {
    const fx = createMineflayerCraftFixture({ sharedWorld: shared, start: { x: i * 30 + 0.5, y: 64, z: 0.5 }, trees: [{ x: i * 30 + 6, z: 3, height: 6 }] });
    shared.blocks.set(`${i * 30 + 3},64,3`, "sweet_berry_bush"); fx.bot.food = 7;
    return [a.citizenId, fx] as const;
  }));
  const nav = { name: "composed-offline" } as NavigationBackend;
  for (const key of ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock", "followEntity", "escapeFrom", "probeReachability", "stop"] as const) Object.assign(nav, { [key]: (bot: unknown, ...args: unknown[]) => {
    const fx = [...bodies.values()].find((f) => f.ctx.bot === bot);
    if (!fx) throw new Error("unknown offline bot");
    return Reflect.apply(fx.nav[key], fx.nav, [bot, ...args]);
  } });
  setNavigationBackend(nav);
  const resolveSecret = vi.fn((ref: { env: string }) => `synthetic-${ref.env}`);
  const createBody = vi.fn((options: ConstructorParameters<typeof MinecraftBody>[0]) => {
    const fx = bodies.get(options.citizenId!)!;
    return {
      connected: true, on: () => undefined, connect: async () => ok({}, 0), disconnect: async () => undefined,
      isDeceased: () => false, isAwaitingRespawn: () => false, getBot: () => fx.ctx.bot,
      inventory: () => fx.items, position: () => fx.bot.entity.position,
      nearbyEntities: () => [], nearbyPlayers: () => [], stopPathfinding: () => undefined,
      unreachable: { has: () => false, mark: () => undefined },
      observe: (): BodyObservation => ({ username: options.username, connected: true, spawned: true, health: 20, food: fx.bot.food, position: fx.bot.entity.position, inventory: fx.items, nearby: [], players: [], gameTime: 1000, isNight: false }),
    } as unknown as MinecraftBody;
  });
  return { store, assignments, bodies, resolveSecret, createBody, args: {
    config, store, assignmentsJson: JSON.stringify(assignments), sessionStore: createInMemoryCitizenSessionStore(), resolveSecret,
    script: (citizenId: string) => (citizenId.startsWith("gpt") ? { goal: "gather_wood" } : { goal: "craft_tools" }),
     createBody,
  } };
}


type Args = Parameters<typeof createIndependentOfflineRuntime>[0];
const withInjected = (args: Args, extra: Record<string, unknown>) => ({ ...args, ...extra }) as unknown as Args;
const REFUSAL = /default-deny/;

describe("offline composition is default-deny for model transports", () => {
  const liveShapes: Array<[string, () => unknown]> = [
    ["direct real fetch", () => realFetchReference],
    ["bound real fetch", () => realFetchReference.bind(globalThis)],
    ["wrapped real fetch", () => (...a: Parameters<typeof fetch>) => realFetchReference(...a)],
    ["wrapper that ignores the URL", () => async () => new Response("{}")],
    ["a double-wrapped bound wrapper", () => ((f: typeof fetch) => (...a: Parameters<typeof fetch>) => f(...a))(realFetchReference.bind(globalThis))],
    ["a scripted double built outside", () => createScriptedOpenAiFetch(() => ({})).fetchImpl],
    ["a non-function value", () => "https://api.openai.com/v1"],
    ["undefined (the key is still present)", () => undefined],
  ];
  it.each(liveShapes)("refuses %s before resolving secrets, creating bodies or sending anything", (_name, make) => {
    const fx = fixture();
    expect(() => createIndependentOfflineRuntime(withInjected(fx.args, { fetchImpl: make() }))).toThrow(REFUSAL);
    expect(fx.resolveSecret).not.toHaveBeenCalled();
    expect(fx.createBody).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["claudeTransportFor", "allowPaidRequests", "transport"])("refuses the injected key '%s'", (key) => {
    const fx = fixture();
    const create = vi.fn(async (): Promise<never> => { throw new Error("must never send"); });
    const value = key === "allowPaidRequests" ? true : () => ({ paid: false, create });
    expect(() => createIndependentOfflineRuntime(withInjected(fx.args, { [key]: value }))).toThrow(REFUSAL);
    expect(create).not.toHaveBeenCalled();
    expect(fx.resolveSecret).not.toHaveBeenCalled();
    expect(fx.createBody).not.toHaveBeenCalled();
  });

  it("refuses a missing or non-function script, because there is then no transport to build", () => {
    const fx = fixture();
    for (const script of [undefined, null, "reply", {}]) {
      expect(() => createIndependentOfflineRuntime(withInjected(fx.args, { script }))).toThrow(REFUSAL);
    }
    expect(fx.resolveSecret).not.toHaveBeenCalled();
    expect(fx.createBody).not.toHaveBeenCalled();
  });

  it("a refused call leaves nothing running: a valid call afterwards still starts normally", async () => {
    const fx = fixture();
    expect(() => createIndependentOfflineRuntime(withInjected(fx.args, { fetchImpl: realFetchReference }))).toThrow(REFUSAL);
    const { manager } = createIndependentOfflineRuntime(fx.args);
    managers.push(manager);
    await manager.start(undefined, { deferTicks: true });
    expect(manager.list()).toHaveLength(2);
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["wrong-count", "missing-run", "one-family"] as const)("a roster refused for %s builds no transport, resolves no secret and never calls the script", (kind) => {
    const fx = fixture();
    const script = vi.fn(fx.args.script);
    let args: Args = { ...fx.args, script };
    if (kind === "wrong-count") args = { ...args, config: { ...args.config, SIM_CITIZEN_COUNT: 4 } };
    if (kind === "missing-run") args = { ...args, config: { ...args.config, SIM_RUN_ID: undefined } };
    if (kind === "one-family") args = { ...args, assignmentsJson: JSON.stringify(fx.assignments.map((a) => ({ ...a, family: "gpt" }))) };
    expect(() => createIndependentOfflineRuntime(args)).toThrow();
    expect(script).not.toHaveBeenCalled();
    expect(fx.resolveSecret).not.toHaveBeenCalled();
    expect(fx.createBody).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});

describe("valid scripted runtimes still work", () => {
  it.each([2, 4] as const)("%i citizens: GPT and Claude are answered from the script and nothing else is touched", async (count) => {
    const fx = fixture(count);
    const { manager, registry, openai, claude } = createIndependentOfflineRuntime(fx.args);
    managers.push(manager);
    await manager.start(undefined, { deferTicks: true });
    for (let step = 0; step < 3; step++) {
      await Promise.all(manager.list().map((c) => manager["tickCitizen"](c, fx.store.getSettlement(), [], undefined)));
      await vi.waitFor(() => expect(manager.pendingOps()).toBe(0), { timeout: 20_000 });
    }
    expect(openai.calls.length).toBeGreaterThan(0);
    expect(openai.calls.every((c) => c.url === "https://api.openai.com/v1/responses")).toBe(true);
    expect(claude.size).toBe(count / 2);
    expect([...claude.values()].every((t) => t.calls.length > 0)).toBe(true);
    expect(registry.accounting().experiment.closed).toBe(false);
    // Each citizen's reply came from the script entry for that citizen.
    for (const a of fx.assignments) {
      const lastPlan = manager.list().find((c) => c.record.id === a.citizenId)?.lastPlan;
      expect(lastPlan?.source).toBe("llm");
    }
    expect(network).not.toHaveBeenCalled();
  }, 40_000);

  it("a scripted failure is reported as that citizen's failure, not retried onto a network", async () => {
    const fx = fixture();
    const script = vi.fn((citizenId: string) => (citizenId === "gpt-a" ? { status: 500 } : { goal: "craft_tools" }));
    const { manager, openai } = createIndependentOfflineRuntime({ ...fx.args, script });
    managers.push(manager);
    await manager.start(undefined, { deferTicks: true });
    await Promise.all(manager.list().map((c) => manager["tickCitizen"](c, fx.store.getSettlement(), [], undefined)));
    await vi.waitFor(() => expect(manager.pendingOps()).toBe(0), { timeout: 20_000 });
    expect(openai.calls.every((c) => c.url.startsWith("https://api.openai.com/"))).toBe(true);
    expect(script).toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  }, 40_000);
});
