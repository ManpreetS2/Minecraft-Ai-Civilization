import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent } from "@civ/shared";
import {
  createJsonFileCitizenSessionStore,
} from "@civ/cognition/routing";
import {
  GateAOfflineHarness,
  DEFAULT_1V1_ASSIGNMENTS,
} from "../src/provider-harness.js";

const networkGuard = vi.fn(() => {
  throw new Error("REAL NETWORK ATTEMPTED: Test failed security invariant");
});

describe("Section 3 — Provider Independence & Citizen Isolation", () => {
  const harnesses: GateAOfflineHarness[] = [];
  const tempDirs: string[] = [];

  beforeEach(() => {
    networkGuard.mockClear();
    vi.stubGlobal("fetch", networkGuard);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    expect(networkGuard).not.toHaveBeenCalled();

    for (const h of harnesses.splice(0)) {
      await h.stop().catch(() => undefined);
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createHarness(options = {}) {
    const h = new GateAOfflineHarness(options);
    harnesses.push(h);
    return h;
  }

  it("1. GPT citizen routes only to the configured OpenAI adapter", async () => {
    const h = createHarness();
    await h.init();

    h.openaiTransport.setResponder(() => ({
      goal: "gather_food",
      priority: 0.9,
      reason: "Need food for energy",
    }));

    await h.tickCitizen("gpt-a");

    expect(h.openaiTransport.calls).toHaveLength(1);
    expect(h.claudeTransport.calls).toHaveLength(0);

    const call = h.openaiTransport.calls[0]!;
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe("Bearer sk-proj-offline-openai-synthetic-key");
    expect(call.headers.get("content-type")).toContain("application/json");
    expect(call.body.model).toBe("gpt-4o-mini");
    expect(call.body).toHaveProperty("text.format.type", "json_schema");

    const runtime = h.getCitizenRuntime("gpt-a");
    expect(runtime?.pendingLlm?.goal).toBe("gather_food");
  });

  it("2. Claude citizen routes only to the configured Anthropic adapter", async () => {
    const h = createHarness();
    await h.init();

    h.claudeTransport.setResponder(() => ({
      goal: "mine_stone",
      priority: 0.85,
      reason: "Need stone for furnace",
    }));

    await h.tickCitizen("claude-a");

    expect(h.claudeTransport.calls).toHaveLength(1);
    expect(h.openaiTransport.calls).toHaveLength(0);

    const call = h.claudeTransport.calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe("Bearer sk-ant-api03-offline-claude-synthetic-key");
    expect(call.headers.has("x-api-key")).toBe(false);
    expect(call.body.model).toBe("claude-haiku-5-5");
    expect(call.body).toHaveProperty("output_config.format.schema");

    const runtime = h.getCitizenRuntime("claude-a");
    expect(runtime?.pendingLlm?.goal).toBe("mine_stone");
  });

  it("3. Each citizen receives only its authorized world knowledge and memories", async () => {
    const h = createHarness();
    await h.init();

    const gptSecret = "COORDINATES_VAULT_GPT_X100_Z200";
    const claudeSecret = "SECRET_SAFEHOUSE_CLAUDE_X999_Z888";

    const gptEvent = createEvent("TaskCompleted", { summary: gptSecret, visibility: { class: "actor_private" } }, "gpt-a");
    h.store.appendEvent(gptEvent);
    h.store.addMemory(
      { id: "m-gpt-1", citizenId: "gpt-a", kind: "episodic", content: gptSecret, importance: 1, createdAt: new Date().toISOString() },
      { sourceEventId: gptEvent.id },
    );

    const claudeEvent = createEvent("TaskCompleted", { summary: claudeSecret, visibility: { class: "actor_private" } }, "claude-a");
    h.store.appendEvent(claudeEvent);
    h.store.addMemory(
      { id: "m-claude-1", citizenId: "claude-a", kind: "episodic", content: claudeSecret, importance: 1, createdAt: new Date().toISOString() },
      { sourceEventId: claudeEvent.id },
    );

    await h.tickBoth();

    expect(h.openaiTransport.calls).toHaveLength(1);
    expect(h.claudeTransport.calls).toHaveLength(1);

    const gptBodyString = JSON.stringify(h.openaiTransport.calls[0]!.body);
    const claudeBodyString = JSON.stringify(h.claudeTransport.calls[0]!.body);

    expect(gptBodyString).toContain(gptSecret);
    expect(gptBodyString).not.toContain(claudeSecret);

    expect(claudeBodyString).toContain(claudeSecret);
    expect(claudeBodyString).not.toContain(gptSecret);
  });

  it("4. Private messages and community broadcasts cannot leak between citizens", async () => {
    const h = createHarness();
    await h.init();

    const gptPrivateDiary = "GPT_PRIVATE_DIARY_CONFIDENTIAL_12345";
    const claudePrivateDiary = "CLAUDE_PRIVATE_DIARY_TOP_SECRET_67890";

    h.store.appendEvent(
      createEvent("ConversationOccurred", { message: gptPrivateDiary, speakerId: "gpt-a", visibility: { class: "actor_private" } }, "gpt-a"),
    );
    h.store.appendEvent(
      createEvent("ConversationOccurred", { message: claudePrivateDiary, speakerId: "claude-a", visibility: { class: "actor_private" } }, "claude-a"),
    );

    const northAnnouncement = "NORTH_COMMUNITY_EXCLUSIVE_ANNOUNCEMENT";
    h.store.appendEvent(
      createEvent(
        "ConversationOccurred",
        {
          message: northAnnouncement,
          speakerId: "gpt-a",
          visibility: { class: "settlement_public", audience: { scope: "community", communityId: "community-north" } },
        },
        "gpt-a",
      ),
    );

    await h.tickBoth();

    const gptBody = JSON.stringify(h.openaiTransport.calls[0]!.body);
    const claudeBody = JSON.stringify(h.claudeTransport.calls[0]!.body);

    expect(gptBody).toContain(gptPrivateDiary);
    expect(gptBody).toContain(northAnnouncement);
    expect(gptBody).not.toContain(claudePrivateDiary);

    expect(claudeBody).toContain(claudePrivateDiary);
    expect(claudeBody).not.toContain(gptPrivateDiary);
    expect(claudeBody).not.toContain(northAnnouncement);
  });

  it("5. Decisions are independently recorded with correct provider provenance", async () => {
    const h = createHarness();
    await h.init();

    h.openaiTransport.setResponder(() => ({ goal: "gather_food", reason: "GPT hungry" }));
    h.claudeTransport.setResponder(() => ({ goal: "mine_stone", reason: "Claude needs stone" }));

    await h.tickBoth();

    const storeDecisions = h.decisions();
    expect(storeDecisions).toHaveLength(2);

    const gptDecision = storeDecisions.find((d) => d.citizenId === "gpt-a");
    expect(gptDecision).toBeDefined();
    expect(gptDecision?.goal).toBe("gather_food");
    expect(gptDecision?.provider).toBe("openai-responses");

    const claudeDecision = storeDecisions.find((d) => d.citizenId === "claude-a");
    expect(claudeDecision).toBeDefined();
    expect(claudeDecision?.goal).toBe("mine_stone");
    expect(claudeDecision?.provider).toBe("anthropic-messages");

    const evidence = h.registry.evidenceLog();
    expect(evidence).toHaveLength(2);

    const gptEv = evidence.find((e) => e.citizenId === "gpt-a");
    expect(gptEv?.family).toBe("gpt");
    expect(gptEv?.model).toBe("gpt-4o-mini");
    expect(gptEv?.decidedBy).toBe("openai-responses");
    expect(gptEv?.outcome).toBe("decided");

    const claudeEv = evidence.find((e) => e.citizenId === "claude-a");
    expect(claudeEv?.family).toBe("claude");
    expect(claudeEv?.model).toBe("claude-haiku-5-5");
    expect(claudeEv?.decidedBy).toBe("anthropic-messages");
    expect(claudeEv?.outcome).toBe("decided");
  });

  it("6. A delayed GPT response cannot affect Claude", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({ ...a, timeoutMs: 30_000 }));
    const h = createHarness({ assignments });
    await h.init();

    h.openaiTransport.setResponder(() => ({
      hang: true,
    }));
    h.claudeTransport.setResponder(() => ({
      goal: "explore",
      reason: "Claude is quick",
    }));

    await h.tickCitizenOnly("gpt-a");
    expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(true);

    await h.tickCitizenOnly("claude-a");
    await vi.waitFor(() => {
      expect(h.getCitizenRuntime("claude-a")?.llmBusy).toBe(false);
      expect(h.getCitizenRuntime("claude-a")?.pendingLlm?.goal).toBe("explore");
    });

    expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(true);
    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm).toBeUndefined();

    h.registry.providerFor("gpt-a").cancel();
  });

  it("7. A delayed Claude response cannot affect GPT", async () => {
    const assignments = DEFAULT_1V1_ASSIGNMENTS.map((a) => ({ ...a, timeoutMs: 30_000 }));
    const h = createHarness({ assignments });
    await h.init();

    h.claudeTransport.setResponder(() => ({
      hang: true,
    }));
    h.openaiTransport.setResponder(() => ({
      goal: "gather_wood",
      reason: "GPT is quick",
    }));

    await h.tickCitizenOnly("claude-a");
    expect(h.getCitizenRuntime("claude-a")?.llmBusy).toBe(true);

    await h.tickCitizenOnly("gpt-a");
    await vi.waitFor(() => {
      expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(false);
      expect(h.getCitizenRuntime("gpt-a")?.pendingLlm?.goal).toBe("gather_wood");
    });

    expect(h.getCitizenRuntime("claude-a")?.llmBusy).toBe(true);
    expect(h.getCitizenRuntime("claude-a")?.pendingLlm).toBeUndefined();

    h.registry.providerFor("claude-a").cancel();
  });

  it("8. Restarting one citizen preserves its legitimate memory without copying another citizen's session (in-process and process-level)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-a-persistence-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "civilization.sqlite");
    const sessionPath = join(dir, "sessions.json");

    const sessionStore1 = createJsonFileCitizenSessionStore(sessionPath);
    const h1 = createHarness({
      databasePath: dbPath,
      sessionStore: sessionStore1,
    });
    await h1.init();

    const gptPrivateMem = "GPT_EXCLUSIVE_PERSISTENT_EXPERIENCE_1";
    const gptEv = createEvent("TaskCompleted", { summary: gptPrivateMem, visibility: { class: "actor_private" } }, "gpt-a");
    h1.store.appendEvent(gptEv);
    h1.store.addMemory(
      { id: "mem-persist-gpt", citizenId: "gpt-a", kind: "episodic", content: gptPrivateMem, importance: 1, createdAt: new Date().toISOString() },
      { sourceEventId: gptEv.id },
    );

    await h1.tickBoth();

    const gptSessionId1 = h1.registry.providerFor("gpt-a").sessionId;
    const claudeSessionId1 = h1.registry.providerFor("claude-a").sessionId;
    const gptSpent1 = h1.registry.accounting().citizens["gpt-a"]!.estimatedSpendUsd;
    const claudeSpent1 = h1.registry.accounting().citizens["claude-a"]!.estimatedSpendUsd;

    expect(gptSessionId1).not.toBe(claudeSessionId1);
    expect(gptSpent1).toBeGreaterThan(0);
    expect(claudeSpent1).toBeGreaterThan(0);

    await h1.stop();

    const sessionStore2 = createJsonFileCitizenSessionStore(sessionPath);
    const h2 = createHarness({
      databasePath: dbPath,
      sessionStore: sessionStore2,
    });
    await h2.init();

    expect(h2.registry.providerFor("gpt-a").sessionId).toBe(gptSessionId1);
    expect(h2.registry.providerFor("claude-a").sessionId).toBe(claudeSessionId1);
    expect(h2.registry.accounting().citizens["gpt-a"]!.estimatedSpendUsd).toBe(gptSpent1);
    expect(h2.registry.accounting().citizens["claude-a"]!.estimatedSpendUsd).toBe(claudeSpent1);

    await h2.tickBoth();

    expect(h2.openaiTransport.calls).toHaveLength(1);
    expect(h2.claudeTransport.calls).toHaveLength(1);

    const newGptBody = JSON.stringify(h2.openaiTransport.calls[0]!.body);
    const newClaudeBody = JSON.stringify(h2.claudeTransport.calls[0]!.body);

    expect(newGptBody).toContain(gptPrivateMem);
    expect(newClaudeBody).not.toContain(gptPrivateMem);

    expect(h2.registry.accounting().citizens["gpt-a"]!.requests).toBe(2);
    expect(h2.registry.accounting().citizens["claude-a"]!.requests).toBe(2);
  });

  it("9. Citizen death or shutdown rejects stale model responses", async () => {
    const h = createHarness();
    await h.init();

    let deliverGptResponse!: () => void;
    const gptResponsePromise = new Promise<void>((resolve) => {
      deliverGptResponse = resolve;
    });

    h.openaiTransport.setResponder(async () => {
      await gptResponsePromise;
      return { goal: "gather_food", reason: "Arrived after death" };
    });

    await h.tickCitizenOnly("gpt-a");
    expect(h.getCitizenRuntime("gpt-a")?.llmBusy).toBe(true);

    const deathEvent = createEvent("CitizenBodyDied", { reason: "lava" }, "gpt-a");
    h.store.appendEvent(deathEvent);
    (h.manager as unknown as { handleBodyDied: (e: unknown) => void }).handleBodyDied(deathEvent);

    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm).toBeUndefined();

    deliverGptResponse();
    await new Promise((r) => setTimeout(r, 100));

    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm).toBeUndefined();

    const skips = h.skips();
    expect(skips.some((s) => s.includes("after it stopped applying") || s.includes("stale") || s.includes("cancelled"))).toBe(true);

    const respawnEvent = createEvent("CitizenRespawned", {}, "gpt-a");
    h.store.appendEvent(respawnEvent);
    (h.manager as unknown as { handleRespawned: (e: unknown) => void }).handleRespawned(respawnEvent);

    h.openaiTransport.setResponder(() => ({ goal: "gather_food", reason: "Respawned and hungry" }));
    await h.tickCitizen("gpt-a");

    expect(h.getCitizenRuntime("gpt-a")?.pendingLlm?.goal).toBe("gather_food");
  });

  it("10. Both citizens can complete successive decision cycles without swapping identities", async () => {
    const h = createHarness();
    await h.init();

    const cycles = [
      { gptGoal: "gather_food", claudeGoal: "mine_stone" },
      { gptGoal: "gather_wood", claudeGoal: "craft_tools" },
      { gptGoal: "explore", claudeGoal: "gather_food" },
    ];

    for (let i = 0; i < cycles.length; i++) {
      const cycle = cycles[i]!;
      h.openaiTransport.setResponder(() => ({
        goal: cycle.gptGoal,
        reason: `GPT cycle ${i + 1}`,
      }));
      h.claudeTransport.setResponder(() => ({
        goal: cycle.claudeGoal,
        reason: `Claude cycle ${i + 1}`,
      }));

      await h.tickBoth();

      const gptRuntime = h.getCitizenRuntime("gpt-a");
      const claudeRuntime = h.getCitizenRuntime("claude-a");

      expect(gptRuntime?.record.id).toBe("gpt-a");
      expect(gptRuntime?.record.name).toBe("GPT_A");
      expect(gptRuntime?.pendingLlm?.goal).toBe(cycle.gptGoal);

      expect(claudeRuntime?.record.id).toBe("claude-a");
      expect(claudeRuntime?.record.name).toBe("Claude_A");
      expect(claudeRuntime?.pendingLlm?.goal).toBe(cycle.claudeGoal);

      expect(h.openaiTransport.calls).toHaveLength(i + 1);
      expect(h.claudeTransport.calls).toHaveLength(i + 1);

      expect(h.openaiTransport.calls[i]!.apiKey).toBe("sk-proj-offline-openai-synthetic-key");
      expect(h.claudeTransport.calls[i]!.apiKey).toBe("sk-ant-api03-offline-claude-synthetic-key");
    }

    const accounting = h.registry.accounting();
    expect(accounting.citizens["gpt-a"]!.requests).toBe(3);
    expect(accounting.citizens["claude-a"]!.requests).toBe(3);
    expect(accounting.experiment.requestsUsed).toBe(6);
  });
});
