import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CognitionPrompt } from "../schema.js";
import { createInMemoryCitizenSessionStore, createJsonFileCitizenSessionStore } from "./citizen-registry.js";
import { OFFLINE_2V2_ASSIGNMENTS, offlineRegistry } from "./offline-fixture.js";
import {
  LIVE_SMOKE_MAX_SPEND_USD,
  parseCitizenAssignments,
  preflightCitizenAssignments,
  runLiveSmoke,
} from "./preflight.js";

/** Offline only: scripted replies and synthetic credentials. No real provider is contacted. */
const prompt = (name: string): CognitionPrompt => ({ citizenName: name, inventory: [], settlementNeeds: [], memories: [], nearbyCitizens: [] });
const nameOf = (id: string) => OFFLINE_2V2_ASSIGNMENTS.find((a) => a.citizenId === id)!.citizenName;

const networkGuard = vi.fn(() => {
  throw new Error("real network reached");
});
const dirs: string[] = [];
beforeEach(() => vi.stubGlobal("fetch", networkGuard));
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  expect(networkGuard).not.toHaveBeenCalled();
});

describe("assignment configuration", () => {
  const valid = JSON.stringify(OFFLINE_2V2_ASSIGNMENTS);

  it("parses a complete assignment list", () => {
    expect(parseCitizenAssignments(valid)).toEqual(OFFLINE_2V2_ASSIGNMENTS);
  });

  it.each([
    ["a misspelled limit", { limits: { maxRequest: 1 } }],
    ["an unknown field", { apiKey: "sk-literal" }],
    ["a credential value instead of a name", { credential: { env: "sk-literal-secret" } }],
    ["a paid fallback", { fallback: { kind: "openai" } }],
    ["an unknown family", { family: "gemini" }],
    ["unbounded retries", { maxRetries: 9 }],
    ["fractional tokens", { maxOutputTokens: 1.5 }],
  ])("rejects %s", (_name, over) => {
    const bad = [{ ...OFFLINE_2V2_ASSIGNMENTS[0]!, ...over }];
    expect(() => parseCitizenAssignments(JSON.stringify(bad))).toThrow();
  });

  it("rejects empty and malformed input", () => {
    expect(() => parseCitizenAssignments("[]")).toThrow();
    expect(() => parseCitizenAssignments("not json")).toThrow();
  });
});

describe("configuration preflight", () => {
  const present = () => "synthetic-secret-value";

  it("by default reports not ready, with paid requests disabled, and sends nothing", () => {
    const report = preflightCitizenAssignments({ assignments: OFFLINE_2V2_ASSIGNMENTS, resolveSecret: () => undefined });
    expect(report).toMatchObject({ ready: false, paidRequestsDisabled: true });
    expect(report.problems).toContain("paid requests are disabled");
    expect(report.problems).toContain("gpt-a: credential KEY_GPT_A is not set");
    expect(report.problems).toContain("claude-a: no Claude transport is available");
    expect(report.citizens.every((c) => !c.credentialPresent)).toBe(true);
  });

  it("is ready only when every requirement is met, and never echoes a credential", () => {
    const report = preflightCitizenAssignments({ assignments: OFFLINE_2V2_ASSIGNMENTS, resolveSecret: present, allowPaidRequests: true, hasClaudeTransport: true });
    expect(report).toEqual({
      ready: true,
      problems: [],
      paidRequestsDisabled: false,
      citizens: OFFLINE_2V2_ASSIGNMENTS.map((a) => ({ citizenId: a.citizenId, family: a.family, model: a.model, credentialPresent: true })),
    });
    expect(JSON.stringify(report)).not.toContain("synthetic-secret-value");
  });

  it("names bad models, duplicates and a missing family", () => {
    const gptOnly = [OFFLINE_2V2_ASSIGNMENTS[0]!, OFFLINE_2V2_ASSIGNMENTS[0]!, { ...OFFLINE_2V2_ASSIGNMENTS[1]!, model: "gpt-unknown" }];
    const { problems } = preflightCitizenAssignments({ assignments: gptOnly, resolveSecret: present, allowPaidRequests: true });
    expect(problems).toEqual(
      expect.arrayContaining([
        "gpt-a: assigned twice",
        "gpt-b: 'gpt-unknown' is not an allowed gpt model",
        "the experiment needs at least one GPT and one Claude citizen",
      ]),
    );
  });
});

describe("live smoke interface, driven offline", () => {
  const smallBudget = { maxConcurrency: 4, maxRequestsPerRun: 8, spendAllowanceUsd: 0.1 };
  const approval = { ownerApprovalReference: "owner-approval-synthetic", runId: "offline-run", maxSpendUsd: 0.1 };

  it("makes one attributed decision per citizen with an approval, inside the ceiling", async () => {
    const fixture = offlineRegistry({ experiment: smallBudget, script: () => ({ goal: "explore" }) });
    const result = await runLiveSmoke({ registry: fixture.registry, runId: "offline-run", authorization: approval, promptFor: (id) => prompt(nameOf(id)) });
    expect(result.citizens.map((c) => [c.citizenId, c.ok, c.goal])).toEqual(OFFLINE_2V2_ASSIGNMENTS.map((a) => [a.citizenId, true, "explore"]));
    for (const assignment of OFFLINE_2V2_ASSIGNMENTS) expect(result.accounting.citizens[assignment.citizenId]!.requests).toBe(1);
    expect(result.accounting.experiment.spendUsd).toBeLessThanOrEqual(0.1);
    expect(result.ownerApprovalReference).toBe("owner-approval-synthetic");
  });

  it("one failing citizen is reported, and the others still complete", async () => {
    const fixture = offlineRegistry({ experiment: smallBudget, script: (c) => (c === "claude-a" ? { status: 401 } : {}) });
    const result = await runLiveSmoke({ registry: fixture.registry, runId: "offline-run", authorization: approval, promptFor: (id) => prompt(nameOf(id)) });
    expect(result.citizens.filter((c) => !c.ok).map((c) => c.citizenId)).toEqual(["claude-a"]);
  });

  it.each([
    ["no approval", undefined, /no owner approval/],
    ["a blank approval", { ...approval, ownerApprovalReference: "  " }, /no owner approval/],
    ["another run's approval", { ...approval, runId: "other-run" }, /different run/],
    ["a ceiling above the limit", { ...approval, maxSpendUsd: LIVE_SMOKE_MAX_SPEND_USD + 0.01 }, /smoke ceiling/],
    ["a NaN ceiling", { ...approval, maxSpendUsd: Number.NaN }, /smoke ceiling/],
    ["an experiment allowance above the approved ceiling", { ...approval, maxSpendUsd: 0.05 }, /allowance is above/],
  ])("refuses with %s and sends nothing", async (_name, authorization, message) => {
    const fixture = offlineRegistry({ experiment: smallBudget });
    await expect(runLiveSmoke({ registry: fixture.registry, runId: "offline-run", authorization, promptFor: (id) => prompt(nameOf(id)) })).rejects.toThrow(message);
    expect(fixture.openai.calls).toEqual([]);
    expect(fixture.registry.accounting().experiment.requestsUsed).toBe(0);
  });

  it("refuses a registry that has already been used, so an approval covers one check", async () => {
    const fixture = offlineRegistry({ experiment: smallBudget });
    await runLiveSmoke({ registry: fixture.registry, runId: "offline-run", authorization: approval, promptFor: (id) => prompt(nameOf(id)) });
    await expect(runLiveSmoke({ registry: fixture.registry, runId: "offline-run", authorization: approval, promptFor: (id) => prompt(nameOf(id)) })).rejects.toThrow(/already been used/);
  });
});

describe("failure injection in session persistence", () => {
  it("a failing store closes the budget instead of breaking the call in hand or leaking a reservation", async () => {
    const store = createInMemoryCitizenSessionStore();
    const fixture = offlineRegistry({ store });
    const save = vi.spyOn(store, "save").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(fixture.registry.providerFor("gpt-a").decide(prompt("GPT-A"))).resolves.toBeDefined();
    const { experiment, citizens } = fixture.registry.accounting();
    expect(experiment).toMatchObject({ inFlight: 0, reservedUsd: 0, closed: true });
    expect(experiment.closedReason).toMatch(/could not be persisted/);
    expect(citizens["gpt-a"]!.estimatedSpendUsd).toBeGreaterThan(0);
    await expect(fixture.registry.providerFor("gpt-b").decide(prompt("GPT-B"))).rejects.toThrow(/could not be persisted/);
    expect(fixture.openai.calls).toHaveLength(1);
    save.mockRestore();
  });

  it("a corrupt session file stops startup rather than resetting spending", () => {
    const dir = mkdtempSync(join(tmpdir(), "citizen-preflight-"));
    dirs.push(dir);
    const file = join(dir, "sessions.json");
    writeFileSync(file, "{ not json");
    expect(() => offlineRegistry({ store: createJsonFileCitizenSessionStore(file) })).toThrow();
  });

  it("corrupt accounting in a readable session file stops startup", () => {
    const store = createInMemoryCitizenSessionStore();
    offlineRegistry({ store });
    const record = store.load("gpt-a")!;
    store.save({ ...record, account: { ...record.account, estimatedSpendUsd: Number.NaN } });
    expect(() => offlineRegistry({ store })).toThrow();
  });
});
