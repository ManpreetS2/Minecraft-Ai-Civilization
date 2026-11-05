import { expect, it, vi } from "vitest";
import { CivilizationStore } from "@civ/agent-core";
import { OFFLINE_2V2_ASSIGNMENTS, createInMemoryCitizenSessionStore } from "@civ/cognition/routing";
import { MinecraftBody } from "@civ/minecraft-adapter";
import { loadConfig, ok } from "@civ/shared";
import { createIndependentOfflineRuntime } from "./independent-offline-runtime.js";

const audit = { actor: "orchestrator-config" as const, reason: "offline review" };

function twoCitizenStore() {
  const store = new CivilizationStore(":memory:");
  store.upsertCommunity("north", "North", audit);
  store.upsertCommunity("south", "South", audit);
  store.addCommunityMember("north", "gpt-a", audit);
  store.addCommunityMember("south", "claude-a", audit);
  return store;
}

function baseAssignments() {
  return OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.citizenId.endsWith("-a")).map((a) => ({
    ...a,
    citizenName: a.citizenName.replaceAll("-", "_"),
  }));
}

function offlineBody() {
  return {
    connected: true,
    on: () => undefined,
    connect: async () => ok({}, 0),
    disconnect: async () => undefined,
    isDeceased: () => false,
    isAwaitingRespawn: () => false,
    getBot: () => undefined,
    inventory: () => [],
    position: () => ({ x: 0, y: 64, z: 0 }),
    nearbyEntities: () => [],
    nearbyPlayers: () => [],
    stopPathfinding: () => undefined,
    unreachable: { has: () => false, mark: () => undefined },
    observe: () => ({
      username: "offline",
      connected: true,
      spawned: true,
      health: 20,
      food: 20,
      position: { x: 0, y: 64, z: 0 },
      inventory: [],
      nearby: [],
      players: [],
      gameTime: 1000,
      isNight: false,
    }),
  };
}

it("refuses a loopback-ollama assignment fallback before any budget path can reach fetch", () => {
  const store = twoCitizenStore();
  const assignments = baseAssignments().map((a) =>
    a.citizenId === "gpt-a"
      ? {
          ...a,
          limits: { maxRequests: 0 },
          fallback: { kind: "loopback-ollama" as const, host: "http://127.0.0.1:12345", model: "local" },
        }
      : a,
  );
  const fetchSpy = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
  try {
    expect(() =>
      createIndependentOfflineRuntime({
        config: loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: "2", SIM_RUN_ID: "review", LLM_ENABLED: "true" }),
        store,
        assignmentsJson: JSON.stringify(assignments),
        sessionStore: createInMemoryCitizenSessionStore(),
        resolveSecret: (ref) => `synthetic-${ref.env}`,
        script: () => ({}),
        createBody: () => offlineBody() as never,
      }),
    ).toThrow(/network-backed fallback|loopback-ollama/);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    store.close();
    vi.unstubAllGlobals();
  }
});

it("refuses a createBody factory that returns MinecraftBody at start", async () => {
  const store = twoCitizenStore();
  let registry: ReturnType<typeof createIndependentOfflineRuntime>["registry"] | undefined;
  let manager: ReturnType<typeof createIndependentOfflineRuntime>["manager"] | undefined;
  try {
    ({ manager, registry } = createIndependentOfflineRuntime({
      config: loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: "2", SIM_RUN_ID: "review-body", LLM_ENABLED: "true" }),
      store,
      assignmentsJson: JSON.stringify(baseAssignments()),
      sessionStore: createInMemoryCitizenSessionStore(),
      resolveSecret: (ref) => `synthetic-${ref.env}`,
      script: () => ({}),
      createBody: (options) =>
        new MinecraftBody({
          ...options,
          reconnect: false,
        }),
    }));
    await expect(manager.start(undefined, { deferTicks: true })).rejects.toThrow(/refuses MinecraftBody/);
  } finally {
    if (manager) await manager.stop().catch(() => undefined);
    registry?.closeAll();
    store.close();
  }
});

it("refuses shared credential env names that would misroute scripted GPT replies", () => {
  const store = twoCitizenStore();
  store.addCommunityMember("south", "gpt-b", audit);
  store.addCommunityMember("north", "claude-b", audit);
  const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => ({
    ...a,
    citizenName: a.citizenName.replaceAll("-", "_"),
    ...(a.citizenId === "gpt-b" ? { credential: { env: "KEY_GPT_A" } } : {}),
  }));
  try {
    expect(() =>
      createIndependentOfflineRuntime({
        config: loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: "4", SIM_RUN_ID: "review-creds", LLM_ENABLED: "true" }),
        store,
        assignmentsJson: JSON.stringify(assignments),
        sessionStore: createInMemoryCitizenSessionStore(),
        resolveSecret: (ref) => `synthetic-${ref.env}`,
        script: () => ({}),
        createBody: () => offlineBody() as never,
      }),
    ).toThrow(/shared credential env/);
  } finally {
    store.close();
  }
});

it("refuses shared resolved credential values across GPT citizens", () => {
  const store = twoCitizenStore();
  store.addCommunityMember("south", "gpt-b", audit);
  store.addCommunityMember("north", "claude-b", audit);
  const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => ({
    ...a,
    citizenName: a.citizenName.replaceAll("-", "_"),
  }));
  try {
    expect(() =>
      createIndependentOfflineRuntime({
        config: loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: "4", SIM_RUN_ID: "review-secret", LLM_ENABLED: "true" }),
        store,
        assignmentsJson: JSON.stringify(assignments),
        sessionStore: createInMemoryCitizenSessionStore(),
        resolveSecret: () => "same-synthetic-secret",
        script: () => ({}),
        createBody: () => offlineBody() as never,
      }),
    ).toThrow(/shared credential values/);
  } finally {
    store.close();
  }
});
