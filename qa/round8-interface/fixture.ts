import { afterEach, beforeEach, expect, vi } from "vitest";
import { loadConfig } from "../../packages/shared/src/index.js";
import { OfflinePhysicalWorld } from "../../packages/agent-core/src/testing/physical-world.js";
import { OFFLINE_2V2_ASSIGNMENTS } from "../../packages/cognition/src/routing/offline-fixture.js";
import type { CognitionPrompt } from "../../packages/cognition/src/schema.js";
const worlds: OfflinePhysicalWorld[] = [];
export const RUN = "offline-run";
const network = vi.fn(() => { throw new Error("real network forbidden"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); vi.unstubAllGlobals(); expect(network).not.toHaveBeenCalled(); });
export const prompt = (id: string): CognitionPrompt => ({ citizenName: OFFLINE_2V2_ASSIGNMENTS.find(a => a.citizenId === id)!.citizenName, health: 20, hunger: 14, inventory: [], settlementNeeds: [], memories: [], nearbyCitizens: [] });
export function world(count: 2 | 4 = 2) {
  const assignments = count === 4 ? OFFLINE_2V2_ASSIGNMENTS : OFFLINE_2V2_ASSIGNMENTS.filter(a => a.citizenId.endsWith("-a"));
  const config = loadConfig({ DEMO_PROFILE: "none", LLM_PROVIDER: "none", LLM_ENABLED: "true", CLOUD_LLM_ENABLED: "false", LLM_COOLDOWN_MS: "1", SIM_RUN_ID: RUN, HUMAN_DIRECTIVES_ENABLED: "false", COMMUNITIES_JSON: JSON.stringify([
    { id: "north", memberIds: assignments.filter(a => a.family === "gpt").map(a => a.citizenId) },
    { id: "south", memberIds: assignments.filter(a => a.family === "claude").map(a => a.citizenId) },
  ]) });
  const w = new OfflinePhysicalWorld({ config, count });
  // Existing fake-body harness injects citizens without manager.start (which would
  // create real clients). Pin its runtime run to the fixture registry's known run.
  w.manager["runId"] = RUN;
  worlds.push(w); return w;
}
