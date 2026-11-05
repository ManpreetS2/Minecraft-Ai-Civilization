import { expect, it, vi } from "vitest";
import { CivilizationStore } from "@civ/agent-core";
import { OFFLINE_2V2_ASSIGNMENTS, createInMemoryCitizenSessionStore } from "@civ/cognition/routing";
import { loadConfig } from "@civ/shared";
import { createIndependentOfflineRuntime } from "./independent-offline-runtime.js";

it("allows a budget refusal to reach the global fetch through the assignment fallback", async () => {
  const store = new CivilizationStore(":memory:");
  const audit = { actor: "orchestrator-config" as const, reason: "offline review" };
  store.upsertCommunity("north", "North", audit);
  store.upsertCommunity("south", "South", audit);
  store.addCommunityMember("north", "gpt-a", audit);
  store.addCommunityMember("south", "claude-a", audit);
  const assignments = OFFLINE_2V2_ASSIGNMENTS.filter(a => a.citizenId.endsWith("-a")).map(a => ({
    ...a, citizenName: a.citizenName.replaceAll("-", "_"),
    ...(a.citizenId === "gpt-a" ? { limits: { maxRequests: 0 }, fallback: { kind: "loopback-ollama" as const, host: "http://127.0.0.1:12345", model: "local" } } : {}),
  }));
  const fetchSpy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: JSON.stringify({ goal: "gather_food", priority: 0.5, reason: "test" }) } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  let registry: ReturnType<typeof createIndependentOfflineRuntime>["registry"] | undefined;
  try {
    ({ registry } = createIndependentOfflineRuntime({
      config: loadConfig({ DEMO_PROFILE: "none", SIM_CITIZEN_COUNT: "2", SIM_RUN_ID: "review", LLM_ENABLED: "true" }),
      store, assignmentsJson: JSON.stringify(assignments), sessionStore: createInMemoryCitizenSessionStore(),
      resolveSecret: ref => `synthetic-${ref.env}`, script: () => ({}), createBody: () => { throw new Error("unused"); },
    }));
    await registry.providerFor("gpt-a").decide({ citizenName: "GPT_A", health: 20, hunger: 14, inventory: [], settlementNeeds: [], memories: ["private fixture"], nearbyCitizens: [] });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:12345/api/chat");
  } finally {
    registry?.closeAll();
    store.close();
    vi.unstubAllGlobals();
  }
});
