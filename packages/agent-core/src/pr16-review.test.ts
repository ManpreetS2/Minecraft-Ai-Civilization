import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatPrompt, type CognitionPrompt, type HighLevelDecision } from "@civ/cognition";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import { createEvent, loadConfig, ok, type BodyObservation, type PlayerInfo, type SimEvent } from "@civ/shared";
import { applyCommunityConfig } from "./community-config.js";
import { AgentManager } from "./manager.js";
import { CivilizationStore, type CommunityAudit } from "./store.js";

/** Independent replay of PR #16's deferred delivery through the real manager tick, with a stubbed body and provider. */
const capture = vi.hoisted(() => ({
  prompts: [] as CognitionPrompt[],
  next: [] as unknown[],
  hold: undefined as Promise<void> | undefined,
  fail: false,
}));
vi.mock("@civ/cognition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@civ/cognition")>();
  return {
    ...actual,
    createCognition: () => ({
      name: "pr16-review-offline",
      async decide(prompt: CognitionPrompt): Promise<HighLevelDecision> {
        capture.prompts.push(structuredClone(prompt));
        if (capture.hold) await capture.hold;
        if (capture.fail) throw new Error("provider refused");
        return actual.validateDecision(capture.next.shift() ?? { goal: "explore", priority: 0.5, reason: "offline" });
      },
    }),
  };
});
vi.mock("./planner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./planner.js")>()),
  planCitizen: () => ({ task: "observe", goal: "offline", source: "planner", reason: "no physical action" }),
}));

const SEEDED = "2026-01-01T00:00:00.000Z";
const AUDIT: CommunityAudit = { actor: "orchestrator-config", reason: "PR 16 review fixture" };
const ROSTER = ["ada", "bea", "cal", "dee"] as const;
type Name = (typeof ROSTER)[number];

class World {
  readonly store = new CivilizationStore(":memory:");
  readonly manager: AgentManager;
  readonly nearby = new Map<Name, PlayerInfo[]>();
  readonly citizens = new Map<Name, ReturnType<AgentManager["list"]>[number]>();
  constructor() {
    const config = loadConfig({
      DEMO_PROFILE: "none",
      LLM_PROVIDER: "none",
      LLM_ENABLED: "true",
      CLOUD_LLM_ENABLED: "false",
      LLM_COOLDOWN_MS: "1",
      DEMO_BULLETIN_TARGET_TOKENS: "400",
      HUMAN_DIRECTIVES_ENABLED: "false",
      COMMUNITIES_JSON: JSON.stringify([
        { id: "north", memberIds: ["ada", "bea"] },
        { id: "south", memberIds: ["cal", "dee"] },
      ]),
    });
    for (const id of ROSTER) {
      this.store.upsertCitizen({ id, name: id, minecraftUsername: id, createdAt: SEEDED, status: "online" });
    }
    applyCommunityConfig(this.store, config, SEEDED);
    this.manager = new AgentManager(config, this.store);
    const registry = (this.manager as unknown as { citizens: Map<string, unknown> }).citizens;
    for (const id of ROSTER) {
      this.nearby.set(id, []);
      const body = {
        connected: true,
        isDeceased: () => false,
        isAwaitingRespawn: () => false,
        getBot: () => null,
        inventory: () => [],
        position: () => ({ x: 0, y: 64, z: 0 }),
        observe: (): BodyObservation => ({
          username: id,
          connected: true,
          spawned: true,
          health: 20,
          food: 10,
          inventory: [],
          players: this.nearby.get(id)!,
          nearby: [],
        }),
        nearbyPlayers: (max = 64) => this.nearby.get(id)!.filter((p) => (p.distance ?? Infinity) <= max),
        whisperTo: (to: readonly string[]) => ok({ sent: [...to] }, 0),
        chat: async (message: string) => ok({ message }, 0),
      };
      const citizen = { record: this.store.getCitizen(id)!, body: body as unknown as MinecraftBody, busy: false, lastLlmAt: 0, lastChatAt: 0 };
      registry.set(id, citizen);
      this.citizens.set(id, citizen as never);
    }
  }
  tickOnly(id: Name) {
    return this.manager["tickCitizen"](this.citizens.get(id)!, this.store.getSettlement(), ["NEED_WOOD", "NEED_STONE"], "build");
  }
  async tick(id: Name): Promise<void> {
    await this.tickOnly(id);
    await vi.waitFor(() => expect(this.manager.pendingOps()).toBe(0));
  }
  append(type: SimEvent["type"], payload: Record<string, unknown>, citizenId?: string): SimEvent {
    const event = createEvent(type, payload, citizenId);
    this.store.appendEvent(event);
    return event;
  }
  shares(): SimEvent[] {
    return this.store
      .listAllEventsForObserver()
      .filter((e) => e.type === "ConversationOccurred" && e.payload.sharedFromEventId !== undefined);
  }
}

const worlds: World[] = [];
const world = () => {
  const value = new World();
  worlds.push(value);
  return value;
};
beforeEach(() => {
  capture.prompts.length = 0;
  capture.next.length = 0;
  capture.hold = undefined;
  capture.fail = false;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const value of worlds.splice(0)) if (value.store.isOpen()) value.store.close();
});

const northLine = (w: World, message: string) =>
  w.append("SystemIncident", { message, visibility: { class: "settlement_public", audience: { scope: "community", communityId: "north" } } }, "bea");
const privateLine = (w: World, message: string) =>
  w.append("TaskCompleted", { message, visibility: { class: "actor_private" } }, "ada");

/** Ada thinks while the two lines are shown, moves to south mid-thought, then acts on her decision. */
async function shareAfterLeaving(w: World, bulletinLine: number): Promise<void> {
  w.nearby.set("ada", [{ username: "cal", uuid: "cal", distance: 4 }]);
  let release!: () => void;
  capture.hold = new Promise<void>((resolve) => (release = resolve));
  capture.next.push({
    goal: "explore",
    priority: 0.5,
    reason: "offline",
    communication: { kind: "share_bulletin_line", bulletinLine, toCitizen: "cal", message: "passing this on" },
  });
  await w.tickOnly("ada");
  await vi.waitFor(() => expect(capture.prompts).toHaveLength(1));
  expect(capture.prompts[0]!.bulletin).toContain("#1 SystemIncident");
  expect(capture.prompts[0]!.bulletin).toContain("#2 TaskCompleted");
  w.store.removeCommunityMember("north", "ada", AUDIT);
  w.store.addCommunityMember("south", "ada", AUDIT);
  capture.hold = undefined;
  release();
  await vi.waitFor(() => expect(w.manager.pendingOps()).toBe(0));
  await w.tick("ada");
}

describe("deferred bulletin delivery", () => {
  it("a share names the line the model was shown, even if an earlier line was withdrawn while it was thinking", async () => {
    const w = world();
    northLine(w, "north incident");
    const second = privateLine(w, "own river sighting");
    await shareAfterLeaving(w, 2);
    const shares = w.shares();
    expect(shares).toHaveLength(1);
    expect(shares[0]!.payload.sharedFromEventId).toBe(second.id);
  });

  it("a withdrawn line named by its shown number is refused, not replaced by the next line", async () => {
    const w = world();
    northLine(w, "north incident");
    privateLine(w, "own river sighting");
    await shareAfterLeaving(w, 1);
    expect(w.shares()).toEqual([]);
    const refusals = w.store.listAllEventsForObserver().filter((e) => e.type === "ActionFailed");
    expect(refusals.map((e) => e.payload.code)).toEqual(["SHARE_REFUSED"]);
  });

  it("a failed call leaves a low-urgency line for the next prompt, and success acknowledges it once", async () => {
    const w = world();
    const line = privateLine(w, "own low urgency note");
    capture.fail = true;
    await w.tick("ada");
    expect(w.store.getDeliveredEventIds("ada")).not.toContain(line.id);
    capture.fail = false;
    await w.tick("ada");
    expect(capture.prompts[1]!.bulletin).toContain("own low urgency note");
    expect(w.store.getDeliveredEventIds("ada")).toContain(line.id);
    await w.tick("ada");
    expect(capture.prompts[2]!.bulletin).not.toContain("own low urgency note");
  });

  it("a rejected decision does not acknowledge what the model was shown", async () => {
    const w = world();
    const line = privateLine(w, "own note");
    capture.next.push({ goal: "teleport_home", priority: 1, reason: "invalid" });
    await w.tick("ada");
    expect(w.store.getDeliveredEventIds("ada")).not.toContain(line.id);
  });

  it("deferral cannot leak: a rival line is never shown or acknowledged, across retries", async () => {
    const w = world();
    const rival = w.append(
      "SystemIncident",
      { message: "SOUTH-SECRET", visibility: { class: "settlement_public", audience: { scope: "community", communityId: "south" } } },
      "cal",
    );
    capture.fail = true;
    await w.tick("ada");
    capture.fail = false;
    await w.tick("ada");
    for (const prompt of capture.prompts) expect(formatPrompt(prompt)).not.toContain("SOUTH-SECRET");
    expect(w.store.getDeliveredEventIds("ada")).not.toContain(rival.id);
  });
});
