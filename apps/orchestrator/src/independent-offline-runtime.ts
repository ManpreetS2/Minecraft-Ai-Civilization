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
import { VALID_USERNAME } from "@civ/minecraft-adapter";
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
  // Registry callers identify a GPT citizen by the key it sends, so remember which citizen each resolved key belongs to.
  const citizenByEnv = new Map(assignments.map((a) => [a.credential.env, a.citizenId]));
  const citizenByKey = new Map<string, string>();
  const resolveSecret: CitizenRegistryOptions["resolveSecret"] = (ref) => {
    const secret = args.resolveSecret(ref);
    const citizenId = citizenByEnv.get(ref.env);
    if (citizenId && typeof secret === "string") citizenByKey.set(secret, citizenId);
    return secret;
  };
  const openai = createScriptedOpenAiFetch((apiKey) => args.script(citizenByKey.get(apiKey) ?? "unknown"));
  const claude = new Map<string, ReturnType<typeof createScriptedClaudeTransport>>();
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
      createBody: args.createBody,
    });
    return { manager, registry, openai, claude };
  } catch (error) {
    registry.closeAll();
    throw error;
  }
}
