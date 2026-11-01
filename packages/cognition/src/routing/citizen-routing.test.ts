import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";
import { createCognition } from "../index.js";
import { CloudAdmissionError } from "../cloud-budget.js";
import { CLAUDE_MODEL_PRICES, OPENAI_ALLOWED_MODELS } from "../cloud-prices.js";
import { GOALS } from "../goals.js";
import { CloudDecisionLedger } from "../decision-record.js";
import { assertOpenAiConfig } from "../openai-responses.js";
import type { CognitionPrompt } from "../schema.js";
import { CitizenBudgetView, emptyCitizenAccount } from "./citizen-budget.js";
import { CloudBudgetGate } from "../cloud-budget.js";
import {
  CitizenProviderRegistry,
  CitizenRoutingError,
  createInMemoryCitizenSessionStore,
  createJsonFileCitizenSessionStore,
  type CitizenAssignment,
} from "./citizen-registry.js";
import { CLAUDE_DECISION_SCHEMA, ClaudeMessagesProvider } from "./claude-messages.js";
import { createScriptedClaudeTransport, OFFLINE_2V2_ASSIGNMENTS, offlineRegistry, type ScriptedReply } from "./offline-fixture.js";

/**
 * Scripted provider replies only. GPT citizens run the real OpenAiResponsesProvider against a mock fetch, and Claude
 * citizens the real ClaudeMessagesProvider against a mock transport. Nothing here shows a live API accepts a request.
 */
const NAMES: Record<string, string> = Object.fromEntries(OFFLINE_2V2_ASSIGNMENTS.map((a) => [a.citizenId, a.citizenName]));
const IDS = Object.keys(NAMES);

function promptFor(citizenId: string, memories: string[] = [], over: Partial<CognitionPrompt> = {}): CognitionPrompt {
  return {
    citizenName: NAMES[citizenId] ?? citizenId,
    health: 20,
    hunger: 14,
    inventory: [],
    settlementNeeds: [],
    memories,
    nearbyCitizens: [],
    ...over,
  };
}

const assignment = (id: string): CitizenAssignment => OFFLINE_2V2_ASSIGNMENTS.find((a) => a.citizenId === id)!;

/** Every byte each citizen's model session received. */
function sentBy(fixture: ReturnType<typeof offlineRegistry>): Record<string, string> {
  const sent: Record<string, string> = {};
  for (const id of IDS) {
    const a = assignment(id);
    sent[id] =
      a.family === "gpt"
        ? fixture.openai.calls.filter((c) => c.apiKey === `synthetic-${a.credential.env}`).map((c) => c.body).join("\n")
        : JSON.stringify(fixture.claude.get(id)?.calls ?? []);
  }
  return sent;
}

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "citizen-routing-"));
  dirs.push(dir);
  return join(dir, "sessions.json");
};
const networkGuard = vi.fn(() => {
  throw new Error("real network reached");
});
beforeEach(() => {
  vi.stubGlobal("fetch", networkGuard);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  expect(networkGuard).not.toHaveBeenCalled();
});

describe("independent citizens through the real decision interface", () => {
  it("runs one GPT and one Claude citizen simultaneously", async () => {
    const assignments = [assignment("gpt-a"), assignment("claude-a")];
    const { registry } = offlineRegistry({ assignments, script: (c) => ({ goal: c === "gpt-a" ? "gather_food" : "gather_wood" }) });
    const [gpt, claude] = await Promise.all([
      registry.providerFor("gpt-a").decide(promptFor("gpt-a")),
      registry.providerFor("claude-a").decide(promptFor("claude-a")),
    ]);
    expect(gpt.goal).toBe("gather_food");
    expect(claude.goal).toBe("gather_wood");
    expect(registry.providerFor("gpt-a").name).toBe("openai-responses");
    expect(registry.providerFor("claude-a").name).toBe("anthropic-messages");
  });

  it("gives two GPT and two Claude citizens four identities, sessions, credentials and valid decisions", async () => {
    const goals = { "gpt-a": "gather_food", "gpt-b": "gather_wood", "claude-a": "mine_stone", "claude-b": "explore" } as Record<string, string>;
    const fixture = offlineRegistry({ script: (c) => ({ goal: goals[c] }) });
    const decisions = await Promise.all(IDS.map((id) => fixture.registry.providerFor(id).decide(promptFor(id))));
    expect(decisions.map((d) => d.goal)).toEqual(IDS.map((id) => goals[id]));
    for (const decision of decisions) expect(GOALS).toContain(decision.goal);
    const sessions = IDS.map((id) => fixture.registry.providerFor(id).sessionId);
    expect(new Set(sessions).size).toBe(4);
    expect(new Set(fixture.openai.calls.map((c) => c.apiKey))).toEqual(new Set(["synthetic-KEY_GPT_A", "synthetic-KEY_GPT_B"]));
    expect(JSON.parse(fixture.openai.calls.find((c) => c.apiKey === "synthetic-KEY_GPT_B")!.body).model).toBe("gpt-4.1-mini");
    expect(fixture.claude.get("claude-b")!.calls[0]!.model).toBe("claude-sonnet-5-5");
    expect(fixture.claude.get("claude-a")!.calls[0]!.output_config.effort).toBe("low");
  });

  it("different memories produce different contexts, and a planted secret reaches only its owner's session", async () => {
    const secrets = Object.fromEntries(IDS.map((id) => [id, `SECRET-OF-${id}`]));
    const fixture = offlineRegistry();
    await Promise.all(IDS.map((id) => fixture.registry.providerFor(id).decide(promptFor(id, [secrets[id]!]))));
    const sent = sentBy(fixture);
    for (const reader of IDS) {
      for (const owner of IDS) {
        if (reader === owner) expect(sent[reader]).toContain(secrets[owner]);
        else expect(sent[reader]).not.toContain(secrets[owner]);
      }
    }
  });

  it("repeated decisions are stateless: an earlier prompt's text is not replayed", async () => {
    const fixture = offlineRegistry();
    const session = fixture.registry.providerFor("claude-a");
    await session.decide(promptFor("claude-a", ["FIRST-RUN-SECRET"]));
    await session.decide(promptFor("claude-a", ["second"]));
    expect(JSON.stringify(fixture.claude.get("claude-a")!.calls[1])).not.toContain("FIRST-RUN-SECRET");
  });

  it("refuses a prompt for another citizen before anything is sent", async () => {
    const fixture = offlineRegistry();
    await expect(fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-b", ["B-PRIVATE"]))).rejects.toMatchObject({ code: "MISROUTED" });
    expect(fixture.openai.calls).toEqual([]);
    expect(fixture.registry.accounting().experiment.requestsUsed).toBe(0);
  });

  it("has no default provider: an unassigned citizen gets an error", () => {
    const { registry } = offlineRegistry();
    expect(() => registry.providerFor("stranger")).toThrow(CitizenRoutingError);
  });

  it("both families answer the same question: same system text, same user text, same reply fields", async () => {
    const fixture = offlineRegistry({ assignments: [assignment("gpt-a"), { ...assignment("claude-a"), citizenName: "GPT-A" }] });
    const prompt = promptFor("gpt-a", ["same memory"]);
    await fixture.registry.providerFor("gpt-a").decide(prompt);
    await fixture.registry.providerFor("claude-a").decide(prompt);
    const gpt = JSON.parse(fixture.openai.calls[0]!.body);
    const claude = fixture.claude.get("claude-a")!.calls[0]!;
    expect(claude.system).toBe(gpt.input[0].content);
    expect(claude.messages[0]!.content).toBe(gpt.input[1].content);
    const schema = gpt.text.format.schema;
    expect(Object.keys(CLAUDE_DECISION_SCHEMA.properties).sort()).toEqual(Object.keys(schema.properties).sort());
    expect(CLAUDE_DECISION_SCHEMA.properties.goal.enum).toEqual(schema.properties.goal.enum);
    expect([...CLAUDE_DECISION_SCHEMA.required].sort()).toEqual([...schema.required].sort());
  });
});

describe("failure isolation between concurrent citizens", () => {
  it("one citizen timing out does not stop the others", async () => {
    const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => (a.citizenId === "claude-a" ? { ...a, timeoutMs: 20 } : a));
    const { registry } = offlineRegistry({ assignments, script: (c) => (c === "claude-a" ? { hang: true } : {}) });
    const results = await Promise.allSettled(IDS.map((id) => registry.providerFor(id).decide(promptFor(id))));
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled"]);
    expect(registry.accounting().experiment.closed).toBe(false);
  });

  it.each(["gpt-a", "claude-a"])("%s producing invalid JSON fails alone and is charged for its usage", async (bad) => {
    const { registry } = offlineRegistry({ script: (c) => (c === bad ? { text: "not json at all" } : {}) });
    const results = await Promise.allSettled(IDS.map((id) => registry.providerFor(id).decide(promptFor(id))));
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(registry.accounting().citizens[bad]!.estimatedSpendUsd).toBeGreaterThan(0);
    expect(registry.accounting().experiment.closed).toBe(false);
  });

  it("cancelling one citizen aborts only its request, and it can decide again", async () => {
    let hangGpt = true;
    let releaseOther!: () => void;
    const otherAfter = new Promise<void>((resolve) => (releaseOther = resolve));
    const { registry } = offlineRegistry({
      script: (c) => (c === "gpt-a" ? { hang: hangGpt } : c === "claude-b" ? { after: otherAfter, goal: "explore" } : {}),
    });
    const a = registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    const b = registry.providerFor("claude-b").decide(promptFor("claude-b"));
    await vi.waitFor(() => expect(registry.accounting().experiment.inFlight).toBe(2));
    registry.providerFor("gpt-a").cancel();
    await expect(a).rejects.toThrow();
    expect(registry.accounting().experiment.inFlight).toBe(1);
    releaseOther();
    await expect(b).resolves.toMatchObject({ goal: "explore" });
    hangGpt = false;
    await expect(registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).resolves.toBeDefined();
    expect(registry.accounting().experiment.closed).toBe(false);
  });

  it.each(["gpt-a", "claude-a"])("%s: cancel aborts at once, without waiting for the timeout", async (id) => {
    const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => ({ ...a, timeoutMs: 3_600_000 }));
    const { registry } = offlineRegistry({ assignments, script: () => ({ hang: true }) });
    const session = registry.providerFor(id);
    const pending = session.decide(promptFor(id));
    await vi.waitFor(() => expect(registry.accounting().experiment.inFlight).toBe(1));
    session.cancel();
    await expect(pending).rejects.toThrow(/aborted/);
    expect(registry.accounting().experiment.inFlight).toBe(0);
  });

  it("closing one citizen does not close the experiment or another citizen", async () => {
    const { registry } = offlineRegistry();
    registry.providerFor("gpt-a").close();
    await expect(registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toMatchObject({ code: "CLOSED" });
    await expect(registry.providerFor("gpt-b").decide(promptFor("gpt-b"))).resolves.toBeDefined();
    expect(registry.accounting().experiment.closed).toBe(false);
  });

  it("closeAll stops every citizen and is idempotent", async () => {
    const { registry } = offlineRegistry();
    registry.closeAll();
    registry.closeAll();
    for (const id of IDS) await expect(registry.providerFor(id).decide(promptFor(id))).rejects.toMatchObject({ code: "CLOSED" });
  });

  it("a disconnected citizen is refused until it resumes, with the same identity", async () => {
    const { registry } = offlineRegistry();
    const session = registry.providerFor("claude-a");
    const before = session.sessionId;
    session.suspend("body disconnected");
    await expect(session.decide(promptFor("claude-a"))).rejects.toMatchObject({ code: "SUSPENDED" });
    await expect(registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).resolves.toBeDefined();
    session.resume();
    await expect(session.decide(promptFor("claude-a"))).resolves.toBeDefined();
    expect(registry.providerFor("claude-a").sessionId).toBe(before);
  });

  it("allows one decision in flight per citizen, without blocking others", async () => {
    let release!: () => void;
    const after = new Promise<void>((resolve) => (release = resolve));
    const { registry } = offlineRegistry({ script: (c) => (c === "gpt-a" ? { after } : {}) });
    const first = registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    await expect(registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toMatchObject({ code: "BUSY" });
    await expect(registry.providerFor("gpt-b").decide(promptFor("gpt-b"))).resolves.toBeDefined();
    release();
    await expect(first).resolves.toBeDefined();
  });
});

describe("late, duplicate and out-of-order replies", () => {
  it.each(["gpt-a", "claude-a"])("%s: a reply arriving after cancel cannot steer the citizen", async (id) => {
    let release!: () => void;
    const after = new Promise<void>((resolve) => (release = resolve));
    const { registry } = offlineRegistry({ script: () => ({ after, goal: "gather_wood" }) });
    const session = registry.providerFor(id);
    const pending = session.decide(promptFor(id));
    await vi.waitFor(() => expect(registry.accounting().citizens[id]!.requests).toBe(1));
    session.cancel();
    release();
    await expect(pending).rejects.toMatchObject({ code: "STALE_RESPONSE" });
    expect(registry.evidenceLog().at(-1)).toMatchObject({ outcome: "stale", goal: "gather_wood" });
  });

  it("replies that arrive out of order still reach the right citizens", async () => {
    const gates = new Map(IDS.map((id) => {
      let release!: () => void;
      const after = new Promise<void>((resolve) => (release = resolve));
      return [id, { after, release }] as const;
    }));
    const goals = { "gpt-a": "gather_food", "gpt-b": "gather_wood", "claude-a": "mine_stone", "claude-b": "explore" } as Record<string, string>;
    const { registry } = offlineRegistry({ script: (c) => ({ after: gates.get(c)!.after, goal: goals[c] }) });
    const pending = IDS.map((id) => registry.providerFor(id).decide(promptFor(id)));
    await vi.waitFor(() => expect(registry.accounting().experiment.inFlight).toBe(4));
    for (const id of [...IDS].reverse()) {
      gates.get(id)!.release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect((await Promise.all(pending)).map((d) => d.goal)).toEqual(IDS.map((id) => goals[id]));
    expect(registry.evidenceLog().map((e) => e.citizenId)).toEqual([...IDS].reverse());
    expect(new Set(registry.evidenceLog().map((e) => e.correlationId)).size).toBe(4);
  });
});

describe("fallback boundaries", () => {
  const withFallback = (fallback: CitizenAssignment["fallback"]) => OFFLINE_2V2_ASSIGNMENTS.map((a) => ({ ...a, fallback }));

  it("with no fallback configured, a cost-policy stop fails rather than switching anything", async () => {
    const fixture = offlineRegistry({ script: (c) => (c === "gpt-a" ? { usage: null } : {}) });
    await expect(fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toThrow(/missing token usage/);
    await expect(fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toThrow(/missing token usage/);
    expect(fixture.openai.calls).toHaveLength(1);
  });

  it("the explicit heuristic fallback answers after a cost-policy stop, with no further paid request", async () => {
    const fixture = offlineRegistry({ assignments: withFallback({ kind: "heuristic" }), script: (c) => (c === "gpt-a" ? { usage: null } : {}) });
    const decision = await fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a", [], { settlementNeeds: ["NEED_WOOD"] }));
    expect(decision.goal).toBe("gather_wood");
    expect(fixture.openai.calls).toHaveLength(1);
    expect(fixture.registry.evidenceLog().at(-1)).toMatchObject({ outcome: "fallback", decidedBy: "heuristic", family: "gpt" });
  });

  it("a Claude citizen's provider never calls a GPT session on failure, or the reverse", async () => {
    const fixture = offlineRegistry({ assignments: withFallback({ kind: "heuristic" }), script: (c) => (c === "claude-a" ? { status: 500 } : {}) });
    await expect(fixture.registry.providerFor("claude-a").decide(promptFor("claude-a"))).rejects.toThrow(/500/);
    expect(fixture.openai.calls).toEqual([]);
    expect(fixture.claude.get("claude-b")!.calls).toEqual([]);
  });

  it("ordinary errors do not fall back, so a transient failure stays visible", async () => {
    const fixture = offlineRegistry({ assignments: withFallback({ kind: "heuristic" }), script: () => ({ status: 400 }) });
    await expect(fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toThrow(/400/);
  });

  it("a fallback answer does not stop the same family being recorded for the citizen", async () => {
    const fixture = offlineRegistry({ assignments: withFallback({ kind: "heuristic" }), script: () => ({ usage: null }) });
    await fixture.registry.providerFor("claude-a").decide(promptFor("claude-a"));
    expect(fixture.registry.providerFor("claude-a").family).toBe("claude");
    expect(fixture.registry.providerFor("claude-a").name).toBe("anthropic-messages");
  });

  it.each(["https://ollama.example.test", "http://localhost.attacker.test:11434", "not a url"])("rejects a non-loopback Ollama fallback: %s", (host) => {
    expect(() => offlineRegistry({ assignments: withFallback({ kind: "loopback-ollama", host, model: "local" }) })).toThrow(/Ollama host/);
  });

  it("the fallback type admits no paid provider", () => {
    const paid = { kind: "openai" } as unknown as CitizenAssignment["fallback"];
    const fixture = offlineRegistry({ assignments: withFallback(paid) });
    expect(fixture.registry.providerFor("gpt-a")).toBeDefined();
    // An unknown kind builds no fallback at all, so nothing can be reached through it.
    return expect(
      offlineRegistry({ assignments: withFallback(paid), script: () => ({ usage: null }) }).registry.providerFor("gpt-a").decide(promptFor("gpt-a")),
    ).rejects.toThrow(/missing token usage/);
  });

  it("Claude does not use server-side fallbacks, so a refusal stays a refusal on the assigned model", async () => {
    const fixture = offlineRegistry({ script: () => ({ stopReason: "refusal" }) });
    await expect(fixture.registry.providerFor("claude-a").decide(promptFor("claude-a"))).rejects.toThrow(/refusal/);
    const sent = fixture.claude.get("claude-a")!.calls[0] as unknown as Record<string, unknown>;
    expect(sent.fallbacks).toBeUndefined();
    expect(fixture.claude.get("claude-a")!.calls).toHaveLength(1);
  });
});

describe("identity across membership changes, death and restart", () => {
  it("family, model and session are not derived from community, and do not change with it", async () => {
    const { registry } = offlineRegistry();
    const session = registry.providerFor("claude-a");
    const identity = () => [session.family, session.assignment.model, session.sessionId];
    const before = identity();
    await session.decide(promptFor("claude-a", [], { bulletin: "you joined community north" }));
    await session.decide(promptFor("claude-a", [], { bulletin: "you joined community south" }));
    expect(identity()).toEqual(before);
    expect(JSON.stringify(session.assignment)).not.toMatch(/community/i);
  });

  it("death and respawn: cancelling in-flight work keeps identity and accounting", async () => {
    const { registry } = offlineRegistry({ script: () => ({ hang: true }) });
    const session = registry.providerFor("gpt-a");
    const id = session.sessionId;
    const pending = session.decide(promptFor("gpt-a"));
    await vi.waitFor(() => expect(registry.accounting().citizens["gpt-a"]!.requests).toBe(1));
    session.cancel();
    await expect(pending).rejects.toThrow();
    expect(registry.providerFor("gpt-a").sessionId).toBe(id);
    expect(registry.accounting().citizens["gpt-a"]!.requests).toBe(1);
  });

  it("restart in the same run restores each citizen's session and cannot reset spending", async () => {
    const file = tempFile();
    const store = createJsonFileCitizenSessionStore(file);
    const first = offlineRegistry({ store });
    await Promise.all(IDS.map((id) => first.registry.providerFor(id).decide(promptFor(id))));
    const sessions = IDS.map((id) => first.registry.providerFor(id).sessionId);
    const before = first.registry.accounting();

    const second = offlineRegistry({ store: createJsonFileCitizenSessionStore(file) });
    expect(IDS.map((id) => second.registry.providerFor(id).sessionId)).toEqual(sessions);
    const after = second.registry.accounting();
    expect(after.citizens).toEqual(before.citizens);
    expect(after.experiment.spendUsd).toBeCloseTo(before.experiment.spendUsd);
    expect(after.experiment.requestsUsed).toBe(before.experiment.requestsUsed);
    await second.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    expect(second.registry.accounting().citizens["gpt-a"]!.requests).toBe(before.citizens["gpt-a"]!.requests + 1);
  });

  it("a crash with a request in flight keeps its bound as a hold after restart", async () => {
    const store = createInMemoryCitizenSessionStore();
    const first = offlineRegistry({ store, script: () => ({ hang: true }) });
    void first.registry.providerFor("gpt-a").decide(promptFor("gpt-a")).catch(() => undefined);
    await vi.waitFor(() => expect(first.registry.accounting().experiment.inFlight).toBe(1));
    const reserved = first.registry.accounting().citizens["gpt-a"]!.reservedUsd;
    expect(reserved).toBeGreaterThan(0);
    const second = offlineRegistry({ store });
    expect(second.registry.accounting().citizens["gpt-a"]).toMatchObject({ reservedUsd: 0, unverifiedHoldUsd: reserved });
    expect(second.registry.accounting().experiment.heldUsd).toBeCloseTo(reserved);
    first.registry.closeAll();
  });

  describe("a cost-safety closure survives restart in the same run", () => {
    it.each([
      ["missing usage", { usage: null }, /missing token usage/],
      ["usage above the bound", { usage: { input: 5_000_000, output: 0 } }, /exceeded the admission bound/],
    ] as Array<[string, ScriptedReply, RegExp]>)("%s", async (_name, reply, reason) => {
      const store = createInMemoryCitizenSessionStore();
      const first = offlineRegistry({ store, script: () => reply });
      await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a")).catch(() => undefined);
      expect(first.registry.accounting().experiment.closedReason).toMatch(reason);
      first.registry.closeAll();

      const restarted = offlineRegistry({ store });
      const { experiment } = restarted.registry.accounting();
      expect(experiment.closed).toBe(true);
      expect(experiment.closedReason).toMatch(reason);
      for (const id of IDS) await expect(restarted.registry.providerFor(id).decide(promptFor(id))).rejects.toThrow(reason);
      expect(restarted.openai.calls).toEqual([]);
      expect([...restarted.claude.values()].flatMap((transport) => transport.calls)).toEqual([]);
    });

    it("every citizen's stored record carries it, so losing the record that caused it cannot reopen the run", async () => {
      const store = createInMemoryCitizenSessionStore();
      const first = offlineRegistry({ store, script: (c) => (c === "claude-a" ? { usage: null } : {}) });
      await first.registry.providerFor("claude-a").decide(promptFor("claude-a")).catch(() => undefined);
      for (const id of IDS) expect(store.load(id)!.experimentClosedReason).toMatch(/missing token usage/);
    });

    it("survives a second restart, through the JSON file store", async () => {
      const file = tempFile();
      const first = offlineRegistry({ store: createJsonFileCitizenSessionStore(file), script: () => ({ usage: null }) });
      await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a")).catch(() => undefined);
      offlineRegistry({ store: createJsonFileCitizenSessionStore(file) });
      const third = offlineRegistry({ store: createJsonFileCitizenSessionStore(file) });
      expect(third.registry.accounting().experiment.closedReason).toMatch(/missing token usage/);
    });

    it("the explicit local fallback still answers after the restart, with no paid request", async () => {
      const store = createInMemoryCitizenSessionStore();
      const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => ({ ...a, fallback: { kind: "heuristic" as const } }));
      const first = offlineRegistry({ store, assignments, script: () => ({ usage: null }) });
      await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
      const restarted = offlineRegistry({ store, assignments });
      await expect(restarted.registry.providerFor("gpt-a").decide(promptFor("gpt-a", [], { settlementNeeds: ["NEED_WOOD"] }))).resolves.toMatchObject({ goal: "gather_wood" });
      expect(restarted.openai.calls).toEqual([]);
    });

    it.each(["gpt-a", "claude-a"])("%s: a reservation that cannot be saved is refused before anything is sent", async (id) => {
      const store = createInMemoryCitizenSessionStore();
      const fixture = offlineRegistry({ store });
      vi.spyOn(store, "save").mockImplementation(() => {
        throw new Error("disk full");
      });
      const refused = await fixture.registry.providerFor(id).decide(promptFor(id)).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CloudAdmissionError);
      expect(String(refused)).toMatch(/could not be persisted/);
      expect(fixture.openai.calls).toEqual([]);
      expect(fixture.claude.get("claude-a")!.calls).toEqual([]);
      const { experiment, citizens } = fixture.registry.accounting();
      expect(experiment).toMatchObject({ inFlight: 0, reservedUsd: 0, spendUsd: 0, heldUsd: 0, closed: true });
      expect(citizens[id]).toMatchObject({ requests: 0, reservedUsd: 0, estimatedSpendUsd: 0, unverifiedHoldUsd: 0 });
    });

    it("a save failing after the call was made settles the call, keeps its charge and closes the budget", async () => {
      const store = createInMemoryCitizenSessionStore();
      const fixture = offlineRegistry({ store });
      const realSave = store.save.bind(store);
      let admitted = false;
      vi.spyOn(store, "save").mockImplementation((record) => {
        // Let the save that records the admission through, then fail every later one.
        if (admitted) throw new Error("disk full");
        if (record.citizenId === "gpt-a" && record.account.requests === 1) admitted = true;
        realSave(record);
      });
      await expect(fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).resolves.toBeDefined();
      const { experiment, citizens } = fixture.registry.accounting();
      expect(fixture.openai.calls).toHaveLength(1);
      expect(experiment).toMatchObject({ inFlight: 0, reservedUsd: 0, closed: true });
      expect(experiment.closedReason).toMatch(/could not be persisted/);
      expect(citizens["gpt-a"]!.estimatedSpendUsd).toBeGreaterThan(0);
      await expect(fixture.registry.providerFor("gpt-b").decide(promptFor("gpt-b"))).rejects.toThrow(/could not be persisted/);
      expect(fixture.openai.calls).toHaveLength(1);
    });

    it("a retry that cannot be saved is not sent", async () => {
      const store = createInMemoryCitizenSessionStore();
      const fixture = offlineRegistry({ store, script: () => ({ status: 429 }) });
      const realSave = store.save.bind(store);
      vi.spyOn(store, "save").mockImplementation((record) => {
        if (record.citizenId === "gpt-a" && record.account.requests >= 2) throw new Error("disk full");
        realSave(record);
      });
      await expect(fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toThrow(/429/);
      expect(fixture.openai.calls).toHaveLength(1);
      const { experiment, citizens } = fixture.registry.accounting();
      expect(experiment).toMatchObject({ inFlight: 0, reservedUsd: 0, closed: true });
      expect(citizens["gpt-a"]).toMatchObject({ requests: 1, retries: 0 });
    });

    it("the explicit local fallback answers when a reservation cannot be saved, with no paid request", async () => {
      const store = createInMemoryCitizenSessionStore();
      const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => ({ ...a, fallback: { kind: "heuristic" as const } }));
      const fixture = offlineRegistry({ store, assignments });
      vi.spyOn(store, "save").mockImplementation(() => {
        throw new Error("disk full");
      });
      await expect(fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a", [], { settlementNeeds: ["NEED_WOOD"] }))).resolves.toMatchObject({ goal: "gather_wood" });
      expect(fixture.openai.calls).toEqual([]);
    });

    it("a normal shutdown does not close the run for its next start", async () => {
      const store = createInMemoryCitizenSessionStore();
      const first = offlineRegistry({ store });
      await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
      first.registry.closeAll();
      const restarted = offlineRegistry({ store });
      expect(restarted.registry.accounting().experiment.closed).toBe(false);
      await expect(restarted.registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).resolves.toBeDefined();
    });

    it("a new run is not closed by a fault in an earlier run", async () => {
      const store = createInMemoryCitizenSessionStore();
      const first = offlineRegistry({ store, script: () => ({ usage: null }) });
      await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a")).catch(() => undefined);
      const next = offlineRegistry({ store, runId: "second-run" });
      expect(next.registry.accounting().experiment.closed).toBe(false);
      expect(store.load("gpt-a")!.experimentClosedReason).toBeUndefined();
    });

    it("a malformed stored closure stops startup rather than reopening the run", async () => {
      const store = createInMemoryCitizenSessionStore();
      offlineRegistry({ store });
      store.save({ ...store.load("gpt-a")!, experimentClosedReason: 7 as never });
      expect(() => offlineRegistry({ store })).toThrow(/closure/);
    });
  });

  it("a new run gets new sessions and starts its accounting fresh", async () => {
    const store = createInMemoryCitizenSessionStore();
    const first = offlineRegistry({ store });
    await first.registry.providerFor("gpt-a").decide(promptFor("gpt-a", ["PRIOR-RUN-SECRET"]));
    const next = offlineRegistry({ store, runId: "second-run" });
    expect(next.registry.providerFor("gpt-a").sessionId).not.toBe(first.registry.providerFor("gpt-a").sessionId);
    expect(next.registry.accounting().citizens["gpt-a"]!.requests).toBe(0);
    await next.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    expect(next.openai.calls.map((c) => c.body).join()).not.toContain("PRIOR-RUN-SECRET");
  });

  it("restart refuses a silent change of model or family", () => {
    const store = createInMemoryCitizenSessionStore();
    offlineRegistry({ store });
    const changedFamily = OFFLINE_2V2_ASSIGNMENTS.map((a) => (a.citizenId === "gpt-a" ? { ...assignment("claude-a"), citizenId: "gpt-a" } : a));
    expect(() => offlineRegistry({ store, assignments: changedFamily })).toThrow(/refusing to continue/);
    const changedModel = OFFLINE_2V2_ASSIGNMENTS.map((a) => (a.citizenId === "gpt-a" ? { ...a, model: "gpt-4o" } : a));
    expect(() => offlineRegistry({ store, assignments: changedModel })).toThrow(/refusing to continue/);
  });

  it("persisted state holds no prompts, replies or credentials", async () => {
    const file = tempFile();
    const fixture = offlineRegistry({ store: createJsonFileCitizenSessionStore(file), script: () => ({ goal: "gather_wood" }) });
    await Promise.all(IDS.map((id) => fixture.registry.providerFor(id).decide(promptFor(id, ["PRIVATE-MEMORY"]))));
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("PRIVATE-MEMORY");
    expect(text).not.toContain("synthetic-");
    expect(text).not.toContain("decision for");
  });
});

describe("per-citizen accounting inside the experiment ceiling", () => {
  it("attributes requests, tokens and estimated spend to the right citizen", async () => {
    const usage = { "gpt-a": { input: 100, output: 10 }, "gpt-b": { input: 200, output: 20 }, "claude-a": { input: 300, output: 30 }, "claude-b": { input: 400, output: 40 } } as Record<string, { input: number; output: number }>;
    const { registry } = offlineRegistry({ script: (c) => ({ usage: usage[c] }) });
    await Promise.all(IDS.map((id) => registry.providerFor(id).decide(promptFor(id))));
    const { citizens, experiment } = registry.accounting();
    for (const id of IDS) {
      expect(citizens[id]).toMatchObject({ requests: 1, retries: 0, inputTokens: usage[id]!.input, outputTokens: usage[id]!.output, reservedUsd: 0 });
      expect(citizens[id]!.estimatedSpendUsd).toBeGreaterThan(0);
    }
    expect(citizens["claude-a"]!.estimatedSpendUsd).toBeCloseTo((300 * 0.1 + 30 * 0.5) / 1e6, 10);
    expect(citizens["claude-b"]!.estimatedSpendUsd).toBeCloseTo((400 * 2 + 40 * 10) / 1e6, 10);
    const sum = IDS.reduce((total, id) => total + citizens[id]!.estimatedSpendUsd, 0);
    expect(experiment.spendUsd).toBeCloseTo(sum, 10);
    expect(experiment.requestsUsed).toBe(4);
  });

  it("the shared ceiling holds across concurrent citizens, even with every attempt failing as billable", async () => {
    const { registry } = offlineRegistry({ experiment: { maxConcurrency: 8, maxRequestsPerRun: 10_000, spendAllowanceUsd: 0.01 }, script: () => ({ status: 500 }) });
    for (let round = 0; round < 25; round += 1) {
      await Promise.allSettled(IDS.map((id) => registry.providerFor(id).decide(promptFor(id))));
      const { experiment, citizens } = registry.accounting();
      expect(experiment.spendUsd + experiment.heldUsd + experiment.reservedUsd).toBeLessThanOrEqual(0.01);
      const held = IDS.reduce((total, id) => total + citizens[id]!.unverifiedHoldUsd, 0);
      expect(held).toBeCloseTo(experiment.heldUsd, 10);
    }
    expect(registry.accounting().experiment.heldUsd).toBeGreaterThan(0);
  });

  it("a citizen's own limits stop that citizen, not the others", async () => {
    const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => (a.citizenId === "gpt-a" ? { ...a, limits: { maxRequests: 1 } } : a));
    const { registry } = offlineRegistry({ assignments });
    await registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    await expect(registry.providerFor("gpt-a").decide(promptFor("gpt-a"))).rejects.toThrow(/citizen request budget/);
    await expect(registry.providerFor("gpt-b").decide(promptFor("gpt-b"))).resolves.toBeDefined();
    expect(registry.accounting().citizens["gpt-a"]!.refused).toBe(1);
  });

  it("a citizen's spend allowance is checked against the full reservation", async () => {
    const assignments = OFFLINE_2V2_ASSIGNMENTS.map((a) => (a.citizenId === "claude-b" ? { ...a, limits: { spendAllowanceUsd: 0.000001 } } : a));
    const fixture = offlineRegistry({ assignments });
    const refused = await fixture.registry.providerFor("claude-b").decide(promptFor("claude-b")).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CloudAdmissionError);
    expect((refused as CloudAdmissionError).code).toBe("spend");
    expect(fixture.claude.get("claude-b")!.calls).toEqual([]);
  });

  it("retries are charged to the citizen and to the experiment", async () => {
    let calls = 0;
    const { registry } = offlineRegistry({ script: (c) => (c === "claude-a" && (calls += 1) === 1 ? { status: 529 } : {}) });
    await registry.providerFor("claude-a").decide(promptFor("claude-a"));
    expect(registry.accounting().citizens["claude-a"]).toMatchObject({ requests: 2, retries: 1 });
    expect(registry.accounting().experiment.requestsUsed).toBe(2);
    expect(registry.accounting().citizens["claude-a"]!.unverifiedHoldUsd).toBeGreaterThan(0);
  });

  it.each(["gpt-a", "claude-a"])("%s: unknown usage holds, attributes to that citizen, and closes the experiment with its reason", async (id) => {
    const { registry } = offlineRegistry({ script: (c) => (c === id ? { usage: null } : {}) });
    await expect(registry.providerFor(id).decide(promptFor(id))).rejects.toThrow(/missing token usage/);
    const { citizens, experiment } = registry.accounting();
    expect(citizens[id]!.unverifiedHoldUsd).toBeGreaterThan(0);
    expect(citizens[id]!.estimatedSpendUsd).toBe(0);
    expect(experiment.heldUsd).toBeCloseTo(citizens[id]!.unverifiedHoldUsd, 10);
    expect(experiment.closedReason).toMatch(/missing token usage/);
    const other = id === "gpt-a" ? "gpt-b" : "claude-b";
    await expect(registry.providerFor(other).decide(promptFor(other))).rejects.toThrow(/missing token usage/);
  });

  it("a cancelled in-flight request becomes a hold, never free", async () => {
    const { registry } = offlineRegistry({ script: () => ({ hang: true }) });
    const session = registry.providerFor("claude-a");
    const pending = session.decide(promptFor("claude-a"));
    await vi.waitFor(() => expect(registry.accounting().experiment.inFlight).toBe(1));
    session.cancel();
    await expect(pending).rejects.toThrow();
    expect(registry.accounting().citizens["claude-a"]).toMatchObject({ reservedUsd: 0, estimatedSpendUsd: 0 });
    expect(registry.accounting().citizens["claude-a"]!.unverifiedHoldUsd).toBeGreaterThan(0);
    expect(registry.accounting().experiment.inFlight).toBe(0);
  });

  it("a reported usage above the bound closes the experiment", async () => {
    const { registry } = offlineRegistry({ script: (c) => (c === "claude-b" ? { usage: { input: 5_000_000, output: 0 } } : {}) });
    await registry.providerFor("claude-b").decide(promptFor("claude-b"));
    expect(registry.accounting().experiment.closedReason).toMatch(/exceeded the admission bound/);
    expect(registry.accounting().citizens["claude-b"]!.estimatedSpendUsd).toBe(10);
  });
});

describe("Claude provider rules (scripted transport)", () => {
  function claude(reply: ScriptedReply, over: Partial<ConstructorParameters<typeof ClaudeMessagesProvider>[0]> = {}) {
    const budget = new CloudBudgetGate({ maxConcurrency: 2, maxRequestsPerRun: 10, spendAllowanceUsd: 1 });
    const transport = createScriptedClaudeTransport(() => reply);
    const provider = new ClaudeMessagesProvider({
      model: "claude-haiku-5-5",
      transport,
      apiKey: "synthetic-claude-key",
      timeoutMs: 1000,
      maxInputTokens: 16_000,
      maxOutputTokens: 1024,
      maxRetries: 0,
      budget,
      ...over,
    });
    return { provider, budget, transport };
  }
  const prompt = promptFor("claude-a", [], { citizenName: "Claude-A" });

  it("sends the Messages shape with no unsupported schema keywords, prefill or fallbacks", async () => {
    const { provider, transport } = claude({});
    await provider.decide(prompt);
    const request = transport.calls[0]!;
    expect(request).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1024, output_config: { format: { type: "json_schema" } } });
    expect(request.messages.map((m) => m.role)).toEqual(["user"]);
    expect(request).not.toHaveProperty("thinking");
    const text = JSON.stringify(request.output_config.format.schema);
    for (const keyword of ["minimum", "maximum", "minLength", "maxLength", "multipleOf"]) expect(text).not.toContain(`"${keyword}"`);
  });

  it("requires every declared property and forbids additional ones at every object level", () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const schema = node as { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; anyOf?: unknown[] };
      if (schema.properties) {
        expect([...schema.required!].sort()).toEqual(Object.keys(schema.properties).sort());
        expect(schema.additionalProperties).toBe(false);
        Object.values(schema.properties).forEach(walk);
      }
      schema.anyOf?.forEach(walk);
    };
    walk(CLAUDE_DECISION_SCHEMA);
  });

  it("normalizes null fields to omitted, the same as the GPT path", async () => {
    const { provider } = claude({ text: JSON.stringify({ goal: "rest", priority: 0.1, reason: "tired", targetCitizenId: null, communication: null }) });
    const decision = await provider.decide(prompt);
    expect(decision).toEqual({ goal: "rest", priority: 0.1, reason: "tired" });
  });

  it.each([
    ["a refusal", { stopReason: "refusal" }, /refusal/],
    ["a reply cut off at max_tokens", { stopReason: "max_tokens" }, /max_tokens/],
    ["an unknown stop reason", { stopReason: "pause_turn" }, /stop_reason/],
    ["malformed JSON", { text: "not json" }, /JSON/],
    ["a disallowed goal", { text: JSON.stringify({ goal: "teleport_home", priority: 1, reason: "x" }) }, /./],
    ["privileged fields", { text: JSON.stringify({ goal: "rest", priority: 1, reason: "x", shell: "rm -rf /", command: "/op me" }) }, /privileged|Unexpected/i],
  ] as Array<[string, ScriptedReply, RegExp]>)("charges usage and returns no decision for %s", async (_name, reply, message) => {
    const { provider, budget } = claude(reply);
    await expect(provider.decide(prompt)).rejects.toThrow(message);
    expect(budget.snapshot).toMatchObject({ inFlight: 0, closed: false, reservedUsd: 0 });
    expect(budget.snapshot.spendUsd).toBeGreaterThan(0);
    expect(provider.recentDecisions[0]).toMatchObject({ ok: false, inputTokens: 100, outputTokens: 20 });
  });

  it("treats a response from a different model as a silent provider change and closes", async () => {
    const { provider, budget } = claude({ model: "claude-opus-5-5" });
    await expect(provider.decide(prompt)).rejects.toThrow(/different model/);
    expect(budget.snapshot).toMatchObject({ closed: true, spendUsd: 0 });
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it.each([
    ["missing", null],
    ["negative", { input: -1, output: 1 }],
    ["fractional", { input: 1.5, output: 1 }],
  ] as Array<[string, ScriptedReply["usage"]]>)("closes on %s usage", async (_name, usage) => {
    const { provider, budget } = claude({ usage });
    await expect(provider.decide(prompt)).rejects.toThrow(/token usage/);
    expect(budget.snapshot.closed).toBe(true);
    expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
  });

  it("charges cache tokens conservatively if any appear", async () => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
    const provider = new ClaudeMessagesProvider({
      model: "claude-sonnet-5-5",
      apiKey: "synthetic-claude-key",
      timeoutMs: 1000,
      maxInputTokens: 16_000,
      maxOutputTokens: 1024,
      maxRetries: 0,
      budget,
      transport: {
        create: async (request) => ({
          id: "msg",
          model: request.model,
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ goal: "rest", priority: 0.1, reason: "x" }) }],
          usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 40 },
        }),
      },
    });
    await provider.decide(prompt);
    expect(budget.snapshot.spendUsd).toBeCloseTo(((10 + 125 + 40) * 2) / 1e6, 10);
  });

  it.each([
    [429, 0],
    [408, 0],
    [500, 1],
    [529, 1],
    [400, 0],
    [401, 0],
  ])("HTTP %i holds %i attempt(s) and never leaves a reservation", async (status, holds) => {
    const { provider, budget } = claude({ status });
    await expect(provider.decide(prompt)).rejects.toThrow(String(status));
    expect(budget.snapshot).toMatchObject({ inFlight: 0, reservedUsd: 0, closed: false });
    if (holds) expect(budget.snapshot.heldUsd).toBeGreaterThan(0);
    else expect(budget.snapshot.heldUsd).toBe(0);
  });

  it("does not retry a 401, and retries an overloaded response within the request budget", async () => {
    const unauthorized = claude({ status: 401 }, { maxRetries: 2 });
    await expect(unauthorized.provider.decide(prompt)).rejects.toThrow();
    expect(unauthorized.transport.calls).toHaveLength(1);
    const overloaded = claude({ status: 529 }, { maxRetries: 2 });
    await expect(overloaded.provider.decide(prompt)).rejects.toThrow();
    expect(overloaded.transport.calls).toHaveLength(3);
    expect(overloaded.budget.snapshot.requestsUsed).toBe(3);
  });

  it("reserves every retry up front, so a request that cannot cover all its attempts is refused unsent", async () => {
    const measuring = claude({ hang: true }, { budget: new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 }) });
    const pending = measuring.provider.decide(prompt).catch(() => undefined);
    await vi.waitFor(() => expect(measuring.transport.calls).toHaveLength(1));
    const budgetOf = (allowance: number) => new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: allowance });
    const onePointFive = 1.5 * (await (async () => {
      const gate = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
      const probe = claude({ hang: true }, { budget: gate });
      const held = probe.provider.decide(prompt).catch(() => undefined);
      await vi.waitFor(() => expect(gate.snapshot.inFlight).toBe(1));
      const reserved = gate.snapshot.reservedUsd;
      probe.provider.close();
      await held;
      return reserved;
    })());
    measuring.provider.close();
    await pending;
    const single = claude({}, { budget: budgetOf(onePointFive), maxRetries: 0 });
    await expect(single.provider.decide(prompt)).resolves.toBeDefined();
    const retrying = claude({}, { budget: budgetOf(onePointFive), maxRetries: 1 });
    await expect(retrying.provider.decide(prompt)).rejects.toThrow(/cannot cover/);
    expect(retrying.transport.calls).toEqual([]);
  });

  it("refuses an oversized request unsent, counting UTF-8 bytes", async () => {
    const { provider, transport, budget } = claude({});
    const big = { ...prompt, memories: ["\u{1F600}".repeat(5_000)] };
    await expect(provider.decide(big)).rejects.toMatchObject({ code: "input_too_large" });
    expect(transport.calls).toEqual([]);
    expect(budget.snapshot.requestsUsed).toBe(0);
  });

  it("refuses a response echoing the key, and never stores the key in its ledger", async () => {
    const ledger = new CloudDecisionLedger();
    await expect(claude({ text: "synthetic-claude-key" }, { ledger }).provider.decide(prompt)).rejects.toThrow(/echoes/);
    expect(ledger.toRedactedJson()).not.toContain("synthetic-claude-key");
  });

  it("rejects unknown models and models with no usable price before anything is sent", () => {
    expect(() => claude({}, { model: "gpt-4o-mini" })).toThrow(/Unsupported Claude model/);
    expect(() => claude({}, { model: "claude-unknown" })).toThrow(/Unsupported Claude model/);
    const saved = CLAUDE_MODEL_PRICES["claude-haiku-5-5"]!;
    CLAUDE_MODEL_PRICES["claude-haiku-5-5"] = { inputPerMillionUsd: 0, outputPerMillionUsd: 1 };
    try {
      expect(() => claude({})).toThrow(/cannot be bounded/);
    } finally {
      CLAUDE_MODEL_PRICES["claude-haiku-5-5"] = saved;
    }
  });
});

describe("assignment preflight fails closed", () => {
  it.each([
    ["a GPT family with a Claude model", { family: "gpt" as const, model: "claude-haiku-5-5" }, /not an allowed gpt model/],
    ["a Claude family with a GPT model", { family: "claude" as const, model: "gpt-4o-mini" }, /not an allowed claude model/],
    ["an unknown model", { model: "gpt-unknown" }, /not an allowed/],
    ["effort on a GPT model", { effort: "low" as const }, /effort/],
  ])("rejects %s", (_name, over, message) => {
    expect(() => offlineRegistry({ assignments: [{ ...assignment("gpt-a"), ...over }] })).toThrow(message);
  });

  it("rejects the same citizen assigned twice", () => {
    expect(() => offlineRegistry({ assignments: [assignment("gpt-a"), assignment("gpt-a")] })).toThrow(/assigned twice/);
  });

  it("rejects a missing credential without naming its value", () => {
    expect(() => offlineRegistry({ resolveSecret: () => undefined })).toThrow(/credential KEY_GPT_A is not set/);
    expect(() => offlineRegistry({ resolveSecret: () => "   " })).toThrow(/credential/);
  });

  it("will not use the real network unless paid requests are deliberately enabled", () => {
    const options = {
      runId: "r",
      assignments: [assignment("gpt-a")],
      experiment: { maxConcurrency: 1, maxRequestsPerRun: 1, spendAllowanceUsd: 1 },
      resolveSecret: () => "synthetic",
    };
    expect(() => new CitizenProviderRegistry(options)).toThrow(/paid requests are not enabled/);
  });

  it("will not start a Claude citizen with no transport, because none ships here", () => {
    expect(
      () =>
        new CitizenProviderRegistry({
          runId: "r",
          assignments: [assignment("claude-a")],
          experiment: { maxConcurrency: 1, maxRequestsPerRun: 1, spendAllowanceUsd: 1 },
          resolveSecret: () => "synthetic",
          allowPaidRequests: true,
        }),
    ).toThrow(/no Claude transport/);
  });

  it("GPT citizens stay on the official endpoint, with redirects refused and strict JSON", async () => {
    const fixture = offlineRegistry({ assignments: [assignment("gpt-a")] });
    await fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    const [call] = fixture.openai.calls;
    expect(call!.url).toBe("https://api.openai.com/v1/responses");
    expect(call!.redirect).toBe("error");
    expect(JSON.parse(call!.body).text.format.strict).toBe(true);
    expect(() => assertOpenAiConfig({ apiKey: "k", model: OPENAI_ALLOWED_MODELS[0], baseUrl: "https://evil.example/v1" })).toThrow();
  });

  it("the existing single-provider factory is unchanged and still defaults to no cloud", () => {
    expect(createCognition(loadConfig({})).name).toBe("heuristic");
  });
});

describe("evidence and logs", () => {
  it("evidence is deterministic in shape, attributed, and free of prompts, replies and credentials", async () => {
    let id = 0;
    const entries: unknown[] = [];
    const fixture = offlineRegistry({
      ids: () => `id-${(id += 1)}`,
      now: () => new Date("2026-11-01T00:00:00.000Z"),
      onEvidence: (entry) => entries.push(entry),
      script: () => ({ goal: "gather_wood" }),
    });
    await fixture.registry.providerFor("gpt-a").decide(promptFor("gpt-a", ["PRIVATE-MEMORY"]));
    const log = fixture.registry.evidenceLog();
    expect(entries).toEqual(log);
    expect(log[0]).toEqual({
      seq: 1,
      runId: "offline-run",
      at: "2026-11-01T00:00:00.000Z",
      citizenId: "gpt-a",
      sessionId: "offline-run:gpt-a:id-1",
      family: "gpt",
      model: "gpt-4o-mini",
      correlationId: "id-5",
      outcome: "decided",
      decidedBy: "openai-responses",
      goal: "gather_wood",
      latencyMs: 0,
      inputTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: expect.any(Number),
      unverifiedHoldUsd: undefined,
    });
    const text = JSON.stringify(log);
    expect(text).not.toContain("PRIVATE-MEMORY");
    expect(text).not.toContain("synthetic-");
    expect(text).not.toContain("decision for");
  });

  it("the evidence log cannot be edited through its accessor", async () => {
    const { registry } = offlineRegistry();
    await registry.providerFor("gpt-a").decide(promptFor("gpt-a"));
    registry.evidenceLog()[0]!.citizenId = "forged";
    expect(registry.evidenceLog()[0]!.citizenId).toBe("gpt-a");
    const before = registry.accounting().citizens["gpt-a"]!.requests;
    registry.accounting().citizens["gpt-a"]!.requests = 99;
    expect(registry.accounting().citizens["gpt-a"]!.requests).toBe(before);
  });

  it("no error message or console output carries a credential", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = offlineRegistry({ script: () => ({ status: 401 }) });
    const results = await Promise.allSettled(IDS.map((id) => fixture.registry.providerFor(id).decide(promptFor(id))));
    const output = JSON.stringify([results.map((r) => (r.status === "rejected" ? String(r.reason) : "")), log.mock.calls, warn.mock.calls, fixture.registry.evidenceLog()]);
    expect(output).not.toContain("synthetic-");
    log.mockRestore();
    warn.mockRestore();
  });
});

describe("the budget view composes the shared gate", () => {
  it("rejects invalid limits and keeps closure local unless it carries a fault", () => {
    const gate = new CloudBudgetGate({ maxConcurrency: 2, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
    expect(() => new CitizenBudgetView(gate, { maxRequests: Number.NaN }, emptyCitizenAccount())).toThrow(RangeError);
    const view = new CitizenBudgetView(gate, {}, emptyCitizenAccount());
    view.close();
    expect(view.snapshot.closed).toBe(true);
    expect(gate.snapshot.closed).toBe(false);
    expect(view.tryAdmit({ attemptBoundUsd: 0.01, maxAttempts: 1 })).toMatchObject({ ok: false, code: "closed" });
    view.close("cost fault");
    expect(gate.snapshot.closedReason).toBe("cost fault");
  });

  it("an unbounded estimate closes the experiment through a view, even with a citizen allowance set", () => {
    const gate = new CloudBudgetGate({ maxConcurrency: 2, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
    const view = new CitizenBudgetView(gate, { spendAllowanceUsd: 1 }, emptyCitizenAccount());
    expect(view.tryAdmit({ attemptBoundUsd: Number.NaN, maxAttempts: 1 })).toMatchObject({ ok: false, code: "closed" });
    expect(gate.snapshot.closedReason).toMatch(/could not be bounded/);
  });

  it("restoring invalid committed values throws rather than corrupting the ceiling", () => {
    const gate = new CloudBudgetGate({ maxConcurrency: 2, maxRequestsPerRun: 5, spendAllowanceUsd: 1 });
    expect(() => gate.restoreCommitted({ spendUsd: Number.NaN, heldUsd: 0, requestsUsed: 0 })).toThrow(RangeError);
    expect(() => gate.restoreCommitted({ spendUsd: -1, heldUsd: 0, requestsUsed: 0 })).toThrow(RangeError);
  });
});
