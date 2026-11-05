import { afterEach, beforeEach, expect, vi } from "vitest";
import { CivilizationStore } from "@civ/agent-core";
import { OFFLINE_2V2_ASSIGNMENTS, offlineRegistry, type ScriptedReply } from "@civ/cognition/routing";
import type { CognitionPrompt } from "../../../packages/cognition/src/schema.js";

/**
 * Deterministic, network-free scaffolding for the independent QA scenarios. Everything here sits on existing project
 * fixtures (`offlineRegistry`, `CivilizationStore(":memory:")`); it does not replace the manager, executor or runtime.
 */
export const AUDIT = { actor: "orchestrator-config" as const, reason: "independent QA fixture" };

let runCounter = 0;
/** Unique, deterministic run id per call within one test process. */
export const uniqueRunId = (prefix = "qa-run") => `${prefix}-${++runCounter}`;

/** Registers a spy as the global fetch for every test in the file and fails the test if anything called it. */
export function installNoNetworkGuard() {
  const spy = vi.fn(() => {
    throw new Error("real network forbidden");
  });
  beforeEach(() => {
    spy.mockClear();
    vi.stubGlobal("fetch", spy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(spy).not.toHaveBeenCalled();
  });
  return spy;
}

/** Temporary in-memory stores, closed automatically after each test. */
export function useStores() {
  const open: CivilizationStore[] = [];
  afterEach(() => {
    for (const s of open.splice(0)) if (s.isOpen()) s.close();
  });
  return () => {
    const s = new CivilizationStore(":memory:");
    open.push(s);
    return s;
  };
}

/** One GPT and one Claude citizen, in two communities, registered in a fresh store. */
export function oneVsOneStore(newStore: () => CivilizationStore) {
  const store = newStore();
  store.upsertCommunity("north", "North", AUDIT);
  store.upsertCommunity("south", "South", AUDIT);
  store.addCommunityMember("north", "gpt-a", AUDIT);
  store.addCommunityMember("south", "claude-a", AUDIT);
  return store;
}

export const ONE_V_ONE = OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.citizenId.endsWith("-a"));
export const NAME: Record<string, string> = Object.fromEntries(OFFLINE_2V2_ASSIGNMENTS.map((a) => [a.citizenId, a.citizenName]));

export function promptFor(citizenId: string, memories: string[] = [], over: Partial<CognitionPrompt> = {}): CognitionPrompt {
  return { citizenName: NAME[citizenId] ?? citizenId, health: 20, hunger: 14, inventory: [], settlementNeeds: [], memories, nearbyCitizens: [], ...over };
}

export function registryFor(over: Parameters<typeof offlineRegistry>[0] = {}) {
  return offlineRegistry({ assignments: ONE_V_ONE, ...over });
}

/** Every byte that each citizen's model session received. */
export function sentBy(fx: ReturnType<typeof offlineRegistry>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of fx.registry.citizenIds().map((id) => OFFLINE_2V2_ASSIGNMENTS.find((x) => x.citizenId === id)!)) {
    out[a.citizenId] =
      a.family === "gpt"
        ? fx.openai.calls.filter((c) => c.apiKey === `synthetic-${a.credential.env}`).map((c) => c.body).join("\n")
        : JSON.stringify(fx.claude.get(a.citizenId)?.calls ?? []);
  }
  return out;
}

export type { ScriptedReply };
