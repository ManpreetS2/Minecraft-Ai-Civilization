import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const citizenSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    communityId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    personalitySeed: z.string().min(1).max(64),
    family: z.enum(["gpt", "claude"]),
    model: z.string().min(1).max(128),
    sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    inventoryVerified: z.boolean(),
    inventory: z.array(z.object({ name: z.string(), count: z.number().int().positive() }).strict()),
    shelterVerifiedAbsent: z.boolean(),
  })
  .strict();

export const ExperimentManifestSchema = z
  .object({
    experimentId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    stage: z.enum(["1v1", "2v2"]),
    durationMinutes: z.number().int().positive().max(60),
    worldSeed: z.string().min(1).max(128),
    sites: z.array(
      z
        .object({
          communityId: z.string(),
          x: z.number().finite(),
          y: z.number().finite(),
          z: z.number().finite(),
          biome: z.string().min(1),
        })
        .strict(),
    ),
    citizens: z.array(citizenSchema),
    server: z
      .object({
        version: z.string(),
        paperBuild: z.number().int(),
        difficulty: z.enum(["peaceful", "easy", "normal", "hard"]),
        keepInventory: z.boolean(),
        hardcore: z.boolean(),
        doDaylightCycle: z.boolean(),
        doMobSpawning: z.boolean(),
        doMobLoot: z.boolean(),
      })
      .strict(),
    paths: z
      .object({
        runRoot: z.string(),
        world: z.string(),
        database: z.string(),
        evidence: z.string(),
      })
      .strict(),
    budget: z
      .object({
        ceilingUsd: z.number().finite().positive(),
        accountingEnabled: z.boolean(),
        unknownUsageFailClosed: z.boolean(),
      })
      .strict(),
    recording: z
      .object({ enabled: z.boolean(), audience: z.enum(["operator_only", "citizen_shared"]) })
      .strict(),
    humanDirectives: z.array(z.string()),
    privacyReplay: z
      .object({
        sourceSha: z.string(),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ExperimentManifest = z.infer<typeof ExperimentManifestSchema>;

/** Code-owned gates cannot be cleared by a manifest, model response, or operator-supplied boolean. */
export const EXPERIMENT_RELEASE_BLOCKERS = [
  "SEC001_INDEPENDENT_RECOVERY_AUTHORIZATION_REVIEW",
  "PROTECTED_EXECUTOR_COMMUNITY_INTEGRATION",
  "CLAUDE_PROVIDER_REGISTRY_AND_REAL_MANAGER_ACCEPTANCE",
  "KNOWLEDGE_SINGLETON_RUNTIME_VERSION_BINDING",
  "PAPER_1_21_6_BUILD_48_LIVE_COMPATIBILITY",
  "OWNER_LIVE_AND_SPENDING_AUTHORIZATION",
] as const;

function canonical(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (ancestor === parent) throw new Error("cannot canonicalize path");
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  return resolve(realpathSync(ancestor), ...suffix);
}
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
function overlaps(a: string, b: string): boolean {
  return contains(a, b) || contains(b, a);
}

export type ExperimentPreflight = {
  configurationValid: boolean;
  readyForLive: false;
  status: "NOT_READY";
  configurationErrors: string[];
  releaseBlockers: readonly string[];
  sourceSha?: string;
};

/** Read-only, operator-facing plan validation. It neither starts a server nor spends money. */
export function validateExperimentPreflight(
  input: unknown,
  protectedPaths: readonly string[],
): ExperimentPreflight {
  const parsed = ExperimentManifestSchema.safeParse(input);
  const errors: string[] = [];
  const result = (sourceSha?: string): ExperimentPreflight => ({
    configurationValid: errors.length === 0,
    readyForLive: false,
    status: "NOT_READY",
    configurationErrors: [...new Set(errors)],
    releaseBlockers: [...EXPERIMENT_RELEASE_BLOCKERS],
    sourceSha,
  });
  if (!parsed.success) {
    errors.push("INVALID_MANIFEST");
    return result();
  }
  const m = parsed.data;
  const expected = m.stage === "1v1" ? 2 : 4;
  if (m.citizens.length !== expected) errors.push("CITIZEN_COUNT");
  if (new Set(m.citizens.map((c) => c.id)).size !== m.citizens.length)
    errors.push("DUPLICATE_CITIZEN");
  if (new Set(m.citizens.map((c) => c.sessionId)).size !== m.citizens.length)
    errors.push("SHARED_MODEL_SESSION");
  for (const family of ["gpt", "claude"])
    if (m.citizens.filter((c) => c.family === family).length !== expected / 2)
      errors.push("PROVIDER_FAMILY_BALANCE");
  const communities = new Set(m.citizens.map((c) => c.communityId));
  if (
    communities.size !== 2 ||
    [...communities].some(
      (id) => m.citizens.filter((c) => c.communityId === id).length !== expected / 2,
    )
  )
    errors.push("STARTING_COMMUNITIES");
  if (
    m.sites.length !== 2 ||
    new Set(m.sites.map((s) => s.communityId)).size !== 2 ||
    m.sites.some((s) => !communities.has(s.communityId))
  )
    errors.push("COMMUNITY_SITES");
  if (
    m.sites.length === 2 &&
    Math.hypot(m.sites[0]!.x - m.sites[1]!.x, m.sites[0]!.z - m.sites[1]!.z) <= 8
  )
    errors.push("STARTING_SITES_IN_HEARING_RANGE");
  if (m.stage === "2v2" && m.durationMinutes !== 60) errors.push("DEMO_DURATION");
  if (m.citizens.some((c) => c.inventory.length > 0 || !c.inventoryVerified))
    errors.push("EMPTY_START_UNVERIFIED");
  if (m.citizens.some((c) => !c.shelterVerifiedAbsent)) errors.push("STARTER_SHELTER_UNVERIFIED");
  const server = m.server;
  if (server.version !== "1.21.6" || server.paperBuild !== 48) errors.push("SERVER_PIN");
  if (
    server.keepInventory ||
    server.hardcore ||
    !server.doDaylightCycle ||
    !server.doMobSpawning ||
    !server.doMobLoot ||
    !["normal", "hard"].includes(server.difficulty)
  )
    errors.push("SURVIVAL_RULES");
  if (!m.budget.accountingEnabled || !m.budget.unknownUsageFailClosed)
    errors.push("COST_ACCOUNTING");
  if (!m.recording.enabled || m.recording.audience !== "operator_only")
    errors.push("OPERATOR_RECORDING");
  if (m.humanDirectives.length) errors.push("HUMAN_DIRECTIVES");
  if (
    m.privacyReplay.sourceSha !== m.sourceSha ||
    m.privacyReplay.passed < 220 ||
    m.privacyReplay.failed !== 0 ||
    m.privacyReplay.skipped !== 0
  )
    errors.push("PRIVACY_REPLAY");
  try {
    if (
      !protectedPaths.length ||
      protectedPaths.some((p) => !isAbsolute(p)) ||
      Object.values(m.paths).some((p) => !isAbsolute(p))
    )
      throw new Error("absolute isolation paths required");
    const root = canonical(m.paths.runRoot);
    const paths = [m.paths.world, m.paths.database, m.paths.evidence].map(canonical);
    if (dirname(root) === root || protectedPaths.map(canonical).some((p) => overlaps(root, p)))
      throw new Error("protected root overlap");
    if (paths.some((p) => p === root || !contains(root, p)))
      throw new Error("path escapes isolated root");
    if (paths.some((p, i) => paths.some((other, j) => i !== j && overlaps(p, other))))
      throw new Error("experiment paths overlap");
  } catch {
    errors.push("PATH_ISOLATION");
  }
  return result(m.sourceSha);
}
