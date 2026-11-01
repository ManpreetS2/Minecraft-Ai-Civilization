import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CloudBudgetGate } from "../cloud-budget.js";
import { hasCloudModelPrice, isAllowedClaudeModel, isAllowedOpenAiModel } from "../cloud-prices.js";
import { HeuristicProvider } from "../heuristic.js";
import { OllamaProvider } from "../ollama.js";
import { isLoopbackHostname, OpenAiResponsesProvider, type FetchLike } from "../openai-responses.js";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "../schema.js";
import {
  CitizenBudgetView,
  emptyCitizenAccount,
  type CitizenAccount,
  type CitizenBudgetLimits,
} from "./citizen-budget.js";
import { ClaudeMessagesProvider, type ClaudeEffort, type ClaudeMessagesTransport } from "./claude-messages.js";

/** Experiment metadata only. Authorization code must never read this. */
export type ProviderFamily = "gpt" | "claude";

export type CitizenFallback =
  | { kind: "none" }
  | { kind: "heuristic" }
  /** Ollama can proxy hosted models, so only a server on this machine counts as non-paid. */
  | { kind: "loopback-ollama"; host: string; model: string };

/** A reference to a secret, never the secret. Safe to log and persist. */
export type CredentialRef = { env: string };

/** Explicit for every citizen. Nothing is inherited from another citizen or a global default. */
export type CitizenAssignment = {
  citizenId: string;
  citizenName: string;
  family: ProviderFamily;
  model: string;
  credential: CredentialRef;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxRetries: number;
  /** Claude only. The allowlisted GPT models take no reasoning setting. */
  effort?: ClaudeEffort;
  limits?: CitizenBudgetLimits;
  fallback?: CitizenFallback;
};

export type CitizenRoutingErrorCode =
  | "UNASSIGNED"
  | "MISROUTED"
  | "BUSY"
  | "SUSPENDED"
  | "CLOSED"
  | "STALE_RESPONSE";

export class CitizenRoutingError extends Error {
  constructor(
    readonly code: CitizenRoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CitizenRoutingError";
  }
}

export type DecisionEvidence = {
  seq: number;
  at: string;
  runId: string;
  citizenId: string;
  sessionId: string;
  family: ProviderFamily;
  model: string;
  correlationId: string;
  outcome: "decided" | "fallback" | "failed" | "cancelled" | "stale";
  decidedBy: string;
  goal?: string;
  failure?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  unverifiedHoldUsd?: number;
  latencyMs: number;
};

/** Persisted identity and accounting. It holds no prompts, replies, memories or credentials. */
export type CitizenSessionRecord = {
  schemaVersion: 1;
  runId: string;
  citizenId: string;
  citizenName: string;
  family: ProviderFamily;
  model: string;
  sessionId: string;
  decisions: number;
  account: CitizenAccount;
  /** Why cost policy closed this run, if it did. A normal shutdown is not recorded, so a restart can continue. */
  experimentClosedReason?: string;
};

export type CitizenSessionStore = {
  load(citizenId: string): CitizenSessionRecord | undefined;
  save(record: CitizenSessionRecord): void;
};

export function createInMemoryCitizenSessionStore(): CitizenSessionStore {
  const records = new Map<string, string>();
  return {
    load: (citizenId) => {
      const raw = records.get(citizenId);
      return raw === undefined ? undefined : (JSON.parse(raw) as CitizenSessionRecord);
    },
    save: (record) => {
      records.set(record.citizenId, JSON.stringify(record));
    },
  };
}

/** One JSON file, replaced atomically, so a crash leaves the previous complete state. */
export function createJsonFileCitizenSessionStore(filePath: string): CitizenSessionStore {
  const read = (): Record<string, CitizenSessionRecord> =>
    existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf8")) as Record<string, CitizenSessionRecord>) : {};
  return {
    load: (citizenId) => read()[citizenId],
    save: (record) => {
      mkdirSync(dirname(filePath), { recursive: true });
      const all = read();
      all[record.citizenId] = record;
      const temp = `${filePath}.tmp`;
      writeFileSync(temp, JSON.stringify(all, null, 2));
      renameSync(temp, filePath);
    },
  };
}

export type CitizenRegistryOptions = {
  runId: string;
  assignments: readonly CitizenAssignment[];
  experiment: { maxConcurrency: number; maxRequestsPerRun: number; spendAllowanceUsd: number };
  resolveSecret: (ref: CredentialRef) => string | undefined;
  /** Required. Without an injected fetch, GPT citizens need allowPaidRequests. */
  fetchImpl?: FetchLike;
  /** Required for Claude citizens. No live transport ships in this repository yet. */
  claudeTransportFor?: (assignment: CitizenAssignment, apiKey: string) => ClaudeMessagesTransport;
  /** Must be set deliberately before anything can use the real network. Default false. */
  allowPaidRequests?: boolean;
  /** First wait between Claude attempts when the provider gives no retry-after. Tests use 0. */
  retryBaseDelayMs?: number;
  store?: CitizenSessionStore;
  onEvidence?: (entry: DecisionEvidence) => void;
  ids?: () => string;
  now?: () => Date;
};

type ProviderWithControls = CognitionProvider & {
  recentDecisions: Array<{
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    unverifiedHoldUsd?: number;
  }>;
  permitsLocalFallback(error: unknown): boolean;
  cancelInFlight(): void;
  close(): void;
};

/**
 * The cognition provider for one citizen. It is the only route to that citizen's model, so a manager holding one per
 * citizen cannot send one citizen's prompt to another's session. It keeps no prompts or replies between decisions:
 * what a citizen knows comes from the store's gated reads each time.
 */
export class CitizenCognitionSession implements CognitionProvider {
  readonly name: string;
  private inFlight = false;
  private epoch = 0;
  private suspendedFor: string | undefined;
  private closed = false;

  constructor(
    readonly assignment: CitizenAssignment,
    readonly sessionId: string,
    private readonly provider: ProviderWithControls,
    private readonly fallback: CognitionProvider | undefined,
    private readonly hooks: {
      correlationId(): string;
      now(): Date;
      decided(session: CitizenCognitionSession): void;
      evidence(entry: Omit<DecisionEvidence, "seq" | "runId">): void;
    },
  ) {
    this.name = provider.name;
  }

  get citizenId(): string {
    return this.assignment.citizenId;
  }

  get family(): ProviderFamily {
    return this.assignment.family;
  }

  async decide(prompt: CognitionPrompt, timeoutMs?: number): Promise<HighLevelDecision> {
    if (this.closed) throw new CitizenRoutingError("CLOSED", `session for ${this.citizenId} is closed`);
    if (this.suspendedFor) {
      throw new CitizenRoutingError("SUSPENDED", `session for ${this.citizenId} is suspended: ${this.suspendedFor}`);
    }
    if (prompt.citizenName !== this.assignment.citizenName) {
      throw new CitizenRoutingError("MISROUTED", `prompt for another citizen reached the session for ${this.citizenId}`);
    }
    if (this.inFlight) throw new CitizenRoutingError("BUSY", `${this.citizenId} already has a decision in flight`);

    const epoch = this.epoch;
    const correlationId = this.hooks.correlationId();
    const startedMs = this.hooks.now().getTime();
    const limit = Math.min(timeoutMs ?? Number.POSITIVE_INFINITY, this.assignment.timeoutMs);
    this.inFlight = true;
    const record = (entry: Pick<DecisionEvidence, "outcome" | "decidedBy" | "goal" | "failure">, usedPrimary: boolean) => {
      const last = usedPrimary ? this.provider.recentDecisions.at(-1) : undefined;
      this.hooks.evidence({
        at: this.hooks.now().toISOString(),
        citizenId: this.citizenId,
        sessionId: this.sessionId,
        family: this.family,
        model: this.assignment.model,
        correlationId,
        latencyMs: this.hooks.now().getTime() - startedMs,
        inputTokens: last?.inputTokens,
        outputTokens: last?.outputTokens,
        estimatedCostUsd: last?.estimatedCostUsd,
        unverifiedHoldUsd: last?.unverifiedHoldUsd,
        ...entry,
      });
    };

    try {
      let decision: HighLevelDecision;
      let decidedBy = this.provider.name;
      try {
        decision = await this.provider.decide(prompt, limit);
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        if (epoch !== this.epoch) {
          record({ outcome: "cancelled", decidedBy: "none", failure }, true);
          throw error;
        }
        if (!this.fallback || !this.provider.permitsLocalFallback(error)) {
          record({ outcome: "failed", decidedBy: "none", failure }, true);
          throw error;
        }
        record({ outcome: "failed", decidedBy: "none", failure }, true);
        decision = await this.fallback.decide(prompt, limit);
        decidedBy = this.fallback.name;
      }
      // Nothing that was cancelled may steer the citizen, even if its reply arrives anyway.
      if (epoch !== this.epoch) {
        record({ outcome: "stale", decidedBy, goal: decision.goal }, decidedBy === this.provider.name);
        throw new CitizenRoutingError("STALE_RESPONSE", `reply for ${this.citizenId} arrived after it was cancelled`);
      }
      const usedPrimary = decidedBy === this.provider.name;
      record({ outcome: usedPrimary ? "decided" : "fallback", decidedBy, goal: decision.goal }, usedPrimary);
      this.hooks.decided(this);
      return decision;
    } finally {
      this.inFlight = false;
    }
  }

  /** Aborts this citizen's work only, for example after death or a change of objective. Any late reply is discarded. */
  cancel(): void {
    this.epoch += 1;
    this.provider.cancelInFlight();
  }

  /** The body disconnected. Refuses new decisions until resume, keeping identity and accounting. */
  suspend(reason: string): void {
    this.suspendedFor = reason;
    this.cancel();
  }

  resume(): void {
    this.suspendedFor = undefined;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancel();
    this.provider.close();
  }
}

export class CitizenProviderRegistry {
  private readonly sessions = new Map<string, CitizenCognitionSession>();
  private readonly accounts = new Map<string, CitizenAccount>();
  private readonly gate: CloudBudgetGate;
  private readonly evidence: DecisionEvidence[] = [];
  private seq = 0;

  constructor(private readonly options: CitizenRegistryOptions) {
    const seen = new Set<string>();
    for (const assignment of options.assignments) {
      if (seen.has(assignment.citizenId)) {
        throw new Error(`citizen ${assignment.citizenId} is assigned twice`);
      }
      seen.add(assignment.citizenId);
      assertAssignment(assignment, options);
    }
    this.gate = new CloudBudgetGate(options.experiment);
    const ids = options.ids ?? (() => crypto.randomUUID());
    const now = options.now ?? (() => new Date());

    const restored = options.assignments.map((assignment) => {
      const prior = options.store?.load(assignment.citizenId);
      if (prior && (prior.family !== assignment.family || prior.model !== assignment.model)) {
        // A silent family change would invalidate the experiment. Changing a model must be a new run.
        throw new Error(
          `citizen ${assignment.citizenId} was ${prior.family}/${prior.model}; refusing to continue as ${assignment.family}/${assignment.model}`,
        );
      }
      return { assignment, prior: prior?.runId === options.runId ? prior : undefined };
    });

    // A restart must not reset spending or reopen a closure. Work that was in flight may have been billed, so it stays
    // as a hold.
    for (const { prior } of restored) {
      if (prior) {
        const closure: unknown = prior.experimentClosedReason;
        if (closure !== undefined) {
          if (typeof closure !== "string" || !closure.trim()) throw new Error("stored budget closure is malformed");
          this.gate.close(closure);
        }
        prior.account.unverifiedHoldUsd += prior.account.reservedUsd;
        prior.account.reservedUsd = 0;
        this.gate.restoreCommitted({
          spendUsd: prior.account.estimatedSpendUsd,
          heldUsd: prior.account.unverifiedHoldUsd,
          requestsUsed: prior.account.requests,
        });
      }
    }

    const records: Array<() => CitizenSessionRecord> = [];
    let closurePersisted = false;
    for (const { assignment, prior } of restored) {
      const account = prior?.account ?? emptyCitizenAccount();
      const sessionId = prior?.sessionId ?? `${options.runId}:${assignment.citizenId}:${ids()}`;
      let decisions = prior?.decisions ?? 0;
      const record = (): CitizenSessionRecord => ({
        schemaVersion: 1,
        runId: options.runId,
        citizenId: assignment.citizenId,
        citizenName: assignment.citizenName,
        family: assignment.family,
        model: assignment.model,
        sessionId,
        decisions,
        account,
        experimentClosedReason: this.gate.snapshot.closedReason,
      });
      records.push(record);
      const persist = (): boolean => {
        if (!options.store) return true;
        try {
          options.store?.save(record());
          // The first save that sees a closure writes it to every citizen, so no single record is the only copy.
          if (this.gate.snapshot.closedReason && !closurePersisted) {
            for (const write of records) options.store?.save(write());
            closurePersisted = true;
          }
          return true;
        } catch {
          // A restart could now forget spending. Work not yet sent is refused, and work already sent can only settle.
          this.gate.close("cloud admissions closed for this run: session accounting could not be persisted");
          return false;
        }
      };
      const budget = new CitizenBudgetView(this.gate, assignment.limits ?? {}, account, persist);
      const apiKey = options.resolveSecret(assignment.credential)!;
      const session = new CitizenCognitionSession(
        assignment,
        sessionId,
        buildProvider(assignment, apiKey, budget, options),
        buildFallback(assignment),
        {
          correlationId: ids,
          now,
          decided: () => {
            decisions += 1;
            persist();
          },
          evidence: (entry) => {
            const full: DecisionEvidence = { seq: (this.seq += 1), runId: options.runId, ...entry };
            this.evidence.push(full);
            options.onEvidence?.(full);
          },
        },
      );
      this.sessions.set(assignment.citizenId, session);
      this.accounts.set(assignment.citizenId, account);
      persist();
    }
  }

  /** There is deliberately no default: an unassigned citizen gets an error, never another citizen's model. */
  providerFor(citizenId: string): CitizenCognitionSession {
    const session = this.sessions.get(citizenId);
    if (!session) throw new CitizenRoutingError("UNASSIGNED", `citizen ${citizenId} has no provider assignment`);
    return session;
  }

  citizenIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Copies, so a caller cannot change the accounting. */
  accounting() {
    return {
      experiment: this.gate.snapshot,
      citizens: Object.fromEntries([...this.accounts].map(([id, account]) => [id, { ...account }])),
    };
  }

  evidenceLog(): DecisionEvidence[] {
    return this.evidence.map((entry) => ({ ...entry }));
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close();
  }
}

function assertAssignment(assignment: CitizenAssignment, options: CitizenRegistryOptions): void {
  const { citizenId, family, model } = assignment;
  const allowed = family === "gpt" ? isAllowedOpenAiModel(model) : family === "claude" && isAllowedClaudeModel(model);
  if (!allowed) throw new Error(`citizen ${citizenId}: '${model}' is not an allowed ${family} model`);
  if (!hasCloudModelPrice(model)) throw new Error(`citizen ${citizenId}: no configured price for '${model}'`);
  if (family === "gpt" && assignment.effort) {
    throw new Error(`citizen ${citizenId}: effort is not a setting for the allowed GPT models`);
  }
  if (!options.resolveSecret(assignment.credential)?.trim()) {
    throw new Error(`citizen ${citizenId}: credential ${assignment.credential.env} is not set`);
  }
  if (family === "gpt" && !options.fetchImpl && !options.allowPaidRequests) {
    throw new Error(`citizen ${citizenId}: paid requests are not enabled and no offline fetch was supplied`);
  }
  if (family === "claude" && !options.claudeTransportFor) {
    throw new Error(`citizen ${citizenId}: no Claude transport was supplied, and none ships with this repository`);
  }
  if (assignment.fallback?.kind === "loopback-ollama") {
    let hostname: string;
    try {
      hostname = new URL(assignment.fallback.host).hostname;
    } catch {
      throw new Error(`citizen ${citizenId}: fallback Ollama host is not a valid URL`);
    }
    if (!isLoopbackHostname(hostname)) throw new Error(`citizen ${citizenId}: fallback Ollama host must be loopback`);
  }
}

function buildProvider(
  assignment: CitizenAssignment,
  apiKey: string,
  budget: CitizenBudgetView,
  options: CitizenRegistryOptions,
): ProviderWithControls {
  const shared = {
    model: assignment.model,
    timeoutMs: assignment.timeoutMs,
    maxInputTokens: assignment.maxInputTokens,
    maxOutputTokens: assignment.maxOutputTokens,
    maxRetries: assignment.maxRetries,
    apiKey,
    budget,
  };
  if (assignment.family === "gpt") {
    return new OpenAiResponsesProvider({
      ...shared,
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: options.fetchImpl,
    });
  }
  const transport = options.claudeTransportFor!(assignment, apiKey);
  if (transport.paid && !options.allowPaidRequests) {
    throw new Error(`citizen ${assignment.citizenId}: a paid Claude transport needs allowPaidRequests`);
  }
  return new ClaudeMessagesProvider({
    ...shared,
    effort: assignment.effort,
    transport,
    retryBaseDelayMs: options.retryBaseDelayMs,
  });
}

function buildFallback(assignment: CitizenAssignment): CognitionProvider | undefined {
  const fallback = assignment.fallback ?? { kind: "none" as const };
  if (fallback.kind === "heuristic") return new HeuristicProvider();
  if (fallback.kind === "loopback-ollama") return new OllamaProvider(fallback.host, fallback.model);
  return undefined;
}
