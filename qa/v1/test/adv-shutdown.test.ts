import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CivilizationStore } from "@civ/agent-core";
import { OFFLINE_2V2_ASSIGNMENTS, createInMemoryCitizenSessionStore } from "@civ/cognition/routing";
import { createMineflayerCraftFixture, createSharedCraftWorld } from "@civ/skills/testing";
import { createNavigationBackend, setNavigationBackend, type MinecraftBody, type NavigationBackend } from "@civ/minecraft-adapter";
import { loadConfig, ok, type BodyObservation } from "@civ/shared";
import { createIndependentOfflineRuntime } from "../../../apps/orchestrator/src/independent-offline-runtime.js";
import { caseTitle } from "../src/scenario.js";
import { AUDIT, installNoNetworkGuard } from "../src/fixture.js";

/**
 * ADV-07 shutdown/restart: a provider reply that completes AFTER the manager stopped and SQLite closed must not write to
 * the closed store, must not raise an unhandled rejection, and must not finalize twice. Controlled promises only; no
 * Paper, no provider, no timers beyond short settle delays.
 */
installNoNetworkGuard();
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  setNavigationBackend(createNavigationBackend("pathfinder"));
  vi.restoreAllMocks();
});

function build(late: Promise<unknown>) {
  const store = new CivilizationStore(":memory:");
  const assignments = OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.citizenId.endsWith("-a")).map((a) => ({ ...a, citizenName: a.citizenName.replaceAll("-", "_") }));
  store.upsertCommunity("north", "North", AUDIT);
  store.upsertCommunity("south", "South", AUDIT);
  store.addCommunityMember("north", "gpt-a", AUDIT);
  store.addCommunityMember("south", "claude-a", AUDIT);
  const config = loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: "2", SIM_RUN_ID: "qa-shutdown-run", LLM_ENABLED: "true", LLM_PROVIDER: "none", CLOUD_LLM_ENABLED: "false", LLM_COOLDOWN_MS: "1", CLOUD_MAX_CONCURRENCY: "4", HUMAN_DIRECTIVES_ENABLED: "false" });
  const shared = createSharedCraftWorld();
  const bodies = new Map(assignments.map((a, i) => [a.citizenId, createMineflayerCraftFixture({ sharedWorld: shared, start: { x: i * 30 + 0.5, y: 64, z: 0.5 }, trees: [{ x: i * 30 + 6, z: 3, height: 6 }] })] as const));
  const nav = { name: "qa-shutdown" } as NavigationBackend;
  for (const key of ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock", "followEntity", "escapeFrom", "probeReachability", "stop"] as const) {
    Object.assign(nav, { [key]: (bot: unknown, ...args: unknown[]) => Reflect.apply([...bodies.values()].find((f) => f.ctx.bot === bot)!.nav[key], [...bodies.values()].find((f) => f.ctx.bot === bot)!.nav, [bot, ...args]) });
  }
  setNavigationBackend(nav);
  const createBody = (options: ConstructorParameters<typeof MinecraftBody>[0]) => {
    const fx = bodies.get(options.citizenId!)!;
    return {
      connected: true, on: () => undefined, connect: async () => ok({}, 0), disconnect: async () => undefined, isDeceased: () => false, isAwaitingRespawn: () => false,
      getBot: () => fx.ctx.bot, inventory: () => fx.items, position: () => fx.bot.entity.position, nearbyEntities: () => [], nearbyPlayers: () => [], stopPathfinding: () => undefined,
      unreachable: { has: () => false, mark: () => undefined }, observe: (): BodyObservation => ({ username: options.username, connected: true, spawned: true, health: 20, food: fx.bot.food, position: fx.bot.entity.position, inventory: fx.items, nearby: [], players: [], gameTime: 1000, isNight: false }),
    } as unknown as MinecraftBody;
  };
  const { manager } = createIndependentOfflineRuntime({
    config, store, assignmentsJson: JSON.stringify(assignments), sessionStore: createInMemoryCitizenSessionStore(), resolveSecret: (ref) => `synthetic-${ref.env}`,
    // gpt-a's model reply stays pending until `late` settles; claude-a answers at once.
    script: (id) => (id === "gpt-a" ? { after: late, goal: "gather_wood" } : { goal: "craft_tools" }),
    createBody,
  });
  return { store, manager };
}

async function startWithOpenOperation(late: Promise<unknown>) {
  const { store, manager } = build(late);
  await manager.start(undefined, { deferTicks: true });
  const tickAll = manager.list().map((c) => manager["tickCitizen"](c, store.getSettlement(), [], undefined));
  void Promise.allSettled(tickAll);
  await tick(150);
  // Guard against a vacuous scenario: an asynchronous operation must really be open when shutdown begins.
  expect(manager.pendingOps(), "the delayed provider operation must be in flight before stop()").toBeGreaterThan(0);
  return { store, manager };
}

describe("shutdown with an in-flight asynchronous operation", () => {
  it(caseTitle("ADV-07", "a reply that completes after drain timeout and SQLite close writes nothing, raises nothing and finalizes once; repeated stop is safe"), async () => {
    let release!: () => void;
    const late = new Promise<void>((r) => { release = r; });
    const { store, manager } = await startWithOpenOperation(late);
    Object.assign((manager as unknown as { hooks: object }).hooks, { drainTimeoutMs: 50 });
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let stopped = 0;
    const append = store.appendEvent.bind(store);
    vi.spyOn(store, "appendEvent").mockImplementation((e) => { if (e.type === "SimulationStopped") stopped++; return append(e); });

    const stopping = manager.stop();
    await stopping;
    expect(store.isOpen(), "the store must be closed once stop() resolves").toBe(false);
    // Non-vacuity: the drain really timed out with the operation still pending when the store closed.
    expect((manager as unknown as { lastDrain?: { fullyDrained: boolean } }).lastDrain?.fullyDrained).toBe(false);

    // From here any database use is a write-after-close.
    const prepare = vi.spyOn(store.db, "prepare");
    release();
    await tick(200);
    expect(prepare, "a delayed completion touched the closed database").not.toHaveBeenCalled();
    expect(errors.filter((m) => /not open|closed/i.test(m)), "closed-store errors were logged").toEqual([]);
    expect(unhandled, "unhandled promise rejection").toEqual([]);

    // Repeated stop returns the same finalization and does not finalize again.
    expect(manager.stop()).toBe(stopping);
    await manager.stop();
    await manager.stop();
    expect(stopped, "SimulationStopped must be emitted at most once").toBeLessThanOrEqual(1);
    expect(prepare).not.toHaveBeenCalled();
  }, 30_000);

  it(caseTitle("ADV-07", "a reply that completes while draining is finalized before the store closes, with no error"), async () => {
    let release!: () => void;
    const late = new Promise<void>((r) => { release = r; });
    const { store, manager } = await startWithOpenOperation(late);
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    const stopping = manager.stop();
    setTimeout(release, 30);
    await stopping;
    expect(store.isOpen()).toBe(false);
    expect(manager.pendingOps()).toBe(0);
    await tick(100);
    expect(errors.filter((m) => /not open|closed/i.test(m))).toEqual([]);
    expect(unhandled).toEqual([]);
    await manager.stop();
  }, 30_000);

  it(caseTitle("ADV-07", "stop() twice concurrently shares one finalization even when called while operations are pending"), async () => {
    const { manager } = await startWithOpenOperation(Promise.resolve());
    const a = manager.stop();
    const b = manager.stop();
    expect(b).toBe(a);
    await a;
    expect(unhandled).toEqual([]);
  }, 30_000);

  it(caseTitle("ADV-07", "meta: the closed-database spy detects a write-after-close by a vulnerable completion"), async () => {
    const { store, manager } = await startWithOpenOperation(Promise.resolve());
    await manager.stop();
    const prepare = vi.spyOn(store.db, "prepare");
    expect(() => store.getSettlement()).toThrow();
    expect(() => expect(prepare).not.toHaveBeenCalled()).toThrow();
  }, 30_000);
});
