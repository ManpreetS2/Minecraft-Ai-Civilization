import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineRegistry, OFFLINE_2V2_ASSIGNMENTS, type ScriptedReply } from "@civ/cognition/routing";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import { createEvent, loadConfig, ok, type BodyObservation } from "@civ/shared";
import { applyCommunityConfig } from "./community-config.js";
import { AgentManager } from "./manager.js";
import { CivilizationStore } from "./store.js";

/**
 * The real AgentManager tick and real SQLite, routed through the real citizen registry, with scripted provider replies.
 * The body and physical planner are stubbed. This is evidence about manager wiring, not about a live server or a live
 * provider. Communities deliberately mix families: family must not decide who hears what.
 */
vi.mock("./planner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./planner.js")>()),
  planCitizen: () => ({ task: "observe", goal: "offline", source: "planner", reason: "no physical action" }),
}));

const COMMUNITIES = [
  { id: "north", memberIds: ["gpt-a", "claude-a"] },
  { id: "south", memberIds: ["gpt-b", "claude-b"] },
];
const IDS = OFFLINE_2V2_ASSIGNMENTS.map((a) => a.citizenId);
const SEEDED = "2026-01-01T00:00:00.000Z";

class RoutedWorld {
  readonly store = new CivilizationStore(":memory:");
  readonly fixture: ReturnType<typeof offlineRegistry>;
  readonly manager: AgentManager;
  readonly citizens = new Map<string, ReturnType<AgentManager["list"]>[number]>();

  constructor(script: (citizen: string) => ScriptedReply = () => ({}), extraCitizens: string[] = []) {
    const config = loadConfig({
      DEMO_PROFILE: "none",
      LLM_PROVIDER: "none",
      LLM_ENABLED: "true",
      CLOUD_LLM_ENABLED: "false",
      LLM_COOLDOWN_MS: "1",
      DEMO_BULLETIN_TARGET_TOKENS: "400",
      HUMAN_DIRECTIVES_ENABLED: "false",
      COMMUNITIES_JSON: JSON.stringify(COMMUNITIES),
    });
    const roster = [...OFFLINE_2V2_ASSIGNMENTS.map((a) => [a.citizenId, a.citizenName] as const), ...extraCitizens.map((id) => [id, id] as const)];
    for (const [id, name] of roster) {
      this.store.upsertCitizen({ id, name, minecraftUsername: name, createdAt: SEEDED, status: "online" });
    }
    applyCommunityConfig(this.store, config);
    this.fixture = offlineRegistry({ script });
    this.manager = new AgentManager(config, this.store, { cognitionRouter: this.fixture.registry });
    const registry = (this.manager as unknown as { citizens: Map<string, unknown> }).citizens;
    for (const [id, name] of roster) {
      const body = {
        connected: true,
        isDeceased: () => false,
        isAwaitingRespawn: () => false,
        getBot: () => null,
        inventory: () => [],
        position: () => ({ x: 0, y: 64, z: 0 }),
        observe: (): BodyObservation => ({ username: name, connected: true, spawned: true, health: 20, food: 10, inventory: [], players: [], nearby: [] }),
        nearbyPlayers: () => [],
        whisperTo: (to: readonly string[]) => ok({ sent: [...to] }, 0),
        chat: async (message: string) => ok({ message }, 0),
        disconnect: async () => undefined,
        stopPathfinding: () => undefined,
      };
      const citizen = { record: this.store.getCitizen(id)!, body: body as unknown as MinecraftBody, busy: false, lastLlmAt: 0, lastChatAt: 0 };
      registry.set(id, citizen);
      this.citizens.set(id, citizen as never);
    }
  }

  tickOnly(id: string): Promise<void> {
    return this.manager["tickCitizen"](this.citizens.get(id)!, this.store.getSettlement(), ["NEED_WOOD", "NEED_STONE"], "build") as Promise<void>;
  }

  async tick(id: string): Promise<void> {
    await this.tickOnly(id);
    await vi.waitFor(() => expect(this.manager.pendingOps()).toBe(0));
  }

  sent(id: string): string {
    const assignment = OFFLINE_2V2_ASSIGNMENTS.find((a) => a.citizenId === id)!;
    return assignment.family === "gpt"
      ? this.fixture.openai.calls.filter((c) => c.apiKey === `synthetic-${assignment.credential.env}`).map((c) => c.body).join("\n")
      : JSON.stringify(this.fixture.claude.get(id)?.calls ?? []);
  }

  skips(): string[] {
    return this.store.listAllEventsForObserver().filter((e) => e.type === "LLMSkipped").map((e) => String(e.payload.error));
  }
}

const worlds: RoutedWorld[] = [];
const world = (...args: ConstructorParameters<typeof RoutedWorld>) => {
  const value = new RoutedWorld(...args);
  worlds.push(value);
  return value;
};
const networkGuard = vi.fn(() => {
  throw new Error("real network reached");
});
beforeEach(() => {
  vi.stubGlobal("fetch", networkGuard);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const value of worlds.splice(0)) if (value.store.isOpen()) value.store.close();
  expect(networkGuard).not.toHaveBeenCalled();
});

describe("AgentManager routes each citizen to its own session", () => {
  it("four citizens decide through four sessions, and each decision returns to its own citizen", async () => {
    const goals = { "gpt-a": "gather_food", "gpt-b": "gather_wood", "claude-a": "mine_stone", "claude-b": "explore" } as Record<string, string>;
    const w = world((c) => ({ goal: goals[c] }));
    for (const id of IDS) await w.tick(id);
    for (const id of IDS) {
      expect(w.sent(id)).toContain(`Citizen: ${OFFLINE_2V2_ASSIGNMENTS.find((a) => a.citizenId === id)!.citizenName}`);
      expect(w.citizens.get(id)!.pendingLlm?.goal).toBe(goals[id]);
      expect(w.fixture.registry.accounting().citizens[id]!.requests).toBe(1);
    }
    const providers = w.store.listAllEventsForObserver().filter((e) => e.type === "LLMDecisionMade");
    expect(new Set(providers.map((e) => e.citizenId))).toEqual(new Set(IDS));
    expect(providers.find((e) => e.citizenId === "claude-a")!.payload.provider).toBe("anthropic-messages");
    expect(providers.find((e) => e.citizenId === "gpt-b")!.payload.provider).toBe("openai-responses");
  });

  it("citizens think at the same time: one slow citizen does not stop the others starting", async () => {
    let release!: () => void;
    const after = new Promise<void>((resolve) => (release = resolve));
    const w = world((c) => (c === "gpt-a" ? { after } : {}));
    await w.tickOnly("gpt-a");
    for (const id of ["gpt-b", "claude-a", "claude-b"]) await w.tickOnly(id);
    await vi.waitFor(() => {
      for (const id of IDS) expect(w.fixture.registry.accounting().citizens[id]!.requests).toBe(1);
    });
    await w.tickOnly("gpt-a");
    expect(w.fixture.registry.accounting().citizens["gpt-a"]!.requests).toBe(1);
    release();
    await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
    // The second tick saw the pending decision and did not try again, rather than being refused as busy.
    expect(w.skips()).toEqual([]);
  });

  it("a real private observation reaches only its owner's session, through the store's gated reads", async () => {
    const w = world();
    for (const id of IDS) {
      const secret = `PRIVATE-OF-${id}`;
      const event = createEvent("TaskCompleted", { summary: secret, visibility: { class: "actor_private" } }, id);
      w.store.appendEvent(event);
      w.store.addMemory({ id: `m-${id}`, citizenId: id, kind: "episodic", content: secret, importance: 1, createdAt: new Date().toISOString() }, { sourceEventId: event.id });
    }
    for (const id of IDS) await w.tick(id);
    for (const reader of IDS) {
      for (const owner of IDS) {
        if (reader === owner) expect(w.sent(reader)).toContain(`PRIVATE-OF-${owner}`);
        else expect(w.sent(reader)).not.toContain(`PRIVATE-OF-${owner}`);
      }
    }
  });

  it("an announcement reaches its community across families, and no rival session of the same family", async () => {
    const w = world();
    const event = createEvent(
      "ConversationOccurred",
      { message: "NORTH-PLAN", speakerId: "gpt-a", visibility: { class: "settlement_public", audience: { scope: "community", communityId: "north" } } },
      "gpt-a",
    );
    w.store.appendEvent(event);
    for (const id of IDS) await w.tick(id);
    expect(w.sent("claude-a")).toContain("NORTH-PLAN");
    expect(w.sent("gpt-b")).not.toContain("NORTH-PLAN");
    expect(w.sent("claude-b")).not.toContain("NORTH-PLAN");
  });

  it("an unassigned citizen cannot think, and never borrows another provider", async () => {
    const w = world(undefined, ["stranger"]);
    await w.tick("stranger");
    expect(w.skips().join()).toMatch(/no provider assignment/);
    expect(w.citizens.get("stranger")!.pendingLlm).toBeUndefined();
    expect(w.fixture.openai.calls).toEqual([]);
    expect(w.fixture.registry.accounting().experiment.requestsUsed).toBe(0);
  });

  it("a timeout in one citizen is skipped for that citizen only, and it can think again", async () => {
    let fail = true;
    const w = world((c) => (c === "claude-a" && fail ? { status: 400 } : {}));
    await w.tick("claude-a");
    await w.tick("gpt-a");
    expect(w.skips()).toHaveLength(1);
    expect(w.citizens.get("gpt-a")!.pendingLlm).toBeDefined();
    fail = false;
    await w.tick("claude-a");
    expect(w.citizens.get("claude-a")!.pendingLlm).toBeDefined();
  });

  it("death cancels that citizen's pending decision, so a late reply cannot steer the respawned body", async () => {
    let release!: () => void;
    const after = new Promise<void>((resolve) => (release = resolve));
    const w = world((c) => (c === "gpt-a" ? { after, goal: "gather_wood" } : {}));
    await w.tickOnly("gpt-a");
    await vi.waitFor(() => expect(w.fixture.registry.accounting().experiment.inFlight).toBe(1));
    w.manager["handleBodyDied"](createEvent("CitizenBodyDied", {}, "gpt-a"));
    release();
    await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
    expect(w.citizens.get("gpt-a")!.pendingLlm).toBeUndefined();
    expect(w.skips().join()).toMatch(/after it was cancelled|aborted|cancelled/);
    await w.tick("gpt-b");
    expect(w.citizens.get("gpt-b")!.pendingLlm).toBeDefined();
  });

  it("stopping one citizen cancels only its decision", async () => {
    const w = world((c) => (c === "claude-b" ? { hang: true } : {}));
    await w.tickOnly("claude-b");
    await vi.waitFor(() => expect(w.fixture.registry.accounting().experiment.inFlight).toBe(1));
    w.manager.stopCitizen("claude-b");
    await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
    await w.tick("gpt-a");
    expect(w.citizens.get("gpt-a")!.pendingLlm).toBeDefined();
  });

  it("shutdown closes every session", async () => {
    const w = world();
    await w.tick("gpt-a");
    await w.manager.stop();
    for (const id of IDS) {
      await expect(w.fixture.registry.providerFor(id).decide({ citizenName: OFFLINE_2V2_ASSIGNMENTS.find((a) => a.citizenId === id)!.citizenName, inventory: [], settlementNeeds: [], memories: [], nearbyCitizens: [] })).rejects.toMatchObject({ code: "CLOSED" });
    }
  });

  it("without a router the manager keeps its existing single-provider path", async () => {
    const config = loadConfig({ DEMO_PROFILE: "none", LLM_PROVIDER: "none", LLM_ENABLED: "false", CLOUD_LLM_ENABLED: "false" });
    const store = new CivilizationStore(":memory:");
    const manager = new AgentManager(config, store);
    expect(manager["cognitionFor"]("anyone").name).toBe("heuristic");
    store.close();
  });
});
