import { MinecraftBody, activePathCount, lastPathDurationMs, pathMetrics } from "@civ/minecraft-adapter";
import { createCognition, type CognitionProvider, type HighLevelDecision } from "@civ/cognition";
import { createMemory, retrieveRelevant } from "@civ/memory";
import { applySocialEvent, sameWorkFamily, SocialDirector } from "@civ/society";
import {
  createEvent,
  DEFAULT_CITIZENS,
  EventBus,
  EventLoopMonitor,
  formatSimEvent,
  resolveFromRoot,
  yieldEventLoop,
  type AppConfig,
  type CitizenRecord,
  type PresentedEvent,
  type SettlementState,
  type SimEvent,
} from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { assignSettlementNeeds, assignWorkRoles, planCitizen, type PlannedTask } from "./planner.js";
import { bodyContext, completeVerifiedTransfer, executePlan } from "./executor.js";
import { deriveSettlementInventory, type SettlementInventoryView } from "./inventory-view.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import type { SettlementProject } from "./projects.js";
import { CivilizationStore } from "./store.js";
import { DirectiveBoard } from "./directives.js";
import { applyBodyRespawn, applyTemporaryBodyDeath, applyTerminalDeath } from "./lifecycle.js";
import type { DirectiveMode, HumanDirective } from "./directive-parse.js";

type RuntimeCitizen = {
  record: CitizenRecord;
  body: MinecraftBody;
  busy: boolean;
  abort?: AbortController;
  lastLlmAt: number;
  lastChatAt: number;
  lastPlan?: PlannedTask;
  pendingLlm?: HighLevelDecision;
};

type PerformanceSnapshot = {
  tickMs: number;
  avgTickMs: number;
  lastTaskMs: number;
  pathMs: number;
  activePaths: number;
  llmInFlight: number;
  llmLastMs: number;
  eventsLastMinute: number;
  reconnectAttempts: number;
};

let llmInFlight = 0;
let lastLlmMs = 0;
let lastTaskMs = 0;

export class AgentManager {
  readonly events = new EventBus(400);
  readonly store: CivilizationStore;
  private readonly citizens = new Map<string, RuntimeCitizen>();
  private readonly config: AppConfig;
  private readonly cognition: CognitionProvider;
  private readonly social = new SocialDirector();
  private readonly lastProximityAt = new Map<string, number>();
  private readonly eventTimes: number[] = [];
  private readonly tickSamples: number[] = [];
  private tickTimer?: ReturnType<typeof setInterval>;
  private perfTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private snapshot: DashboardSnapshot;
  private lastTickMs = 0;
  private runId = "";
  private readonly loop = new EventLoopMonitor();
  private readonly runtime = new SettlementRuntime();
  private readonly directives: DirectiveBoard;
  private readonly pendingDrops = new Map<string, { item: string; count: number; giverId: string; giverBefore: number }>();

  constructor(config: AppConfig, store?: CivilizationStore) {
    this.config = config;
    this.store = store ?? new CivilizationStore(resolveFromRoot(config.DATABASE_PATH));
    this.cognition = createCognition(config);
    this.snapshot = emptySnapshot();
    this.directives = new DirectiveBoard(
      this.store,
      this.events,
      () => this.config.HUMAN_DIRECTIVES_ENABLED,
      () => this.runId,
    );
    this.events.on((event) => {
      this.eventTimes.push(Date.now());
      this.store.appendEvent(event);
      if (event.type === "CitizenDied") this.handleDeathEvent(event);
      if (event.type === "CitizenBodyDied") this.handleBodyDied(event);
      if (event.type === "CitizenRespawned") this.handleRespawned(event);
      if (event.type === "ItemTransferred") this.notePendingDrop(event);
    });
  }

  getSnapshot(): DashboardSnapshot {
    return this.snapshot;
  }

  list(): RuntimeCitizen[] {
    return [...this.citizens.values()];
  }

  get(name: string): RuntimeCitizen | undefined {
    return [...this.citizens.values()].find((c) => c.record.name.toLowerCase() === name.toLowerCase());
  }

  async start(count = this.config.SIM_CITIZEN_COUNT): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loop.start();
    this.runId = crypto.randomUUID();
    this.store.setMeta("runId", this.runId);
    this.store.setMeta("humanDirectives", String(this.config.HUMAN_DIRECTIVES_ENABLED));
    this.store.setMeta("permadeath", String(this.config.SIM_PERMADEATH_ENABLED));
    const wanted = DEFAULT_CITIZENS.slice(0, count);
    this.events.emit(
      createEvent("SimulationStarted", {
        citizens: wanted.map((c) => c.name),
        runId: this.runId,
        permadeath: this.config.SIM_PERMADEATH_ENABLED,
        humanDirectives: this.config.HUMAN_DIRECTIVES_ENABLED,
      }),
    );

    for (const identity of wanted) {
      const record = this.store.getCitizen(identity.id) ?? {
        id: identity.id,
        name: identity.name,
        minecraftUsername: identity.name,
        createdAt: new Date().toISOString(),
        status: "offline" as const,
      };
      if (!this.config.SIM_PERMADEATH_ENABLED && record.status === "dead") {
        this.store.restoreLivingIdentity(record.id, "development mode; identity restored");
        const restored = this.store.getCitizen(identity.id);
        if (restored) {
          record.status = restored.status;
          record.diedAt = restored.diedAt;
          record.deathPosition = restored.deathPosition;
          record.reason = restored.reason;
        }
      }
      const body = new MinecraftBody({
        username: identity.name,
        config: this.config,
        events: this.events,
        citizenId: identity.id,
        reconnect: record.status !== "dead",
        allowRespawn: !this.config.SIM_PERMADEATH_ENABLED,
        eventLoopLag: () => this.loop.lagMs,
      });
      if (record.status === "dead") {
        body.markDeceased();
      }
      this.citizens.set(identity.id, {
        record,
        body,
        busy: false,
        lastLlmAt: Date.now(),
        lastChatAt: 0,
      });
      if (record.status === "dead") {
        continue;
      }
      const result = await body.connect();
      record.status = result.success ? "online" : "error";
      record.reason = result.success ? "connected" : result.error;
      this.store.upsertCitizen(record);
      await delay(1500);
    }

    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.config.SIM_TICK_MS);
    this.perfTimer = setInterval(() => this.logPerformance(), 30_000);
    await this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.loop.stop();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.perfTimer) clearInterval(this.perfTimer);
    for (const citizen of this.citizens.values()) {
      citizen.abort?.abort();
      if (!citizen.body.isDeceased()) {
        await citizen.body.disconnect("simulation-stop");
        if (citizen.record.status !== "dead") citizen.record.status = "offline";
        this.store.upsertCitizen(citizen.record);
      }
    }
    this.events.emit(createEvent("SimulationStopped", {}));
    this.store.close();
  }

  private async tick(): Promise<void> {
    const started = Date.now();
    const online = [...this.citizens.values()].filter((c) => c.body.connected && !c.body.isDeceased());
    const settlement = this.store.getSettlement();
    if (settlement.projectJson && !this.runtime.project) {
      try {
        this.runtime.project = JSON.parse(settlement.projectJson) as SettlementProject;
      } catch {
        this.runtime.project = undefined;
      }
    }
    const assignments = assignSettlementNeeds(
      online.map((c) => c.record.id),
      settlement.needs,
    );
    const roles = assignWorkRoles(online.map((c) => c.record.id));

    for (const citizen of this.citizens.values()) {
      try {
        await this.tickCitizen(citizen, settlement, assignments.get(citizen.record.id) ?? [], roles.get(citizen.record.id));
        await yieldEventLoop();
      } catch (error) {
        this.events.emit(
          createEvent(
            "ErrorOccurred",
            { error: error instanceof Error ? error.message : String(error) },
            citizen.record.id,
          ),
        );
        citizen.busy = false;
        if (citizen.record.status !== "dead") {
          citizen.record.status = citizen.body.connected ? "error" : "offline";
          this.store.upsertCitizen(citizen.record);
        }
      }
    }
    this.lastTickMs = Date.now() - started;
    this.tickSamples.push(this.lastTickMs);
    if (this.tickSamples.length > 40) this.tickSamples.shift();
    this.refreshSnapshot();
  }

  private async tickCitizen(
    citizen: RuntimeCitizen,
    settlement: SettlementState,
    assignedNeeds: ReturnType<typeof assignSettlementNeeds> extends Map<string, infer V> ? V : never,
    workRole?: ReturnType<typeof assignWorkRoles> extends Map<string, infer V> ? V : never,
  ): Promise<void> {
    if (citizen.body.isDeceased() || (this.config.SIM_PERMADEATH_ENABLED && citizen.record.status === "dead")) {
      citizen.record.status = "dead";
      return;
    }
    if (citizen.body.isAwaitingRespawn()) {
      citizen.record.status = "respawning";
      this.store.upsertCitizen(citizen.record);
      return;
    }

    const observation = citizen.body.observe();
    citizen.record.lastKnownPosition = observation.position;
    citizen.record.health = observation.health;
    citizen.record.hunger = observation.food;
    citizen.record.status = observation.spawned ? "online" : citizen.body.connected ? "connecting" : "offline";

    if (citizen.busy || !observation.spawned) {
      this.store.upsertCitizen(citizen.record);
      return;
    }

    const activeDirective = this.directives.activeFor(citizen.record.id);
    const suggestions = this.directives.suggestionsFor(citizen.record.id);
    const llmDecision: HighLevelDecision | undefined = citizen.pendingLlm;
    citizen.pendingLlm = undefined;
    const now = Date.now();
    const llmDue =
      this.config.LLM_ENABLED &&
      llmInFlight === 0 &&
      now - citizen.lastLlmAt > this.config.LLM_COOLDOWN_MS &&
      !(activeDirective && activeDirective.mode !== "SUGGESTION") &&
      (assignedNeeds.length > 1 || (observation.food ?? 20) < 12 || Boolean(observation.nearby.find((e) => e.hostile)));

    if (llmDue) {
      citizen.lastLlmAt = now;
      llmInFlight += 1;
      const started = Date.now();
      const memories = retrieveRelevant(this.store.getMemories(citizen.record.id), assignedNeeds.join(" "), 5);
      const gameFacts = minecraftKnowledge().getRelevantRules({
        goal: assignedNeeds[0] ?? citizen.record.currentGoal,
        inventory: observation.inventory,
        nearbyEntities: observation.nearby.map((entity) => entity.name),
        hunger: observation.food,
        hasPickaxe: observation.inventory.some((item) => item.name.includes("pickaxe")),
        hasCraftingTableNearby: Boolean(settlement.workstations?.craftingTables.length),
      }).facts;
      void this.cognition
        .decide({
          citizenName: citizen.record.name,
          health: observation.health,
          hunger: observation.food,
          occupation: citizen.record.occupation,
          inventory: observation.inventory.map((i) => `${i.name} x${i.count}`),
          settlementNeeds: settlement.needs,
          memories: [
            ...suggestions.map((item) => `Human suggestion: ${item.rawText}`),
            ...memories.map((m) => m.content),
          ],
          nearbyCitizens: observation.players.map((p) => p.username),
          gameFacts,
        })
        .then((decision) => {
          lastLlmMs = Date.now() - started;
          citizen.pendingLlm = decision;
          this.store.logLlmCall({
            citizenId: citizen.record.id,
            latencyMs: lastLlmMs,
            ok: true,
            goal: decision.goal,
            reason: decision.reason,
          });
          this.events.emit(
            createEvent(
              "LLMDecisionMade",
              { goal: decision.goal, reason: decision.reason, provider: this.cognition.name },
              citizen.record.id,
            ),
          );
        })
        .catch((error: unknown) => {
          lastLlmMs = Date.now() - started;
          this.store.logLlmCall({
            citizenId: citizen.record.id,
            latencyMs: lastLlmMs,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
          this.events.emit(
            createEvent(
              "LLMSkipped",
              { error: error instanceof Error ? error.message : String(error), provider: this.cognition.name },
              citizen.record.id,
            ),
          );
        })
        .finally(() => {
          llmInFlight = Math.max(0, llmInFlight - 1);
        });
    }

    const plan = planCitizen({
      citizenId: citizen.record.id,
      observation,
      settlement,
      assignedNeeds,
      workRole,
      llmGoal: llmDecision?.goal,
      llmReason: llmDecision?.reason,
      projectStatus: this.runtime.project?.status,
      humanDirective:
        activeDirective?.intent && activeDirective.mode !== "SUGGESTION"
          ? {
              id: activeDirective.id,
              intent: activeDirective.intent,
              mode: activeDirective.mode,
              args: activeDirective.args,
            }
          : undefined,
    });
    citizen.lastPlan = plan;
    citizen.record.currentGoal = plan.goal;
    citizen.record.currentTask = plan.task;
    citizen.record.currentAction = plan.action;
    citizen.record.decisionSource = plan.source;
    citizen.record.reason = plan.reason;
    if (plan.occupation) citizen.record.occupation = plan.occupation;
    this.store.upsertCitizen(citizen.record);

    if (plan.task !== "observe") {
      this.events.emit(
        createEvent(
          "TaskStarted",
          { task: plan.task, goal: plan.goal, source: plan.source, reason: plan.reason },
          citizen.record.id,
        ),
      );
    }

    const ctx = bodyContext(citizen.body, undefined, this.events, citizen.record.id);
    if (!ctx) return;

    citizen.busy = true;
    citizen.abort = new AbortController();
    ctx.signal = citizen.abort.signal;

    const taskStarted = Date.now();
    void executePlan(ctx, plan, this.store, this.events, this.runtime)
      .then((result) => {
        lastTaskMs = Date.now() - taskStarted;
        if (plan.task !== "observe") {
          this.events.emit(
            createEvent(
              result.success ? "TaskCompleted" : "TaskFailed",
              {
                task: plan.task,
                success: result.success,
                code: result.success ? undefined : result.code,
                error: result.success ? undefined : result.error,
              },
              citizen.record.id,
            ),
          );
        }
        if (!result.success) {
          this.store.addMemory(
            createMemory(citizen.record.id, "episodic", `Task ${plan.task} failed: ${result.error}`, 0.45),
          );
        } else if (plan.task === "gather_wood" || plan.task === "gather_food" || plan.task === "build_shelter") {
          this.store.addMemory(createMemory(citizen.record.id, "episodic", `Completed ${plan.task}`, 0.4));
        }
        this.maybeCollectDropped(citizen);
        this.maybeSocial(citizen, result.success);
      })
      .catch((error: unknown) => {
        lastTaskMs = Date.now() - taskStarted;
        this.events.emit(createEvent("TaskFailed", { task: plan.task, error: String(error) }, citizen.record.id));
      })
      .finally(() => {
        citizen.busy = false;
      });
  }

  private maybeSocial(citizen: RuntimeCitizen, taskSucceeded: boolean): void {
    if (citizen.body.isDeceased() || citizen.record.status === "dead") return;
    const task = citizen.lastPlan?.task ?? "";
    if (task === "observe" || task === "eat" || task === "deposit") {
      this.maybeProximity(citizen);
      return;
    }

    const other = this.chooseJointWorker(citizen);
    if (!other) {
      this.maybeProximity(citizen);
      return;
    }

    const llmHelp = citizen.lastPlan?.source === "llm" && citizen.lastPlan.goal === "help_citizen";
    const trigger = llmHelp ? "helped" : "cooperated";
    const cause = llmHelp ? "llm_decision" : "joint_work";
    const decision = this.social.considerConversation({
      cause,
      trigger,
      speaker: citizen.record.name,
      other: other.record.name,
      topic: task,
      speakChance: 0.18,
    });

    if (decision.applyRelationship && taskSucceeded) {
      let rel = this.store.getRelationship(citizen.record.id, other.record.id);
      rel = applySocialEvent(rel, trigger);
      this.store.saveRelationship(rel);
      this.social.noteRelationshipApplied(citizen.record.name, other.record.name, trigger, task);
      this.events.emit(
        createEvent(
          "RelationshipChanged",
          {
            otherId: other.record.id,
            trigger,
            cause,
            trust: rel.trust,
            affection: rel.affection,
            respect: rel.respect,
            resentment: rel.resentment,
            familiarity: rel.familiarity,
          },
          citizen.record.id,
        ),
      );
    }

    if (!decision.shouldSpeak || !decision.message) return;
    citizen.lastChatAt = Date.now();
    void citizen.body.chat(decision.message);
    this.events.emit(
      createEvent("ConversationOccurred", { message: decision.message, other: other.record.name, cause }, citizen.record.id),
    );
    this.store.addMemory(createMemory(citizen.record.id, "social", decision.message, 0.5, other.record.id));
  }

  private chooseJointWorker(citizen: RuntimeCitizen): RuntimeCitizen | undefined {
    const task = citizen.lastPlan?.task;
    if (!task) return undefined;
    const origin = citizen.body.position();
    const nearby = citizen.body
      .nearbyPlayers(8)
      .map((p) => this.get(p.username))
      .filter((c): c is RuntimeCitizen => {
        if (!c) return false;
        return c.record.id !== citizen.record.id && !c.body.isDeceased();
      });
    return nearby.find((other) => {
      if (!other.busy || !other.lastPlan) return false;
      if (!origin || !other.body.position()) return false;
      return sameWorkFamily(task, other.lastPlan.task);
    });
  }

  private maybeProximity(citizen: RuntimeCitizen): void {
    const other = citizen.body
      .nearbyPlayers(6)
      .map((p) => this.get(p.username))
      .find((c): c is RuntimeCitizen => {
        if (!c) return false;
        return c.record.id !== citizen.record.id && !c.body.isDeceased();
      });
    if (!other) return;
    const pair = [citizen.record.id, other.record.id].sort().join("::");
    const now = Date.now();
    if (now - (this.lastProximityAt.get(pair) ?? 0) < 5 * 60_000) return;
    this.lastProximityAt.set(pair, now);
    let rel = this.store.getRelationship(citizen.record.id, other.record.id);
    rel = applySocialEvent(rel, "proximity");
    this.store.saveRelationship(rel);
  }

  private handleDeathEvent(event: SimEvent): void {
    if (!this.config.SIM_PERMADEATH_ENABLED) {
      this.handleBodyDied(event);
      return;
    }
    const citizen = this.citizens.get(event.citizenId ?? "");
    applyTerminalDeath({ event, store: this.store, runtime: this.runtime, citizen });
    if (citizen) this.directives.cancelForCitizen(citizen.record.id, "terminal_death");
  }

  private handleBodyDied(event: SimEvent): void {
    const citizen = this.citizens.get(event.citizenId ?? "");
    if (!citizen) return;
    applyTemporaryBodyDeath({ citizen, store: this.store, runtime: this.runtime });
    this.directives.cancelForCitizen(citizen.record.id, "body_died");
    this.store.upsertCitizen(citizen.record);
  }

  private handleRespawned(event: SimEvent): void {
    const citizen = this.citizens.get(event.citizenId ?? "");
    if (!citizen) return;
    applyBodyRespawn(citizen);
    this.store.upsertCitizen(citizen.record);
  }

  issueDirective(input: { target: string; mode: DirectiveMode; instruction: string; selectedIds?: string[] }) {
    const result = this.directives.issue({
      ...input,
      citizens: [...this.citizens.values()].map((c) => ({ id: c.record.id, name: c.record.name })),
    });
    if (result.ok && input.mode === "ADMIN_OVERRIDE") {
      for (const directive of result.directives) {
        for (const id of directive.targetIds) {
          const citizen = this.citizens.get(id);
          if (!citizen) continue;
          citizen.abort?.abort();
          citizen.body.stopPathfinding();
          citizen.busy = false;
          this.runtime.releaseCitizen(id);
        }
      }
    }
    return result;
  }

  cancelDirective(id: string) {
    return this.directives.cancel(id);
  }

  stopCitizen(nameOrId: string) {
    const citizen =
      this.citizens.get(nameOrId) ??
      [...this.citizens.values()].find((c) => c.record.name.toLowerCase() === nameOrId.toLowerCase());
    if (!citizen) return { ok: false as const, reason: "Citizen not found", status: 404 };
    citizen.abort?.abort();
    citizen.body.stopPathfinding();
    citizen.busy = false;
    this.runtime.releaseCitizen(citizen.record.id);
    this.directives.cancelForCitizen(citizen.record.id, "stopped by human");
    citizen.record.currentTask = undefined;
    citizen.record.reason = "stopped by human; replanning";
    this.store.upsertCitizen(citizen.record);
    return { ok: true as const, citizenId: citizen.record.id };
  }

  listDirectives(): HumanDirective[] {
    return this.directives.list();
  }

  private notePendingDrop(event: SimEvent): void {
    if (!event.citizenId) return;
    const item = typeof event.payload.item === "string" ? event.payload.item : undefined;
    const count = typeof event.payload.count === "number" ? event.payload.count : 1;
    if (!item) return;
    const giver = this.citizens.get(event.citizenId);
    const after = giver?.body.inventory().find((i) => i.name === item)?.count ?? 0;
    this.pendingDrops.set(event.citizenId, {
      item,
      count,
      giverId: event.citizenId,
      giverBefore: after + count,
    });
  }

  private maybeCollectDropped(citizen: RuntimeCitizen): void {
    for (const [giverId, pending] of this.pendingDrops) {
      if (giverId === citizen.record.id) continue;
      const giver = this.citizens.get(giverId);
      if (!giver) continue;
      const receiverItem = citizen.body.inventory().find((i) => i.name === pending.item)?.count ?? 0;
      const giverItem = giver.body.inventory().find((i) => i.name === pending.item)?.count ?? 0;
      void completeVerifiedTransfer({
        giverBefore: pending.giverBefore,
        giverAfter: giverItem,
        receiverBefore: Math.max(0, receiverItem - pending.count),
        receiverAfter: receiverItem,
        item: pending.item,
        count: pending.count,
        giverId,
        receiverId: citizen.record.id,
        purpose: "food_share",
        events: this.events,
      }).then((ok) => {
        if (ok) this.pendingDrops.delete(giverId);
      });
    }
  }

  private performance(): PerformanceSnapshot {
    const cutoff = Date.now() - 60_000;
    while (this.eventTimes.length > 0) {
      const oldest = this.eventTimes[0];
      if (oldest === undefined || oldest >= cutoff) break;
      this.eventTimes.shift();
    }
    const avg =
      this.tickSamples.length === 0
        ? 0
        : Math.round(this.tickSamples.reduce((sum, n) => sum + n, 0) / this.tickSamples.length);
    return {
      tickMs: this.lastTickMs,
      avgTickMs: avg,
      lastTaskMs,
      pathMs: lastPathDurationMs(),
      activePaths: activePathCount(),
      llmInFlight,
      llmLastMs: lastLlmMs,
      eventsLastMinute: this.eventTimes.length,
      reconnectAttempts: [...this.citizens.values()].reduce((sum, c) => sum + c.body.reconnectAttempts(), 0),
    };
  }

  private logPerformance(): void {
    const perf = this.performance();
    console.log(
      `[perf] tick=${perf.tickMs}ms avgTick=${perf.avgTickMs}ms task=${perf.lastTaskMs}ms path=${perf.pathMs}ms activePaths=${perf.activePaths} llmInFlight=${perf.llmInFlight} llm=${perf.llmLastMs}ms events/min=${perf.eventsLastMinute} reconnects=${perf.reconnectAttempts}`,
    );
  }

  private refreshSnapshot(): void {
    const names: Record<string, string> = {};
    const citizens = [...this.citizens.values()].map((c) => {
      names[c.record.id] = c.record.name;
      names[c.record.name] = c.record.name;
      return {
        ...c.record,
        inventory: c.body.inventory(),
        connected: c.body.connected,
        busy: c.busy,
        connectionHealth: c.body.connectionTelemetry().health,
      };
    });
    const rawEvents = this.events.getRecent(80);
    const settlement = this.store.getSettlement();
    const inventories = citizens.map((c) => c.inventory);
    const inventoryView = deriveSettlementInventory(inventories, settlement.storageContents, this.runtime.reservations);
    const loop = this.loop.snapshot();
    const paths = pathMetrics();
    this.snapshot = {
      updatedAt: new Date().toISOString(),
      population: this.citizens.size,
      activeBots: citizens.filter((c) => c.connected).length,
      runId: this.runId,
      permadeath: this.config.SIM_PERMADEATH_ENABLED,
      humanDirectivesEnabled: this.config.HUMAN_DIRECTIVES_ENABLED,
      developmentMode: !this.config.SIM_PERMADEATH_ENABLED,
      citizens,
      settlement,
      project: this.runtime.project,
      inventoryView,
      workers: citizens
        .filter((c) => c.status !== "dead")
        .map((c) => ({ name: c.name, task: c.currentTask ?? "idle", occupation: c.occupation })),
      directives: this.directives.list(20),
      events: rawEvents,
      presentedEvents: rawEvents.map((event) => formatSimEvent(event, names)),
      memories: citizens.flatMap((c) => this.store.getMemories(c.id, 5)),
      relationships: citizens.flatMap((c) => this.store.listRelationships(c.id)),
      llmCalls: this.store.recentLlmCalls(30),
      performance: {
        ...this.performance(),
        eventLoopLagMs: loop.lagMs,
        worstEventLoopLagMs: loop.worstLagMs,
        pathAttempts: paths.attempts,
        pathSuccess: paths.success,
        pathTimeouts: paths.timeout,
        pathStuck: paths.stuck,
        congestionYields: paths.yields,
      },
    };
  }
}

export type DashboardSnapshot = {
  updatedAt: string;
  population: number;
  activeBots: number;
  runId?: string;
  permadeath?: boolean;
  humanDirectivesEnabled?: boolean;
  developmentMode?: boolean;
  citizens: Array<
    CitizenRecord & {
      inventory: Array<{ name: string; count: number }>;
      connected: boolean;
      busy: boolean;
      connectionHealth?: string;
    }
  >;
  settlement: SettlementState;
  project?: SettlementProject;
  inventoryView?: SettlementInventoryView;
  workers?: Array<{ name: string; task: string; occupation?: string }>;
  directives?: HumanDirective[];
  events: SimEvent[];
  presentedEvents: PresentedEvent[];
  memories: ReturnType<CivilizationStore["getMemories"]>;
  relationships: ReturnType<CivilizationStore["listRelationships"]>;
  llmCalls: Array<Record<string, unknown>>;
  performance: PerformanceSnapshot & {
    eventLoopLagMs?: number;
    worstEventLoopLagMs?: number;
    pathAttempts?: number;
    pathSuccess?: number;
    pathTimeouts?: number;
    pathStuck?: number;
    congestionYields?: number;
  };
};

function emptySnapshot(): DashboardSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    population: 0,
    activeBots: 0,
    citizens: [],
    settlement: {
      id: "settlement_first",
      name: "First Settlement",
      food: 0,
      wood: 0,
      stone: 0,
      beds: 0,
      housingCapacity: 0,
      tools: 0,
      shelterComplete: false,
      needs: [],
    },
    events: [],
    presentedEvents: [],
    memories: [],
    relationships: [],
    llmCalls: [],
    performance: {
      tickMs: 0,
      avgTickMs: 0,
      lastTaskMs: 0,
      pathMs: 0,
      activePaths: 0,
      llmInFlight: 0,
      llmLastMs: 0,
      eventsLastMinute: 0,
      reconnectAttempts: 0,
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { CivilizationStore } from "./store.js";
