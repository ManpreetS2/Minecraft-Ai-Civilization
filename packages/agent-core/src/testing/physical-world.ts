/** Offline test harness. Real manager/planner/executor/skills; simulated bodies, world and model transports. */
import { offlineRegistry, OFFLINE_2V2_ASSIGNMENTS, type ScriptedReply, type CitizenSessionStore } from "@civ/cognition/routing";
import { createMineflayerCraftFixture, createSharedCraftWorld } from "@civ/skills/testing";
import { createNavigationBackend, setNavigationBackend, type MinecraftBody, type NavigationBackend } from "@civ/minecraft-adapter";
import { createEvent, ok, type AppConfig, type BodyObservation } from "@civ/shared";
import { AgentManager } from "../manager.js";
import { CivilizationStore } from "../store.js";
import { applyCommunityConfig } from "../community-config.js";

type RuntimeCitizen = Parameters<AgentManager["tickCitizen"]>[0];
type PhysicalBody = ReturnType<typeof createMineflayerCraftFixture>;
export class OfflinePhysicalWorld {
  readonly world = createSharedCraftWorld();
  readonly bodies = new Map<string, PhysicalBody>();
  readonly citizens = new Map<string, RuntimeCitizen>();
  readonly assignments;
  readonly trace: Array<{ id: string; action?: string; source?: string; success?: boolean; food: number; inventory: Array<{ name: string; count: number }> }> = [];
  store!: CivilizationStore;
  manager!: AgentManager;
  fixture!: ReturnType<typeof offlineRegistry>;
  constructor(readonly options: {
    config: AppConfig; count?: 2 | 4; databasePath?: string; sessionStore?: CitizenSessionStore;
    script?: (citizen: string) => ScriptedReply;
  }) {
    this.assignments = options.count === 4 ? OFFLINE_2V2_ASSIGNMENTS : OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.citizenId.endsWith("-a"));
    for (const [index, a] of this.assignments.entries()) {
      const x = index * 30;
      const fx = createMineflayerCraftFixture({ sharedWorld: this.world, start: { x: x + 0.5, y: 64, z: 0.5 }, trees: [{ x: x + 6, z: 3, height: 6 }] });
      // Natural mature bushes in the scenario, no prepared structure or supplied inventory.
      this.world.blocks.set(`${x + 3},64,3`, "sweet_berry_bush");
      fx.bot.food = 7;
      this.bodies.set(a.citizenId, fx);
    }
    this.attach();
  }
  private attach() {
    this.store = new CivilizationStore(this.options.databasePath ?? ":memory:");
    const config = this.options.config;
    for (const a of this.assignments) if (!this.store.getCitizen(a.citizenId)) this.store.upsertCitizen({ id: a.citizenId, name: a.citizenName, minecraftUsername: a.citizenName, createdAt: "2026-01-01T00:00:00.000Z", status: "online" });
    applyCommunityConfig(this.store, config);
    this.fixture = offlineRegistry({ assignments: this.assignments, script: this.options.script ?? ((id) => ({ goal: id.startsWith("gpt") ? "gather_wood" : "craft_tools" })), store: this.options.sessionStore });
    this.manager = new AgentManager(config, this.store, { cognitionRouter: this.fixture.registry });
    const entries = this.manager["citizens"];
    this.citizens.clear();
    for (const a of this.assignments) {
      const fx = this.bodies.get(a.citizenId)!;
      const body = {
        connected: true, isDeceased: () => false, isAwaitingRespawn: () => false,
        getBot: () => fx.ctx.bot, inventory: () => fx.items, position: () => fx.bot.entity.position,
        observe: (): BodyObservation => ({ username: a.citizenName, connected: true, spawned: true, health: fx.bot.health, food: fx.bot.food, position: fx.bot.entity.position, inventory: fx.items, players: [], nearby: [], gameTime: 1000, isNight: false }),
        nearbyEntities: () => [], nearbyPlayers: () => [],
        whisperTo: (to: readonly string[]) => ok({ sent: [...to] }, 0),
        chat: async () => { throw new Error("server-wide chat forbidden"); },
        disconnect: async () => undefined, stopPathfinding: () => undefined,
        unreachable: { has: () => false, mark: () => undefined },
      } as unknown as MinecraftBody;
      const citizen: RuntimeCitizen = { record: this.store.getCitizen(a.citizenId)!, body, busy: false, lastLlmAt: 0, lastChatAt: 0 };
      entries.set(a.citizenId, citizen);
      this.citizens.set(a.citizenId, citizen);
    }
    // One backend dispatches to the actual simulated bot; concurrent bodies cannot navigate each other.
    const backend = { name: "shared-offline-world" } as NavigationBackend;
    for (const key of ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock", "followEntity", "escapeFrom", "probeReachability", "stop"] as const) {
      Object.assign(backend, { [key]: (bot: unknown, ...args: unknown[]) => {
        const fx = [...this.bodies.values()].find((b) => b.ctx.bot === bot);
        if (!fx) throw new Error("unknown simulated body");
        return Reflect.apply(fx.nav[key], fx.nav, [bot, ...args]);
      } });
    }
    setNavigationBackend(backend);
  }
  async tick(ids = this.assignments.map((a) => a.citizenId)) {
    await Promise.all(ids.map((id) => this.manager["tickCitizen"](this.citizens.get(id)!, this.store.getSettlement(), [], undefined)));
    const deadline = Date.now() + 20_000;
    while (this.manager.pendingOps()) {
      if (Date.now() > deadline) throw new Error("offline operations did not drain");
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    for (const id of ids) {
      const c = this.citizens.get(id)!;
      const fx = this.bodies.get(id)!;
      this.trace.push({ id, action: c.lastPlan?.action, source: c.lastPlan?.source, success: c.lastOutcome?.success, food: fx.bot.food, inventory: fx.items.map(({ name, count }) => ({ name, count })) });
    }
  }
  sent(id: string) {
    const assignment = this.assignments.find((a) => a.citizenId === id)!;
    return assignment.family === "gpt" ? this.fixture.openai.calls.filter((c) => c.apiKey === `synthetic-${assignment.credential.env}`).map((c) => c.body).join("\n") : JSON.stringify(this.fixture.claude.get(id)?.calls ?? []);
  }
  privateMemory(id: string, text: string) {
    const event = createEvent("TaskCompleted", { summary: text, visibility: { class: "actor_private" } }, id);
    this.store.appendEvent(event);
    this.store.addMemory({ id: `private-${id}`, citizenId: id, kind: "episodic", content: text, importance: 1, createdAt: new Date().toISOString() }, { sourceEventId: event.id });
  }
  async restart() {
    if (!this.options.databasePath) throw new Error("restart requires disposable file storage");
    await this.manager.stop();
    this.attach(); // Server-side simulated world/inventories survive manager restart; no new supplies.
  }
  async close() {
    await this.manager.stop();
    setNavigationBackend(createNavigationBackend("pathfinder"));
  }
}
