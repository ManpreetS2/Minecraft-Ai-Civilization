import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export interface VerifyScenarioOptions {
  artifactDir: string;
  expectedCount: 2 | 4;
  expectedSha?: string;
  expectedRepository?: string;
}

export interface ScenarioCheckDetails {
  citizensMatch: boolean;
  countsMatch: boolean;
  observationsMatch: boolean;
  orderingValid: boolean;
  inventoriesValid: boolean;
  decisionSourcesHonest: boolean;
  receiptReferencesValid: boolean;
  authenticityHonest: boolean;
  hashChainValid: boolean;
}

export interface ScenarioVerificationResult {
  passed: boolean;
  scenario: 2 | 4;
  artifactDir: string;
  runId: string;
  testedSha: string;
  citizens: string[];
  actionAttemptsCount: number;
  actionObservationsCount: number;
  physicallyVerifiedCount: number;
  hashChainTotalRows: number;
  validatorVerdict: string;
  paperAttestationProven: boolean;
  unprovenReasons: string[];
  errors: string[];
  warnings: string[];
  details: ScenarioCheckDetails;
}

export interface JournalCliCheckResult {
  status: "READY" | "NOT_RUN" | "FAILED";
  command: string;
  details: string;
  forgedReceiptTestPassed?: boolean;
  executed?: boolean;
  exitCodes?: Record<string, number>;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  pnpmVersion?: string;
}

export interface OverallAcceptanceReport {
  passed: boolean;
  testedSha: string;
  system: SystemInfo;
  scenarios: Record<string, ScenarioVerificationResult>;
  journalCliCheck: JournalCliCheckResult;
  allErrors: string[];
}

/**
 * Computes the SHA-256 hash of a journal row object without its 'hash' field.
 */
export function computeJournalRowHash(rowWithHash: Record<string, unknown>): string {
  const { hash: _hash, ...withoutHash } = rowWithHash;
  return createHash("sha256").update(JSON.stringify(withoutHash)).digest("hex");
}

/**
 * Verifies hash-chain integrity of a journal JSONL line array.
 */
export function auditJournalHashChain(lines: readonly string[]): {
  valid: boolean;
  totalRows: number;
  error?: string;
  rows: Record<string, unknown>[];
} {
  const nonEmptyLines = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (nonEmptyLines.length === 0) {
    return { valid: false, totalRows: 0, error: "Journal is empty (no records found)", rows: [] };
  }

  let priorHash = "";
  const parsedRows: Record<string, unknown>[] = [];

  for (let i = 0; i < nonEmptyLines.length; i++) {
    const rawLine = nonEmptyLines[i]!;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      return {
        valid: false,
        totalRows: nonEmptyLines.length,
        error: `Row ${i + 1} contains invalid JSON`,
        rows: parsedRows,
      };
    }

    const expectedSeq = i + 1;
    if (parsed.seq !== expectedSeq) {
      return {
        valid: false,
        totalRows: nonEmptyLines.length,
        error: `Row ${expectedSeq} sequence mismatch: expected ${expectedSeq}, got ${String(parsed.seq)}`,
        rows: parsedRows,
      };
    }

    if (parsed.previousHash !== priorHash) {
      return {
        valid: false,
        totalRows: nonEmptyLines.length,
        error: `Row ${expectedSeq} previousHash mismatch: expected '${priorHash}', got '${String(parsed.previousHash)}'`,
        rows: parsedRows,
      };
    }

    const recordedHash = String(parsed.hash ?? "");
    const computedHash = computeJournalRowHash(parsed);
    if (recordedHash !== computedHash) {
      return {
        valid: false,
        totalRows: nonEmptyLines.length,
        error: `Row ${expectedSeq} hash tampering detected: recorded '${recordedHash}' != computed '${computedHash}'`,
        rows: parsedRows,
      };
    }

    priorHash = recordedHash;
    parsedRows.push(parsed);
  }

  return {
    valid: true,
    totalRows: parsedRows.length,
    rows: parsedRows,
  };
}

/**
 * Verifies all artifacts in an offline scenario run directory (1v1 or 2v2).
 */
export function verifyOfflineScenario(options: VerifyScenarioOptions): ScenarioVerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const details: ScenarioCheckDetails = {
    citizensMatch: false,
    countsMatch: false,
    observationsMatch: false,
    orderingValid: false,
    inventoriesValid: false,
    decisionSourcesHonest: false,
    receiptReferencesValid: false,
    authenticityHonest: false,
    hashChainValid: false,
  };

  const artifactDir = resolve(options.artifactDir);
  const count = options.expectedCount;
  const expectedActionsCount = count * 3;
  const expectedCitizenIds =
    count === 2 ? ["gpt-a", "claude-a"] : ["gpt-a", "gpt-b", "claude-a", "claude-b"];
  const expectedRepo =
    options.expectedRepository ?? "ManpreetS2/Minecraft-Ai-Civilization-windows-backup";

  let runId = "unknown";
  let testedSha = "unknown";
  const observedCitizens: string[] = [];
  let actionAttemptsCount = 0;
  let actionObservationsCount = 0;
  let physicallyVerifiedCount = 0;
  let hashChainTotalRows = 0;
  let validatorVerdict = "UNKNOWN";
  let paperAttestationProven = false;
  let unprovenReasons: string[] = [];

  // 1. Check required artifact files
  const requiredFiles = [
    "manifest.json",
    "operator.jsonl",
    "verdict.json",
    "gemini-validator-report.json",
    "acceptance.json",
  ];

  for (const filename of requiredFiles) {
    const fullPath = join(artifactDir, filename);
    if (!existsSync(fullPath)) {
      errors.push(`Missing required artifact file: ${filename}`);
    }
  }

  const receiptsDir = join(artifactDir, "receipts");
  if (!existsSync(receiptsDir) || !statSync(receiptsDir).isDirectory()) {
    errors.push("Missing required 'receipts' directory");
  }

  if (errors.length > 0) {
    return {
      passed: false,
      scenario: count,
      artifactDir,
      runId,
      testedSha,
      citizens: observedCitizens,
      actionAttemptsCount,
      actionObservationsCount,
      physicallyVerifiedCount,
      hashChainTotalRows,
      validatorVerdict,
      paperAttestationProven,
      unprovenReasons,
      errors,
      warnings,
      details,
    };
  }

  // 2. Validate manifest.json
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(join(artifactDir, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch (err) {
    errors.push(`Failed to parse manifest.json: ${String(err)}`);
  }

  if (manifest.schemaVersion !== 1) {
    errors.push(
      `manifest schemaVersion mismatch: expected 1, got ${String(manifest.schemaVersion)}`,
    );
  }

  if (manifest.mode !== "offline-fixture") {
    errors.push(`manifest mode must be 'offline-fixture', got '${String(manifest.mode)}'`);
  }

  if (manifest.repository && manifest.repository !== expectedRepo) {
    errors.push(
      `manifest repository mismatch: expected '${expectedRepo}', got '${String(manifest.repository)}'`,
    );
  }

  runId = String(manifest.runId ?? "unknown");
  testedSha = String(manifest.sourceSha ?? "unknown");

  if (!/^[a-f0-9]{40}$/.test(testedSha)) {
    errors.push(`manifest sourceSha is not a valid 40-character hex SHA: '${testedSha}'`);
  } else if (options.expectedSha && testedSha !== options.expectedSha) {
    errors.push(`Wrong source SHA: expected ${options.expectedSha}, got ${testedSha}`);
  }

  // Verify citizens in manifest
  const rawCitizens = Array.isArray(manifest.citizens) ? manifest.citizens : [];
  if (rawCitizens.length !== count) {
    errors.push(`Incorrect citizen count: expected ${count}, got ${rawCitizens.length}`);
  }

  const manifestCitizenIds: string[] = [];
  for (const c of rawCitizens) {
    if (c && typeof c === "object" && "id" in c) {
      const citizen = c as { id: string; authentication?: unknown; model?: unknown };
      manifestCitizenIds.push(citizen.id);
      observedCitizens.push(citizen.id);

      if (citizen.authentication !== "synthetic") {
        errors.push(
          `Citizen ${citizen.id} authentication must be 'synthetic', got '${String(citizen.authentication)}'`,
        );
      }
    }
  }

  const distinctManifestIds = new Set(manifestCitizenIds);
  if (distinctManifestIds.size !== count) {
    errors.push(
      `Citizen IDs in manifest contain duplicates: found ${distinctManifestIds.size} distinct out of ${count}`,
    );
  }

  const citizensMatch =
    distinctManifestIds.size === count &&
    expectedCitizenIds.every((id) => distinctManifestIds.has(id)) &&
    manifestCitizenIds.length === count;
  details.citizensMatch = citizensMatch;
  if (!citizensMatch) {
    errors.push(
      `Citizen IDs mismatch: expected [${expectedCitizenIds.join(", ")}], got [${manifestCitizenIds.join(", ")}]`,
    );
  }

  // Verify actions in manifest
  const rawActions = Array.isArray(manifest.actions) ? manifest.actions : [];
  if (rawActions.length !== expectedActionsCount) {
    errors.push(
      `Manifest actions count mismatch: expected ${expectedActionsCount}, got ${rawActions.length}`,
    );
  }

  const seenActionAttempts = new Set<string>();
  let allReceiptsValid = true;

  for (const act of rawActions) {
    if (!act || typeof act !== "object") continue;
    const a = act as {
      sequence: number;
      citizenId: string;
      actionType: string;
      attemptId: string;
      receiptId?: string;
      reportedSuccess: boolean;
      observedSuccess: boolean;
      expectedDelta?: { oak_log?: number };
      inventoryDelta?: { oak_log?: number };
    };

    if (seenActionAttempts.has(a.attemptId)) {
      errors.push(`Duplicate attempt detected in manifest actions: ${a.attemptId}`);
    }
    seenActionAttempts.add(a.attemptId);

    if (a.actionType !== "gather") {
      errors.push(
        `Action type mismatch for attempt ${a.attemptId}: expected 'gather', got '${a.actionType}'`,
      );
    }

    if (!a.receiptId) {
      errors.push(`Action attempt ${a.attemptId} lacks a receiptId`);
      allReceiptsValid = false;
    } else {
      const receiptPath = join(receiptsDir, `${a.receiptId}.json`);
      if (!existsSync(receiptPath)) {
        errors.push(`Referenced receipt file does not exist: ${a.receiptId}.json`);
        allReceiptsValid = false;
      } else {
        try {
          const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
            attemptId?: string;
            citizenId?: string;
            sourceSha?: string;
          };
          if (receipt.attemptId !== a.attemptId) {
            errors.push(
              `Receipt ${a.receiptId} attemptId mismatch: expected '${a.attemptId}', got '${String(receipt.attemptId)}'`,
            );
            allReceiptsValid = false;
          }
          if (receipt.citizenId !== a.citizenId) {
            errors.push(
              `Receipt ${a.receiptId} citizenId mismatch: expected '${a.citizenId}', got '${String(receipt.citizenId)}'`,
            );
            allReceiptsValid = false;
          }
        } catch (err) {
          errors.push(`Failed to parse receipt ${a.receiptId}.json: ${String(err)}`);
          allReceiptsValid = false;
        }
      }
    }
  }
  details.receiptReferencesValid = allReceiptsValid;

  // 3. Validate operator.jsonl (Journal hash chain and semantics)
  const journalPath = join(artifactDir, "operator.jsonl");
  const journalRawBytes = readFileSync(journalPath);
  const journalLines = journalRawBytes.toString("utf8").split(/\r?\n/);
  const hashChainAudit = auditJournalHashChain(journalLines);
  hashChainTotalRows = hashChainAudit.totalRows;
  details.hashChainValid = hashChainAudit.valid;

  if (!hashChainAudit.valid) {
    errors.push(
      `Journal hash chain error: ${hashChainAudit.error ?? "unknown verification failure"}`,
    );
  }

  const rows = hashChainAudit.rows;
  if (rows.length > 0) {
    const startRow = rows[0]!;
    if (startRow.kind !== "start") {
      errors.push(`First journal row kind must be 'start', got '${String(startRow.kind)}'`);
    } else {
      if (startRow.sourceSha !== testedSha) {
        errors.push(
          `Journal start row sourceSha mismatch: expected '${testedSha}', got '${String(startRow.sourceSha)}'`,
        );
      }
      if (startRow.runId !== runId) {
        errors.push(
          `Journal start row runId mismatch: expected '${runId}', got '${String(startRow.runId)}'`,
        );
      }
      if (startRow.decisionTransport !== "scripted-in-process") {
        errors.push(
          `Journal start row decisionTransport must be 'scripted-in-process', got '${String(startRow.decisionTransport)}'`,
        );
      }
      if (startRow.mode !== "offline") {
        errors.push(`Journal start row mode must be 'offline', got '${String(startRow.mode)}'`);
      }
    }

    // Extract attempts and observations
    const attempts = rows.filter((r) => r.kind === "action_attempt");
    const observations = rows.filter((r) => r.kind === "action_observation");

    actionAttemptsCount = attempts.length;
    actionObservationsCount = observations.length;

    if (actionAttemptsCount !== expectedActionsCount) {
      errors.push(
        `Incorrect attempt count: expected ${expectedActionsCount}, got ${actionAttemptsCount}`,
      );
    }
    if (actionObservationsCount !== expectedActionsCount) {
      errors.push(
        `Incorrect observation count: expected ${expectedActionsCount}, got ${actionObservationsCount}`,
      );
    }

    const attemptsById = new Map<string, Record<string, unknown>>();
    const citizenAttemptCounts: Record<string, number> = {};
    let honestDecisionSources = true;

    for (const att of attempts) {
      const attemptId = String(att.attemptId ?? "");
      const citizenId = String(att.citizenId ?? "");
      const decisionSource = String(att.decisionSource ?? "");

      if (!attemptId) {
        errors.push("Journal action_attempt lacks attemptId");
        continue;
      }

      if (attemptsById.has(attemptId)) {
        errors.push(`Duplicate attempt detected in journal: ${attemptId}`);
      }
      attemptsById.set(attemptId, att);

      citizenAttemptCounts[citizenId] = (citizenAttemptCounts[citizenId] ?? 0) + 1;

      // Decision Source Contract
      if (decisionSource === "model") {
        errors.push(
          `Scripted decisions disguised as genuine model decisions: attempt ${attemptId} claimed decisionSource 'model'`,
        );
        honestDecisionSources = false;
      } else if (!["scripted", "planner", "reflex"].includes(decisionSource)) {
        errors.push(`Invalid decisionSource in attempt ${attemptId}: '${decisionSource}'`);
        honestDecisionSources = false;
      }
    }
    details.decisionSourcesHonest = honestDecisionSources;

    // Verify per-citizen attempt counts
    for (const citizenId of expectedCitizenIds) {
      const countForCitizen = citizenAttemptCounts[citizenId] ?? 0;
      if (countForCitizen !== 3) {
        errors.push(
          `Citizen ${citizenId} has ${countForCitizen} attempts in journal, expected exactly 3`,
        );
      }
    }

    // Correlate observations
    const seenObservedAttempts = new Set<string>();
    let allOrderingValid = true;
    let allInventoriesValid = true;

    for (const obs of observations) {
      const attemptId = String(obs.attemptId ?? "");
      const obsCitizenId = String(obs.citizenId ?? "");
      const obsSeq = Number(obs.seq ?? 0);

      if (!attemptId) {
        errors.push("Journal action_observation lacks attemptId");
        continue;
      }

      if (seenObservedAttempts.has(attemptId)) {
        errors.push(`Duplicate observation for attemptId: ${attemptId}`);
      }
      seenObservedAttempts.add(attemptId);

      const matchingAttempt = attemptsById.get(attemptId);
      if (!matchingAttempt) {
        errors.push(`Observation without prior attempt: ${attemptId}`);
        continue;
      }

      const attemptSeq = Number(matchingAttempt.seq ?? 0);
      const attemptCitizenId = String(matchingAttempt.citizenId ?? "");

      // Ordering check
      if (obsSeq <= attemptSeq) {
        errors.push(
          `Out-of-order execution: observation seq ${obsSeq} precedes or equals attempt seq ${attemptSeq} for attempt ${attemptId}`,
        );
        allOrderingValid = false;
      }

      // Cross-citizen identity check
      if (obsCitizenId !== attemptCitizenId) {
        errors.push(
          `Cross-citizen identity confusion: attempt citizen '${attemptCitizenId}' != observation citizen '${obsCitizenId}' for attempt ${attemptId}`,
        );
      }

      // Inventory check
      const beforeInv = (obs.beforeInventory as Record<string, number> | undefined) ?? {};
      const afterInv = (obs.afterInventory as Record<string, number> | undefined) ?? {};
      const beforeOak = beforeInv.oak_log ?? 0;
      const afterOak = afterInv.oak_log ?? 0;

      if (afterOak > beforeOak + 1) {
        errors.push(
          `Artificially increased inventory: citizen ${obsCitizenId} gained more logs than observed (before=${beforeOak}, after=${afterOak}) in attempt ${attemptId}`,
        );
        allInventoriesValid = false;
      } else if (afterOak !== beforeOak + 1) {
        errors.push(
          `Inventory accounting discrepancy for citizen ${obsCitizenId}: expected ${beforeOak + 1} oak_logs, got ${afterOak} in attempt ${attemptId}`,
        );
        allInventoriesValid = false;
      }

      // Check for spontaneous gains of other items
      for (const [item, countAfter] of Object.entries(afterInv)) {
        if (item === "oak_log") continue;
        const countBefore = beforeInv[item] ?? 0;
        if (countAfter > countBefore) {
          errors.push(
            `Spontaneous inventory gain detected: item '${item}' increased from ${countBefore} to ${countAfter} without corresponding gather`,
          );
          allInventoriesValid = false;
        }
      }
    }

    // Check for missing observations
    for (const [attemptId] of attemptsById) {
      if (!seenObservedAttempts.has(attemptId)) {
        errors.push(`Missing observation for attempt: ${attemptId}`);
      }
    }

    details.orderingValid = allOrderingValid;
    details.inventoriesValid = allInventoriesValid;
    details.observationsMatch =
      seenObservedAttempts.size === expectedActionsCount &&
      errors.filter((e) => e.includes("observation")).length === 0;
  }

  // 4. Validate verdict.json
  let verdictObj: Record<string, unknown> = {};
  try {
    verdictObj = JSON.parse(readFileSync(join(artifactDir, "verdict.json"), "utf8")) as Record<
      string,
      unknown
    >;
    validatorVerdict = String(verdictObj.verdict ?? "UNKNOWN");

    if (validatorVerdict === "PASS" || validatorVerdict === "VERIFIED") {
      errors.push(
        `Simulated report promoted to authenticated Paper evidence: verdict is '${validatorVerdict}', must remain 'NOT PROVEN' for offline simulated run`,
      );
    } else if (validatorVerdict !== "NOT PROVEN") {
      errors.push(
        `Unexpected verdict in verdict.json: '${validatorVerdict}' (expected 'NOT PROVEN')`,
      );
    }

    const recordedJournalSha = String(verdictObj.evidenceJournalSha256 ?? "");
    const computedJournalSha = createHash("sha256").update(journalRawBytes).digest("hex");
    if (recordedJournalSha !== computedJournalSha) {
      errors.push(
        `verdict.json evidenceJournalSha256 mismatch: recorded '${recordedJournalSha}' != actual '${computedJournalSha}'`,
      );
    }
  } catch (err) {
    errors.push(`Failed to parse verdict.json: ${String(err)}`);
  }

  // 5. Validate gemini-validator-report.json
  try {
    const report = JSON.parse(
      readFileSync(join(artifactDir, "gemini-validator-report.json"), "utf8"),
    ) as {
      overallStatus?: string;
      environment?: string;
      sourceSha?: string;
      runId?: string;
      experimentId?: string;
      summary?: {
        totalAttemptedActions?: number;
        verifiedActions?: number;
        physicallyVerifiedActions?: number;
        unverifiedActions?: number;
        unverifiedActionClaims?: number;
        inventoryViolationsCount?: number;
        inventoryDiscrepancies?: number;
        hashChainValid?: boolean;
        hashChainIntegrity?: string;
        durationProven?: boolean;
        durationVerified?: boolean;
      };
      hashChainAudit?: {
        valid?: boolean;
        totalRows?: number;
      };
      notProven?: Array<{ code?: string; description?: string }>;
      violations?: Array<{ code?: string; description?: string }>;
    };

    if (report.overallStatus === "VERIFIED") {
      errors.push(
        "Simulated report promoted to authenticated Paper evidence: overallStatus is 'VERIFIED'",
      );
    } else if (report.overallStatus !== "NOT_PROVEN") {
      errors.push(
        `gemini-validator-report overallStatus is '${String(report.overallStatus)}', expected 'NOT_PROVEN'`,
      );
    }

    if (report.sourceSha !== testedSha) {
      errors.push(
        `gemini-validator-report sourceSha mismatch: expected '${testedSha}', got '${String(report.sourceSha)}'`,
      );
    }

    const reportRunId = String(report.runId ?? report.experimentId ?? "");
    if (reportRunId !== runId) {
      errors.push(
        `gemini-validator-report runId mismatch: expected '${runId}', got '${reportRunId}'`,
      );
    }

    const summary = report.summary ?? {};
    if (summary.totalAttemptedActions !== expectedActionsCount) {
      errors.push(
        `gemini-validator-report attempted actions mismatch: expected ${expectedActionsCount}, got ${String(summary.totalAttemptedActions)}`,
      );
    }

    physicallyVerifiedCount = summary.verifiedActions ?? summary.physicallyVerifiedActions ?? 0;
    if (physicallyVerifiedCount !== expectedActionsCount) {
      errors.push(
        `gemini-validator-report physically verified actions mismatch: expected ${expectedActionsCount}, got ${physicallyVerifiedCount}`,
      );
    }

    const unverifiedCount = summary.unverifiedActions ?? summary.unverifiedActionClaims ?? 0;
    if (unverifiedCount !== 0) {
      errors.push(
        `gemini-validator-report unverifiedActionClaims must be 0, got ${unverifiedCount}`,
      );
    }

    const inventoryDiscrepancies =
      summary.inventoryViolationsCount ?? summary.inventoryDiscrepancies ?? 0;
    if (inventoryDiscrepancies !== 0) {
      errors.push(
        `gemini-validator-report inventoryDiscrepancies must be 0, got ${inventoryDiscrepancies}`,
      );
    }

    let isHashChainValid = false;
    if (typeof summary.hashChainValid === "boolean") {
      isHashChainValid = summary.hashChainValid;
    } else if (typeof summary.hashChainIntegrity === "string") {
      isHashChainValid = summary.hashChainIntegrity === "VALID";
    } else if (report.hashChainAudit && typeof report.hashChainAudit.valid === "boolean") {
      isHashChainValid = report.hashChainAudit.valid;
    }

    if (!isHashChainValid) {
      errors.push("gemini-validator-report hash chain verification failed or not valid");
    }

    // Authenticity checks
    paperAttestationProven = Boolean(summary.durationProven ?? summary.durationVerified ?? false);
    if (paperAttestationProven) {
      errors.push(
        "Simulated report promoted to authenticated Paper evidence: durationProven is true for offline fixture",
      );
    }

    if (Array.isArray(report.notProven)) {
      unprovenReasons = report.notProven.map((np) => String(np.code ?? "UNKNOWN"));
    }

    const hasPaperAuthenticityUnproven = unprovenReasons.includes("UNPROVEN_PAPER_AUTHENTICITY");
    if (!hasPaperAuthenticityUnproven) {
      warnings.push(
        "gemini-validator-report did not include explicit UNPROVEN_PAPER_AUTHENTICITY gap code",
      );
    }
  } catch (err) {
    errors.push(`Failed to parse gemini-validator-report.json: ${String(err)}`);
  }

  details.countsMatch =
    actionAttemptsCount === expectedActionsCount &&
    actionObservationsCount === expectedActionsCount;
  details.authenticityHonest = validatorVerdict === "NOT PROVEN" && !paperAttestationProven;

  const passed = errors.length === 0;

  return {
    passed,
    scenario: count,
    artifactDir,
    runId,
    testedSha,
    citizens: observedCitizens,
    actionAttemptsCount,
    actionObservationsCount,
    physicallyVerifiedCount,
    hashChainTotalRows,
    validatorVerdict,
    paperAttestationProven,
    unprovenReasons,
    errors,
    warnings,
    details,
  };
}

/**
 * Checks for Codex's combined journal CLI integration (PR #58).
 * Reports NOT_RUN / NOT_READY if command does not yet exist on this branch,
 * and executes full journal cross-check + forged-receipt negative test if present.
 */
export function checkJournalCliIntegration(
  workspaceRoot: string,
  scenarioArtifactDir?: string,
  expectedSha?: string,
): JournalCliCheckResult {
  const root = resolve(workspaceRoot);
  const cliScriptPath = join(root, "tools/v1-integration/journal-cli-main.ts");
  const packageJsonPath = join(root, "package.json");

  let hasScriptInPackageJson = false;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    hasScriptInPackageJson = Boolean(pkg.scripts && pkg.scripts["v1:journal"]);
  } catch {
    // ignore
  }

  const cliExists = existsSync(cliScriptPath) || hasScriptInPackageJson;

  if (!cliExists) {
    return {
      status: "NOT_RUN",
      command: "pnpm v1:journal",
      details:
        "Codex journal CLI integration (PR #58) pending combination into candidate branch; command 'pnpm v1:journal' and 'tools/v1-integration/journal-cli-main.ts' are not available on this branch.",
    };
  }

  // If CLI is available on a combined branch, execute journal cross-checks
  if (!scenarioArtifactDir) {
    return {
      status: "READY",
      command: "pnpm v1:journal",
      details: "Journal CLI is present and ready for execution.",
    };
  }

  const manifestPath = join(scenarioArtifactDir, "manifest.json");
  let temporary: string | undefined;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const sha = expectedSha ?? manifest.sourceSha;
    const repo = "ManpreetS2/Minecraft-Ai-Civilization-windows-backup";
    const experiment = manifest.configuration?.experimentId;
    const invoke = (args: string[]) => {
      let output: string;
      let code = 0;
      try {
        output = execFileSync(process.execPath, ["--import", "tsx", cliScriptPath, ...args], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
        });
      } catch (error) {
        const failure = error as { status?: number; stdout?: string };
        if (typeof failure.status !== "number" || typeof failure.stdout !== "string") throw error;
        code = failure.status;
        output = failure.stdout;
      }
      const result = JSON.parse(output);
      if (result.authenticatedLiveExecution !== false)
        throw new Error("Journal CLI promoted local evidence to live execution");
      return { code, result };
    };
    const fullArgs = (path: string, directory: string) => [
      path,
      sha,
      repo,
      directory,
      "operator.jsonl",
      ...(typeof experiment === "string" ? [experiment] : []),
    ];
    const consistent = invoke(fullArgs(manifestPath, scenarioArtifactDir));
    const missingRoot = invoke([manifestPath, sha, repo]);
    const missingJournal = invoke([manifestPath, sha, repo, scenarioArtifactDir]);
    temporary = mkdtempSync(join(tmpdir(), "offline-ci-forgery-"));
    const forgedRoot = join(temporary, "evidence");
    cpSync(scenarioArtifactDir, forgedRoot, { recursive: true });
    const action = manifest.actions[0];
    const reference = manifest.sourceReceipts.find(
      (r: { id: string }) => r.id === action.receiptId,
    );
    const receiptPath = resolve(forgedRoot, reference.reference);
    const rel = relative(forgedRoot, receiptPath);
    if (!rel || isAbsolute(rel) || rel.startsWith(".."))
      throw new Error("Unsafe forged receipt reference");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    receipt.inventoryAfter.oak_log = (receipt.inventoryBefore.oak_log ?? 0) + 30;
    const bytes = JSON.stringify(receipt);
    writeFileSync(receiptPath, bytes);
    reference.sha256 = createHash("sha256").update(bytes).digest("hex");
    action.inventoryDelta = { oak_log: 30 };
    action.expectedDelta = { oak_log: 30 };
    const forgedManifest = join(forgedRoot, "manifest.json");
    writeFileSync(forgedManifest, JSON.stringify(manifest));
    const forged = invoke(fullArgs(forgedManifest, forgedRoot));
    const exitCodes = {
      consistent: consistent.code,
      missingRoot: missingRoot.code,
      missingJournal: missingJournal.code,
      forged: forged.code,
    };
    const passed =
      consistent.code === 0 &&
      consistent.result.status === "JOURNAL CONSISTENT" &&
      consistent.result.verdict === "NOT PROVEN" &&
      missingRoot.code === 2 &&
      missingRoot.result.status === "NOT PROVEN" &&
      missingJournal.code === 2 &&
      missingJournal.result.status === "NOT PROVEN" &&
      forged.code === 1 &&
      forged.result.status === "FAIL" &&
      forged.result.failures.some((f: string) => /Journal action/.test(f));
    return {
      status: passed ? "READY" : "FAILED",
      executed: true,
      command: "node --import tsx tools/v1-integration/journal-cli-main.ts",
      exitCodes,
      forgedReceiptTestPassed: forged.code === 1 && forged.result.status === "FAIL",
      details: `Executed consistent, missing-root, missing-journal and rehashed forged-receipt cases: ${JSON.stringify(exitCodes)}. Local consistency is not live authenticity.`,
    };
  } catch (error) {
    return {
      status: "FAILED",
      executed: true,
      command: "pnpm v1:journal",
      details: `Journal CLI execution failed: ${String(error)}`,
      forgedReceiptTestPassed: false,
    };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Formats a comprehensive Markdown summary of offline acceptance verification.
 */
export function formatMarkdownSummary(report: OverallAcceptanceReport): string {
  const statusEmoji = report.passed ? "✅" : "❌";
  const statusText = report.passed ? "PASSED" : "FAILED";

  const lines: string[] = [
    `# ${statusEmoji} Offline Acceptance Verification Report: ${statusText}`,
    "",
    `**Tested Commit SHA:** \`${report.testedSha}\`  `,
    `**Host Environment:** \`${report.system.platform} (${report.system.arch})\` | Node.js \`${report.system.nodeVersion}\`${report.system.pnpmVersion ? ` | pnpm \`${report.system.pnpmVersion}\`` : ""}  `,
    `**Overall Verdict:** **${statusText}**  `,
    "",
    "> OFFLINE ONLY: known PR #67 live-authenticity vulnerabilities are not fixed or accepted by this verification. No live gate may rely on this result.",
    "",
    "## Scenario Summary Matrix",
    "",
    "| Scenario | Citizens | Attempts | Observations | Verified | Hash Chain | Verdict | Paper Proven | Result |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
  ];

  for (const [key, res] of Object.entries(report.scenarios)) {
    const name = key === "2" || key === "scenario-2" ? "1v1 (2 Citizens)" : "2v2 (4 Citizens)";
    const hashStatus = res.details.hashChainValid ? "VALID" : "INVALID";
    const passIndicator = res.passed ? "✅ PASS" : "❌ FAIL";
    const citizensStr = res.citizens.join(", ");
    lines.push(
      `| **${name}** | ${citizensStr} | ${res.actionAttemptsCount} | ${res.actionObservationsCount} | ${res.physicallyVerifiedCount} | ${hashStatus} | ${res.validatorVerdict} | ${res.paperAttestationProven ? "YES (VIOLATION)" : "NO (Honest)"} | ${passIndicator} |`,
    );
  }

  lines.push("");
  lines.push("## Codex Journal CLI Integration (PR #58 / Release Candidate)");
  lines.push("");
  if (report.journalCliCheck.status === "NOT_RUN") {
    lines.push("- **Status:** ⏸️ NOT RUN / NOT READY");
    lines.push(`- **Command:** \`${report.journalCliCheck.command}\``);
    lines.push(`- **Details:** ${report.journalCliCheck.details}`);
    lines.push(
      "- **Integration Handoff:** Once Codex's combined integration candidate lands on this branch, this gate will automatically cross-check original journal rows and execute forged-receipt negative regression tests.",
    );
  } else if (report.journalCliCheck.status === "READY") {
    lines.push("- **Status:** ✅ READY & VERIFIED");
    lines.push(`- **Details:** ${report.journalCliCheck.details}`);
    lines.push(
      `- **Forged-Receipt Negative Test:** ${report.journalCliCheck.forgedReceiptTestPassed ? "PASSED" : "FAILED"}`,
    );
  } else {
    lines.push("- **Status:** ❌ FAILED");
    lines.push(`- **Details:** ${report.journalCliCheck.details}`);
  }

  // Missing Evidence Summary across scenarios
  const allUnproven = new Set<string>();
  for (const res of Object.values(report.scenarios)) {
    for (const code of res.unprovenReasons) {
      allUnproven.add(code);
    }
  }

  if (allUnproven.size > 0) {
    lines.push("");
    lines.push("## Documented Missing Evidence / Gaps (Fail-Closed Policy)");
    lines.push("");
    lines.push("> [!NOTE]");
    lines.push(
      "> These checks are truthfully documented as NOT PROVEN. Offline simulated fixtures cannot fabricate live Paper server metrics or genuine LLM cognition.",
    );
    lines.push("");
    for (const code of allUnproven) {
      lines.push(`- \`${code}\``);
    }
  }

  if (report.allErrors.length > 0) {
    lines.push("");
    lines.push("## ❌ Verification Failures & Errors");
    lines.push("");
    for (const err of report.allErrors) {
      lines.push(`- ${err}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Generated by Minecraft AI Civilization Offline Acceptance CI Verifier.*");

  return lines.join("\n");
}
