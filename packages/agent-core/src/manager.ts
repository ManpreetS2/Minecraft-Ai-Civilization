import { MinecraftBody, activePathCount, lastPathDurationMs, pathMetrics } from "@civ/minecraft-adapter";
import { createCognition, type CognitionProvider, type HighLevelDecision } from "@civ/cognition";
import { createMemory, retrieveRelevant } from "@civ/memory";
import { applySocialEvent, sameWorkFamily, SocialDirector } from "@civ/society";
import {
  createEvent,
  DEFAULT_CITIZENS,
  isMechanicsProbeUsername,
  EventBus,
  EventLoopMonitor,
  formatSimEvent,
  resolveFromRoot,
  yieldEventLoop,
  type AppConfig,
  type CitizenRecord,
  type PresentedEvent,
  type SettlementNeed,
  type SettlementState,
  type SimEvent,
  type Vec3,
} from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import { authorizedWorkStorage } from "./activity-choice.js";
import { listAvailableHomes } from "./available-homes.js";
import { experimentWorkAssignment, planCitizen, type LastOutcome, type PlannedTask, type WorkRole } from "./planner.js";
import { shouldAbortActiveWorkForCurfew } from "./curfew-runtime.js";
import {
  cancelCitizenWork,
  decisionKind,
  lastOutcomeFrom,
  loadCitizenLastOutcome,
  physicalWorkComplete,
  persistCitizenLastOutcome,
  skillStatusOf,
  taskEventType,
} from "./task-recovery.js";
import { listDiscoveredSites, visibleShoresFromWorld } from "./discovered-sites.js";
import { bodyContext, completeVerifiedTransfer, completionMemoryForTask, executePlan } from "./executor.js";
import { deriveSettlementInventory, type SettlementInventoryView } from "./inventory-view.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import type { SettlementProject } from "./projects.js";
import { CivilizationStore, type StoreWriteResult } from "./store.js";
import { DirectiveBoard } from "./directives.js";
import { applyBodyRespawn, applyTemporaryBodyDeath, applyTerminalDeath } from "./lifecycle.js";
import { OperationTracker, type DrainResult } from "./operation-tracker.js";
import type { DirectiveMode, HumanDirective } from "./directive-parse.js";

export type AgentManagerHooks = {
  drainTimeoutMs?: number;
};

type RuntimeCitizen = {
  record: CitizenRecord;
  body: MinecraftBody;
  busy: boolean;
  abort?: AbortController;
  lastLlmAt: number;
  lastChatAt: number;
  lastPlan?: PlannedTask;
  lastOutcome?: LastOutcome;
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
  private stopPromise?: Promise<void>;
  private lastDrain?: DrainResult;
  private readonly ops = new OperationTracker();
  private readonly hooks: AgentManagerHooks;
  private snapshot: DashboardSnapshot;
  private lastTickMs = 0;
  private runId = "";
  private readonly loop = new EventLoopMonitor();
  private readonly runtime = new SettlementRuntime();
  private readonly directives: DirectiveBoard;
  private readonly pendingDrops = new Map<string, { item: string; count: number; giverId: string; giverBefore: number }>();

  constructor(config: AppConfig, store?: CivilizationStore, hooks?: AgentManagerHooks) {
    this.config = config;
    this.hooks = hooks ?? {};
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
      if (!this.ops.canWrite() || !this.store.isOpen()) return;
      const wrote = this.store.safeWrite("appendEvent", () => this.store.appendEvent(event));
      if (!wrote.ok) return;
      if (event.type === "CitizenDied") this.handleDeathEvent(event);
      if (event.type === "CitizenBodyDied") this.handleBodyDied(event);
      if (event.type === "CitizenRespawned") this.handleRespawned(event);
      if (event.type === "ItemTransferred" || event.type === "ItemDropped") this.notePendingDrop(event);
    });
  }

  pendingOps(): number {
    return this.ops.size;
  }

  /** Last shutdown drain outcome (undefined until stop() runs). */
  lastShutdownDrain(): DrainResult | undefined {
    return this.lastDrain;
  }

  private canRun(): boolean {
    return this.running && this.ops.canAcceptWork() && this.store.isOpen();
  }

  private reportWrite(label: string, result: StoreWriteResult): boolean {
    if (result.ok) return true;
    if (result.reason === "closed") {
      console.warn(`[shutdown] skipped durable write after close: ${label}`);
      return false;
    }
    console.error(`[store] durable write failed (${label})`, result.error);
    return false;
  }

  private writeCitizen(record: CitizenRecord): boolean {
    if (!this.ops.canWrite() || !this.store.isOpen()) return false;
    return this.reportWrite(
      "upsertCitizen",
      this.store.safeWrite("upsertCitizen", () => this.store.upsertCitizen(record)),
    );
  }

  private writeMemory(...args: Parameters<CivilizationStore["addMemory"]>): boolean {
    if (!this.ops.canWrite() || !this.store.isOpen()) return false;
    return this.reportWrite(
      "addMemory",
      this.store.safeWrite("addMemory", () => this.store.addMemory(...args)),
    );
  }

  private writeRelationship(...args: Parameters<CivilizationStore["saveRelationship"]>): boolean {
    if (!this.ops.canWrite() || !this.store.isOpen()) return false;
    return this.reportWrite(
      "saveRelationship",
      this.store.safeWrite("saveRelationship", () => this.store.saveRelationship(...args)),
    );
  }

  private writeLlmCall(...args: Parameters<CivilizationStore["logLlmCall"]>): boolean {
    if (!this.ops.canWrite() || !this.store.isOpen()) return false;
    return this.reportWrite(
      "logLlmCall",
      this.store.safeWrite("logLlmCall", () => this.store.logLlmCall(...args)),
    );
  }

  private emitIfLive(event: SimEvent): void {
    if (!this.ops.canWrite() || !this.store.isOpen()) return;
    this.events.emit(event);
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

  /**
   * Connect roster bodies. `deferTicks` skips the first planner tick so a
   * WORLD-LAB launcher can inspect spawn (pond vs house) before Atlas acts.
   * Default remains: connect then tick immediately.
   */
  async start(count = this.config.SIM_CITIZEN_COUNT, options?: { deferTicks?: boolean }): Promise<void> {
    if (this.ops.isShuttingDown || this.ops.isClosed) {
      throw new Error("Cannot start AgentManager while shutting down or after stop");
    }
    if (this.running) return;
    this.running = true;
    this.loop.start();
    this.runId = crypto.randomUUID();
    this.store.setMeta("runId", this.runId);
    this.store.setMeta("humanDirectives", String(this.config.HUMAN_DIRECTIVES_ENABLED));
    this.store.setMeta("permadeath", String(this.config.SIM_PERMADEATH_ENABLED));
    const wanted = DEFAULT_CITIZENS.slice(0, count).filter((identity) => !isMechanicsProbeUsername(identity.name));
    this.emitIfLive(
      createEvent("SimulationStarted", {
        citizens: wanted.map((c) => c.name),
        runId: this.runId,
        permadeath: this.config.SIM_PERMADEATH_ENABLED,
        humanDirectives: this.config.HUMAN_DIRECTIVES_ENABLED,
      }),
    );

    for (const identity of wanted) {
      if (!this.canRun()) break;
      if (isMechanicsProbeUsername(identity.name) || isMechanicsProbeUsername(identity.id)) continue;
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
      // Guarantee an `error` listener so transport faults stay observable without crashing Node.
      body.on("error", (error) => {
        console.warn(`[body] ${identity.name} error: ${error.message}`);
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
        lastOutcome: loadCitizenLastOutcome(this.store, identity.id),
      });
      if (record.status === "dead") {
        continue;
      }
      const connecting = body.connect();
      void this.ops.track(connecting);
      const result = await connecting;
      if (!this.canRun() || !this.store.isOpen()) {
        if (result.success || body.connected) await body.disconnect("startup-interrupted");
        break;
      }
      record.status = result.success ? "online" : "error";
      record.reason = result.success ? "connected" : result.error;
      this.writeCitizen(record);
      await delay(1500);
    }

    this.perfTimer = setInterval(() => this.logPerformance(), 30_000);
    if (options?.deferTicks) return;
    if (!this.canRun()) return;
    await this.resumeTicks();
  }

  /** Arm the planner loop after a `start(..., { deferTicks: true })` spawn check. */
  async resumeTicks(): Promise<void> {
    if (!this.canRun() || this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.config.SIM_TICK_MS);
    await this.tick();
  }

  plannerTicksArmed(): boolean {
    return Boolean(this.tickTimer);
  }

  /** Concurrent callers share one shutdown promise. */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.performStop();
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    this.running = false;
    this.loop.stop();
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    if (this.perfTimer) clearInterval(this.perfTimer);
    this.perfTimer = undefined;
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
        this.writeCitizen(citizen.record);
      }
    }
    this.emitIfLive(createEvent("SimulationStopped", {}));
    this.store.close();
  }

  private async tick(): Promise<void> {
    if (!this.canRun()) return;
    const work = this.runTick();
    void this.ops.track(work);
    await work;
  }

  private async runTick(): Promise<void> {
    if (!this.canRun()) return;
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
    const { roles, assignedNeeds: assignments } = experimentWorkAssignment(
      online.map((c) => c.record.id),
      settlement.needs,
      this.config.SIM_ASSIGN_WORK_ROLES,
    );

    for (const citizen of this.citizens.values()) {
      try {
        await this.tickCitizen(citizen, settlement, assignments.get(citizen.record.id) ?? [], roles.get(citizen.record.id));
        await yieldEventLoop();
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
          this.writeCitizen(citizen.record);
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
    assignedNeeds: SettlementNeed[],
    workRole?: WorkRole,
  ): Promise<void> {
    if (!this.ops.canAcceptWork()) return;
    if (citizen.body.isDeceased() || (this.config.SIM_PERMADEATH_ENABLED && citizen.record.status === "dead")) {
      citizen.record.status = "dead";
      return;
    }
    if (citizen.body.isAwaitingRespawn()) {
      citizen.record.status = "respawning";
      this.writeCitizen(citizen.record);
      return;
    }

    const observation = citizen.body.observe();
    citizen.record.lastKnownPosition = observation.position;
    citizen.record.health = observation.health;
    citizen.record.hunger = observation.food;
    citizen.record.status = observation.spawned ? "online" : citizen.body.connected ? "connecting" : "offline";

    if (citizen.busy || !observation.spawned) {
      if (
        citizen.busy &&
        observation.spawned &&
        shouldAbortActiveWorkForCurfew({
          busy: true,
          lastAction: citizen.lastPlan?.action,
          lastTask: citizen.lastPlan?.task,
          home: this.store.getCitizenHome(citizen.record.id),
          position: observation.position,
          timeOfDay: observation.gameTime,
          isNight: observation.isNight,
        })
      ) {
        cancelCitizenWork(citizen);
      }
      this.writeCitizen(citizen.record);
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

    if (llmDue && this.ops.canAcceptWork()) {
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
      const decisionWork = this.cognition
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
          if (!this.ops.canWrite()) return;
          citizen.pendingLlm = decision;
          this.writeLlmCall({
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
          this.writeLlmCall({
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

    const claimedHome = this.store.getCitizenHome(citizen.record.id);
    const plan = planCitizen({
      citizenId: citizen.record.id,
      observation,
      settlement,
      assignedNeeds,
      workRole,
      llmGoal: llmDecision?.goal,
      llmReason: llmDecision?.reason,
      projectStatus: this.runtime.project?.status,
      lastOutcome: citizen.lastOutcome,
      home: claimedHome
        ? {
            homeId: claimedHome.homeId,
            bed: claimedHome.bed,
            status: claimedHome.status,
            origin: claimedHome.origin,
            entrance: claimedHome.entrance,
            personalChest: claimedHome.personalChest,
          }
        : undefined,
      knownSites: listDiscoveredSites(this.store),
      visibleShores: visibleShoresFor(citizen.body, observation.position),
      authorizedStorage: authorizedWorkStorage(this.store, citizen.record.id),
      availableHomes: listAvailableHomes(this.store),
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
    this.writeCitizen(citizen.record);

    if (plan.task !== "observe") {
      this.emitIfLive(
        createEvent(
          "TaskStarted",
          {
            task: plan.task,
            goal: plan.goal,
            source: plan.source,
            reason: plan.reason,
            item: plan.item,
            target: plan.target,
            blocked: plan.blocked,
            options: plan.trace?.options.map((entry) => entry.action),
            chosen: plan.trace?.chosen?.action,
            decisionKind: decisionKind(citizen.record.id, "intent"),
          },
          citizen.record.id,
        ),
      );
    }

    if (!this.ops.canAcceptWork()) return;

    const ctx = bodyContext(citizen.body, undefined, this.events, citizen.record.id);
    if (!ctx) return;

    citizen.busy = true;
    citizen.abort = new AbortController();
    ctx.signal = citizen.abort.signal;

    const taskStarted = Date.now();
    const taskWork = executePlan(ctx, plan, this.store, this.events, this.runtime)
      .then((result) => {
        lastTaskMs = Date.now() - taskStarted;
        if (!this.ops.canWrite()) return;
        citizen.lastOutcome = lastOutcomeFrom(plan, result, citizen.lastOutcome);
        persistCitizenLastOutcome(this.store, citizen.record.id, citizen.lastOutcome);
        if (plan.task !== "observe") {
          this.emitIfLive(
            createEvent(
              taskEventType(result),
              {
                task: plan.task,
                success: result.success,
                code: result.success ? undefined : result.code,
                error: result.success ? undefined : result.error,
                decisionKind: decisionKind(citizen.record.id, "result"),
                skillStatus: skillStatusOf(result),
                workComplete: citizen.lastOutcome.workComplete,
                collected: citizen.lastOutcome.collected,
              },
              citizen.record.id,
            ),
          );
        }
        if (!result.success && shouldRememberFailure(result.code, plan.item)) {
          this.writeMemory(
            createMemory(citizen.record.id, "episodic", `Task ${plan.task} failed: ${result.error}`, 0.45),
          );
        } else if (result.success) {
          const memory = completionMemoryForTask(plan.task, result);
          if (memory) {
            this.writeMemory(createMemory(citizen.record.id, "episodic", memory, 0.4));
          }
        }
        this.maybeCollectDropped(citizen);
        this.maybeSocial(citizen, physicalWorkComplete(result));
      })
      .catch((error: unknown) => {
        lastTaskMs = Date.now() - taskStarted;
        if (!this.ops.canWrite()) return;
        citizen.lastOutcome = {
          task: plan.task,
          action: plan.action,
          success: false,
          error: String(error),
          item: plan.item,
          streak: citizen.lastOutcome?.task === plan.task ? (citizen.lastOutcome.streak ?? 0) + 1 : 1,
          workComplete: false,
          skillStatus: "FAILED",
          unresolved: citizen.lastOutcome?.unresolved,
        };
        persistCitizenLastOutcome(this.store, citizen.record.id, citizen.lastOutcome);
        this.emitIfLive(
          createEvent(
            "TaskFailed",
            {
              task: plan.task,
              error: String(error),
              decisionKind: decisionKind(citizen.record.id, "result"),
              workComplete: false,
              skillStatus: "FAILED",
            },
            citizen.record.id,
          ),
        );
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
      if (!this.writeRelationship(rel)) return;
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
    this.writeMemory(createMemory(citizen.record.id, "social", decision.message, 0.5, other.record.id));
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
    let rel = this.store.getRelationship(citizen.record.id, other.record.id);
    rel = applySocialEvent(rel, "proximity");
    this.writeRelationship(rel);
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
    this.writeCitizen(citizen.record);
  }

  private handleRespawned(event: SimEvent): void {
    const citizen = this.citizens.get(event.citizenId ?? "");
    if (!citizen) return;
    applyBodyRespawn(citizen);
    this.writeCitizen(citizen.record);
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
          cancelCitizenWork(citizen);
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
    cancelCitizenWork(citizen);
    citizen.body.stopPathfinding();
    citizen.busy = false;
    this.runtime.releaseCitizen(citizen.record.id);
    this.directives.cancelForCitizen(citizen.record.id, "stopped by human");
    citizen.record.currentTask = undefined;
    citizen.record.reason = "stopped by human; replanning";
    this.writeCitizen(citizen.record);
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

function visibleShoresFor(body: MinecraftBody, position: Vec3 | undefined): Array<{ stand: Vec3; water: Vec3 }> {
  const bot = body.getBot();
  if (!bot || !position) return [];
  try {
    return visibleShoresFromWorld(position, (pos: Vec3) => {
      const block = bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
      if (!block) return undefined;
      return { name: block.name, boundingBox: block.boundingBox };
    });
  } catch {
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INFRA_FAILURES = new Set([
  "TIMEOUT",
  "NOT_CONNECTED",
  "KICKED",
  "CANCELLED",
  "INTERRUPTED",
  "CURFEW_STOP",
  "NOT_SLEEP_TIME",
  "PATH_FAILED",
  "PATH_BLOCKED",
  "HAZARD_BLOCKED",
  "INTERIOR_UNREACHABLE",
]);

function shouldRememberFailure(code: string, item?: string): boolean {
  if (INFRA_FAILURES.has(code)) return false;
  if (code === "PURPOSELESS_PLACEMENT") return false;
  if ((code === "NO_RECIPE" || code === "UNKNOWN_RECIPE") && item && minecraftKnowledge().recipeExists(item)) {
    return false;
  }
  return true;
}

export { CivilizationStore } from "./store.js";
