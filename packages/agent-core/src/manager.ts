import {
  MinecraftBody,
  activePathCount,
  lastPathDurationMs,
  type MinecraftBodyOptions,
} from "@civ/minecraft-adapter";
import { createCognition, type CognitionProvider, type HighLevelDecision } from "@civ/cognition";
import { createMemory, retrieveRelevant } from "@civ/memory";
import { applySocialEvent, sameWorkFamily, SocialDirector } from "@civ/society";
import {
  createEvent,
  DEFAULT_CITIZENS,
  EventBus,
  formatSimEvent,
  resolveFromRoot,
  type AppConfig,
  type CitizenRecord,
  type PresentedEvent,
  type SettlementState,
  type SimEvent,
  type Vec3,
} from "@civ/shared";
import { assignSettlementNeeds, planCitizen, type PlannedTask } from "./planner.js";
import { bodyContext, executePlan } from "./executor.js";
import { isDeferredGoal } from "./goal-dispatch.js";
import { OperationTracker, type DrainResult } from "./lifecycle.js";
import { CivilizationStore, type StoreWriteResult } from "./store.js";

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

export type AgentManagerHooks = {
  /** Awaited after a tick is tracked, before any store reads (tests: suspend vs stop). */
  beforeTick?: () => Promise<void>;
  /** Awaited after the settlement read, before the citizen loop / snapshot. */
  afterTickReads?: () => Promise<void>;
  /** Injectable Mineflayer body factory — tests must not connect to a real server. */
  bodyFactory?: (options: MinecraftBodyOptions) => MinecraftBody;
  /** Override drain timeout (tests). */
  drainTimeoutMs?: number;
};

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
  private starting = false;
  private stopPromise?: Promise<void>;
  private lastDrain?: DrainResult;
  private readonly ops = new OperationTracker();
  private readonly hooks: AgentManagerHooks;
  private unsubscribeEvents?: () => void;
  private snapshot: DashboardSnapshot;
  private lastTickMs = 0;
  private activeTick?: Promise<void>;
  private emittingPersistenceError = false;

  constructor(
    config: AppConfig,
    store?: CivilizationStore,
    cognition?: CognitionProvider,
    hooks: AgentManagerHooks = {},
  ) {
    this.config = config;
    this.store = store ?? new CivilizationStore(resolveFromRoot(config.DATABASE_PATH));
    this.cognition = cognition ?? createCognition(config);
    this.hooks = hooks;
    this.snapshot = emptySnapshot();
    this.unsubscribeEvents = this.events.on((event) => {
      if (!this.store.isOpen()) return;
      this.eventTimes.push(Date.now());
      const wrote = this.store.safeWrite("appendEvent", () => this.store.appendEvent(event));
      if (!wrote.ok && wrote.reason === "error") {
        // Never emit another event here — persistence failures must not recurse.
        console.error(
          `[manager] unexpected event persistence failure: ${wrote.error instanceof Error ? wrote.error.message : String(wrote.error)}`,
        );
      }
      if (event.type === "CitizenDied") this.handleDeathEvent(event);
    });
  }

  /** Test/diagnostics: outstanding cognition + action promises. */
  pendingOperationCount(): number {
    return this.ops.size;
  }

  /** Last shutdown drain outcome (undefined until stop() runs). */
  lastShutdownDrain(): DrainResult | undefined {
    return this.lastDrain;
  }

  /** True while start() is connecting citizens and has not finished. */
  isStarting(): boolean {
    return this.starting;
  }

  private shouldContinueStartup(): boolean {
    return this.running && this.ops.canAcceptWork() && this.store.isOpen();
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
    if (this.ops.isShuttingDown || this.ops.isClosed) {
      throw new Error("Cannot start AgentManager while shutting down or after stop");
    }
    if (this.running) return;
    this.running = true;
    this.starting = true;
    const wanted = DEFAULT_CITIZENS.slice(0, count);
    if (this.store.isOpen()) {
      this.events.emit(createEvent("SimulationStarted", { citizens: wanted.map((c) => c.name) }));
    }

    try {
      for (const identity of wanted) {
        if (!this.shouldContinueStartup()) break;
        if (!this.store.isOpen()) break;
        const record = this.store.getCitizen(identity.id) ?? {
          id: identity.id,
          name: identity.name,
          minecraftUsername: identity.name,
          createdAt: new Date().toISOString(),
          status: "offline" as const,
        };
        const bodyFactory = this.hooks.bodyFactory ?? ((options) => new MinecraftBody(options));
        const body = bodyFactory({
          username: identity.name,
          config: this.config,
          events: this.events,
          citizenId: identity.id,
          reconnect: record.status !== "dead",
          allowRespawn: false,
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
        if (!this.shouldContinueStartup()) break;
        const connecting = body.connect();
        void this.ops.track(connecting);
        const result = await connecting;
        if (!this.shouldContinueStartup() || !this.store.isOpen()) {
          if (result.success || body.connected) await body.disconnect("startup-interrupted");
          break;
        }
        record.status = result.success ? "online" : "error";
        record.reason = result.success ? "connected" : result.error;
        this.persistCitizen(record);
        await this.interruptibleDelay(1500);
      }

      if (!this.shouldContinueStartup()) {
        this.running = false;
        return;
      }

      this.tickTimer = setInterval(() => {
        void this.tick();
      }, this.config.SIM_TICK_MS);
      this.perfTimer = setInterval(() => this.logPerformance(), 30_000);
      await this.tick();
    } finally {
      this.starting = false;
    }
  }

  /** Concurrent callers share one shutdown promise (not wrapped by async). */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.performStop();
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    if (this.perfTimer) {
      clearInterval(this.perfTimer);
      this.perfTimer = undefined;
    }

    for (const citizen of this.citizens.values()) {
      citizen.abort?.abort();
    }

    this.lastDrain = await this.ops.drainAndClose(this.hooks.drainTimeoutMs ?? 8_000);
    if (!this.lastDrain.fullyDrained) {
      console.warn(
        `[shutdown] drain incomplete: attempted=${this.lastDrain.attempted} remaining=${this.lastDrain.remaining} timedOut=${this.lastDrain.timedOut}`,
      );
    }

    for (const citizen of this.citizens.values()) {
      if (!citizen.body.isDeceased()) {
        await citizen.body.disconnect("simulation-stop");
        if (citizen.record.status !== "dead") citizen.record.status = "offline";
        this.persistCitizen(citizen.record);
      }
    }

    if (this.store.isOpen()) {
      this.events.emit(createEvent("SimulationStopped", {
        drain: this.lastDrain,
        fullyDrained: this.lastDrain.fullyDrained,
      }));
      this.store.close();
    }
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
  }

  private reportWrite(label: string, result: StoreWriteResult): StoreWriteResult {
    if (result.ok || result.reason === "closed") return result;
    console.error(`[manager] unexpected persistence failure (${label})`);
    if (this.emittingPersistenceError || !this.store.isOpen()) return result;
    this.emittingPersistenceError = true;
    try {
      this.events.emit(
        createEvent("ErrorOccurred", {
          error: `Persistence failed (${label}): ${result.error instanceof Error ? result.error.message : String(result.error)}`,
          durable: false,
        }),
      );
    } finally {
      this.emittingPersistenceError = false;
    }
    return result;
  }

  private persistCitizen(record: CitizenRecord): StoreWriteResult {
    return this.reportWrite("upsertCitizen", this.store.safeWrite("upsertCitizen", () => this.store.upsertCitizen(record)));
  }

  private persistMemory(...args: Parameters<CivilizationStore["addMemory"]>): StoreWriteResult {
    return this.reportWrite("addMemory", this.store.safeWrite("addMemory", () => this.store.addMemory(...args)));
  }

  private persistLlmCall(...args: Parameters<CivilizationStore["logLlmCall"]>): StoreWriteResult {
    return this.reportWrite("logLlmCall", this.store.safeWrite("logLlmCall", () => this.store.logLlmCall(...args)));
  }

  private persistRelationship(...args: Parameters<CivilizationStore["saveRelationship"]>): StoreWriteResult {
    return this.reportWrite(
      "saveRelationship",
      this.store.safeWrite("saveRelationship", () => this.store.saveRelationship(...args)),
    );
  }

  private emitIfLive(event: SimEvent): void {
    if (!this.ops.canWrite() || !this.store.isOpen()) return;
    this.events.emit(event);
  }

  private async interruptibleDelay(ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until && this.shouldContinueStartup()) {
      await delay(Math.min(50, until - Date.now()));
    }
  }

  private tick(): Promise<void> {
    if (this.activeTick) return this.activeTick;
    if (!this.running || !this.ops.canAcceptWork() || !this.store.isOpen()) {
      return Promise.resolve();
    }
    const work = this.runTick();
    this.activeTick = this.ops
      .track(work)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        this.activeTick = undefined;
      });
    return this.activeTick;
  }

  private async runTick(): Promise<void> {
    await this.hooks.beforeTick?.();
    if (!this.running || !this.ops.canAcceptWork() || !this.store.isOpen()) return;

    const started = Date.now();
    const online = [...this.citizens.values()].filter((c) => c.body.connected && !c.body.isDeceased());
    const settlementRead = this.store.safeRead("getSettlement", () => this.store.getSettlement());
    if (!settlementRead.ok) return;
    const settlement = settlementRead.value;
    const assignments = assignSettlementNeeds(
      online.map((c) => c.record.id),
      settlement.needs,
    );

    await this.hooks.afterTickReads?.();
    if (!this.running || !this.store.isOpen()) return;

    for (const citizen of this.citizens.values()) {
      if (!this.store.isOpen()) return;
      try {
        await this.tickCitizen(citizen, settlement, assignments.get(citizen.record.id) ?? []);
      } catch (error) {
        this.emitIfLive(
          createEvent(
            "ErrorOccurred",
            { error: error instanceof Error ? error.message : String(error) },
            citizen.record.id,
          ),
        );
        citizen.busy = false;
        if (citizen.record.status !== "dead") {
          citizen.record.status = citizen.body.connected ? "error" : "offline";
          this.persistCitizen(citizen.record);
        }
      }
    }
    this.lastTickMs = Date.now() - started;
    this.tickSamples.push(this.lastTickMs);
    if (this.tickSamples.length > 40) this.tickSamples.shift();
    if (!this.store.isOpen()) return;
    this.refreshSnapshot();
  }

  private async tickCitizen(
    citizen: RuntimeCitizen,
    settlement: SettlementState,
    assignedNeeds: ReturnType<typeof assignSettlementNeeds> extends Map<string, infer V> ? V : never,
  ): Promise<void> {
    if (!this.ops.canAcceptWork()) return;
    if (citizen.record.status === "dead" || citizen.body.isDeceased()) {
      citizen.record.status = "dead";
      return;
    }

    const observation = citizen.body.observe();
    citizen.record.lastKnownPosition = observation.position;
    citizen.record.health = observation.health;
    citizen.record.hunger = observation.food;
    citizen.record.status = observation.spawned ? "online" : citizen.body.connected ? "connecting" : "offline";

    if (citizen.busy || !observation.spawned) {
      this.persistCitizen(citizen.record);
      return;
    }

    const llmDecision: HighLevelDecision | undefined = citizen.pendingLlm;
    citizen.pendingLlm = undefined;
    const now = Date.now();
    const llmDue =
      this.config.LLM_ENABLED &&
      llmInFlight === 0 &&
      now - citizen.lastLlmAt > this.config.LLM_COOLDOWN_MS &&
      (assignedNeeds.length > 1 || (observation.food ?? 20) < 12 || Boolean(observation.nearby.find((e) => e.hostile)));

    if (llmDue && this.ops.canAcceptWork()) {
      citizen.lastLlmAt = now;
      llmInFlight += 1;
      const started = Date.now();
      const memoryRead = this.store.safeRead("getMemories", () => this.store.getMemories(citizen.record.id));
      const memories = memoryRead.ok
        ? retrieveRelevant(memoryRead.value, assignedNeeds.join(" "), 5)
        : [];
      const decisionWork = this.cognition
        .decide({
          citizenName: citizen.record.name,
          health: observation.health,
          hunger: observation.food,
          occupation: citizen.record.occupation,
          inventory: observation.inventory.map((i) => `${i.name} x${i.count}`),
          settlementNeeds: settlement.needs,
          memories: memories.map((m) => m.content),
          nearbyCitizens: observation.players.map((p) => p.username),
        })
        .then((decision) => {
          lastLlmMs = Date.now() - started;
          if (!this.ops.canWrite()) return;
          citizen.pendingLlm = decision;
          this.persistLlmCall({
            citizenId: citizen.record.id,
            latencyMs: lastLlmMs,
            ok: true,
            goal: decision.goal,
            reason: decision.reason,
          });
          this.emitIfLive(
            createEvent(
              "LLMDecisionMade",
              { goal: decision.goal, reason: decision.reason, provider: this.cognition.name },
              citizen.record.id,
            ),
          );
        })
        .catch((error: unknown) => {
          lastLlmMs = Date.now() - started;
          if (!this.ops.canWrite()) return;
          this.persistLlmCall({
            citizenId: citizen.record.id,
            latencyMs: lastLlmMs,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
          this.emitIfLive(
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
      void this.ops.track(decisionWork);
    }

    const plan = planCitizen({
      citizenId: citizen.record.id,
      observation,
      settlement,
      assignedNeeds,
      llmGoal: llmDecision?.goal,
      llmReason: llmDecision?.reason,
    });
    citizen.lastPlan = plan;
    citizen.record.currentGoal = plan.goal;
    citizen.record.currentTask = plan.task;
    citizen.record.currentAction = plan.action;
    citizen.record.decisionSource = plan.source;
    citizen.record.reason = plan.reason;
    if (plan.occupation) citizen.record.occupation = plan.occupation;
    this.persistCitizen(citizen.record);

    if (plan.task !== "observe") {
      this.emitIfLive(
        createEvent(
          "TaskStarted",
          { task: plan.task, goal: plan.goal, source: plan.source, reason: plan.reason },
          citizen.record.id,
        ),
      );
    }

    const ctx = bodyContext(citizen.body, undefined, this.events, citizen.record.id);
    if (!ctx) return;
    if (!this.ops.canAcceptWork()) return;

    citizen.busy = true;
    citizen.abort = new AbortController();
    ctx.signal = citizen.abort.signal;

    const taskStarted = Date.now();
    const taskWork = executePlan(ctx, plan, this.store, this.events)
      .then((result) => {
        lastTaskMs = Date.now() - taskStarted;
        if (!this.ops.canWrite()) return;
        if (plan.task !== "observe") {
          this.emitIfLive(
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
          this.persistMemory(
            createMemory(citizen.record.id, "episodic", `Task ${plan.task} failed: ${result.error}`, 0.45),
          );
        } else if (plan.task === "gather_food") {
          const acquired =
            result.data &&
            typeof result.data === "object" &&
            (result.data as { acquired?: unknown }).acquired === true;
          if (acquired) {
            const gained = (result.data as { foodGained?: number }).foodGained;
            this.persistMemory(
              createMemory(
                citizen.record.id,
                "episodic",
                `Newly gathered food${typeof gained === "number" ? ` (+${gained})` : ""}`,
                0.4,
              ),
            );
          }
        } else if (plan.task === "gather_wood" || plan.task === "build_shelter") {
          this.persistMemory(createMemory(citizen.record.id, "episodic", `Completed ${plan.task}`, 0.4));
        }
        this.maybeSocial(citizen, result.success);
      })
      .catch((error: unknown) => {
        lastTaskMs = Date.now() - taskStarted;
        if (!this.ops.canWrite()) return;
        this.emitIfLive(createEvent("TaskFailed", { task: plan.task, error: String(error) }, citizen.record.id));
      })
      .finally(() => {
        citizen.busy = false;
      });
    void this.ops.track(taskWork);
  }

  private maybeSocial(citizen: RuntimeCitizen, taskSucceeded: boolean): void {
    if (!this.ops.canWrite() || !this.store.isOpen()) return;
    if (citizen.body.isDeceased() || citizen.record.status === "dead") return;
    const task = citizen.lastPlan?.task ?? "";
    const goal = citizen.lastPlan?.goal ?? "";
    // Deferred / unsupported voluntary goals must not fabricate help, rest, or cooperation evidence.
    if (
      task === "observe" ||
      task === "eat" ||
      task === "deposit" ||
      task === "unsupported_goal" ||
      task === "help_citizen" ||
      task === "rest" ||
      isDeferredGoal(goal)
    ) {
      this.maybeProximity(citizen);
      return;
    }

    const other = this.chooseJointWorker(citizen);
    if (!other) {
      this.maybeProximity(citizen);
      return;
    }

    // Only verified joint work — never invent "helped" from an LLM help_citizen intention.
    const trigger = "cooperated";
    const cause = "joint_work";
    const decision = this.social.considerConversation({
      cause,
      trigger,
      speaker: citizen.record.name,
      other: other.record.name,
      topic: task,
      speakChance: 0.18,
    });

    if (decision.applyRelationship && taskSucceeded) {
      const relRead = this.store.safeRead("getRelationship", () =>
        this.store.getRelationship(citizen.record.id, other.record.id),
      );
      if (!relRead.ok) return;
      const rel = applySocialEvent(relRead.value, trigger);
      const wrote = this.persistRelationship(rel);
      if (!wrote.ok) {
        // Physical/social moment may have happened; do not claim a durable relationship change.
        return;
      }
      this.social.noteRelationshipApplied(citizen.record.name, other.record.name, trigger, task);
      this.emitIfLive(
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
    this.emitIfLive(
      createEvent("ConversationOccurred", { message: decision.message, other: other.record.name, cause }, citizen.record.id),
    );
    this.persistMemory(createMemory(citizen.record.id, "social", decision.message, 0.5, other.record.id));
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
    if (!this.ops.canWrite() || !this.store.isOpen()) return;
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
    const relRead = this.store.safeRead("getRelationship", () =>
      this.store.getRelationship(citizen.record.id, other.record.id),
    );
    if (!relRead.ok) return;
    this.persistRelationship(applySocialEvent(relRead.value, "proximity"));
  }

  private handleDeathEvent(event: SimEvent): void {
    if (!this.store.isOpen()) return;
    const id = event.citizenId;
    if (!id) return;
    const position = asVec3(event.payload.position);
    let first = false;
    this.reportWrite(
      "markDeceased",
      this.store.safeWrite("markDeceased", () => {
        first = this.store.markDeceased(id, event.timestamp, position);
      }),
    );
    const citizen = this.citizens.get(id);
    if (citizen) {
      citizen.abort?.abort();
      citizen.busy = false;
      citizen.body.markDeceased();
      citizen.record.status = "dead";
      citizen.record.diedAt = event.timestamp;
      citizen.record.deathPosition = position;
      citizen.record.currentTask = undefined;
      citizen.record.currentAction = undefined;
      citizen.record.reason = "deceased";
    }
    if (!first) return;
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
    if (!this.store.isOpen()) return;
    const names: Record<string, string> = {};
    const citizens = [...this.citizens.values()].map((c) => {
      names[c.record.id] = c.record.name;
      names[c.record.name] = c.record.name;
      return {
        ...c.record,
        inventory: c.body.inventory(),
        connected: c.body.connected,
        busy: c.busy,
      };
    });
    const rawEvents = this.events.getRecent(80);
    const settlement = this.store.safeRead("snapshot.settlement", () => this.store.getSettlement());
    const memories = this.store.safeRead("snapshot.memories", () => citizens.flatMap((c) => this.store.getMemories(c.id, 5)));
    const relationships = this.store.safeRead("snapshot.relationships", () =>
      citizens.flatMap((c) => this.store.listRelationships(c.id)),
    );
    const llmCalls = this.store.safeRead("snapshot.llmCalls", () => this.store.recentLlmCalls(30));
    if (!settlement.ok || !memories.ok || !relationships.ok || !llmCalls.ok) return;
    this.snapshot = {
      updatedAt: new Date().toISOString(),
      population: this.citizens.size,
      activeBots: citizens.filter((c) => c.connected).length,
      citizens,
      settlement: settlement.value,
      events: rawEvents,
      presentedEvents: rawEvents.map((event) => formatSimEvent(event, names)),
      memories: memories.value,
      relationships: relationships.value,
      llmCalls: llmCalls.value,
      performance: this.performance(),
    };
  }
}

export type DashboardSnapshot = {
  updatedAt: string;
  population: number;
  activeBots: number;
  citizens: Array<CitizenRecord & { inventory: Array<{ name: string; count: number }>; connected: boolean; busy: boolean }>;
  settlement: SettlementState;
  events: SimEvent[];
  presentedEvents: PresentedEvent[];
  memories: ReturnType<CivilizationStore["getMemories"]>;
  relationships: ReturnType<CivilizationStore["listRelationships"]>;
  llmCalls: Array<Record<string, unknown>>;
  performance: PerformanceSnapshot;
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

function asVec3(value: unknown): Vec3 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pos = value as { x?: unknown; y?: unknown; z?: unknown };
  if (typeof pos.x !== "number" || typeof pos.y !== "number" || typeof pos.z !== "number") return undefined;
  return { x: pos.x, y: pos.y, z: pos.z };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { CivilizationStore } from "./store.js";

