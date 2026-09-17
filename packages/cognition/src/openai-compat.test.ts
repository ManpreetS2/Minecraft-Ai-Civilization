import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";
import type { InferenceBackend } from "./chat-backend.js";
import { resolveCognitionConfig } from "./config.js";
import { chatCompletionsUrl, OpenAICompatibleBackend } from "./openai-compat.js";
import { providerOrder, isExperimentalAutoModel } from "./inference-route.js";
import { decideWithFallback } from "./routed-inference.js";
import { ModelRouter } from "./router.js";
import { detectEmergencyReflex } from "./reflex.js";
import type { CognitionContext } from "@civ/psychology";

function backend(name: "ollama" | "openai_compat", impl: InferenceBackend["chat"]): InferenceBackend {
  return { name, kind: name, configured: true, chat: impl };
}

function ctx(): CognitionContext {
  return {
    citizen: { id: "citizen_atlas", name: "Atlas" },
    immediateNeeds: { health: 20, hunger: 14, concerns: [] },
    nearbyWorldState: { entities: [] },
    mood: {
      citizenId: "citizen_atlas",
      moodValence: 0,
      stress: 0.1,
      fear: 0,
      anger: 0,
      sadness: 0,
      positiveAffect: 0.3,
      confidence: 0.4,
      currentConcerns: [],
      updatedAt: "t",
    },
    activeAffect: { dominant: "neutral", intensity: 0 },
    relevantMemories: [],
    relevantSocialBeliefs: [],
    activityFamiliarity: {},
    learnedAssociations: [],
    habits: [],
    recentImportantEvents: [],
    settlementNeeds: ["NEED_WOOD"],
    inventorySummary: ["steak x64"],
    uncertainty: 0.2,
    uncertainties: [],
  };
}

describe("inference route defaults", () => {
  it("keeps Ollama local as default and does not enable cloud", () => {
    const resolved = resolveCognitionConfig(loadConfig({}));
    expect(resolved.inferenceRoute).toBe("LOCAL");
    expect(resolved.provider).toBe("ollama");
    expect(resolved.routineModel).toBe("qwen3.5:9b");
    expect(resolved.openaiCompat.baseUrl).toBe("");
    expect(providerOrder("LOCAL")).toEqual(["ollama"]);
    expect(isExperimentalAutoModel("auto")).toBe(true);
    expect(isExperimentalAutoModel("qwen3.5:9b")).toBe(false);
  });
});

describe("ModelRouter never calls a provider for emergencies", () => {
  it("returns NO_LLM without a provider order on creeper/drowning", () => {
    const router = new ModelRouter({ enabled: true, reflectionEnabled: false, inferenceRoute: "CLOUD" });
    const drowning = router.route({
      view: { oxygen: 2, inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
      llmEnabled: true,
      reflectionEnabled: false,
      reflectionAvailable: false,
      shouldDeliberate: true,
      hasGoal: false,
      busy: false,
    });
    expect(drowning.mode).toBe("NO_LLM");
    expect(drowning.providerOrder).toBeUndefined();
    expect(detectEmergencyReflex({ inventory: [], nearbyHostiles: [{ name: "creeper", distance: 3 }], nearbyCitizens: [] })?.kind).toBe(
      "lethal_mob",
    );
  });
});

describe("LOCAL_THEN_CLOUD fallback", () => {
  it("does not call cloud when LOCAL succeeds", async () => {
    const cloud = vi.fn();
    const result = await decideWithFallback({
      route: "LOCAL_THEN_CLOUD",
      backends: {
        ollama: backend("ollama", async () => ({
          content: '{"goal":"gather_wood","priority":0.6,"reason":"The settlement needs wood."}',
          provider: "ollama",
          model: "qwen3.5:9b",
        })),
        openai_compat: backend("openai_compat", cloud),
      },
      requestFor: (b) => ({
        system: "json only",
        user: "goal",
        model: b.kind === "openai_compat" ? "hosted-fixed" : "qwen3.5:9b",
        timeoutMs: 1000,
      }),
    });
    expect(result.provider).toBe("ollama");
    expect(result.fallbackCount).toBe(0);
    expect(cloud).not.toHaveBeenCalled();
  });

  it("falls back to cloud only when the route allows it and local fails validation", async () => {
    const result = await decideWithFallback({
      route: "LOCAL_THEN_CLOUD",
      backends: {
        ollama: backend("ollama", async () => ({
          content: "not json",
          provider: "ollama",
          model: "qwen3.5:9b",
        })),
        openai_compat: backend("openai_compat", async () => ({
          content: '{"goal":"gather_wood","priority":0.55,"reason":"Wood is still needed."}',
          provider: "openai_compat",
          model: "hosted-fixed",
        })),
      },
      requestFor: (b) => ({
        system: "json only",
        user: "goal",
        model: b.kind === "openai_compat" ? "hosted-fixed" : "qwen3.5:9b",
        timeoutMs: 1000,
      }),
    });
    expect(result.provider).toBe("openai_compat");
    expect(result.fallbackCount).toBe(1);
    expect(result.value.goal).toBe("gather_wood");
  });

  it("does not call cloud on LOCAL even if a cloud backend is present", async () => {
    const cloud = vi.fn();
    await expect(
      decideWithFallback({
        route: "LOCAL",
        backends: {
          ollama: backend("ollama", async () => {
            throw new Error("ollama down");
          }),
          openai_compat: backend("openai_compat", cloud),
        },
        requestFor: () => ({ system: "json", user: "goal", model: "qwen3.5:9b", timeoutMs: 1000 }),
      }),
    ).rejects.toThrow(/ollama down/);
    expect(cloud).not.toHaveBeenCalled();
  });
});

describe("shared validation", () => {
  it("rejects invented personal starvation from either backend", async () => {
    await expect(
      decideWithFallback({
        route: "CLOUD",
        backends: {
          openai_compat: backend("openai_compat", async () => ({
            content: '{"goal":"gather_food","priority":0.9,"reason":"I have no food."}',
            provider: "openai_compat",
            model: "hosted-fixed",
          })),
        },
        facts: {
          hunger: 14,
          health: 20,
          personalInventory: [{ name: "steak", count: 64 }],
          settlementFoodReserve: 0,
        },
        requestFor: () => ({ system: "json", user: "goal", model: "hosted-fixed", timeoutMs: 1000 }),
      }),
    ).rejects.toThrow(/FACT_GUARD:PERSONAL_FOOD_PRESENT/);
  });
});

describe("openai compatible adapter", () => {
  it("builds generic /v1/chat/completions URLs and redacts keys", async () => {
    expect(chatCompletionsUrl("https://example.test")).toBe("https://example.test/v1/chat/completions");
    expect(chatCompletionsUrl("https://example.test/v1")).toBe("https://example.test/v1/chat/completions");
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "Bearer sk-secret-key-value is invalid",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAICompatibleBackend({
      baseUrl: "https://example.test",
      apiKey: "sk-secret-key-value",
      routineModel: "hosted-fixed",
    });
    await expect(
      client.chat({ system: "json", user: "hi", model: "hosted-fixed", timeoutMs: 1000 }),
    ).rejects.toThrow(/\[redacted\]/);
    const call = fetchMock.mock.calls[0] as unknown as [string, { headers?: Record<string, string> }];
    expect(call[1].headers?.authorization).toBe("Bearer sk-secret-key-value");
    vi.unstubAllGlobals();
  });
});

describe("context is not a lifetime dump", () => {
  it("keeps steak as inventory evidence for Atlas", () => {
    expect(ctx().inventorySummary).toEqual(["steak x64"]);
    expect(JSON.stringify(ctx())).not.toMatch(/chain_of_thought|lifetime|all memories/);
  });
});
