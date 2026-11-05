import {
  validateContract,
  type ActionType,
  type CitizenUsage,
  type FactEvidence,
  type ReceiptReference,
  type ValidationContext,
} from "./evidence-contract.js";
export type {
  ActionType,
  CitizenUsage,
  FactEvidence,
  ReceiptReference,
  SourceReceipt,
  ValidationContext,
} from "./evidence-contract.js";
export type Verdict = "PASS" | "FAIL" | "NOT PROVEN";
export interface Citizen {
  id: string;
  family: "gpt" | "claude";
  model: string | null;
  sessionId: string | null;
  authentication: "synthetic" | "api" | "subscription" | null;
  initialInventory: Record<string, number> | null;
}
export interface ActionEvidence {
  sequence: number;
  citizenId: string;
  reportedSuccess: boolean;
  observedSuccess: boolean | null;
  inventoryDelta: Record<string, number> | null;
  authorizedKnowledge: boolean | null;
  actionType?: ActionType;
  expectedDelta?: Record<string, number> | null;
  inventoryScope?: "citizen" | "container";
  eventId?: string;
  attemptId?: string;
  runId?: string;
  sourceSha?: string;
  receiptId?: string;
  sourceEventId?: string;
}
export interface RunBundle {
  schemaVersion: 1;
  runId: string;
  repository: string;
  sourceSha: string;
  mode: "offline-fixture" | "isolated-live-test" | "public-live-demonstration";
  citizens: Citizen[];
  fixtureSeed: string | null;
  startingPositions: Record<string, { x: number; y: number; z: number }> | null;
  configuration: Record<string, string | number | boolean | null>;
  startedAt: string | null;
  endedAt: string | null;
  tickSource: "simulated" | "paper" | null;
  ticks: number[] | null;
  command: string;
  exitCode: number | null;
  providerUsage: {
    requests: number | null;
    costUsd: number | null;
    artifact: string | null;
    paidRequests?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    usageComplete?: boolean;
    sha256?: string;
    perCitizen?: CitizenUsage[];
  };
  actions: ActionEvidence[];
  expectedActionCount: number | null;
  persistenceArtifact: string | null;
  restarted: boolean;
  validator: { name: string; verdict: Verdict; artifact: string } | null;
  interventions: string[];
  /** Additive v1 contract revision; legacy fields remain readable but missing evidence is unproven. */
  evidenceContractVersion?: 2;
  sourceReceipts?: ReceiptReference[];
  persistentFacts?: FactEvidence[];
}
/** Explicit whitelist prevents accidentally serializing credentials from AppConfig/provider objects. */
export function buildManifest(input: RunBundle): RunBundle {
  const rejectSecretKeys = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        /secret|cookie|password|api.?key|credential/i.test(key) ||
        (/token/i.test(key) && !["inputTokens", "outputTokens"].includes(key))
      )
        throw new Error("Secret-bearing manifest field forbidden");
      rejectSecretKeys(child);
    }
  };
  rejectSecretKeys(input);
  if (!/^[a-f0-9]{40}$/.test(input.sourceSha) || !input.repository.trim() || !input.runId.trim())
    throw new Error("Run requires repository, full SHA and ID");
  if (
    input.schemaVersion !== 1 ||
    !["offline-fixture", "isolated-live-test", "public-live-demonstration"].includes(input.mode)
  )
    throw new Error("Unsupported manifest version/mode");
  if (input.evidenceContractVersion !== undefined && input.evidenceContractVersion !== 2)
    throw new Error("Unsupported evidence contract revision");
  if (![2, 4].includes(input.citizens.length)) throw new Error("Roster must be 1v1 or 2v2");
  const ids = input.citizens.map((c) => c.id),
    sessions = input.citizens.map((c) => c.sessionId).filter((s) => s !== null);
  if (
    new Set(ids).size !== ids.length ||
    new Set(sessions).size !== sessions.length ||
    sessions.some((s) => !s)
  )
    throw new Error("Independent citizen/session identities required");
  if (input.citizens.filter((c) => c.family === "gpt").length !== ids.length / 2)
    throw new Error("Balanced GPT/Claude roster required");
  if (input.citizens.some((c) => !["gpt", "claude"].includes(c.family)))
    throw new Error("Unknown model family");
  if (
    input.mode === "offline-fixture" &&
    (input.tickSource !== "simulated" ||
      input.citizens.some((c) => c.authentication !== "synthetic"))
  )
    throw new Error("Offline manifests require simulated ticks and synthetic authentication");
  if (
    Object.keys(input.configuration).some((k) =>
      /secret|token|cookie|password|api.?key|credential/i.test(k),
    )
  )
    throw new Error("Secret-bearing configuration forbidden");
  const inventory = (value: Record<string, number> | null) =>
    value === null
      ? null
      : Object.fromEntries(
          Object.entries(value).map(([item, count]) => {
            if (!/^[a-z0-9_:]+$/.test(item) || !Number.isSafeInteger(count) || count < 0)
              throw new Error("Invalid inventory observation");
            return [item, count];
          }),
        );
  const delta = (value: Record<string, number> | null) =>
    value === null
      ? null
      : Object.fromEntries(
          Object.entries(value).map(([item, count]) => {
            if (!/^[a-z0-9_:]+$/.test(item) || !Number.isSafeInteger(count))
              throw new Error("Invalid inventory delta");
            return [item, count];
          }),
        );
  const copy: RunBundle = {
    schemaVersion: 1,
    runId: input.runId,
    repository: input.repository,
    sourceSha: input.sourceSha,
    mode: input.mode,
    citizens: input.citizens.map((c) => ({
      id: c.id,
      family: c.family,
      model: c.model,
      sessionId: c.sessionId,
      authentication: c.authentication,
      initialInventory: inventory(c.initialInventory),
    })),
    fixtureSeed: input.fixtureSeed,
    startingPositions:
      input.startingPositions === null
        ? null
        : Object.fromEntries(
            Object.entries(input.startingPositions).map(([id, p]) => [
              id,
              { x: p.x, y: p.y, z: p.z },
            ]),
          ),
    configuration: Object.fromEntries(
      Object.entries(input.configuration).map(([k, v]) => {
        if (v !== null && !["string", "number", "boolean"].includes(typeof v))
          throw new Error("Configuration values must be primitives");
        return [k, v];
      }),
    ),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    tickSource: input.tickSource,
    ticks: input.ticks === null ? null : [...input.ticks],
    command: input.command,
    exitCode: input.exitCode,
    providerUsage: {
      requests: input.providerUsage.requests,
      costUsd: input.providerUsage.costUsd,
      artifact: input.providerUsage.artifact,
      paidRequests: input.providerUsage.paidRequests,
      inputTokens: input.providerUsage.inputTokens,
      outputTokens: input.providerUsage.outputTokens,
      usageComplete: input.providerUsage.usageComplete,
      sha256: input.providerUsage.sha256,
      perCitizen: input.providerUsage.perCitizen?.map((p) => ({
        citizenId: p.citizenId,
        family: p.family,
        model: p.model,
        sessionId: p.sessionId,
        requests: p.requests,
        retries: p.retries,
      })),
    },
    actions: input.actions.map((a) => ({
      sequence: a.sequence,
      citizenId: a.citizenId,
      reportedSuccess: a.reportedSuccess,
      observedSuccess: a.observedSuccess,
      inventoryDelta: delta(a.inventoryDelta),
      authorizedKnowledge: a.authorizedKnowledge,
      actionType: a.actionType,
      expectedDelta: a.expectedDelta == null ? a.expectedDelta : delta(a.expectedDelta),
      inventoryScope: a.inventoryScope,
      eventId: a.eventId,
      attemptId: a.attemptId,
      runId: a.runId,
      sourceSha: a.sourceSha,
      receiptId: a.receiptId,
      sourceEventId: a.sourceEventId,
    })),
    expectedActionCount: input.expectedActionCount,
    persistenceArtifact: input.persistenceArtifact,
    restarted: input.restarted,
    validator:
      input.validator === null
        ? null
        : {
            name: input.validator.name,
            verdict: input.validator.verdict,
            artifact: input.validator.artifact,
          },
    interventions: [...input.interventions],
    evidenceContractVersion: input.evidenceContractVersion,
    sourceReceipts: input.sourceReceipts?.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      attemptId: r.attemptId,
      runId: r.runId,
      sourceSha: r.sourceSha,
      repository: r.repository,
      citizenId: r.citizenId,
      reference: r.reference,
      sha256: r.sha256,
    })),
    persistentFacts: input.persistentFacts?.map((f) => ({
      id: f.id,
      citizenId: f.citizenId,
      runId: f.runId,
      sourceSha: f.sourceSha,
      sourceEventId: f.sourceEventId,
      receiptId: f.receiptId,
      authorizedKnowledge: f.authorizedKnowledge,
    })),
  };
  return JSON.parse(JSON.stringify(copy)) as RunBundle;
}
/** Structural/integrity checks never authenticate a Paper server or an external validator declaration. */
export function validateBundle(
  run: RunBundle,
  expectedSourceSha?: string,
  context: Omit<ValidationContext, "expectedSourceSha"> = {},
): { verdict: Verdict; failures: string[]; unproven: string[] } {
  const { failures, unproven } = validateContract(run, { ...context, expectedSourceSha });
  const ids = new Set(run.citizens.map((c) => c.id));
  if (run.citizens.some((c) => c.sessionId === null)) unproven.push("Session identity missing");
  for (const [i, action] of run.actions.entries()) {
    if (action.sequence !== i + 1) failures.push("Non-contiguous action history");
    if (!ids.has(action.citizenId)) failures.push("Mismatched citizen ID");
    if (action.authorizedKnowledge === false) failures.push("Unauthorized citizen knowledge");
    if (action.authorizedKnowledge !== true && action.authorizedKnowledge !== false)
      unproven.push("Knowledge authorization missing");
    if (action.reportedSuccess && action.observedSuccess === false)
      failures.push("Failed action reported as success");
    if (action.observedSuccess == null) unproven.push("Physical outcome missing");
    if (
      action.inventoryDelta === null &&
      action.actionType !== "move" &&
      action.actionType !== "speech"
    )
      unproven.push("Physical inventory delta missing");
  }
  if (run.expectedActionCount === null) unproven.push("Action history completeness unknown");
  else if (run.actions.length !== run.expectedActionCount)
    failures.push("Truncated action history");
  if (run.restarted && !run.persistenceArtifact)
    unproven.push("Restart persistence evidence missing");
  if (run.exitCode !== 0)
    (run.exitCode === null ? unproven : failures).push("Executable result unsuccessful or missing");
  if (run.mode !== "offline-fixture") {
    if (run.tickSource !== "paper" || !run.ticks || run.ticks.length < 2)
      unproven.push("Paper ticks missing");
    if (run.ticks?.some((t, i, a) => !Number.isFinite(t) || (i > 0 && t <= a[i - 1]!)))
      failures.push("Non-monotonic ticks");
    if (run.mode === "public-live-demonstration") {
      const duration = Date.parse(run.endedAt ?? "") - Date.parse(run.startedAt ?? "");
      if (!Number.isFinite(duration) || duration < 3_600_000)
        failures.push("60-minute duration not established");
      // Wall-clock labels alone cannot establish continuity or real elapsed time.
      if (!run.validator || run.validator.verdict !== "PASS")
        unproven.push("Authentic continuous duration requires external validator evidence");
    }
  }
  if (!run.validator || run.validator.verdict === "NOT PROVEN")
    unproven.push("Independent evidence validator pending");
  else if (run.validator.verdict === "PASS")
    unproven.push(
      "Validator receipt not independently verified by structural checker; use acceptance evidence trust boundary",
    );
  if (run.validator?.verdict === "FAIL") failures.push("Evidence validator rejected bundle");
  return {
    verdict: failures.length ? "FAIL" : unproven.length ? "NOT PROVEN" : "PASS",
    failures,
    unproven,
  };
}
export interface EvidenceValidatorAdapter {
  name: string;
  validate(bundle: RunBundle): Promise<NonNullable<RunBundle["validator"]>>;
}
