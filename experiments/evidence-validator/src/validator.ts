import { journalAttemptSchema } from "./schemas.js";
import { verifyHashChain } from "./hash-chain-verifier.js";
import { verifySingleAction } from "./action-verifier.js";
import { auditInformationBoundaries, buildDirectory } from "./information-verifier.js";
import { auditInventoryConservation } from "./inventory-verifier.js";
import { auditDurationAndTicks } from "./duration-verifier.js";
import type { SourceAttestation } from "./types.js";
import type { KeyObject } from "node:crypto";
import { redactSensitiveData } from "./redactor.js";
import type {
  ActionAttemptEvidence,
  ActionObservationEvidence,
  ActionVerificationResult,
  MissingEvidenceItem,
  OverallValidationStatus,
  SimulationMode,
  ValidationReport,
  WorldBlockChange,
} from "./types.js";
import type {
  EventStreamItem,
  JournalRow,
  PersistentFactItem,
  ValidatedManifest,
} from "./schemas.js";

/** Compare JSON row content, ignoring only root-level hash fields verified from raw lines. */
function sameJournalRow(raw: Record<string, unknown>, parsed: Record<string, unknown>): boolean {
  try {
    return canonicalJournalRow(raw) === canonicalJournalRow(parsed);
  } catch {
    // Non-JSON caller values must fail binding rather than normalize into signed JSON.
    return false;
  }
}

function canonicalJournalRow(row: Record<string, unknown>): string {
  const content = { ...row };
  delete content.hash;
  delete content.previousHash;
  if (content.kind === "action_observation") {
    // These consumers treat absent collections as empty. Keep that existing API default.
    for (const key of ["beforeInventory", "afterInventory"]) {
      if (content[key] === undefined) content[key] = {};
    }
    for (const key of ["worldChanges", "authorizedRecipients"]) {
      if (content[key] === undefined) content[key] = [];
    }
  }
  return JSON.stringify(canonicalJson(content));
}

function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === "object" && value !== null &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  throw new Error("Journal row contains a non-JSON value");
}

export type ValidatorInput = {
  manifest?: ValidatedManifest;
  experimentId?: string;
  sourceSha?: string;
  runId?: string;
  citizens?: string[];
  rawJournalLines?: string[];
  journalRows?: JournalRow[];
  events?: EventStreamItem[];
  deliveries?: Array<{ citizenId: string; eventId: string; deliveredAt: string }>;
  facts?: PersistentFactItem[];
  finalInventories?: Record<string, Record<string, number>>;
  citizenPositionsHistory?: Map<string, Array<{ x: number; y: number; z: number }>>;
  sourceAttestation?: SourceAttestation;
  trustedAuthorities?: string[];
  trustedKeys?: Record<string, string | KeyObject> | Map<string, string | KeyObject>;
};

export function validateExperimentEvidence(input: ValidatorInput): ValidationReport {
  const violations: Array<{
    code: string;
    citizenId?: string;
    description: string;
    severity: "ERROR" | "WARNING";
  }> = [];

  const notProven: MissingEvidenceItem[] = [];

  // 1. Determine simulation mode (Mission 006: never upgrade to real_minecraft solely from path or audience)
  let mode: SimulationMode = "offline_simulated";

  // 2. Hash chain verification (if raw journal lines provided)
  let hashChainAudit: {
    valid: boolean;
    totalRows: number;
    brokenSeq?: number;
    error?: string;
  } = {
    valid: false,
    totalRows: 0,
    error: "No journal lines provided",
  };

  if (input.rawJournalLines && input.rawJournalLines.length > 0) {
    hashChainAudit = verifyHashChain(input.rawJournalLines);
    if (!hashChainAudit.valid) {
      violations.push({
        code: "CORRUPTED_HASH_CHAIN",
        description: hashChainAudit.error ?? "Operator journal hash chain failed verification",
        severity: "ERROR",
      });
    }
  } else {
    notProven.push({
      code: "NO_HASH_CHAIN_EVIDENCE",
      description: "Cryptographic operator journal hash chain not supplied",
      missingFields: ["rawJournalLines"],
    });
  }

  // 3. Process Journal Rows & Resolve Identities
  let journalRows: JournalRow[] = input.journalRows ?? [];
  const rawParsed: Array<Record<string, unknown>> = [];
  if (input.rawJournalLines && input.rawJournalLines.length > 0) {
    for (const line of input.rawJournalLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rawParsed.push(JSON.parse(trimmed));
      } catch {
        // syntax error handled by hash chain
      }
    }
  }

  // QA67-M4 / QA75-M2 / QA75-M3: caller-supplied journalRows vs rawJournalLines bidirectional binding
  if (rawParsed.length > 0) {
    if (journalRows.length !== rawParsed.length) {
      violations.push({
        code: "RAW_JOURNAL_ROW_MISMATCH",
        description: `journalRows count (${journalRows.length}) does not match rawJournalLines count (${rawParsed.length}). Signed rows must not be omitted or injected.`,
        severity: "ERROR",
      });
    }

    for (let i = 0; i < rawParsed.length; i++) {
      const raw = rawParsed[i]!;
      const row = journalRows[i];
      if (!row) {
        violations.push({
          code: "RAW_JOURNAL_ROW_MISMATCH",
          citizenId: raw.citizenId as string | undefined,
          description: `Raw journal line seq ${raw.seq} (${raw.kind}) is omitted from journalRows.`,
          severity: "ERROR",
        });
        continue;
      }

      const rowAny = row as unknown as Record<string, unknown>;

      // Bind the complete row, including identity, roster, optional and future fields.
      const diverges = !sameJournalRow(raw, rowAny);

      if (diverges) {
        violations.push({
          code: "RAW_JOURNAL_ROW_MISMATCH",
          citizenId: (raw.citizenId as string) ?? (rowAny.citizenId as string),
          description: `journalRow seq ${row.seq} (${row.kind}) diverges from signed rawJournalLines evidence.`,
          severity: "ERROR",
        });
      }
    }

    // Downstream decisions use authenticated raw values, never a divergent caller copy.
    journalRows = rawParsed as unknown as JournalRow[];
  }

  // Start rows for identity resolution
  const startRows = journalRows.filter((r): r is Extract<JournalRow, { kind: "start" }> => r.kind === "start");
  const startRow = startRows[0];
  const rawStartRows = rawParsed.filter((r) => r.kind === "start");
  const allStartRows: Array<Record<string, unknown>> = [...startRows, ...rawStartRows];

  // QA67-M1 / QA75-M2: Identity Resolution & Conflict Detection
  // 1. Multiple conflicting start rows in journal rows or raw lines
  if (allStartRows.length > 1) {
    const startShas = new Set(allStartRows.map((r) => r.sourceSha).filter(Boolean));
    const startRuns = new Set(allStartRows.map((r) => r.runId).filter(Boolean));
    if (startShas.size > 1) {
      violations.push({
        code: "SOURCE_IDENTITY_CONFLICT",
        description: `Multiple journal start rows contain conflicting sourceSha values: ${Array.from(startShas).join(", ")}`,
        severity: "ERROR",
      });
    }
    if (startRuns.size > 1) {
      violations.push({
        code: "RUN_ID_CONFLICT",
        description: `Multiple journal start rows contain conflicting runId values: ${Array.from(startRuns).join(", ")}`,
        severity: "ERROR",
      });
    }
  }

  // 2. Conflicting experimentIds across rows in the journal (journalRows + rawParsed)
  const journalExpIds = new Set<string>();
  for (const r of journalRows) if (r.experimentId) journalExpIds.add(r.experimentId);
  for (const r of rawParsed) if (typeof r.experimentId === "string") journalExpIds.add(r.experimentId);
  if (journalExpIds.size > 1) {
    violations.push({
      code: "EXPERIMENT_ID_CONFLICT",
      description: `Journal rows contain conflicting experimentIds mid-stream: ${Array.from(journalExpIds).join(", ")}`,
      severity: "ERROR",
    });
  }

  // 3. Caller sourceSha validation (must be valid 40-hex lowercase)
  if (input.sourceSha !== undefined) {
    if (
      !/^[a-f0-9]{40}$/.test(input.sourceSha) ||
      input.sourceSha === "0000000000000000000000000000000000000000"
    ) {
      violations.push({
        code: "INVALID_SOURCE_SHA",
        description: `Caller sourceSha is invalid (must be 40 lowercase hex characters): '${input.sourceSha}'`,
        severity: "ERROR",
      });
    }
  }

  // 4. Source SHA conflict detection across inputs
  const definedShas = new Map<string, string>();
  if (startRow?.sourceSha && /^[a-f0-9]{40}$/.test(startRow.sourceSha)) {
    definedShas.set("journal start", startRow.sourceSha);
  }
  if (input.manifest?.sourceSha && /^[a-f0-9]{40}$/.test(input.manifest.sourceSha)) {
    definedShas.set("manifest", input.manifest.sourceSha);
  }
  if (
    input.sourceSha &&
    /^[a-f0-9]{40}$/.test(input.sourceSha) &&
    input.sourceSha !== "0000000000000000000000000000000000000000"
  ) {
    definedShas.set("caller", input.sourceSha);
  }
  const uniqueShas = new Set(definedShas.values());
  if (uniqueShas.size > 1) {
    const details = Array.from(definedShas.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    violations.push({
      code: "SOURCE_IDENTITY_CONFLICT",
      description: `Conflicting sourceSha across inputs: ${details}`,
      severity: "ERROR",
    });
  }

  // 5. Experiment ID conflict detection across inputs
  const journalExp = startRow?.experimentId ?? journalRows[0]?.experimentId;
  const definedExps = new Map<string, string>();
  if (journalExp) definedExps.set("journal", journalExp);
  if (input.manifest?.experimentId) definedExps.set("manifest", input.manifest.experimentId);
  if (input.experimentId) definedExps.set("caller", input.experimentId);
  const uniqueExps = new Set(definedExps.values());
  if (uniqueExps.size > 1) {
    const details = Array.from(definedExps.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    violations.push({
      code: "EXPERIMENT_ID_CONFLICT",
      description: `Conflicting experimentId across inputs: ${details}`,
      severity: "ERROR",
    });
  }

  // 6. Run ID conflict detection across inputs
  const definedRuns = new Map<string, string>();
  for (const s of allStartRows) {
    if (s.runId && typeof s.runId === "string") {
      definedRuns.set(`journal start seq ${s.seq ?? 1}`, s.runId);
    }
  }
  if (input.runId) definedRuns.set("caller", input.runId);
  const uniqueRuns = new Set(definedRuns.values());
  if (uniqueRuns.size > 1) {
    const details = Array.from(definedRuns.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    violations.push({
      code: "RUN_ID_CONFLICT",
      description: `Conflicting runId across inputs: ${details}`,
      severity: "ERROR",
    });
  }

  // 7. Citizens / Roster conflict detection
  const manifestRoster = input.manifest
    ? input.manifest.citizens.map((c: { id: string }) => c.id)
    : undefined;
  const startRoster =
    startRow?.citizens && startRow.citizens.length > 0 ? startRow.citizens : undefined;
  const callerRoster = input.citizens && input.citizens.length > 0 ? input.citizens : undefined;

  if (startRoster && callerRoster) {
    const s1 = new Set<string>(startRoster);
    const s2 = new Set<string>(callerRoster);
    if (s1.size !== s2.size || [...s1].some((c) => !s2.has(c))) {
      violations.push({
        code: "ROSTER_CONFLICT",
        description: `Journal start roster ([${startRoster.join(", ")}]) conflicts with caller roster ([${callerRoster.join(", ")}]).`,
        severity: "ERROR",
      });
    }
  }
  if (startRoster && manifestRoster) {
    const s1 = new Set<string>(startRoster);
    const s2 = new Set<string>(manifestRoster);
    if (s1.size !== s2.size || [...s1].some((c) => !s2.has(c))) {
      violations.push({
        code: "ROSTER_CONFLICT",
        description: `Journal start roster ([${startRoster.join(", ")}]) conflicts with manifest roster ([${manifestRoster.join(", ")}]).`,
        severity: "ERROR",
      });
    }
  }
  if (manifestRoster && callerRoster) {
    const s1 = new Set<string>(manifestRoster);
    const s2 = new Set<string>(callerRoster);
    if (s1.size !== s2.size || [...s1].some((c) => !s2.has(c))) {
      violations.push({
        code: "ROSTER_CONFLICT",
        description: `Manifest roster ([${manifestRoster.join(", ")}]) conflicts with caller roster ([${callerRoster.join(", ")}]).`,
        severity: "ERROR",
      });
    }
  }

  // Known citizen IDs set
  const knownCitizenIds: Set<string> | undefined = manifestRoster
    ? new Set(manifestRoster)
    : startRoster
      ? new Set(startRoster)
      : callerRoster
        ? new Set(callerRoster)
        : undefined;

  // QA75-M2: Check phantom citizen actions in raw parsed evidence
  if (knownCitizenIds) {
    for (const r of rawParsed) {
      if ((r.kind === "action_attempt" || r.kind === "action_observation") && r.citizenId) {
        const cId = r.citizenId as string;
        if (!knownCitizenIds.has(cId)) {
          if (!violations.some((v) => v.code === "PHANTOM_CITIZEN_ACTION" && v.citizenId === cId)) {
            violations.push({
              code: "PHANTOM_CITIZEN_ACTION",
              citizenId: cId,
              description: `action from citizen '${cId}' in raw evidence who is not registered in the authorized roster.`,
              severity: "ERROR",
            });
          }
        }
      }
    }
  }

  // Resolve effective identities
  const effectiveSourceSha =
    startRow?.sourceSha ??
    input.manifest?.sourceSha ??
    (input.sourceSha && /^[a-f0-9]{40}$/.test(input.sourceSha) ? input.sourceSha : undefined) ??
    "0000000000000000000000000000000000000000";

  const effectiveExperimentId =
    journalExp ??
    input.manifest?.experimentId ??
    input.experimentId ??
    "unspecified_experiment";

  const effectiveRunId =
    startRow?.runId ??
    input.runId ??
    input.manifest?.experimentId ??
    effectiveExperimentId;

  // QA67-R1: Expected values for attestation verification MUST bind to manifest/journal, NEVER caller alone!
  const expectedSourceShaForAttestation =
    startRow?.sourceSha ??
    input.manifest?.sourceSha ??
    (uniqueShas.size > 1 ? undefined : (input.sourceSha && /^[a-f0-9]{40}$/.test(input.sourceSha) ? input.sourceSha : undefined));

  const expectedExperimentIdForAttestation =
    journalExp ??
    input.manifest?.experimentId ??
    (uniqueExps.size > 1 ? undefined : input.experimentId);

  // 3b. Process Action Records from Journal Rows
  const pendingAttempts = new Map<string, ActionAttemptEvidence>();
  const seenAttemptIds = new Set<string>();
  const actionVerifications: ActionVerificationResult[] = [];
  const citizenLastInventory = new Map<string, Record<string, number>>();

  for (const row of journalRows) {
    if (row.kind === "action_attempt") {
      // Raw rows remain authoritative, but do not bypass the parser's decision-source enum.
      if (!journalAttemptSchema.shape.decisionSource.safeParse(row.decisionSource).success) {
        violations.push({
          code: "INVALID_ACTION_DECISION_SOURCE",
          citizenId: row.citizenId,
          description: "Signed action_attempt has an unsupported decisionSource.",
          severity: "ERROR",
        });
        continue;
      }
      if (seenAttemptIds.has(row.attemptId)) {
        violations.push({
          code: "DUPLICATE_ATTEMPT_ID",
          citizenId: row.citizenId,
          description: `Duplicate action_attempt ID '${row.attemptId}' recorded more than once; overwriting prior entry. This indicates a recorder bug or tampered log.`,
          severity: "ERROR",
        });
      }
      seenAttemptIds.add(row.attemptId);

      if (knownCitizenIds && !knownCitizenIds.has(row.citizenId)) {
        violations.push({
          code: "PHANTOM_CITIZEN_ACTION",
          citizenId: row.citizenId,
          description: `action_attempt from citizen '${row.citizenId}' who is not registered in the authorized roster.`,
          severity: "ERROR",
        });
      }

      // QA67-M6: refuse model-provenance claims when transport is scripted
      if (startRow?.decisionTransport === "scripted-in-process" && row.decisionSource === "model") {
        violations.push({
          code: "TRANSPORT_SOURCE_CONTRADICTION",
          citizenId: row.citizenId,
          description: `Action attempt '${row.attemptId}' claims decisionSource 'model', but journal start row specifies decisionTransport 'scripted-in-process'.`,
          severity: "ERROR",
        });
      }

      pendingAttempts.set(row.attemptId, {
        citizenId: row.citizenId,
        attemptId: row.attemptId,
        action: row.action,
        decisionSource: row.decisionSource,
        decisionEventId: row.decisionEventId,
        expectedItem: row.expectedItem,
        target: row.target,
        range: row.range,
        originPosition: row.originPosition,
        timestamp: row.at,
      });
    } else if (row.kind === "action_observation") {
      if (knownCitizenIds && !knownCitizenIds.has(row.citizenId)) {
        violations.push({
          code: "PHANTOM_CITIZEN_ACTION",
          citizenId: row.citizenId,
          description: `action_observation from citizen '${row.citizenId}' who is not registered in the authorized roster.`,
          severity: "ERROR",
        });
      }

      // QA67-M7: Per-citizen inventory continuity
      const lastInv = citizenLastInventory.get(row.citizenId);
      if (lastInv !== undefined) {
        const beforeInv = row.beforeInventory ?? {};
        const allKeys = new Set([...Object.keys(lastInv), ...Object.keys(beforeInv)]);
        let match = true;
        for (const k of allKeys) {
          if ((lastInv[k] ?? 0) !== (beforeInv[k] ?? 0)) {
            match = false;
            break;
          }
        }
        if (!match) {
          violations.push({
            code: "INVENTORY_CONTINUITY_DISRUPTION",
            citizenId: row.citizenId,
            description: `Citizen '${row.citizenId}' observation '${row.attemptId}' beforeInventory does not match previous observation afterInventory.`,
            severity: "ERROR",
          });
        }
      }
      citizenLastInventory.set(row.citizenId, { ...(row.afterInventory ?? {}) });

      const attempt = pendingAttempts.get(row.attemptId);
      if (!attempt) {
        violations.push({
          code: "UNMATCHED_ACTION_OBSERVATION",
          citizenId: row.citizenId,
          description: `Action observation references unknown or unattempted action ID '${row.attemptId}'`,
          severity: "ERROR",
        });
        continue;
      }

      pendingAttempts.delete(row.attemptId);

      const matchingRawObs = rawParsed.find((p) => p.seq === row.seq);
      const observation: ActionObservationEvidence = {
        citizenId: row.citizenId,
        attemptId: row.attemptId,
        successReported:
          matchingRawObs?.successReported !== undefined
            ? Boolean(matchingRawObs.successReported)
            : Boolean(row.successReported),
        verified:
          matchingRawObs?.verified !== undefined
            ? Boolean(matchingRawObs.verified)
            : Boolean(row.verified),
        beforeInventory:
          ((matchingRawObs?.beforeInventory ?? row.beforeInventory ?? {}) as Record<string, number>),
        afterInventory:
          ((matchingRawObs?.afterInventory ?? row.afterInventory ?? {}) as Record<string, number>),
        position:
          ((matchingRawObs?.position ?? row.position) as { x: number; y: number; z: number } | undefined),
        hungerBefore: row.hungerBefore,
        hungerAfter: row.hungerAfter,
        healthBefore: row.healthBefore,
        healthAfter: row.healthAfter,
        worldChanges:
          ((matchingRawObs?.worldChanges ?? row.worldChanges ?? []) as unknown as WorldBlockChange[]),
        authorizedRecipients: row.authorizedRecipients,
        failureCode: row.failureCode,
        timestamp: row.at,
      };

      const result = verifySingleAction(attempt, observation);
      actionVerifications.push(result);

      if (
        result.status === "CORRUPTED" ||
        (result.status === "UNVERIFIED" && observation.successReported)
      ) {
        violations.push({
          code:
            result.status === "CORRUPTED" ? "CORRUPTED_ACTION_EVIDENCE" : "UNVERIFIED_ACTION_CLAIM",
          citizenId: result.citizenId,
          description:
            result.reasons.join("; ") ||
            `Action '${result.action}' claimed success without verified physical evidence`,
          severity: "ERROR",
        });
      }
    } else if (row.kind === "action_interrupted") {
      const attempt = pendingAttempts.get(row.attemptId);
      if (attempt) {
        pendingAttempts.delete(row.attemptId);
        actionVerifications.push({
          attemptId: row.attemptId,
          citizenId: row.citizenId,
          action: attempt.action,
          decisionEventId: attempt.decisionEventId,
          decisionSource: attempt.decisionSource,
          status: "INTERRUPTED",
          classification: "attempted_action",
          chain: {
            worldEventProven: false,
            legitimatelyObserved: false,
            legitimateBelief: false,
            decisionDocumented: true,
            actionAttempted: true,
            physicalOutcomeVerified: false,
          },
          physicalDeltas: {
            inventoryDelta: {},
            worldChangesCount: 0,
          },
          reasons: [`Action interrupted due to: ${row.cause}`],
        });
      }
    }
  }

  // Any remaining pending attempts were never completed
  for (const [id, attempt] of pendingAttempts) {
    notProven.push({
      code: "INCOMPLETE_ACTION_ATTEMPT",
      citizenId: attempt.citizenId,
      description: `Action attempt '${id}' (${attempt.action}) has no matching observation receipt`,
      missingFields: ["action_observation"],
    });
  }

  // QA75-L1: Compare final journal observations against physical final inventories
  if (input.finalInventories) {
    for (const [citizenId, finalPhysical] of Object.entries(input.finalInventories)) {
      const lastObsInv = citizenLastInventory.get(citizenId);
      if (lastObsInv !== undefined) {
        const allKeys = new Set([...Object.keys(lastObsInv), ...Object.keys(finalPhysical)]);
        let match = true;
        for (const k of allKeys) {
          if ((lastObsInv[k] ?? 0) !== (finalPhysical[k] ?? 0)) {
            match = false;
            break;
          }
        }
        if (!match) {
          violations.push({
            code: "INVENTORY_CONTINUITY_DISRUPTION",
            citizenId,
            description: `Citizen '${citizenId}' final journal observation inventory does not match physical final inventory.`,
            severity: "ERROR",
          });
        }
      }
    }
  }

  // Duration & Tick Audit
  const claimedMinutes = input.manifest?.durationMinutes ?? 0;
  const durationAudit = auditDurationAndTicks({
    claimedDurationMinutes: claimedMinutes,
    journalRows,
    sourceAttestation: input.sourceAttestation,
    experimentId: expectedExperimentIdForAttestation,
    trustedAuthorities: input.trustedAuthorities,
    trustedKeys: input.trustedKeys,
    expectedSourceSha:
      expectedSourceShaForAttestation &&
      expectedSourceShaForAttestation !== "0000000000000000000000000000000000000000"
        ? expectedSourceShaForAttestation
        : undefined,
    rawJournalLines: input.rawJournalLines,
  });

  // Mission 006 / QA75-L2: Run mode upgraded to real_minecraft ONLY with proven server attestation and zero ERROR violations
  const hasErrorViolations = violations.some((v) => v.severity === "ERROR");
  if (
    durationAudit.serverTickProven &&
    durationAudit.sourceAttestationAudit?.proven &&
    durationAudit.durationComplete &&
    !hasErrorViolations
  ) {
    mode = "real_minecraft";
  } else if (input.manifest?.paths.runRoot.includes("live")) {
    notProven.push({
      code: "UNPROVEN_PAPER_AUTHENTICITY",
      description:
        "Experiment path or configuration claims live Minecraft execution, but Paper server authenticity and continuous tick progression are not proven",
      missingFields: ["sourceAttestation"],
    });
  }

  // Phase 2: If ticks are simulated (uniform multiples of 60s and no serverGameTick),
  // record it in durationAudit reasons as an informational observation for simulated runs
  const tickRows = journalRows.filter((r) => r.kind === "tick");
  const isSimulatedPattern =
    durationAudit.serverTickCount === 0 &&
    tickRows.length > 1 &&
    tickRows.every((r) => r.kind === "tick" && r.durationMs % 60_000 === 0);
  if (isSimulatedPattern) {
    durationAudit.reasons.push(
      "Duration evidence appears simulated: all tick durationMs values are exact multiples of 60,000ms with no serverGameTick field. " +
        "Genuine Paper server evidence requires serverGameTick to prove uninterrupted world progression.",
    );
  }

  if (!durationAudit.durationComplete && claimedMinutes > 0) {
    violations.push({
      code: "DURATION_EVIDENCE_DEFICIT",
      description: durationAudit.reasons.join("; "),
      severity: "ERROR",
    });
  }

  // 5. Information Boundary Audit
  const communities: Array<{ id: string; memberIds: readonly string[] }> = [];
  if (input.manifest) {
    const rawCommIds = input.manifest.citizens.map((c: { communityId: string }) => c.communityId);
    const commIds: string[] = Array.from(new Set(rawCommIds));
    for (const cId of commIds) {
      communities.push({
        id: cId,
        memberIds: input.manifest.citizens
          .filter((c: { communityId: string }) => c.communityId === cId)
          .map((c: { id: string }) => c.id),
      });
    }
  }

  const directory = buildDirectory(communities);
  const rivalSites = input.manifest?.sites;

  const informationAudit = auditInformationBoundaries({
    events: input.events ?? [],
    deliveries: input.deliveries,
    facts: input.facts,
    directory,
    rivalSites,
    citizenPositionsHistory: input.citizenPositionsHistory,
  });

  for (const v of informationAudit.violations) {
    violations.push({
      code: v.violationType,
      citizenId: v.citizenId,
      description: v.description,
      severity: "ERROR",
    });
  }

  // 6. Inventory Conservation Audit
  const inventoryAudit = auditInventoryConservation({
    manifest: input.manifest,
    actionVerifications,
    citizenFinalInventories: input.finalInventories,
  });

  for (const disc of inventoryAudit.discrepancies) {
    violations.push({
      code: disc.type,
      citizenId: disc.citizenId,
      description: disc.description,
      severity: "ERROR",
    });
  }

  // 7. Calculate Summary and Overall Status
  const verifiedActions = actionVerifications.filter((v) => v.status === "VERIFIED").length;
  const unverifiedActions = actionVerifications.filter((v) => v.status === "UNVERIFIED").length;
  const failedActions = actionVerifications.filter((v) => v.status === "FAILED").length;
  const interruptedActions = actionVerifications.filter((v) => v.status === "INTERRUPTED").length;

  // If live execution is claimed or live path configured, fail closed if unproven
  const claimsLive =
    Boolean(input.manifest?.paths.runRoot.includes("live")) ||
    startRow?.mode === "live" ||
    (input.sourceAttestation !== undefined && input.sourceAttestation.sourceType === "paper_server_attested");
  if (claimsLive && (!durationAudit.sourceAttestationAudit?.proven || mode !== "real_minecraft")) {
    if (!notProven.some((item) => item.code === "UNPROVEN_PAPER_AUTHENTICITY")) {
      notProven.push({
        code: "UNPROVEN_PAPER_AUTHENTICITY",
        description:
          "Experiment claims live Minecraft execution, but Paper server authenticity and continuous tick progression are not proven.",
        missingFields: ["sourceAttestation"],
      });
    }
  }

  let overallStatus: OverallValidationStatus;
  if (violations.length > 0) {
    overallStatus = "VIOLATIONS_DETECTED";
  } else if (notProven.length > 0 || actionVerifications.length === 0 || !hashChainAudit.valid) {
    overallStatus = "NOT_PROVEN";
  } else {
    overallStatus = "VERIFIED";
  }

  const citizenList =
    (startRoster && startRoster.length > 0 ? startRoster : undefined) ??
    (manifestRoster && manifestRoster.length > 0 ? manifestRoster : undefined) ??
    callerRoster ?? [
      ...new Set(actionVerifications.map((v) => v.citizenId)),
    ];

  if (mode === "real_minecraft" && violations.some((v) => v.severity === "ERROR")) {
    mode = "offline_simulated";
  }

  const report: ValidationReport = {
    version: "1.0.0",
    validatorName: "antigravity-evidence-validator",
    generatedAt: new Date().toISOString(),
    experimentId: effectiveExperimentId,
    sourceSha: effectiveSourceSha,
    mode,
    overallStatus,
    summary: {
      totalAttemptedActions: actionVerifications.length + pendingAttempts.size,
      verifiedActions,
      unverifiedActions,
      failedActions,
      interruptedActions,
      observedFacts: informationAudit.observedFactsCount,
      communicatedClaims: informationAudit.communicatedClaimsCount,
      privacyViolationsCount: informationAudit.violations.length,
      inventoryViolationsCount: inventoryAudit.discrepancies.length,
      hashChainValid: hashChainAudit.valid,
      durationVerified: durationAudit.durationComplete,
      notProvenChecksCount: notProven.length,
    },
    hashChainAudit,
    durationAudit,
    sourceAttestationAudit: durationAudit.sourceAttestationAudit,
    inventoryAudit,
    informationAudit,
    actionVerifications,
    violations,
    notProven,
    redacted: true,
    attribution: {
      runId: effectiveRunId,
      citizens: citizenList,
      communities: communities.map((c) => c.id),
    },
  };

  return redactSensitiveData(report);
}
