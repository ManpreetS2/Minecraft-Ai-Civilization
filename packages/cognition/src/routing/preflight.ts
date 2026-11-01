import { z } from "zod";
import { CLAUDE_ALLOWED_MODELS, hasCloudModelPrice, OPENAI_ALLOWED_MODELS } from "../cloud-prices.js";
import type { CognitionPrompt } from "../schema.js";
import type { CitizenAssignment, CitizenProviderRegistry, CredentialRef } from "./citizen-registry.js";

const fallbackSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("heuristic") }).strict(),
  z.object({ kind: z.literal("loopback-ollama"), host: z.string().min(1), model: z.string().min(1) }).strict(),
]);

const assignmentSchema = z
  .object({
    citizenId: z.string().min(1).max(64),
    citizenName: z.string().min(1).max(64),
    family: z.enum(["gpt", "claude"]),
    model: z.string().min(1),
    /** The name of an environment variable. A credential value here would be stored in configuration. */
    credential: z.object({ env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }).strict(),
    timeoutMs: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxRetries: z.number().int().min(0).max(2),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    limits: z
      .object({ maxRequests: z.number().int().nonnegative().optional(), spendAllowanceUsd: z.number().nonnegative().optional() })
      .strict()
      .optional(),
    fallback: fallbackSchema.optional(),
  })
  .strict();

/** Strict: an unknown field is an error, so a misspelled limit cannot silently mean no limit. */
export function parseCitizenAssignments(json: string): CitizenAssignment[] {
  return z.array(assignmentSchema).min(1).max(64).parse(JSON.parse(json));
}

export type PreflightReport = {
  ready: boolean;
  /** Plain statements. Credential values never appear; only the names of environment variables. */
  problems: string[];
  citizens: Array<{ citizenId: string; family: string; model: string; credentialPresent: boolean }>;
  /** True unless paid requests were deliberately enabled. Nothing in preflight sends a request. */
  paidRequestsDisabled: boolean;
};

/**
 * Checks a planned configuration without building a provider or sending anything. Default outcome for a machine with
 * no credentials is a list of problems, and paid requests stay disabled.
 */
export function preflightCitizenAssignments(args: {
  assignments: readonly CitizenAssignment[];
  resolveSecret: (ref: CredentialRef) => string | undefined;
  allowPaidRequests?: boolean;
  hasClaudeTransport?: boolean;
}): PreflightReport {
  const problems: string[] = [];
  const seen = new Set<string>();
  const families = new Set<string>();
  const citizens = args.assignments.map((assignment) => {
    const { citizenId, family, model, credential } = assignment;
    if (seen.has(citizenId)) problems.push(`${citizenId}: assigned twice`);
    seen.add(citizenId);
    families.add(family);
    const allowed: readonly string[] = family === "gpt" ? OPENAI_ALLOWED_MODELS : CLAUDE_ALLOWED_MODELS;
    if (!allowed.includes(model)) problems.push(`${citizenId}: '${model}' is not an allowed ${family} model`);
    else if (!hasCloudModelPrice(model)) problems.push(`${citizenId}: no configured price for '${model}'`);
    const credentialPresent = Boolean(args.resolveSecret(credential)?.trim());
    if (!credentialPresent) problems.push(`${citizenId}: credential ${credential.env} is not set`);
    if (family === "claude" && !args.hasClaudeTransport) problems.push(`${citizenId}: no Claude transport is available`);
    return { citizenId, family, model, credentialPresent };
  });
  if (!args.allowPaidRequests) problems.push("paid requests are disabled");
  if (citizens.length > 0 && !(families.has("gpt") && families.has("claude"))) {
    problems.push("the experiment needs at least one GPT and one Claude citizen");
  }
  return { ready: problems.length === 0, problems, citizens, paidRequestsDisabled: !args.allowPaidRequests };
}

/** A live smoke check is deliberately small: one decision per citizen, under this ceiling. */
export const LIVE_SMOKE_MAX_SPEND_USD = 0.25;

/** Must come from the owner for one specific run. The reference is recorded, not interpreted. */
export type LiveSmokeAuthorization = {
  ownerApprovalReference: string;
  /** Must repeat the registry's run ID, so an approval cannot be reused by a later run. */
  runId: string;
  maxSpendUsd: number;
};

export type LiveSmokeResult = {
  ownerApprovalReference: string;
  runId: string;
  citizens: Array<{ citizenId: string; family: string; model: string; ok: boolean; goal?: string; failure?: string }>;
  accounting: ReturnType<CitizenProviderRegistry["accounting"]>;
};

/** Why this smoke check may not run, or undefined. Never throws, so a caller can report it. */
export function liveSmokeRefusal(
  authorization: LiveSmokeAuthorization | undefined,
  registry: Pick<CitizenProviderRegistry, "accounting">,
  runId: string,
): string | undefined {
  if (!authorization?.ownerApprovalReference?.trim()) return "no owner approval reference was supplied";
  if (authorization.runId !== runId) return "the owner approval is for a different run";
  const limit = authorization.maxSpendUsd;
  if (!Number.isFinite(limit) || limit <= 0 || limit > LIVE_SMOKE_MAX_SPEND_USD) {
    return `the smoke ceiling must be above 0 and at most $${LIVE_SMOKE_MAX_SPEND_USD}`;
  }
  const { spendAllowanceUsd, spendUsd, heldUsd, requestsUsed } = registry.accounting().experiment;
  if (spendAllowanceUsd > limit) return "the experiment allowance is above the approved smoke ceiling";
  if (spendUsd > 0 || heldUsd > 0 || requestsUsed > 0) return "the registry has already been used";
  return undefined;
}

/**
 * The interface for a later real-provider check. It is transport-agnostic: offline tests drive it with scripted replies.
 * Nothing in this repository calls it with real credentials, and doing so needs separate owner permission.
 */
export async function runLiveSmoke(args: {
  registry: CitizenProviderRegistry;
  runId: string;
  authorization: LiveSmokeAuthorization | undefined;
  promptFor: (citizenId: string) => CognitionPrompt;
}): Promise<LiveSmokeResult> {
  const refusal = liveSmokeRefusal(args.authorization, args.registry, args.runId);
  if (refusal) throw new Error(`live smoke refused: ${refusal}`);
  const citizens = await Promise.all(
    args.registry.citizenIds().map(async (citizenId) => {
      const session = args.registry.providerFor(citizenId);
      const identity = { citizenId, family: session.family, model: session.assignment.model };
      try {
        const decision = await session.decide(args.promptFor(citizenId));
        return { ...identity, ok: true, goal: decision.goal };
      } catch (error) {
        return { ...identity, ok: false, failure: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return {
    ownerApprovalReference: args.authorization!.ownerApprovalReference,
    runId: args.runId,
    citizens,
    accounting: args.registry.accounting(),
  };
}
