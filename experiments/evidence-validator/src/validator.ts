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
} from "./types.js";
import type {
  EventStreamItem,
  JournalRow,
  PersistentFactItem,
  ValidatedManifest,
} from "./schemas.js";

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

  // 3. Build known citizen set from manifest (Phase 2: detect phantom citizens)
  const knownCitizenIds: Set<string> | undefined = input.manifest
    ? new Set(input.manifest.citizens.map((c: { id: string }) => c.id))
    : undefined;

  // 3. Process Journal Rows
  const journalRows: JournalRow[] = input.journalRows ?? [];
  const pendingAttempts = new Map<string, ActionAttemptEvidence>();
  // Phase 2: track seen attempt IDs to detect duplicates
  const seenAttemptIds = new Set<string>();
  const actionVerifications: ActionVerificationResult[] = [];

  for (const row of journalRows) {
    if (row.kind === "action_attempt") {
      // Phase 2: detect duplicate attemptId
      if (seenAttemptIds.has(row.attemptId)) {
        violations.push({
          code: "DUPLICATE_ATTEMPT_ID",
          citizenId: row.citizenId,
          description: `Duplicate action_attempt ID '${row.attemptId}' recorded more than once; overwriting prior entry. This indicates a recorder bug or tampered log.`,
          severity: "ERROR",
        });
      }
      seenAttemptIds.add(row.attemptId);
      // Phase 2: detect citizen not in manifest
      if (knownCitizenIds && !knownCitizenIds.has(row.citizenId)) {
        violations.push({
          code: "PHANTOM_CITIZEN_ACTION",
          citizenId: row.citizenId,
          description: `action_attempt from citizen '${row.citizenId}' who is not registered in the experiment manifest.`,
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

      const observation: ActionObservationEvidence = {
        citizenId: row.citizenId,
        attemptId: row.attemptId,
        successReported: row.successReported,
        verified: row.verified,
        beforeInventory: row.beforeInventory,
        afterInventory: row.afterInventory,
        position: row.position,
        hungerBefore: row.hungerBefore,
        hungerAfter: row.hungerAfter,
        healthBefore: row.healthBefore,
        healthAfter: row.healthAfter,
        worldChanges: row.worldChanges,
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

  // 4. Resolve identity & source SHA from manifest, caller inputs, or journal start row
  const startRow = journalRows.find((r) => r.kind === "start");
  const effectiveSourceSha =
    (input.sourceSha && /^[a-f0-9]{40}$/.test(input.sourceSha) ? input.sourceSha : undefined) ??
    (input.manifest?.sourceSha && /^[a-f0-9]{40}$/.test(input.manifest.sourceSha)
      ? input.manifest.sourceSha
      : undefined) ??
    (startRow?.sourceSha && /^[a-f0-9]{40}$/.test(startRow.sourceSha)
      ? startRow.sourceSha
      : undefined) ??
    "0000000000000000000000000000000000000000";

  const effectiveExperimentId =
    (input.experimentId && input.experimentId.trim() ? input.experimentId.trim() : undefined) ??
    (input.manifest?.experimentId && input.manifest.experimentId.trim()
      ? input.manifest.experimentId.trim()
      : undefined) ??
    (startRow?.experimentId && startRow.experimentId.trim()
      ? startRow.experimentId.trim()
      : undefined) ??
    "unspecified_experiment";

  const effectiveRunId =
    (input.runId && input.runId.trim() ? input.runId.trim() : undefined) ??
    (startRow?.runId && startRow.runId.trim() ? startRow.runId.trim() : undefined) ??
    (input.manifest?.experimentId && input.manifest.experimentId.trim()
      ? input.manifest.experimentId.trim()
      : undefined) ??
    effectiveExperimentId;

  // Duration & Tick Audit
  const claimedMinutes = input.manifest?.durationMinutes ?? 0;
  const durationAudit = auditDurationAndTicks({
    claimedDurationMinutes: claimedMinutes,
    journalRows,
    sourceAttestation: input.sourceAttestation,
    experimentId: effectiveExperimentId,
    trustedAuthorities: input.trustedAuthorities,
    trustedKeys: input.trustedKeys,
    expectedSourceSha:
      effectiveSourceSha !== "0000000000000000000000000000000000000000"
        ? effectiveSourceSha
        : undefined,
    rawJournalLines: input.rawJournalLines,
  });

  // Mission 006: Run mode upgraded to real_minecraft ONLY with proven server attestation
  if (
    durationAudit.serverTickProven &&
    durationAudit.sourceAttestationAudit?.proven &&
    durationAudit.durationComplete
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

  let overallStatus: OverallValidationStatus;
  if (violations.length > 0) {
    overallStatus = "VIOLATIONS_DETECTED";
  } else if (notProven.length > 0 || actionVerifications.length === 0 || !hashChainAudit.valid) {
    overallStatus = "NOT_PROVEN";
  } else {
    overallStatus = "VERIFIED";
  }

  const citizenList = input.manifest?.citizens.map((c: { id: string }) => c.id) ??
    (input.citizens && input.citizens.length > 0 ? input.citizens : undefined) ??
    (startRow?.citizens && startRow.citizens.length > 0 ? startRow.citizens : undefined) ?? [
      ...new Set(actionVerifications.map((v) => v.citizenId)),
    ];

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
