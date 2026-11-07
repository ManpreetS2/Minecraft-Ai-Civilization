import { EventEmitter } from "node:events";
import {
  AgentManager,
  type AgentManagerHooks,
  CivilizationStore,
} from "@civ/agent-core";
import {
  CitizenProviderRegistry,
  createInMemoryCitizenSessionStore,
  createJsonFileCitizenSessionStore,
  type CitizenAssignment,
  type CitizenSessionStore,
  type DecisionEvidence,
  PaidRequestGate,
  PAID_RUN_APPROVAL_ENV,
} from "@civ/cognition/routing";
import { createClaudeSdkTransport } from "@civ/cognition/routing/claude-live";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import {
  loadConfig,
  ok,
  type BodyObservation,
  type SettlementNeed,
  type SettlementState,
} from "@civ/shared";
import {
  SimulatedClaudeTransport,
  SimulatedOpenAiTransport,
} from "./simulated-transports.js";

export const GATE_A_RUN_ID = "gate-a-provider-readiness-run";

export const DEFAULT_1V1_ASSIGNMENTS: readonly CitizenAssignment[] = [
  {
    citizenId: "gpt-a",
    citizenName: "GPT_A",
    family: "gpt",
    model: "gpt-4o-mini",
    credential: { env: "KEY_GPT_A" },
    timeoutMs: 3000,
    maxInputTokens: 16_000,
    maxOutputTokens: 256,
    maxRetries: 1,
  },
  {
    citizenId: "claude-a",
    citizenName: "Claude_A",
    family: "claude",
    model: "claude-haiku-5-5",
    credential: { env: "KEY_CLAUDE_A" },
    timeoutMs: 3000,
    maxInputTokens: 16_000,
    maxOutputTokens: 1024,
    maxRetries: 1,
    effort: "low",
  },
];

export type HarnessOptions = {
  runId?: string;
  assignments?: readonly CitizenAssignment[];
  databasePath?: string;
  sessionStore?: CitizenSessionStore;
  sessionStorePath?: string;
  maxConcurrency?: number;
  maxRequestsPerRun?: number;
  spendAllowanceUsd?: number;
  retryBaseDelayMs?: number;
  communities?: Array<{ id: string; memberIds: string[] }>;
  envOverrides?: Record<string, string>;
  onEvidence?: (entry: DecisionEvidence) => void;
};

export class GateAOfflineHarness {
  readonly runId: string;
  readonly assignments: readonly CitizenAssignment[];
  readonly openaiTransport: SimulatedOpenAiTransport;
  readonly claudeTransport: SimulatedClaudeTransport;
  readonly gate: PaidRequestGate;
  readonly sessionStore: CitizenSessionStore;
  readonly store: CivilizationStore;
  readonly registry: CitizenProviderRegistry;
  readonly manager: AgentManager;
  readonly evidenceLog: DecisionEvidence[] = [];
  private readonly bodies = new Map<string, { body: MinecraftBody; observation: BodyObservation }>();

  constructor(private readonly options: HarnessOptions = {}) {
    this.runId = options.runId ?? GATE_A_RUN_ID;
    this.assignments = options.assignments ?? DEFAULT_1V1_ASSIGNMENTS;

    this.openaiTransport = new SimulatedOpenAiTransport();
    this.claudeTransport = new SimulatedClaudeTransport();

    this.gate = PaidRequestGate.fromApproval(
      {
        ownerApprovalReference: "gate-a-test-owner-approval",
        runId: this.runId,
        maxRequests: options.maxRequestsPerRun ?? 100,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      {
        env: {
          [PAID_RUN_APPROVAL_ENV]: this.runId,
          ...(options.envOverrides ?? {}),
        },
      },
    );

    if (options.sessionStore) {
      this.sessionStore = options.sessionStore;
    } else if (options.sessionStorePath) {
      this.sessionStore = createJsonFileCitizenSessionStore(options.sessionStorePath);
    } else {
      this.sessionStore = createInMemoryCitizenSessionStore();
    }

    this.store = new CivilizationStore(options.databasePath ?? ":memory:");

    const communities = options.communities ?? [
      { id: "community-north", memberIds: ["gpt-a"] },
      { id: "community-south", memberIds: ["claude-a"] },
    ];

    const config = loadConfig({
      DEMO_PROFILE: "none",
      LLM_PROVIDER: "none",
      LLM_ENABLED: "true",
      CLOUD_LLM_ENABLED: "false",
      LLM_COOLDOWN_MS: "1",
      DEMO_BULLETIN_TARGET_TOKENS: "400",
      HUMAN_DIRECTIVES_ENABLED: "false",
      COMMUNITIES_JSON: JSON.stringify(communities),
      SIM_RUN_ID: this.runId,
      ...(options.envOverrides ?? {}),
    });

    for (const assignment of this.assignments) {
      if (!this.store.getCitizen(assignment.citizenId)) {
        this.store.upsertCitizen({
          id: assignment.citizenId,
          name: assignment.citizenName,
          minecraftUsername: assignment.citizenName,
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "online",
        });
      }
    }

    this.registry = new CitizenProviderRegistry({
      runId: this.runId,
      assignments: this.assignments,
      experiment: {
        maxConcurrency: options.maxConcurrency ?? 4,
        maxRequestsPerRun: options.maxRequestsPerRun ?? 100,
        spendAllowanceUsd: options.spendAllowanceUsd ?? 1.0,
      },
      resolveSecret: (ref) => {
        if (ref.env.includes("CLAUDE")) {
          return "sk-ant-api03-offline-claude-synthetic-key";
        }
        return "sk-proj-offline-openai-synthetic-key";
      },
      allowPaidRequests: true,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 0,
      fetchImpl: this.openaiTransport.fetchImpl,
      claudeTransportFor: (assignment, apiKey) =>
        createClaudeSdkTransport({
          apiKey,
          gate: this.gate,
          timeoutMs: assignment.timeoutMs,
          fetchImpl: this.claudeTransport.fetchImpl,
        }),
      store: this.sessionStore,
      onEvidence: (entry) => {
        this.evidenceLog.push(entry);
        options.onEvidence?.(entry);
      },
    });

    const createBody = (bodyOptions: ConstructorParameters<typeof MinecraftBody>[0]): MinecraftBody => {
      const emitter = new EventEmitter();
      const observation: BodyObservation = {
        username: bodyOptions.username,
        connected: true,
        spawned: true,
        health: 20,
        food: 10,
        inventory: [],
        players: [],
        nearby: [],
      };
      const mock = {
        connected: true,
        on: (evt: string, cb: (...args: unknown[]) => void) => {
          emitter.on(evt, cb);
          return mock;
        },
        emit: (evt: string, ...args: unknown[]) => emitter.emit(evt, ...args),
        connect: async () => ok({}, 0),
        disconnect: async () => undefined,
        isDeceased: () => false,
        isAwaitingRespawn: () => false,
        markDeceased: () => undefined,
        getBot: () => null,
        inventory: () => observation.inventory,
        position: () => ({ x: 0, y: 64, z: 0 }),
        observe: (): BodyObservation => ({ ...observation }),
        nearbyPlayers: () => observation.players,
        whisperTo: async (to: readonly string[]) => ok({ sent: [...to] }, 0),
        chat: async (message: string) => ok({ message }, 0),
        stopPathfinding: () => undefined,
      } as unknown as MinecraftBody;

      const citizenId = bodyOptions.citizenId ?? "";
      this.bodies.set(citizenId, { body: mock, observation });
      return mock;
    };

    const roster = this.assignments.map((a) => ({ id: a.citizenId, name: a.citizenName }));
    const hooks: AgentManagerHooks = {
      cognitionRouter: this.registry,
      roster,
      createBody,
      drainTimeoutMs: 200,
    };

    this.manager = new AgentManager(config, this.store, hooks);
  }

  async init(): Promise<void> {
    await this.manager.start(undefined, { deferTicks: true });
  }

  setObservation(citizenId: string, partial: Partial<BodyObservation>) {
    const entry = this.bodies.get(citizenId);
    if (entry) {
      Object.assign(entry.observation, partial);
    }
  }

  getCitizenRuntime(citizenId: string) {
    const citizensMap = (this.manager as unknown as { citizens: Map<string, unknown> }).citizens;
    return citizensMap.get(citizenId) as {
      record: { id: string; name: string };
      busy: boolean;
      llmBusy?: boolean;
      llmEpoch?: number;
      lastLlmAt: number;
      pendingLlm?: { goal: string; priority: number; reason: string };
    } | undefined;
  }

  async tickCitizenOnly(
    citizenId: string,
    assignedNeeds: SettlementNeed[] = ["NEED_WOOD", "NEED_STONE"],
    workRole: "build" | "maintain" | "explore" = "build",
  ): Promise<void> {
    const citizen = this.getCitizenRuntime(citizenId);
    if (!citizen) throw new Error(`Citizen ${citizenId} not found in manager runtime`);
    citizen.lastLlmAt = 0;
    const settlement = this.store.getSettlement();
    await (this.manager as unknown as {
      tickCitizen: (c: unknown, s: SettlementState, n: SettlementNeed[], r: string) => Promise<void>;
    }).tickCitizen(citizen, settlement, assignedNeeds, workRole);
  }

  async waitForPendingOps(timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (this.manager.pendingOps() > 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for manager pendingOps (remaining=${this.manager.pendingOps()})`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async tickCitizen(
    citizenId: string,
    assignedNeeds: SettlementNeed[] = ["NEED_WOOD", "NEED_STONE"],
  ): Promise<void> {
    await this.tickCitizenOnly(citizenId, assignedNeeds);
    await this.waitForPendingOps();
  }

  async tickBoth(assignedNeeds: SettlementNeed[] = ["NEED_WOOD", "NEED_STONE"]): Promise<void> {
    for (const a of this.assignments) {
      await this.tickCitizenOnly(a.citizenId, assignedNeeds);
    }
    await this.waitForPendingOps();
  }

  skips(): string[] {
    return this.store
      .listAllEventsForObserver()
      .filter((e) => e.type === "LLMSkipped")
      .map((e) => String(e.payload.error));
  }

  decisions(): Array<{ citizenId?: string; goal: string; provider: string; reason?: string }> {
    return this.store
      .listAllEventsForObserver()
      .filter((e) => e.type === "LLMDecisionMade")
      .map((e) => ({
        citizenId: e.citizenId,
        goal: String(e.payload.goal),
        provider: String(e.payload.provider),
        reason: typeof e.payload.reason === "string" ? e.payload.reason : undefined,
      }));
  }

  async stop(): Promise<void> {
    this.registry.closeAll();
    await this.manager.stop();
    if (this.store.isOpen()) {
      this.store.close();
    }
  }
}
