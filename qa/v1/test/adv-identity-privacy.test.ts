import { describe, expect, it } from "vitest";
import type { MemoryRecord, SimEvent } from "@civ/shared";
import { createInMemoryCitizenSessionStore, OFFLINE_2V2_ASSIGNMENTS } from "@civ/cognition/routing";
import { caseTitle } from "../src/scenario.js";
import { installNoNetworkGuard, oneVsOneStore, promptFor, registryFor, sentBy, uniqueRunId, useStores } from "../src/fixture.js";

installNoNetworkGuard();
const newStore = useStores();
const SECRET = "secret-cache at 4711,64,-2290";

describe("identity and sessions", () => {
  it(caseTitle("ADV-01", "each citizen gets its own session and its own transport; a prompt for the other citizen is refused unsent"), async () => {
    const fx = registryFor({ script: (c) => ({ goal: c === "gpt-a" ? "gather_food" : "gather_wood" }) });
    const gpt = fx.registry.providerFor("gpt-a");
    const claude = fx.registry.providerFor("claude-a");
    expect(gpt.sessionId).not.toBe(claude.sessionId);
    expect(gpt.family).toBe("gpt");
    expect(claude.family).toBe("claude");
    // A GPT prompt pushed into the Claude session must be refused before any bytes leave.
    await expect(claude.decide(promptFor("gpt-a"))).rejects.toMatchObject({ code: "MISROUTED" });
    await expect(gpt.decide(promptFor("claude-a"))).rejects.toMatchObject({ code: "MISROUTED" });
    expect(fx.openai.calls).toHaveLength(0);
    expect(fx.claude.get("claude-a")?.calls ?? []).toHaveLength(0);
    // Unknown citizen: error, never a default provider.
    expect(() => fx.registry.providerFor("someone-else")).toThrow(/no provider assignment/);
  });

  it(caseTitle("ADV-01", "memories given to one citizen never appear in the other citizen's session bytes"), async () => {
    const fx = registryFor();
    await fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a", [SECRET]));
    await fx.registry.providerFor("claude-a").decide(promptFor("claude-a", ["my own diary line"]));
    const sent = sentBy(fx);
    expect(sent["gpt-a"]).toContain(SECRET);
    expect(sent["claude-a"]).not.toContain("4711");
    expect(sent["claude-a"]).toContain("my own diary line");
    expect(sent["gpt-a"]).not.toContain("my own diary line");
  });

  it(caseTitle("ADV-07", "a restart keeps each citizen bound to the same family, model and session id and refuses a rebind"), async () => {
    const sessions = createInMemoryCitizenSessionStore();
    const runId = uniqueRunId();
    const first = registryFor({ runId, store: sessions });
    await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    await first.registry.providerFor("claude-a").decide(promptFor("claude-a"));
    const ids = Object.fromEntries(first.registry.citizenIds().map((id) => [id, first.registry.providerFor(id).sessionId]));
    first.registry.closeAll();

    const again = registryFor({ runId, store: sessions });
    for (const id of again.registry.citizenIds()) expect(again.registry.providerFor(id).sessionId).toBe(ids[id]);
    expect(sessions.load("gpt-a")).toMatchObject({ family: "gpt", decisions: 1 });
    again.registry.closeAll();

    // Rebinding gpt-a to Claude's identity under the same persisted session must be refused.
    const swapped = OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.citizenId === "claude-a").map((a) => ({ ...a, citizenId: "gpt-a" }));
    expect(() => registryFor({ runId, store: sessions, assignments: [...swapped] })).toThrow(/refusing to continue as/);
  });

  it(caseTitle("ADV-10", "one citizen's provider failure does not change another citizen's accounting or the other's reply"), async () => {
    const fx = registryFor({ script: (c) => (c === "gpt-a" ? { status: 500 } : { goal: "gather_wood" }) });
    await expect(fx.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toBeDefined();
    const decision = await fx.registry.providerFor("claude-a").decide(promptFor("claude-a"));
    expect(decision.goal).toBe("gather_wood");
    const acct = fx.registry.accounting().citizens;
    expect(acct["claude-a"]?.requests).toBe(1);
    expect(fx.registry.evidenceLog().filter((e) => e.citizenId === "claude-a").every((e) => e.outcome === "decided")).toBe(true);
  });
});

describe("private knowledge", () => {
  const privateEvent = (citizenId: string, message: string): SimEvent => ({
    id: `ev-${citizenId}`, citizenId, type: "TaskCompleted", timestamp: "2026-01-01T00:00:00.000Z",
    payload: { message, visibility: { class: "actor_private" } },
  });
  const memory = (citizenId: string, content: string): MemoryRecord => ({
    id: `m-${citizenId}`, citizenId, kind: "episodic", content, importance: 1, createdAt: "2026-02-01T00:00:00.000Z",
  });

  it(caseTitle("ADV-02", "a sourced private memory is readable by its owner only and never reaches the other citizen's prompt"), async () => {
    const store = oneVsOneStore(newStore);
    store.appendEvent(privateEvent("gpt-a", SECRET));
    store.addMemory(memory("gpt-a", SECRET), { sourceEventId: "ev-gpt-a" });
    expect(store.getMemories("gpt-a").map((m) => m.content)).toEqual([SECRET]);
    const theirs = store.getMemories("claude-a");
    expect(JSON.stringify(theirs)).not.toContain("4711");

    const fx = registryFor();
    await fx.registry.providerFor("claude-a").decide(promptFor("claude-a", theirs.map((m) => m.content)));
    expect(sentBy(fx)["claude-a"]).not.toContain("4711");
    expect(store.getMemories("nobody")).toEqual([]);
  });

  it(caseTitle("ADV-02", "an unsourced claim (no observed event) never becomes a citizen's usable memory, even the writer's"), () => {
    const store = oneVsOneStore(newStore);
    store.addMemory(memory("gpt-a", "the rival hides diamonds at 9,9,9"));
    expect(store.getMemories("gpt-a")).toEqual([]);
    // Naming a source that belongs to another citizen does not authenticate it either.
    store.appendEvent(privateEvent("claude-a", "claude saw something"));
    store.addMemory({ ...memory("gpt-a", "the rival hides diamonds at 9,9,9"), id: "m-forged" }, { sourceEventId: "ev-claude-a" });
    expect(store.getMemories("gpt-a")).toEqual([]);
  });
});
