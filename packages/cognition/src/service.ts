import { randomId } from "@civ/memory";
import type { CitizenMind, CognitionContext, ReflectionContext, ReflectionTrigger } from "@civ/psychology";
import { prepareReflection } from "@civ/psychology";
import { resolveCognitionConfig, type CognitionConfig } from "./config.js";
import { CognitionContextBuilder } from "./context-builder.js";
import { createCooldownState, markDeliberated, shouldDeliberate } from "./cooldown.js";
import { heuristicDeliberation } from "./heuristic-deliberation.js";
import { DecisionLogBuffer, type DecisionLog } from "./observability.js";
import { ollamaChat, parseModelJson } from "./ollama-client.js";
import { buildDeliberationMessages } from "./prompt.js";
import { InferenceQueue } from "./queue.js";
import { applyReflectionProposal } from "./reflection-apply.js";
import { validateReflectionProposal, type ReflectionProposal } from "./reflection-schema.js";
import { detectEmergencyReflex, type ReflexDecision, type WorldView } from "./reflex.js";
import { ModelRouter, type CognitionMode, type DeliberationTrigger, type RouteResult } from "./router.js";
import { validateCognitionDecision, type CognitionDecision } from "./schema.js";
import { isDecisionStale, type DecisionAssumptions } from "./stale.js";
import type { AppConfig } from "@civ/shared";
import { isEdibleName } from "./fact-guards.js";

export type Deliberator = {
  decide(ctx: CognitionContext, timeoutMs: number): Promise<ModelTurn<CognitionDecision>>;
  reflect(prompt: string, timeoutMs: number, model: string): Promise<ModelTurn<ReflectionProposal>>;
};

export type ModelTurn<T> = {
  value: T;
  normalized: boolean;
  model: string;
  promptTokens?: number;
  evalTokens?: number;
  rawError?: string;
};

export type DecideRequest = {
  citizenId: string;
  name?: string;
  view: WorldView;
  acceptView?: WorldView;
  currentGoal?: string;
  currentTask?: string;
  settlementNeeds: string[];
  consecutiveFailures?: number;
  trigger?: DeliberationTrigger;
  busy?: boolean;
  idle?: boolean;
  context?: CognitionContext;
  reflectionTrigger?: ReflectionTrigger;
  significantEventId?: string;
  now?: number;
};

export type DecideResult = {
  mode: CognitionMode;
  accepted: boolean;
  decision?: CognitionDecision;
  reflex?: ReflexDecision;
  discardedReason?: string;
  route: RouteResult;
  log: DecisionLog;
  wroteObjectiveEvent: false;
};

export type ReflectRequest = {
  citizenId: string;
  trigger: ReflectionTrigger;
  context: ReflectionContext;
  now?: number;
};

export type ReflectResult = {
  mode: CognitionMode;
  proposal?: ReflectionProposal;
  fallback: "reflection_model" | "routine_model" | "deterministic";
  accepted: boolean;
  discardedReason?: string;
  applied?: ReturnType<typeof applyReflectionProposal>;
  log: DecisionLog;
};

export class CognitionService {
  readonly config: CognitionConfig;
  readonly router: ModelRouter;
  readonly queue: InferenceQueue;
  readonly logs = new DecisionLogBuffer();
  private readonly cooldown = createCooldownState();
  private readonly builder?: CognitionContextBuilder;
  private readonly deliberator: Deliberator;
  private readonly mind?: CitizenMind;

  constructor(args: {
    config: CognitionConfig;
    mind?: CitizenMind;
    deliberator?: Deliberator;
  }) {
    this.config = args.config;
    this.mind = args.mind;
    this.builder = args.mind ? new CognitionContextBuilder(args.mind) : undefined;
    this.router = new ModelRouter(args.config);
    this.queue = new InferenceQueue(args.config.maxConcurrency);
    this.deliberator = args.deliberator ?? createOllamaDeliberator(args.config);
  }

  static fromAppConfig(app: AppConfig, mind?: CitizenMind, deliberator?: Deliberator): CognitionService {
    return new CognitionService({ config: resolveCognitionConfig(app), mind, deliberator });
  }

  async decide(req: DecideRequest): Promise<DecideResult> {
    const now = req.now ?? Date.now();
    const startedAssumptions = assumptionsFrom(req.view, req);
    const ctx =
      req.context ??
      this.builder?.build({
        citizenId: req.citizenId,
        name: req.name,
        currentGoal: req.currentGoal,
        currentTask: req.currentTask,
        health: req.view.health,
        hunger: req.view.hunger,
        inventory: compactInventory(req.view.inventory),
        settlementNeeds: req.settlementNeeds,
        query: req.currentGoal,
      });
    const idle = req.idle ?? (!req.currentGoal && !req.busy);
    const deliberation = shouldDeliberate(
      {
        citizenId: req.citizenId,
        now,
        cooldownMs: this.config.cooldownMs,
        trigger: req.trigger,
        hasGoal: Boolean(req.currentGoal),
        busy: Boolean(req.busy),
        consecutiveFailures: req.consecutiveFailures ?? 0,
        idle,
      },
      this.cooldown,
    );
    const route = this.router.route({
      view: req.view,
      llmEnabled: this.config.enabled,
      reflectionEnabled: this.config.reflectionEnabled,
      reflectionAvailable: this.config.reflectionEnabled,
      reflectionTrigger: req.reflectionTrigger,
      shouldDeliberate: deliberation.allowed,
      hasGoal: Boolean(req.currentGoal),
      busy: Boolean(req.busy),
    });

    if (route.reflex) {
      return this.finish({
        req,
        route,
        accepted: true,
        reflex: route.reflex,
        decision: {
          goal: route.reflex.goal,
          priority: route.reflex.priority,
          reason: route.reflex.reason,
        },
        normalized: false,
        memoryCount: ctx?.relevantMemories.length ?? 0,
        now,
      });
    }

    if (route.mode === "DEEP_REFLECTION") {
      return this.finish({
        req,
        route,
        accepted: false,
        discardedReason: "use_reflect",
        memoryCount: ctx?.relevantMemories.length ?? 0,
        now,
      });
    }

    if (route.mode === "NO_LLM") {
      if (!deliberation.allowed && route.reason !== "llm_disabled") {
        return this.finish({
          req,
          route,
          accepted: false,
          discardedReason: deliberation.reason,
          memoryCount: ctx?.relevantMemories.length ?? 0,
          now,
        });
      }
      const decision = heuristicDeliberation(fallbackContext(req, ctx));
      markDeliberated(this.cooldown, req.citizenId, now);
      return this.finish({
        req,
        route,
        accepted: true,
        decision,
        normalized: false,
        model: "heuristic",
        memoryCount: ctx?.relevantMemories.length ?? 0,
        now,
      });
    }

    if (!ctx) {
      return this.finish({
        req,
        route,
        accepted: false,
        discardedReason: "missing_context",
        memoryCount: 0,
        now,
      });
    }

    try {
      const queued = await this.queue.enqueue({
        id: randomId(),
        citizenId: req.citizenId,
        type: "routine",
        run: () => this.deliberator.decide(ctx, this.config.timeoutMs),
      });
      const acceptAssumptions = assumptionsFrom(req.acceptView ?? req.view, req);
      const stale = isDecisionStale(startedAssumptions, acceptAssumptions);
      if (stale.stale) {
        return this.finish({
          req,
          route,
          accepted: false,
          discardedReason: stale.reason,
          decision: queued.value.value,
          normalized: queued.value.normalized,
          model: queued.value.model,
          latencyMs: queued.meta.latencyMs,
          queueWaitMs: queued.meta.queueWaitMs,
          memoryCount: ctx.relevantMemories.length,
          contextAgeMs: now - startedAssumptions.createdAtMs,
          now,
        });
      }
      markDeliberated(this.cooldown, req.citizenId, now);
      return this.finish({
        req,
        route,
        accepted: true,
        decision: queued.value.value,
        normalized: queued.value.normalized,
        model: queued.value.model,
        latencyMs: queued.meta.latencyMs,
        queueWaitMs: queued.meta.queueWaitMs,
        promptTokens: queued.value.promptTokens,
        evalTokens: queued.value.evalTokens,
        memoryCount: ctx.relevantMemories.length,
        contextAgeMs: Date.now() - startedAssumptions.createdAtMs,
        now,
      });
    } catch (error) {
      const schemaError = error instanceof Error ? error.message : "decision_failed";
      return this.finish({
        req,
        route,
        accepted: false,
        discardedReason: "schema_error",
        schemaError,
        memoryCount: ctx.relevantMemories.length,
        now,
      });
    }
  }

  async reflect(req: ReflectRequest): Promise<ReflectResult> {
    const now = req.now ?? Date.now();
    const prompt = reflectionPrompt(req);
    const tryModel = async (kind: "reflection_model" | "routine_model"): Promise<ReflectResult | undefined> => {
      const model = kind === "reflection_model" ? this.config.reflectionModel : this.config.routineModel;
      try {
        const queued = await this.queue.enqueue({
          id: randomId(),
          citizenId: req.citizenId,
          type: "reflection",
          run: async () =>
            this.deliberator.reflect(
              prompt,
              kind === "reflection_model"
                ? Math.min(this.config.timeoutMs, 25_000)
                : Math.min(this.config.timeoutMs, 20_000),
              model,
            ),
        });
        const proposal = queued.value.value;
        const applied = this.mind
          ? applyReflectionProposal(this.mind.store, req.citizenId, proposal, randomId)
          : undefined;
        const log = this.record({
          citizenId: req.citizenId,
          model,
          mode: "DEEP_REFLECTION",
          accepted: true,
          normalized: queued.value.normalized,
          reason: proposal.narrativeSummary,
          memoryCount: req.context.relevantMemories.length,
          latencyMs: queued.meta.latencyMs,
          queueWaitMs: queued.meta.queueWaitMs,
          timestamp: new Date(now).toISOString(),
        });
        return {
          mode: "DEEP_REFLECTION",
          proposal,
          fallback: kind,
          accepted: true,
          applied,
          log,
        };
      } catch {
        return undefined;
      }
    };

    if (this.config.enabled && this.config.reflectionEnabled) {
      const deep = await tryModel("reflection_model");
      if (deep) return deep;
      const routine = await tryModel("routine_model");
      if (routine) return { ...routine, fallback: "routine_model" };
    }

    const prepared = prepareReflection(req.context);
    const proposal: ReflectionProposal = {
      significance: req.trigger.salience,
      beliefUpdates: prepared.proposedSemanticFacts.slice(0, 3).map((text) => ({
        subject: req.trigger.kind,
        proposedInterpretation: text,
        confidence: 0.4,
      })),
      goalReconsideration: req.trigger.salience >= 0.6,
      narrativeSummary: prepared.summary,
    };
    const applied = this.mind
      ? applyReflectionProposal(this.mind.store, req.citizenId, proposal, randomId)
      : undefined;
    const log = this.record({
      citizenId: req.citizenId,
      model: "deterministic",
      mode: "DEEP_REFLECTION",
      accepted: true,
      normalized: false,
      reason: proposal.narrativeSummary,
      memoryCount: req.context.relevantMemories.length,
      timestamp: new Date(now).toISOString(),
    });
    return { mode: "DEEP_REFLECTION", proposal, fallback: "deterministic", accepted: true, applied, log };
  }

  private finish(args: {
    req: DecideRequest;
    route: RouteResult;
    accepted: boolean;
    decision?: CognitionDecision;
    reflex?: ReflexDecision;
    discardedReason?: string;
    normalized?: boolean;
    model?: string;
    latencyMs?: number;
    queueWaitMs?: number;
    promptTokens?: number;
    evalTokens?: number;
    memoryCount: number;
    contextAgeMs?: number;
    schemaError?: string;
    now: number;
  }): DecideResult {
    const log = this.record({
      citizenId: args.req.citizenId,
      model: args.model,
      mode: args.route.mode,
      latencyMs: args.latencyMs,
      queueWaitMs: args.queueWaitMs,
      accepted: args.accepted,
      rejectedReason: args.discardedReason,
      normalized: Boolean(args.normalized),
      goal: args.decision?.goal,
      reason: args.decision?.reason,
      contextAgeMs: args.contextAgeMs,
      memoryCount: args.memoryCount,
      schemaError: args.schemaError,
      promptTokens: args.promptTokens,
      evalTokens: args.evalTokens,
      timestamp: new Date(args.now).toISOString(),
    });
    return {
      mode: args.route.mode,
      accepted: args.accepted,
      decision: args.decision,
      reflex: args.reflex,
      discardedReason: args.discardedReason,
      route: args.route,
      log,
      wroteObjectiveEvent: false,
    };
  }

  private record(entry: DecisionLog): DecisionLog {
    this.logs.record(entry);
    return entry;
  }
}

export function assumptionsFrom(view: WorldView, req: Pick<DecideRequest, "currentGoal" | "settlementNeeds" | "significantEventId">): DecisionAssumptions {
  return {
    version: 1,
    createdAtMs: Date.now(),
    hunger: view.hunger,
    health: view.health,
    hasFoodInInventory: view.inventory.some((i) => i.count > 0 && isEdibleName(i.name)),
    nearbyHostile: view.nearbyHostiles.some((h) => h.distance < 12),
    currentGoal: req.currentGoal,
    significantEventId: req.significantEventId,
    majorNeed: req.settlementNeeds[0],
  };
}

function compactInventory(items: WorldView["inventory"]): string[] {
  return items
    .filter((i) => i.count > 0)
    .slice(0, 12)
    .map((i) => `${i.name} x${i.count}`);
}

function fallbackContext(req: DecideRequest, ctx?: CognitionContext): CognitionContext {
  if (ctx) return ctx;
  return {
    citizen: { id: req.citizenId, name: req.name },
    immediateNeeds: { health: req.view.health, hunger: req.view.hunger, concerns: [] },
    currentGoal: req.currentGoal,
    currentTask: req.currentTask,
    inventorySummary: compactInventory(req.view.inventory),
    nearbyWorldState: { entities: req.view.nearbyCitizens },
    mood: {
      citizenId: req.citizenId,
      moodValence: 0,
      stress: 0.2,
      fear: 0,
      anger: 0,
      sadness: 0,
      positiveAffect: 0.4,
      confidence: 0.4,
      currentConcerns: [],
      updatedAt: new Date().toISOString(),
    },
    activeAffect: { dominant: "neutral", intensity: 0 },
    relevantMemories: [],
    relevantSocialBeliefs: [],
    activityFamiliarity: {},
    learnedAssociations: [],
    habits: [],
    recentImportantEvents: [],
    settlementNeeds: req.settlementNeeds,
    uncertainty: 0.5,
    uncertainties: ["no_mind_context"],
  };
}

function createOllamaDeliberator(config: CognitionConfig): Deliberator {
  return {
    async decide(ctx, timeoutMs) {
      const knowledge = "relevantGameKnowledge" in ctx ? (ctx as { relevantGameKnowledge?: { facts: string[] } }).relevantGameKnowledge : undefined;
      const messages = buildDeliberationMessages(ctx, config.contextSize, knowledge);
      const chat = await ollamaChat({
        host: config.host,
        model: config.routineModel,
        system: messages.system,
        user: messages.user,
        timeoutMs,
        contextSize: config.contextSize,
      });
      const parsed = parseModelJson(chat.content);
      return {
        value: validateCognitionDecision(parsed),
        normalized: true,
        model: config.routineModel,
        promptTokens: chat.promptTokens,
        evalTokens: chat.evalTokens,
      };
    },
    async reflect(prompt, timeoutMs, model) {
      const chat = await ollamaChat({
        host: config.host,
        model,
        system: "Reply with JSON only for a rare citizen reflection. No chain-of-thought. Do not invent Minecraft world facts.",
        user: prompt,
        timeoutMs,
        numPredict: 220,
        contextSize: config.contextSize,
      });
      return {
        value: validateReflectionProposal(parseModelJson(chat.content)),
        normalized: true,
        model,
        promptTokens: chat.promptTokens,
        evalTokens: chat.evalTokens,
      };
    },
  };
}

function reflectionPrompt(req: ReflectRequest): string {
  return [
    `Rare reflection: ${req.trigger.kind} (salience ${req.trigger.salience.toFixed(2)})`,
    `Memories: ${req.context.relevantMemories.map((m) => m.summary).slice(0, 8).join(" | ") || "none"}`,
    "Return JSON: {significance, beliefUpdates, goalReconsideration, associationProposals, narrativeSummary}",
    "Do not claim actions that did not happen. Do not write chain-of-thought.",
  ].join("\n");
}

export { detectEmergencyReflex };
