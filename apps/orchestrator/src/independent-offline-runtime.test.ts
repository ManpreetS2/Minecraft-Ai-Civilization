import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CivilizationStore } from "@civ/agent-core";
import {
  OFFLINE_2V2_ASSIGNMENTS,
  createInMemoryCitizenSessionStore,
  createJsonFileCitizenSessionStore,
  type CitizenAssignment,
  type CitizenSessionStore,
} from "@civ/cognition/routing";
import { createMineflayerCraftFixture, createSharedCraftWorld } from "@civ/skills/testing";
import { createNavigationBackend, setNavigationBackend, type MinecraftBody, type NavigationBackend } from "@civ/minecraft-adapter";
import { createEvent, loadConfig, ok, type BodyObservation } from "@civ/shared";
import { createIndependentOfflineRuntime } from "./independent-offline-runtime.js";
type OfflineRuntime = ReturnType<typeof createIndependentOfflineRuntime>;
const managers: OfflineRuntime["manager"][] = [];
const stores: CivilizationStore[] = [];
const dirs: string[] = [];
const network = vi.fn(() => { throw new Error("real network forbidden"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.stop();
  for (const store of stores.splice(0)) if (store.isOpen()) store.close();
  setNavigationBackend(createNavigationBackend("pathfinder"));
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  expect(network).not.toHaveBeenCalled();
});
function fixture(count: 2 | 4 = 2, options: { databasePath?: string; sessionStore?: CitizenSessionStore; store?: CivilizationStore } = {}) {
  const store = options.store ?? new CivilizationStore(options.databasePath ?? ":memory:");
  if (!options.store) stores.push(store);
  const assignments = OFFLINE_2V2_ASSIGNMENTS.filter((a) => count === 4 || a.citizenId.endsWith("-a")).map((a) => ({ ...a, citizenName: a.citizenName.replaceAll("-", "_") }));
  const audit = { actor: "orchestrator-config" as const, reason: "disposable independent runtime fixture" };
  const directory = store.getCommunityDirectory();
  if (!directory.hasCommunity("north") || !directory.hasCommunity("south")) {
    store.upsertCommunity("north", "North", audit); store.upsertCommunity("south", "South", audit);
  }
  if (!store.getCommunityDirectory().communityOf("gpt-a")) store.addCommunityMember("north", "gpt-a", audit);
  if (!store.getCommunityDirectory().communityOf("claude-a")) store.addCommunityMember("south", "claude-a", audit);
  if (count === 4) {
    if (!store.getCommunityDirectory().communityOf("gpt-b")) store.addCommunityMember("south", "gpt-b", audit);
    if (!store.getCommunityDirectory().communityOf("claude-b")) store.addCommunityMember("north", "claude-b", audit);
  }
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
    config, store, assignmentsJson: JSON.stringify(assignments), sessionStore: options.sessionStore ?? createInMemoryCitizenSessionStore(), resolveSecret,
    script: (citizenId: string) => (citizenId.startsWith("gpt") ? { goal: "gather_wood" } : { goal: "craft_tools" }),
     createBody,
  } };
}

async function drainTicks(runtime: OfflineRuntime, store: CivilizationStore, steps = 3) {
  for (let step = 0; step < steps; step++) {
    await Promise.all(runtime.manager.list().map((c) => runtime.manager["tickCitizen"](c, store.getSettlement(), [], undefined)));
    await vi.waitFor(() => expect(runtime.manager.pendingOps()).toBe(0), { timeout: 20_000 });
  }
}

function sessionText(runtime: OfflineRuntime, assignment: CitizenAssignment): string {
  return assignment.family === "gpt"
    ? runtime.openai.calls.filter((call) => call.apiKey === `synthetic-${assignment.credential.env}`).map((call) => call.body).join("\n")
    : JSON.stringify(runtime.claude.get(assignment.citizenId)?.calls ?? []);
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

/**
 * OFF-17 (scripted offline 1v1) evidence lives here. Peer OFF-03…OFF-16 are separate ledger criteria, not
 * inherited by this suite. Codex's independent OFF-17 support covers limited scripted 1v1 only — not
 * process-crash recovery, not live survival. The late-callback case below is author tip evidence for
 * shutdown/pending-ops, distinct from Codex's limited OFF-17 scope. Provider session text across restart
 * requires the explicit session store; it is not claimed as automatic process-session durability.
 */
describe("scripted 1 GPT vs 1 Claude integrated offline 1v1", () => {
  it("starts identities, verifies survival, keeps secrets, restarts, and shuts down with no network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-offline-1v1-")); dirs.push(dir);
    const sessionStore = createJsonFileCitizenSessionStore(join(dir, "sessions.json"));
    const fx = fixture(2, { databasePath: join(dir, "offline.sqlite"), sessionStore });
    const first = createIndependentOfflineRuntime(fx.args); managers.push(first.manager);
    await first.manager.start(undefined, { deferTicks: true });

    const [gpt, claude] = fx.assignments;
    expect(fx.assignments.map((a) => [a.citizenId, a.family])).toEqual([["gpt-a", "gpt"], ["claude-a", "claude"]]);
    expect(first.manager.list().map((c) => c.record.id)).toEqual(["gpt-a", "claude-a"]);
    expect(first.manager.list().map((c) => c.record.minecraftUsername)).toEqual(["GPT_A", "Claude_A"]);
    expect(fx.store.getMeta("runId")).toBe("offline-composed-run");
    expect(fx.store.getCommunityDirectory().communityOf("gpt-a")).toBe("north");
    expect(fx.store.getCommunityDirectory().communityOf("claude-a")).toBe("south");
    expect(first.registry.providerFor("gpt-a").family).toBe("gpt");
    expect(first.registry.providerFor("claude-a").family).toBe("claude");
    expect(first.registry.providerFor("gpt-a").sessionId).not.toBe(first.registry.providerFor("claude-a").sessionId);
    for (const body of fx.bodies.values()) expect(body.totalItems()).toBe(0);

    for (const a of fx.assignments) {
      const secret = `1V1-PRIVATE-${a.citizenId}`;
      const event = createEvent("TaskCompleted", { summary: secret, visibility: { class: "actor_private" } }, a.citizenId);
      first.manager.events.emit(event);
      fx.store.addMemory({ id: `1v1-${a.citizenId}`, citizenId: a.citizenId, kind: "episodic", content: secret, importance: 1, createdAt: new Date().toISOString() }, { sourceEventId: event.id });
    }
    first.manager.events.emit(createEvent(
      "ConversationOccurred",
      { message: "NORTH-ONLY-PLAN", speakerId: "gpt-a", visibility: { class: "settlement_public", audience: { scope: "community", communityId: "north" } } },
      "gpt-a",
    ));

    await drainTicks(first, fx.store, 3);
    expect(fx.bodies.get("gpt-a")!.count("oak_log")).toBeGreaterThan(0);
    expect(fx.bodies.get("claude-a")!.count("wooden_pickaxe")).toBe(1);
    for (const body of fx.bodies.values()) {
      expect(body.count("sweet_berries")).toBe(1);
      expect(body.bot.food).toBe(9);
    }
    expect(first.manager.list().every((c) => c.lastPlan?.source === "llm")).toBe(true);
    expect(sessionText(first, gpt!)).toContain("1V1-PRIVATE-gpt-a");
    expect(sessionText(first, gpt!)).not.toContain("1V1-PRIVATE-claude-a");
    expect(sessionText(first, claude!)).toContain("1V1-PRIVATE-claude-a");
    expect(sessionText(first, claude!)).not.toContain("1V1-PRIVATE-gpt-a");
    expect(sessionText(first, gpt!)).toContain("NORTH-ONLY-PLAN");
    expect(sessionText(first, claude!)).not.toContain("NORTH-ONLY-PLAN");
    const gptSession = first.registry.providerFor("gpt-a").sessionId;
    const claudeSession = first.registry.providerFor("claude-a").sessionId;
    const spent = first.registry.accounting();
    expect(spent.experiment.requestsUsed).toBeGreaterThanOrEqual(2);
    expect(spent.citizens["gpt-a"]!.requests).toBeGreaterThanOrEqual(1);
    expect(spent.citizens["claude-a"]!.requests).toBeGreaterThanOrEqual(1);
    const inventories = [...fx.bodies].map(([id, body]) => [id, body.items.map((item) => ({ name: item.name, count: item.count }))]);

    await first.manager.stop();
    expect(first.manager.lastShutdownDrain()).toMatchObject({ fullyDrained: true, remaining: 0, timedOut: false });
    expect(first.manager.pendingOps()).toBe(0);
    expect(fx.store.isOpen()).toBe(false);
    expect(fx.store.safeWrite("appendEvent", () => { throw new Error("closed store must not run writes"); })).toEqual({ ok: false, reason: "closed" });
    await expect(first.manager.start(undefined, { deferTicks: true })).rejects.toThrow(/shutting down or after stop/);
    await expect(first.registry.providerFor("gpt-a").decide({ citizenName: "GPT_A", inventory: [], settlementNeeds: [], memories: [], nearbyCitizens: [] })).rejects.toMatchObject({ code: "CLOSED" });

    const resumedStore = new CivilizationStore(join(dir, "offline.sqlite")); stores.push(resumedStore);
    const second = createIndependentOfflineRuntime({ ...fx.args, store: resumedStore, sessionStore }); managers.push(second.manager);
    expect(second.registry.providerFor("gpt-a").sessionId).toBe(gptSession);
    expect(second.registry.providerFor("claude-a").sessionId).toBe(claudeSession);
    expect(second.registry.accounting().citizens["gpt-a"]!.requests).toBe(spent.citizens["gpt-a"]!.requests);
    expect(second.registry.accounting().citizens["claude-a"]!.estimatedSpendUsd).toBe(spent.citizens["claude-a"]!.estimatedSpendUsd);
    expect(resumedStore.getCommunityDirectory().communityOf("gpt-a")).toBe("north");
    expect(resumedStore.getCommunityDirectory().communityOf("claude-a")).toBe("south");
    expect(resumedStore.getCitizen("gpt-a")?.minecraftUsername).toBe("GPT_A");
    expect(resumedStore.getMemories("gpt-a").map((m) => m.content)).toContain("1V1-PRIVATE-gpt-a");
    expect(resumedStore.getMemories("claude-a").map((m) => m.content)).not.toContain("1V1-PRIVATE-gpt-a");

    await second.manager.start(undefined, { deferTicks: true });
    expect(second.manager.list().map((c) => c.record.id)).toEqual(["gpt-a", "claude-a"]);
    expect([...fx.bodies].map(([id, body]) => [id, body.items.map((item) => ({ name: item.name, count: item.count }))])).toEqual(inventories);
    await drainTicks(second, resumedStore, 1);
    expect(sessionText(second, gpt!)).toContain("1V1-PRIVATE-gpt-a");
    expect(sessionText(second, gpt!)).not.toContain("1V1-PRIVATE-claude-a");
    expect(sessionText(second, claude!)).toContain("1V1-PRIVATE-claude-a");
    expect(sessionText(second, claude!)).not.toContain("1V1-PRIVATE-gpt-a");
    expect(sessionText(second, claude!)).not.toContain("NORTH-ONLY-PLAN");
    expect(second.registry.accounting().citizens["gpt-a"]!.requests).toBeGreaterThan(spent.citizens["gpt-a"]!.requests);

    await second.manager.stop();
    expect(second.manager.lastShutdownDrain()).toMatchObject({ fullyDrained: true, remaining: 0, timedOut: false });
    expect(resumedStore.isOpen()).toBe(false);
    expect(network).not.toHaveBeenCalled();
  }, 60_000);

  it("a late cognition callback after shutdown cannot write closed SQLite or throw", async () => {
    let release!: (value: { goal: string; priority: number; reason: string; targetCitizenId: null; communication: null }) => void;
    const deferred = new Promise<{ goal: string; priority: number; reason: string; targetCitizenId: null; communication: null }>((resolve) => {
      release = resolve;
    });
    const fx = fixture(2);
    const runtime = createIndependentOfflineRuntime({
      ...fx.args,
      script: () => ({ after: deferred, goal: "gather_wood" }),
    });
    managers.push(runtime.manager);
    await runtime.manager.start(undefined, { deferTicks: true });
    // Arm one planning tick so a cognition decide() is in flight and waiting on `deferred`.
    await Promise.all(runtime.manager.list().map((c) => runtime.manager["tickCitizen"](c, fx.store.getSettlement(), [], undefined)));
    expect(runtime.manager.pendingOps()).toBeGreaterThan(0);

    const stopping = runtime.manager.stop();
    // Resolve the late provider reply only after stop has begun draining.
    release({ goal: "gather_wood", priority: 0.5, reason: "late after shutdown", targetCitizenId: null, communication: null });
    await stopping;

    expect(runtime.manager.lastShutdownDrain()).toMatchObject({ fullyDrained: true, remaining: 0, timedOut: false });
    expect(fx.store.isOpen()).toBe(false);
    expect(fx.store.safeWrite("late-llm", () => fx.store.setMeta("late-llm", "1"))).toEqual({ ok: false, reason: "closed" });
    expect(network).not.toHaveBeenCalled();
  }, 60_000);
});
