import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CivilizationStore } from "@civ/agent-core";
import { OFFLINE_2V2_ASSIGNMENTS, createInMemoryCitizenSessionStore } from "@civ/cognition/routing";
import { createMineflayerCraftFixture, createSharedCraftWorld } from "@civ/skills/testing";
import { createNavigationBackend, setNavigationBackend, type MinecraftBody, type NavigationBackend } from "@civ/minecraft-adapter";
import { createEvent, loadConfig, ok, type BodyObservation } from "@civ/shared";
import { createIndependentOfflineRuntime } from "./independent-offline-runtime.js";
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

describe("independent offline composition and normal manager startup", () => {
  it.each([2, 4] as const)("normal start creates %i bodies and real planning executes routed survival choices", async (count) => {
    const fx = fixture(count);
    const { manager, registry, openai, claude } = createIndependentOfflineRuntime(fx.args); managers.push(manager);
    await manager.start(undefined, { deferTicks: true });
    expect(manager.list().map((c) => c.record.id)).toEqual(fx.assignments.map((a) => a.citizenId));
    expect(fx.createBody.mock.calls.map(([o]) => o.username)).toEqual(fx.assignments.map((a) => a.citizenName));
    for (const c of manager.list()) {
      const secret = `STARTUP-PRIVATE-${c.record.id}`;
      const event = createEvent("TaskCompleted", { summary: secret, visibility: { class: "actor_private" } }, c.record.id);
      manager.events.emit(event);
      fx.store.addMemory({ id: `startup-${c.record.id}`, citizenId: c.record.id, kind: "episodic", content: secret, importance: 1, createdAt: new Date().toISOString() }, { sourceEventId: event.id });
    }
    for (let step = 0; step < 3; step++) {
      await Promise.all(manager.list().map((c) => manager["tickCitizen"](c, fx.store.getSettlement(), [], undefined)));
      await vi.waitFor(() => expect(manager.pendingOps()).toBe(0), { timeout: 20_000 });
    }
    for (const a of fx.assignments) {
      const body = fx.bodies.get(a.citizenId)!;
      if (a.family === "gpt") expect(body.count("oak_log")).toBeGreaterThan(0);
      else expect(body.count("wooden_pickaxe")).toBe(1);
      const prompts = a.family === "gpt" ? openai.calls.filter((call) => call.apiKey === `synthetic-${a.credential.env}`).map((call) => call.body).join("\n") : JSON.stringify(claude.get(a.citizenId)?.calls);
      for (const other of fx.assignments) expect(prompts.includes(`STARTUP-PRIVATE-${other.citizenId}`)).toBe(a.citizenId === other.citizenId);
    }
    for (const body of fx.bodies.values()) expect(body.bot.food).toBe(9);
    expect(openai.calls.length).toBeGreaterThan(0); expect([...claude.values()].every((transport) => transport.calls.length > 0)).toBe(true);
    expect(claude.size).toBe(count / 2);
    expect(registry.evidenceLog().every((e) => e.runId === fx.store.getMeta("runId"))).toBe(true);
    expect(manager.list().every((c) => c.lastPlan?.source === "llm")).toBe(true);
  }, 30_000);

  it.each(["unknown-field", "duplicate-id", "invalid-username", "one-family", "missing-run", "wrong-count"])("refuses %s before resolving secrets or creating bodies", (kind) => {
    const fx = fixture();
    const assignments = fx.assignments.map((a) => ({ ...a }));
    let args = fx.args;
    if (kind === "unknown-field") args = { ...args, assignmentsJson: JSON.stringify(assignments.map((a) => ({ ...a, hiddenPermission: true }))) };
    if (kind === "duplicate-id") { assignments[1]!.citizenId = assignments[0]!.citizenId; args = { ...args, assignmentsJson: JSON.stringify(assignments) }; }
    if (kind === "invalid-username") { assignments[0]!.citizenName = "/tell @a"; args = { ...args, assignmentsJson: JSON.stringify(assignments) }; }
    if (kind === "one-family") { assignments[1]!.family = "gpt"; args = { ...args, assignmentsJson: JSON.stringify(assignments) }; }
    if (kind === "missing-run") args = { ...args, config: { ...args.config, SIM_RUN_ID: undefined } };
    if (kind === "wrong-count") args = { ...args, config: { ...args.config, SIM_CITIZEN_COUNT: 4 } };
    expect(() => createIndependentOfflineRuntime(args)).toThrow();
    expect(fx.resolveSecret).not.toHaveBeenCalled(); expect(fx.createBody).not.toHaveBeenCalled();
  });
  it("refuses a paid Claude transport factory outright, without sending or constructing bodies", () => {
    const fx = fixture();
    const send = vi.fn(async (): Promise<never> => { throw new Error("paid transport must not send"); });
    expect(() => createIndependentOfflineRuntime({ ...fx.args, claudeTransportFor: () => ({ paid: true, create: send }) } as never)).toThrow(/default-deny/);
    expect(send).not.toHaveBeenCalled();
    expect(fx.createBody).not.toHaveBeenCalled();
    expect(fx.resolveSecret).not.toHaveBeenCalled();
  });
});
