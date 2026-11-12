/* eslint-disable @typescript-eslint/no-explicit-any -- Independent fake-body QA fixture. */
// Real AgentManager + real MinecraftBody (event handlers, death/kick/end plumbing) over the frozen controlled OfflineBot.
// Only the executor entry point is replaced (by the test) so the test chooses WHICH production skill runs and when.
import { loadConfig } from "../../../packages/shared/src/index.js";
import { AgentManager } from "../../../packages/agent-core/src/manager.js";
import { CivilizationStore } from "../../../packages/agent-core/src/store.js";
import { offlineBody, OfflineBody, type OfflineBot } from "./offline-body.js";

export type Exec = (ctx: any, plan: any, ...rest: any[]) => Promise<any>;
export const hook: { exec: Exec } = { exec: async () => ({ success: true, data: {}, durationMs: 1 }) };

export function rig(opts: { id?: string } = {}) {
  const id = opts.id ?? "citizen_atlas";
  const config = loadConfig({ DEMO_PROFILE: "none", LLM_PROVIDER: "none", LLM_ENABLED: "false", CLOUD_LLM_ENABLED: "false" });
  const store = new CivilizationStore(":memory:");
  store.upsertCitizen({ id, name: "Atlas", minecraftUsername: "Atlas", createdAt: "2026-01-01T00:00:00.000Z", status: "online" } as never);
  const manager = new AgentManager(config, store);
  const body: OfflineBody = offlineBody("Atlas", id);
  const bot: OfflineBot = body.fake;
  // production wiring: the manager hands the body its own event bus (manager.ts createBody options)
  (body as unknown as { events: unknown }).events = manager.events;
  Object.assign(bot, { players: {}, time: { timeOfDay: 1000, isDay: true }, isRaining: false, spawnPoint: { x: 0, y: 64, z: 0 } });
  bot.emit("spawn");
  const citizen: any = { record: store.getCitizen(id)!, body, busy: false, lastLlmAt: 0, lastChatAt: 0 };
  manager["citizens"].set(id, citizen);
  const tick = () => manager["tickCitizen"](citizen, store.getSettlement(), [], undefined);
  return { id, config, store, manager, body, bot, citizen, tick };
}
