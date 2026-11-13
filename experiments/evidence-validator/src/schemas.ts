import { z } from "zod";

export const pointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  })
  .strict();

export const inventorySchema = z.record(
  z.string().regex(/^(?:[a-z0-9_]+:)?[a-z0-9_]+$/),
  z.number().int().nonnegative(),
);

export const worldBlockChangeSchema = z
  .object({
    position: pointSchema,
    before: z.string(),
    after: z.string(),
  })
  .strict();

export const journalStartSchema = z
  .object({
    kind: z.literal("start"),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    recordingAudience: z.literal("operator_only"),
    mode: z.enum(["offline", "live"]),
    decisionTransport: z.enum(["scripted-in-process", "live-provider"]).nullable().optional(),
    sourceSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable()
      .optional(),
    runId: z.string().nullable().optional(),
    citizens: z.array(z.string()).optional(),
  })
  .strict();

export const journalAttemptSchema = z
  .object({
    kind: z.literal("action_attempt"),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    citizenId: z.string(),
    attemptId: z.string(),
    action: z.enum(["gather", "craft", "place", "eat", "move", "speech", "deposit", "withdraw"]),
    decisionSource: z.enum(["scripted", "model", "planner", "reflex"]),
    decisionEventId: z.string(),
    expectedItem: z.string().optional(),
    target: pointSchema.optional(),
    range: z.number().finite().nonnegative().optional(),
    originPosition: pointSchema.optional(),
  })
  .strict();

export const journalObservationSchema = z
  .object({
    kind: z.literal("action_observation"),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    citizenId: z.string(),
    attemptId: z.string(),
    verified: z.boolean(),
    successReported: z.boolean(),
    beforeInventory: inventorySchema,
    afterInventory: inventorySchema,
    position: pointSchema.optional(),
    hungerBefore: z.number().min(0).max(20).optional(),
    hungerAfter: z.number().min(0).max(20).optional(),
    healthBefore: z.number().min(0).max(20).optional(),
    healthAfter: z.number().min(0).max(20).optional(),
    worldChanges: z.array(worldBlockChangeSchema),
    authorizedRecipients: z.array(z.string()).optional(),
    failureCode: z.string().optional(),
    // Phase 2: tool durability tracking (absent in current recorder -- reported NOT_PROVEN when missing)
    toolDurabilityBefore: inventorySchema.optional(),
    toolDurabilityAfter: inventorySchema.optional(),
  })
  .strict();

export const journalTickSchema = z
  .object({
    kind: z.literal("tick"),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    durationMs: z.number().finite().nonnegative(),
    measuredTps: z.number().finite().min(0).max(20).nullable().optional(),
    serverGameTick: z.number().int().nonnegative().nullable().optional(),
    simulatedStep: z.number().int().nonnegative().nullable().optional(),
    tickProvenance: z.enum(["paper-or-world", "unavailable"]).nullable().optional(),
  })
  .strict();

export const journalLifecycleSchema = z
  .object({
    kind: z.enum(["death", "respawn"]),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    citizenId: z.string(),
    position: pointSchema.optional(),
  })
  .strict();

export const journalInterruptedSchema = z
  .object({
    kind: z.literal("action_interrupted"),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    citizenId: z.string(),
    attemptId: z.string(),
    cause: z.string(),
  })
  .strict();

export const journalInterventionSchema = z
  .object({
    kind: z.literal("intervention"),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    code: z.enum(["operator_stop", "operator_restart", "human_directive"]),
  })
  .strict();

export const journalShutdownSchema = z
  .object({
    kind: z.literal("shutdown"),
    experimentId: z.string(),
    seq: z.number().int().positive(),
    at: z.string(),
    previousHash: z.string(),
    hash: z.string(),
    completedDuration: z.boolean(),
    mode: z.enum(["offline", "live"]),
    attempted: z.number().int().nonnegative().optional(),
    verified: z.number().int().nonnegative().optional(),
    unverified: z.number().int().nonnegative().optional(),
    interrupted: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    deaths: z.number().int().nonnegative().optional(),
    respawns: z.number().int().nonnegative().optional(),
    interventions: z.number().int().nonnegative().optional(),
    incompleteActions: z.number().int().nonnegative().optional(),
  })
  .strict();

export const journalRowSchema = z.discriminatedUnion("kind", [
  journalStartSchema,
  journalAttemptSchema,
  journalObservationSchema,
  journalTickSchema,
  journalLifecycleSchema,
  journalInterruptedSchema,
  journalInterventionSchema,
  journalShutdownSchema,
]);

/** Schema-derived allow-list shared by the adapter and authenticated-row validator. */
export function projectKnownFields(kind: unknown, raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const schema = journalRowSchema.options.find((option) => option.shape.kind.safeParse(kind).success);
  if (!schema) return undefined;
  const projected: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(schema.shape)) {
    if (Object.hasOwn(raw, key)) projected[key] = raw[key];
  }
  return projected;
}

export type JournalRow = z.infer<typeof journalRowSchema>;

export const manifestCitizenSchema = z
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

export const experimentManifestSchema = z
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
    citizens: z.array(manifestCitizenSchema),
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
      .object({
        enabled: z.boolean(),
        audience: z.enum(["operator_only", "citizen_shared"]),
      })
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

export type ValidatedManifest = z.infer<typeof experimentManifestSchema>;

export const eventStreamItemSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    timestamp: z.string(),
    citizenId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type EventStreamItem = z.infer<typeof eventStreamItemSchema>;

export const persistentFactItemSchema = z
  .object({
    id: z.string(),
    citizenId: z.string(),
    factKey: z.string(),
    content: z.string(),
    kind: z.enum(["observed_fact", "communicated_claim", "quarantined_claim"]),
    createdAt: z.string(),
    sourceEventId: z.string().optional(),
  })
  .strict();

export type PersistentFactItem = z.infer<typeof persistentFactItemSchema>;
