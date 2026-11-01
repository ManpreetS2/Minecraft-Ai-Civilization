import { AgentManager, type AgentManagerHooks, type CivilizationStore } from "@civ/agent-core";
import { CitizenProviderRegistry, parseCitizenAssignments, type CitizenRegistryOptions, type CitizenSessionStore } from "@civ/cognition/routing";
import { VALID_USERNAME } from "@civ/minecraft-adapter";
import type { AppConfig } from "@civ/shared";

/**
 * Operator-only composition root for offline rehearsals. No implicit database open, secret lookup or network transport.
 * Live entrypoints remain refused by runtime-launch-policy. These injected transports must be local test doubles.
 */
export function createIndependentOfflineRuntime(args: {
  config: AppConfig;
  assignmentsJson: string;
  store: CivilizationStore;
  sessionStore: CitizenSessionStore;
  resolveSecret: CitizenRegistryOptions["resolveSecret"];
  fetchImpl: NonNullable<CitizenRegistryOptions["fetchImpl"]>;
  claudeTransportFor: NonNullable<CitizenRegistryOptions["claudeTransportFor"]>;
  createBody: NonNullable<AgentManagerHooks["createBody"]>;
}) {
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
  const registry = new CitizenProviderRegistry({
    runId: config.SIM_RUN_ID,
    assignments,
    experiment: { maxConcurrency: config.CLOUD_MAX_CONCURRENCY, maxRequestsPerRun: config.CLOUD_MAX_REQUESTS_PER_RUN, spendAllowanceUsd: config.CLOUD_SPEND_ALLOWANCE_USD },
    store: args.sessionStore,
    resolveSecret: args.resolveSecret,
    fetchImpl: args.fetchImpl,
    claudeTransportFor: args.claudeTransportFor,
    allowPaidRequests: false,
  });
  try {
    const manager = new AgentManager(config, store, {
      cognitionRouter: registry,
      roster: assignments.map((a) => ({ id: a.citizenId, name: a.citizenName })),
      createBody: args.createBody,
    });
    return { manager, registry };
  } catch (error) {
    registry.closeAll();
    throw error;
  }
}
