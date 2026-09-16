import { MinecraftBody } from "@civ/minecraft-adapter";
import { createCognition, type CognitionProvider, type HighLevelDecision } from "@civ/cognition";
import { createMemory, retrieveRelevant } from "@civ/memory";
import { applySocialEvent, maybeConversation } from "@civ/society";
import {
  createEvent,
  DEFAULT_CITIZENS,
  EventBus,
  resolveFromRoot,
  type AppConfig,
  type CitizenRecord,
  type SettlementState,
} from "@civ/shared";
import { assignSettlementNeeds, planCitizen, type PlannedTask } from "./planner.js";
import { bodyContext, executePlan } from "./executor.js";
import { CivilizationStore } from "./store.js";

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

let llmInFlight = false;

export class AgentManager {
  readonly events = new EventBus(400);
  readonly store: CivilizationStore;
  private readonly citizens = new Map<string, RuntimeCitizen>();
  private readonly config: AppConfig;
  private readonly cognition: CognitionProvider;
  private tickTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private snapshot: DashboardSnapshot;

  constructor(config: AppConfig, store?: CivilizationStore) {
    this.config = config;
    this.store = store ?? new CivilizationStore(resolveFromRoot(config.DATABASE_PATH));
    this.cognition = createCognition(config);
    this.snapshot = emptySnapshot();
    this.events.on((event) => this.store.appendEvent(event));
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
    const wanted = DEFAULT_CITIZENS.slice(0, count);
    this.events.emit(createEvent("SimulationStarted", { citizens: wanted.map((c) => c.name) }));

    for (const identity of wanted) {
      const record = this.store.getCitizen(identity.id) ?? {
        id: identity.id,
        name: identity.name,
        minecraftUsername: identity.name,
        createdAt: new Date().toISOString(),
        status: "offline",
      };
      const body = new MinecraftBody({
        username: identity.name,
        config: this.config,
        events: this.events,
        citizenId: identity.id,
      });
      this.citizens.set(identity.id, {
        record,
        body,
        busy: false,
        lastLlmAt: Date.now(),
        lastChatAt: 0,
      });
      const result = await body.connect();
      record.status = result.success ? "online" : "error";
      record.reason = result.success ? "connected" : result.error;
      this.store.upsertCitizen(record);
      await delay(1500);
    }

    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.config.SIM_TICK_MS);
    await this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const citizen of this.citizens.values()) {
      citizen.abort?.abort();
      await citizen.body.disconnect("simulation-stop");
      citizen.record.status = "offline";
      this.store.upsertCitizen(citizen.record);
    }
    this.events.emit(createEvent("SimulationStopped", {}));
    this.store.close();
  }

  private async tick(): Promise<void> {
    const online = [...this.citizens.values()].filter((c) => c.body.connected);
    const settlement = this.store.getSettlement();
    const assignments = assignSettlementNeeds(
      online.map((c) => c.record.id),
      settlement.needs,
    );

    for (const citizen of this.citizens.values()) {
      try {
        await this.tickCitizen(citizen, settlement, assignments.get(citizen.record.id) ?? []);
      } catch (error) {
        this.events.emit(
          createEvent(
            "ErrorOccurred",
            { error: error instanceof Error ? error.message : String(error) },
            citizen.record.id,
          ),
        );
        citizen.busy = false;
        citizen.record.status = citizen.body.connected ? "error" : "offline";
        this.store.upsertCitizen(citizen.record);
      }
    }
    this.refreshSnapshot();
  }

  private async tickCitizen(
    citizen: RuntimeCitizen,
    settlement: SettlementState,
    assignedNeeds: ReturnType<typeof assignSettlementNeeds> extends Map<string, infer V> ? V : never,
  ): Promise<void> {
    const observation = citizen.body.observe();
    citizen.record.lastKnownPosition = observation.position;
    citizen.record.health = observation.health;
    citizen.record.hunger = observation.food;
    citizen.record.status = observation.spawned ? "online" : citizen.body.connected ? "connecting" : "offline";

    if (citizen.busy || !observation.spawned) {
      this.store.upsertCitizen(citizen.record);
      return;
    }

    let llmDecision: HighLevelDecision | undefined = citizen.pendingLlm;
    citizen.pendingLlm = undefined;
    const now = Date.now();
    const llmDue =
      this.config.LLM_ENABLED &&
      !llmInFlight &&
      now - citizen.lastLlmAt > this.config.LLM_COOLDOWN_MS &&
      (assignedNeeds.length > 1 || (observation.food ?? 20) < 12 || Boolean(observation.nearby.find((e) => e.hostile)));

    if (llmDue) {
      citizen.lastLlmAt = now;
      llmInFlight = true;
      const started = Date.now();
      const memories = retrieveRelevant(this.store.getMemories(citizen.record.id), assignedNeeds.join(" "), 5);
      void this.cognition
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
          citizen.pendingLlm = decision;
          this.store.logLlmCall({
            citizenId: citizen.record.id,
            latencyMs: Date.now() - started,
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
          this.store.logLlmCall({
            citizenId: citizen.record.id,
            latencyMs: Date.now() - started,
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
          llmInFlight = false;
        });
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
    this.store.upsertCitizen(citizen.record);

    this.events.emit(
      createEvent(
        "TaskStarted",
        { task: plan.task, goal: plan.goal, source: plan.source, reason: plan.reason },
        citizen.record.id,
      ),
    );

    const ctx = bodyContext(citizen.body, undefined, this.events, citizen.record.id);
    if (!ctx) return;

    citizen.busy = true;
    citizen.abort = new AbortController();
    ctx.signal = citizen.abort.signal;

    void executePlan(ctx, plan, this.store, this.events)
      .then((result) => {
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
        if (!result.success) {
          this.store.addMemory(
            createMemory(citizen.record.id, "episodic", `Task ${plan.task} failed: ${result.error}`, 0.45),
          );
        } else if (plan.task === "gather_wood" || plan.task === "gather_food" || plan.task === "build_shelter") {
          this.store.addMemory(
            createMemory(citizen.record.id, "episodic", `Completed ${plan.task}`, 0.4),
          );
        }
        this.maybeSocial(citizen);
      })
      .catch((error: unknown) => {
        this.events.emit(
          createEvent("TaskFailed", { task: plan.task, error: String(error) }, citizen.record.id),
        );
      })
      .finally(() => {
        citizen.busy = false;
      });
  }

  private maybeSocial(citizen: RuntimeCitizen): void {
    const now = Date.now();
    if (now - citizen.lastChatAt < 45_000) return;
    const others = citizen.body
      .nearbyPlayers(12)
      .map((p) => this.get(p.username))
      .filter((c): c is RuntimeCitizen => Boolean(c));
    const other = others[0];
    if (!other) return;
    const trigger = citizen.lastPlan?.task === "gather_food" ? "shared_food" : "cooperated";
    let rel = this.store.getRelationship(citizen.record.id, other.record.id);
    rel = applySocialEvent(rel, trigger);
    this.store.saveRelationship(rel);
    this.events.emit(
      createEvent(
        "RelationshipChanged",
        { otherId: other.record.id, trigger, trust: rel.trust, affection: rel.affection },
        citizen.record.id,
      ),
    );
    const convo = maybeConversation({
      trigger,
      speaker: citizen.record.name,
      other: other.record.name,
      topic: citizen.lastPlan?.task ?? "work",
    });
    if (convo.shouldSpeak) {
      citizen.lastChatAt = now;
      void citizen.body.chat(convo.message);
      this.events.emit(
        createEvent("ConversationOccurred", { message: convo.message, other: other.record.name }, citizen.record.id),
      );
      this.store.addMemory(
        createMemory(citizen.record.id, "social", convo.message, 0.5, other.record.id),
      );
    }
  }

  private refreshSnapshot(): void {
    const citizens = [...this.citizens.values()].map((c) => ({
      ...c.record,
      inventory: c.body.inventory(),
      connected: c.body.connected,
      busy: c.busy,
    }));
    this.snapshot = {
      updatedAt: new Date().toISOString(),
      population: this.citizens.size,
      activeBots: citizens.filter((c) => c.connected).length,
      citizens,
      settlement: this.store.getSettlement(),
      events: this.events.getRecent(80),
      memories: citizens.flatMap((c) => this.store.getMemories(c.id, 5)),
      relationships: citizens.flatMap((c) => this.store.listRelationships(c.id)),
      llmCalls: this.store.recentLlmCalls(30),
    };
  }
}

export type DashboardSnapshot = {
  updatedAt: string;
  population: number;
  activeBots: number;
  citizens: Array<CitizenRecord & { inventory: Array<{ name: string; count: number }>; connected: boolean; busy: boolean }>;
  settlement: SettlementState;
  events: ReturnType<EventBus["getRecent"]>;
  memories: ReturnType<CivilizationStore["getMemories"]>;
  relationships: ReturnType<CivilizationStore["listRelationships"]>;
  llmCalls: Array<Record<string, unknown>>;
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
    memories: [],
    relationships: [],
    llmCalls: [],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { CivilizationStore } from "./store.js";
