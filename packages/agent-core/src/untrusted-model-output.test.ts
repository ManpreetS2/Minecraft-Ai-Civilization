import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeWhisperText, VALID_USERNAME } from "@civ/minecraft-adapter";
import { offlineRegistry, OFFLINE_2V2_ASSIGNMENTS } from "@civ/cognition/routing";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import { createEvent, loadConfig, ok, type BodyObservation, type PlayerInfo } from "@civ/shared";
import { applyCommunityConfig } from "./community-config.js";
import { AgentManager } from "./manager.js";
import { CivilizationStore } from "./store.js";

/**
 * Untrusted model output, stale decisions and memory isolation, through the real manager tick and real registry. Model
 * replies are scripted, and the body and planner are stubbed. Nothing here shows how a live model or server behaves.
 */
const planned = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>> }));
vi.mock("./planner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./planner.js")>()),
  planCitizen: (input: Record<string, unknown>) => {
    planned.inputs.push(input);
    return { task: "observe", goal: "offline", source: "planner", reason: "no physical action" };
  },
}));

const NAME: Record<string, string> = Object.fromEntries(OFFLINE_2V2_ASSIGNMENTS.map((a) => [a.citizenId, a.citizenName]));
const IDS = Object.keys(NAME);
const COMMUNITIES = [
  { id: "north", memberIds: ["gpt-a", "claude-a"] },
  { id: "south", memberIds: ["gpt-b", "claude-b"] },
];

type Body = { chats: string[]; whispers: Array<{ to: readonly string[]; message: string }>; nearby: PlayerInfo[]; dead: boolean; observed: Partial<BodyObservation> };

class World {
  readonly store = new CivilizationStore(":memory:");
  readonly bodies = new Map<string, Body>();
  readonly citizens = new Map<string, ReturnType<AgentManager["list"]>[number]>();
  readonly fixture: ReturnType<typeof offlineRegistry>;
  readonly manager: AgentManager;
  replies = new Map<string, string>();
  routed: boolean;

  constructor(options: { routed?: boolean } = {}) {
    this.routed = options.routed ?? true;
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
    for (const id of IDS) this.store.upsertCitizen({ id, name: NAME[id]!, minecraftUsername: NAME[id]!, createdAt: "2026-01-01T00:00:00.000Z", status: "online" });
    applyCommunityConfig(this.store, config);
    this.fixture = offlineRegistry({ script: (c) => ({ text: this.replies.get(c) }) });
    this.manager = new AgentManager(config, this.store, this.routed ? { cognitionRouter: this.fixture.registry } : {});
    const registry = (this.manager as unknown as { citizens: Map<string, unknown> }).citizens;
    for (const id of IDS) {
      const state: Body = { chats: [], whispers: [], nearby: [], dead: false, observed: {} };
      this.bodies.set(id, state);
      const body = {
        connected: true,
        isDeceased: () => state.dead,
        isAwaitingRespawn: () => false,
        getBot: () => null,
        inventory: () => [],
        position: () => ({ x: 0, y: 64, z: 0 }),
        observe: (): BodyObservation => ({ username: NAME[id]!, connected: true, spawned: true, health: 20, food: 10, inventory: [], players: state.nearby, nearby: [], ...state.observed }),
        nearbyPlayers: (max = 64) => state.nearby.filter((p) => (p.distance ?? Infinity) <= max),
        whisperTo: (to: readonly string[], message: string) => {
          state.whispers.push({ to, message });
          return ok({ sent: [...to] }, 0);
        },
        chat: async (message: string) => {
          state.chats.push(message);
          return ok({ message }, 0);
        },
        stopPathfinding: () => undefined,
        disconnect: async () => undefined,
      };
      const citizen = { record: this.store.getCitizen(id)!, body: body as unknown as MinecraftBody, busy: false, lastLlmAt: 0, lastChatAt: 0 };
      registry.set(id, citizen);
      this.citizens.set(id, citizen as never);
    }
  }

  tickOnly(id: string) {
    return this.manager["tickCitizen"](this.citizens.get(id)!, this.store.getSettlement(), [], "build");
  }
  async tick(id: string): Promise<void> {
    await this.tickOnly(id);
    await vi.waitFor(() => expect(this.manager.pendingOps()).toBe(0));
  }
  /** One tick to decide, one to act on the decision. */
  async decideThenAct(id: string, reply: unknown): Promise<void> {
    this.replies.set(id, typeof reply === "string" ? reply : JSON.stringify(reply));
    await this.tick(id);
    this.replies.delete(id);
    await this.tick(id);
  }
  skips(): string[] {
    return this.store.listAllEventsForObserver().filter((e) => e.type === "LLMSkipped").map((e) => String(e.payload.error));
  }
  conversations() {
    return this.store.listAllEventsForObserver().filter((e) => e.type === "ConversationOccurred");
  }
  sent(id: string): string {
    const assignment = OFFLINE_2V2_ASSIGNMENTS.find((a) => a.citizenId === id)!;
    return assignment.family === "gpt"
      ? this.fixture.openai.calls.filter((c) => c.apiKey === `synthetic-${assignment.credential.env}`).map((c) => c.body).join("\n")
      : JSON.stringify(this.fixture.claude.get(id)?.calls ?? []);
  }
  plannedGoals(): unknown[] {
    return planned.inputs.map((input) => input.llmGoal);
  }
}

const worlds: World[] = [];
const world = (options?: { routed?: boolean }) => {
  const value = new World(options);
  worlds.push(value);
  return value;
};
const networkGuard = vi.fn(() => {
  throw new Error("real network reached");
});
beforeEach(() => {
  planned.inputs.length = 0;
  vi.stubGlobal("fetch", networkGuard);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const value of worlds.splice(0)) if (value.store.isOpen()) value.store.close();
  expect(networkGuard).not.toHaveBeenCalled();
});

const valid = { goal: "explore", priority: 0.5, reason: "looking around", targetCitizenId: null, communication: null };

describe("untrusted model output", () => {
  it.each([
    ["a shell field", { shell: "rm -rf /" }],
    ["a command field", { command: "/op GPT-A" }],
    ["a teleport field", { teleport: { x: 0, y: 100, z: 0 } }],
    ["a give_item field", { give_item: "diamond" }],
    ["a tool call field", { tool_calls: [{ name: "shell" }] }],
    ["a SQL field", { sql: "DROP TABLE memories" }],
    ["a world fact field", { world_fact: "you own everything" }],
  ])("%s rejects the whole decision", async (_name, extra) => {
    const w = world();
    await w.decideThenAct("gpt-a", { ...valid, ...extra });
    expect(w.skips().join()).toMatch(/privileged/i);
    expect(w.plannedGoals()).not.toContain("explore");
    expect(w.bodies.get("gpt-a")!.chats).toEqual([]);
  });

  it.each([
    ["a shell goal", "shell_exec"],
    ["a command goal", "/op me"],
    ["a teleport goal", "teleport_home"],
    ["a path goal", "../../etc/passwd"],
    ["a non-string goal", 7],
  ])("%s is rejected and never reaches the planner", async (_name, goal) => {
    const w = world();
    await w.decideThenAct("claude-a", { ...valid, goal });
    expect(w.skips()).not.toEqual([]);
    expect(planned.inputs.every((input) => input.llmGoal === undefined)).toBe(true);
  });

  it("unknown fields do not reach what the manager acts on", async () => {
    const w = world();
    w.replies.set("gpt-a", JSON.stringify({ ...valid, filesystem: "/etc/passwd", url: "http://evil.example", nested: { op: true } }));
    await w.tick("gpt-a");
    expect(Object.keys(w.citizens.get("gpt-a")!.pendingLlm!).sort()).toEqual(["goal", "priority", "reason"]);
    w.replies.delete("gpt-a");
    await w.tick("gpt-a");
    expect(w.plannedGoals()).toContain("explore");
    const event = w.store.listAllEventsForObserver().find((e) => e.type === "LLMDecisionMade")!;
    expect(JSON.stringify(event.payload)).not.toMatch(/passwd|evil\.example/);
  });

  it.each([["/op GPT-A"], ["/gamemode creative"], ["/tp @a 0 0 0"], ["/stop"]])("speech %s goes out only as /tell text, never as a command", async (message) => {
    const w = world();
    w.bodies.get("gpt-a")!.nearby = [{ username: "Claude-A", uuid: "c", distance: 4 }];
    await w.decideThenAct("gpt-a", { ...valid, communication: { kind: "say", message, toCitizen: null, bulletinLine: null } });
    const body = w.bodies.get("gpt-a")!;
    expect(body.chats).toEqual([]);
    expect(body.whispers).toEqual([{ to: ["Claude-A"], message }]);
    expect(w.conversations()[0]!.payload).toMatchObject({ visibility: { class: "nearby_speech", audienceIds: ["claude-a"], speakerId: "gpt-a" } });
  });

  it("the adapter neutralizes selectors and control characters, and rejects unsafe recipient names", () => {
    expect(sanitizeWhisperText("hi @a and @e[type=player]")).not.toMatch(/@[a-z](\b|\[)/);
    expect(sanitizeWhisperText("line one\n/op me\u0000")).toBe("line one /op me");
    expect(sanitizeWhisperText("x".repeat(500))).toHaveLength(200);
    for (const name of ["@a", "@e[type=player]", "a b", "/op", "../x", "", "name;rm", "x".repeat(17)]) {
      expect(VALID_USERNAME.test(name)).toBe(false);
    }
    expect(VALID_USERNAME.test("Claude_A")).toBe(true);
  });

  it.each([["@a"], ["../../x"], ["/op"], ["GPT-B"]])("addressing %s, who is not within hearing, is refused", async (toCitizen) => {
    const w = world();
    w.bodies.get("gpt-a")!.nearby = [{ username: "Claude-A", uuid: "c", distance: 4 }];
    await w.decideThenAct("gpt-a", { ...valid, communication: { kind: "say", message: "psst", toCitizen, bulletinLine: null } });
    expect(w.bodies.get("gpt-a")!.whispers).toEqual([]);
    expect(w.conversations()).toEqual([]);
  });

  it("a malformed communication is dropped, and the goal still stands", async () => {
    const w = world();
    await w.decideThenAct("gpt-a", { ...valid, communication: { kind: "broadcast_to_world", message: "everyone" } });
    expect(w.conversations()).toEqual([]);
    expect(w.plannedGoals()).toContain("explore");
  });

  it("a forged speaker or audience is ignored", async () => {
    const w = world();
    await w.decideThenAct("gpt-b", {
      ...valid,
      communication: { kind: "announce_to_community", message: "forged", speakerId: "gpt-a", communityId: "north", visibility: { class: "world_public", audience: { scope: "world" } } },
    });
    const event = w.conversations()[0]!;
    expect(event.citizenId).toBe("gpt-b");
    expect(event.payload.visibility).toMatchObject({ class: "settlement_public", audience: { scope: "community", communityId: "south" } });
    await w.tick("gpt-a");
    expect(w.sent("gpt-a")).not.toContain("forged");
  });

  it("a huge reply is rejected or truncated without breaking the citizen", async () => {
    const w = world();
    await w.decideThenAct("gpt-a", { ...valid, reason: "r".repeat(100_000) });
    const made = w.store.listAllEventsForObserver().find((e) => e.type === "LLMDecisionMade");
    expect(String(made?.payload.reason ?? "").length).toBeLessThanOrEqual(280);
    await w.decideThenAct("gpt-a", valid);
    expect(w.plannedGoals()).toContain("explore");
  });
});

describe.each([[true], [false]])("stale decisions (router: %s)", (routed) => {
  const decide = async (w: World, id: string, after: Promise<void>) => {
    if (routed) return;
    (w.manager as unknown as { cognition: { name: string; decide: () => Promise<unknown> } }).cognition = {
      name: "scripted-single",
      decide: async () => {
        await after;
        return { goal: "gather_wood", priority: 0.5, reason: "late" };
      },
    };
    void id;
  };

  it("a decision finished before death is not acted on after respawn, including its speech", async () => {
    const w = world({ routed });
    if (!routed) await decide(w, "gpt-a", Promise.resolve());
    w.bodies.get("gpt-a")!.nearby = [{ username: "Claude-A", uuid: "c", distance: 4 }];
    w.replies.set("gpt-a", JSON.stringify({ ...valid, goal: "gather_wood", communication: { kind: "say", message: "stale plan", toCitizen: null, bulletinLine: null } }));
    await w.tick("gpt-a");
    if (routed) expect(w.citizens.get("gpt-a")!.pendingLlm?.goal).toBe("gather_wood");
    w.manager["handleBodyDied"](createEvent("CitizenBodyDied", {}, "gpt-a"));
    w.replies.delete("gpt-a");
    planned.inputs.length = 0;
    await w.tickOnly("gpt-a");
    expect(planned.inputs[0]?.llmGoal).toBeUndefined();
    expect(w.bodies.get("gpt-a")!.whispers).toEqual([]);
  });

  it("a reply arriving after death is discarded", async () => {
    const w = world({ routed });
    let release!: () => void;
    const after = new Promise<void>((resolve) => (release = resolve));
    await decide(w, "gpt-a", after);
    if (routed) {
      (w.fixture.registry.providerFor("gpt-a") as unknown as { provider: { decide: (...args: unknown[]) => Promise<unknown> } }).provider.decide = async () => {
        await after;
        return { goal: "gather_wood", priority: 0.5, reason: "late" };
      };
    }
    await w.tickOnly("gpt-a");
    w.manager["handleBodyDied"](createEvent("CitizenBodyDied", {}, "gpt-a"));
    release();
    await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
    expect(w.citizens.get("gpt-a")!.pendingLlm).toBeUndefined();
    expect(w.skips().join()).toMatch(/stopped applying|cancelled/);
  });
});

describe("decisions overtaken by events", () => {
  it.each([
    ["a new threat", { nearby: [{ name: "zombie", hostile: true, distance: 6 }] }, "new_threat"],
    ["critical injury", { health: 3 }, "critical_injury"],
  ] as Array<[string, Partial<BodyObservation>, string]>)("%s discards the pending decision", async (_name, change, reason) => {
    const w = world();
    w.replies.set("gpt-a", JSON.stringify({ ...valid, goal: "gather_wood" }));
    await w.tick("gpt-a");
    w.replies.delete("gpt-a");
    w.bodies.get("gpt-a")!.observed = change;
    planned.inputs.length = 0;
    await w.tickOnly("gpt-a");
    expect(planned.inputs[0]?.llmGoal).toBeUndefined();
    expect(w.skips().join()).toContain(reason);
    await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
  });

  it("hunger solved while thinking discards a food decision made while starving", async () => {
    const w = world();
    w.bodies.get("gpt-a")!.observed = { food: 4 };
    w.replies.set("gpt-a", JSON.stringify({ ...valid, goal: "gather_food" }));
    await w.tick("gpt-a");
    w.replies.delete("gpt-a");
    w.bodies.get("gpt-a")!.observed = { food: 18 };
    planned.inputs.length = 0;
    await w.tickOnly("gpt-a");
    expect(planned.inputs[0]?.llmGoal).toBeUndefined();
    expect(w.skips().join()).toContain("hunger_resolved");
    await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
  });

  it("an unchanged situation keeps the decision", async () => {
    const w = world();
    w.replies.set("gpt-a", JSON.stringify({ ...valid, goal: "gather_wood" }));
    await w.tick("gpt-a");
    w.replies.delete("gpt-a");
    planned.inputs.length = 0;
    await w.tickOnly("gpt-a");
    expect(planned.inputs[0]?.llmGoal).toBe("gather_wood");
    await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
  });
});

describe("memory isolation across respawn, reconnect and restart of a session", () => {
  function privateMemory(w: World, id: string, text: string): void {
    const event = createEvent("TaskCompleted", { summary: text, visibility: { class: "actor_private" } }, id);
    w.store.appendEvent(event);
    w.store.addMemory({ id: `m-${id}`, citizenId: id, kind: "episodic", content: text, importance: 1, createdAt: new Date().toISOString() }, { sourceEventId: event.id });
  }

  it("death and respawn keep identity and permitted memory, and add no one else's", async () => {
    const w = world();
    privateMemory(w, "gpt-a", "OWN-MEMORY-A");
    privateMemory(w, "gpt-b", "OWN-MEMORY-B");
    const session = w.fixture.registry.providerFor("gpt-a").sessionId;
    w.manager["handleBodyDied"](createEvent("CitizenBodyDied", {}, "gpt-a"));
    w.manager["handleRespawned"](createEvent("CitizenRespawned", {}, "gpt-a"));
    await w.tick("gpt-a");
    expect(w.sent("gpt-a")).toContain("OWN-MEMORY-A");
    expect(w.sent("gpt-a")).not.toContain("OWN-MEMORY-B");
    expect(w.fixture.registry.providerFor("gpt-a").sessionId).toBe(session);
  });

  it("a disconnected citizen is skipped, others think, and on return it has its own memory only", async () => {
    const w = world();
    privateMemory(w, "claude-a", "OWN-MEMORY-CA");
    privateMemory(w, "claude-b", "OWN-MEMORY-CB");
    const session = w.fixture.registry.providerFor("claude-a");
    session.suspend("body disconnected");
    await w.tick("claude-a");
    expect(w.fixture.claude.get("claude-a")!.calls).toEqual([]);
    expect(w.skips().join()).toMatch(/suspended/);
    await w.tick("gpt-a");
    expect(w.citizens.get("gpt-a")!.pendingLlm).toBeDefined();
    session.resume();
    await w.tick("claude-a");
    expect(w.sent("claude-a")).toContain("OWN-MEMORY-CA");
    expect(w.sent("claude-a")).not.toContain("OWN-MEMORY-CB");
  });

  it("changing community keeps the model and private memory, and grants nothing from the new one's past", async () => {
    const w = world();
    privateMemory(w, "gpt-a", "OWN-MEMORY-A");
    await w.tick("gpt-b");
    const before = w.fixture.registry.providerFor("gpt-a");
    const audit = { actor: "orchestrator-config" as const, reason: "voluntary move in test" };
    w.store.removeCommunityMember("north", "gpt-a", audit);
    w.store.addCommunityMember("south", "gpt-a", audit);
    await w.tick("gpt-a");
    expect(w.fixture.registry.providerFor("gpt-a")).toBe(before);
    expect(before.family).toBe("gpt");
    expect(before.assignment.model).toBe("gpt-4o-mini");
    expect(w.sent("gpt-a")).toContain("OWN-MEMORY-A");
  });

  it("a teammate's private memory never reaches another member of the same community", async () => {
    const w = world();
    privateMemory(w, "gpt-a", "TEAM-PRIVATE-SECRET");
    await w.tick("claude-a");
    expect(w.sent("claude-a")).not.toContain("TEAM-PRIVATE-SECRET");
  });
});
