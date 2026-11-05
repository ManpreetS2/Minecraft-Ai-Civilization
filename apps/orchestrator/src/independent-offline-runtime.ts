import { AgentManager, type AgentManagerHooks, type CivilizationStore } from "@civ/agent-core";
import {
  CitizenProviderRegistry,
  createScriptedClaudeTransport,
  createScriptedOpenAiFetch,
  parseCitizenAssignments,
  type CitizenRegistryOptions,
  type CitizenSessionStore,
  type ScriptedReply,
} from "@civ/cognition/routing";
import { MinecraftBody, VALID_USERNAME } from "@civ/minecraft-adapter";
import type { AppConfig } from "@civ/shared";

/**
 * Operator-only composition root for offline rehearsals. No implicit database open, secret lookup or network transport.
 * Live entrypoints remain refused by runtime-launch-policy.
 *
 * Default-deny: this root accepts no model transport at all. Both families are served by the in-process scripted
 * doubles that it builds itself from `script`, so a caller cannot supply a function that reaches a network, whether it
 * is the real fetch, a bound or wrapped copy of it, or a custom transport that claims not to be paid. A request that
 * reaches a transport is answered from `script` and goes nowhere else. This does not sandbox arbitrary code running in
 * the same process; it removes the supported route by which a model request could leave it.
 *
 * Additional offline boundaries (independent review of PR #48):
 * - Assignment fallbacks may be `none`/`heuristic` only; `loopback-ollama` is refused here because it uses fetch.
 * - `createBody` is required and must return a non-`MinecraftBody` in-process body (no mineflayer connect path).
 * - Credential env names and resolved secret values must uniquely identify one GPT citizen for scripted replies.
 */
const FORBIDDEN_INJECTIONS = ["fetchImpl", "claudeTransportFor", "allowPaidRequests", "transport"] as const;

export function createIndependentOfflineRuntime(args: {
  config: AppConfig;
  assignmentsJson: string;
  store: CivilizationStore;
  sessionStore: CitizenSessionStore;
  resolveSecret: CitizenRegistryOptions["resolveSecret"];
  /** Scripted model reply for a citizen. Data only: it cannot name a URL or a transport. */
  script: (citizenId: string) => ScriptedReply;
  createBody: NonNullable<AgentManagerHooks["createBody"]>;
}) {
  // Checked first, before any other argument is read, so a refused call resolves no secret and creates no body.
  for (const key of FORBIDDEN_INJECTIONS) {
    if (key in args) {
      throw new Error(`Offline runtime is default-deny: '${key}' is not injectable here; model transports are built in-process from 'script'`);
    }
  }
  if (typeof args.script !== "function") throw new Error("Offline runtime is default-deny: a scripted reply function is required");
  if (typeof args.createBody !== "function") {
    throw new Error("Offline runtime requires an offline createBody factory; omitting one would fall through to MinecraftBody");
  }
  const { config, store } = args;
  const assignments = parseCitizenAssignments(args.assignmentsJson);
  if (!config.SIM_RUN_ID?.trim()) throw new Error("Independent runtime needs an explicit stable run ID");
  if (!config.LLM_ENABLED || config.DEMO_PROFILE !== "none") throw new Error("Independent runtime needs enabled cognition and demo profile none");
  if (![2, 4].includes(assignments.length) || config.SIM_CITIZEN_COUNT !== assignments.length) throw new Error("Independent roster must contain exactly two or four citizens matching configured count");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const a of assignments) {
    if (!VALID_USERNAME.test(a.citizenName) || ids.has(a.citizenId) || names.has(a.citizenName.toLowerCase())) throw new Error("Invalid or duplicate independent identity/username");
    const existing = store.getCitizen(a.citizenId);
    if (existing && existing.minecraftUsername !== a.citizenName) throw new Error("Independent identity conflicts with persisted username");
    ids.add(a.citizenId); names.add(a.citizenName.toLowerCase());
    // Network-backed fallbacks are valid in the general registry, but not through this offline root.
    if (a.fallback && a.fallback.kind !== "none" && a.fallback.kind !== "heuristic") {
      throw new Error(
        `Offline runtime refuses network-backed fallback '${a.fallback.kind}' for ${a.citizenId}; use heuristic or none`,
      );
    }
  }
  if (assignments.filter((a) => a.family === "gpt").length !== assignments.length / 2) throw new Error("Independent experiment needs equal GPT and Claude citizen counts");
  // Membership comes from the authenticated directory already seeded by the operator, never from model family.
  const communities = new Map<string, number>();
  for (const a of assignments) {
    const community = store.getCommunityDirectory().communityOf(a.citizenId);
    if (!community) throw new Error("Independent citizen has no authenticated community membership");
    communities.set(community, (communities.get(community) ?? 0) + 1);
  }
  if (communities.size !== 2 || [...communities.values()].some((n) => n !== assignments.length / 2)) throw new Error("Independent experiment needs two equally sized starting communities");

  // Bind scripted GPT replies by unique credential identity. Shared env names or shared resolved values would
  // otherwise let the later map entry steal another citizen's script.
  const citizenByEnv = new Map<string, string>();
  for (const a of assignments) {
    if (citizenByEnv.has(a.credential.env)) {
      throw new Error(`Offline runtime refuses shared credential env '${a.credential.env}' across citizens`);
    }
    citizenByEnv.set(a.credential.env, a.citizenId);
  }
  const assignmentById = new Map(assignments.map((a) => [a.citizenId, a]));
  const citizenByKey = new Map<string, string>();
  const resolveSecret: CitizenRegistryOptions["resolveSecret"] = (ref) => {
    const secret = args.resolveSecret(ref);
    const citizenId = citizenByEnv.get(ref.env);
    if (!citizenId) throw new Error(`Offline runtime has no citizen for credential env '${ref.env}'`);
    // Only GPT scripted replies are keyed by the Bearer secret; Claude is bound by citizenId already.
    if (assignmentById.get(citizenId)?.family === "gpt") {
      if (typeof secret !== "string" || !secret) throw new Error(`Offline runtime requires a non-empty secret for ${citizenId}`);
      const prior = citizenByKey.get(secret);
      if (prior && prior !== citizenId) {
        throw new Error(`Offline runtime refuses shared credential values across citizens (${prior} vs ${citizenId})`);
      }
      citizenByKey.set(secret, citizenId);
    }
    return secret;
  };
  const openai = createScriptedOpenAiFetch((apiKey) => {
    const citizenId = citizenByKey.get(apiKey);
    if (!citizenId) throw new Error("Offline scripted GPT transport saw an unknown API key");
    return args.script(citizenId);
  });
  const claude = new Map<string, ReturnType<typeof createScriptedClaudeTransport>>();
  const createBody: NonNullable<AgentManagerHooks["createBody"]> = (options) => {
    const body = args.createBody(options);
    if (body == null) {
      throw new Error("Offline runtime createBody must return a body; omitting one would fall through to MinecraftBody");
    }
    if (body instanceof MinecraftBody) {
      throw new Error("Offline runtime refuses MinecraftBody; supply an in-process offline body");
    }
    return body;
  };
  const registry = new CitizenProviderRegistry({
    runId: config.SIM_RUN_ID,
    assignments,
    experiment: { maxConcurrency: config.CLOUD_MAX_CONCURRENCY, maxRequestsPerRun: config.CLOUD_MAX_REQUESTS_PER_RUN, spendAllowanceUsd: config.CLOUD_SPEND_ALLOWANCE_USD },
    store: args.sessionStore,
    resolveSecret,
    fetchImpl: openai.fetchImpl,
    claudeTransportFor: (assignment) => {
      const transport = createScriptedClaudeTransport(() => args.script(assignment.citizenId));
      claude.set(assignment.citizenId, transport);
      return transport;
    },
    allowPaidRequests: false,
  });
  try {
    const manager = new AgentManager(config, store, {
      cognitionRouter: registry,
      roster: assignments.map((a) => ({ id: a.citizenId, name: a.citizenName })),
      createBody,
    });
    return { manager, registry, openai, claude };
  } catch (error) {
    registry.closeAll();
    throw error;
  }
}
