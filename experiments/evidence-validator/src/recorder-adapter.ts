/**
 * Recorder Adapter (Phase 2)
 *
 * Bridges the gap between records produced by the CODEX 1-owned
 * `ExperimentEvidenceJournal` (packages/agent-core/src/experiment-evidence.ts)
 * and the format consumed by the offline evidence validator.
 *
 * The recorder schema is NARROWER than the validator schema in these ways:
 *
 *   1. `action_attempt` does NOT include `originPosition`
 *      → Adapter leaves it undefined; validator reports NOT_PROVEN for
 *        path-traversal checks that require it.
 *
 *   2. `action_observation` does NOT include `toolDurabilityBefore/After`
 *      → Adapter leaves them undefined; validator reports NOT_PROVEN for
 *        tool-wear checks.
 *
 *   3. `tick` records do NOT include `serverGameTick`
 *      → Adapter leaves it undefined; duration verifier reports that Paper
 *        tick continuity cannot be proven without this field (Phase 2 check).
 *
 *   4. `citizen_persistent_facts` rows may omit `source_event_id`
 *      → Adapter emits `sourceEventId: undefined`; information verifier
 *        cannot trace provenance for those facts → NOT_PROVEN.
 *
 * This adapter does NOT modify the recorder; it only normalises copies
 * of already-produced offline fixture artifacts/logs as inputs.
 *
 * Integration request reference: RECORDER_GAP_ANALYSIS.md
 * Coordination: Issue #6
 */

import { createHash } from "node:crypto";
import { journalRowSchema } from "./schemas.js";
import type { JournalRow, PersistentFactItem } from "./schemas.js";
import type { MissingEvidenceItem } from "./types.js";

export type RecorderAdapterResult = {
  journalRows: JournalRow[];
  rawJournalLines: string[];
  notProven: MissingEvidenceItem[];
  /** Warnings about fields that were absent in the recorder output */
  recorderGaps: string[];
};

/**
 * Parse raw JSONL lines from the CODEX 1 operator journal into the
 * validator's typed JournalRow format.  Unknown / extra fields that
 * are NOT in the validator schema are stripped silently so that strict()
 * schemas do not reject the rows.
 *
 * Absent-but-expected Phase 2 fields are recorded in `notProven` and
 * `recorderGaps` rather than causing a parse failure.
 */
export function adaptRecorderJournal(rawLines: readonly string[]): RecorderAdapterResult {
  const journalRows: JournalRow[] = [];
  const outputLines: string[] = [];
  const notProven: MissingEvidenceItem[] = [];
  const recorderGaps: string[] = [];

  let missingOriginPosition = false;
  let missingToolDurability = false;
  let missingServerGameTick = false;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      notProven.push({
        code: "INVALID_RECORDER_LINE",
        description: `Non-JSON line in recorder output: ${trimmed.slice(0, 64)}`,
        missingFields: ["valid_json"],
      });
      continue;
    }

    const kind = parsed.kind as string | undefined;

    // Strip fields that do not exist in the validator schema (e.g., future recorder additions)
    // but KEEP all validator-schema fields.  We rebuild a clean object so .strict() doesn't
    // reject unknown keys from the recorder.
    if (kind === "action_attempt") {
      if (!("originPosition" in parsed) || parsed.originPosition === undefined) {
        missingOriginPosition = true;
      }
      // Construct a clean attempt record (no extra fields beyond the schema)
      const clean: Record<string, unknown> = {
        kind: "action_attempt",
        experimentId: parsed.experimentId,
        seq: parsed.seq,
        at: parsed.at,
        previousHash: parsed.previousHash,
        hash: parsed.hash,
        citizenId: parsed.citizenId,
        attemptId: parsed.attemptId,
        action: parsed.action,
        decisionSource: parsed.decisionSource,
        decisionEventId: parsed.decisionEventId,
      };
      if (parsed.expectedItem !== undefined) clean.expectedItem = parsed.expectedItem;
      if (parsed.target !== undefined) clean.target = parsed.target;
      if (parsed.range !== undefined) clean.range = parsed.range;
      if (parsed.originPosition !== undefined) clean.originPosition = parsed.originPosition;

      const result = journalRowSchema.safeParse(clean);
      if (result.success) {
        journalRows.push(result.data);
        outputLines.push(trimmed); // Preserve original line for hash-chain integrity
      } else {
        notProven.push({
          code: "RECORDER_SCHEMA_MISMATCH_ATTEMPT",
          description: `action_attempt row failed validator schema: ${result.error.message.slice(0, 128)}`,
          missingFields: result.error.issues.map((i) => i.path.join(".")),
        });
      }
    } else if (kind === "action_observation") {
      if (!("toolDurabilityBefore" in parsed) || parsed.toolDurabilityBefore === undefined) {
        missingToolDurability = true;
      }
      const clean: Record<string, unknown> = {
        kind: "action_observation",
        experimentId: parsed.experimentId,
        seq: parsed.seq,
        at: parsed.at,
        previousHash: parsed.previousHash,
        hash: parsed.hash,
        citizenId: parsed.citizenId,
        attemptId: parsed.attemptId,
        verified: parsed.verified,
        successReported: parsed.successReported,
        beforeInventory: parsed.beforeInventory ?? {},
        afterInventory: parsed.afterInventory ?? {},
        worldChanges: parsed.worldChanges ?? [],
      };
      if (parsed.position !== undefined) clean.position = parsed.position;
      if (parsed.hungerBefore !== undefined) clean.hungerBefore = parsed.hungerBefore;
      if (parsed.hungerAfter !== undefined) clean.hungerAfter = parsed.hungerAfter;
      if (parsed.healthBefore !== undefined) clean.healthBefore = parsed.healthBefore;
      if (parsed.healthAfter !== undefined) clean.healthAfter = parsed.healthAfter;
      if (parsed.authorizedRecipients !== undefined)
        clean.authorizedRecipients = parsed.authorizedRecipients;
      if (parsed.failureCode !== undefined) clean.failureCode = parsed.failureCode;
      if (parsed.toolDurabilityBefore !== undefined)
        clean.toolDurabilityBefore = parsed.toolDurabilityBefore;
      if (parsed.toolDurabilityAfter !== undefined)
        clean.toolDurabilityAfter = parsed.toolDurabilityAfter;

      const result = journalRowSchema.safeParse(clean);
      if (result.success) {
        journalRows.push(result.data);
        outputLines.push(trimmed); // Preserve original line for hash-chain integrity
      } else {
        notProven.push({
          code: "RECORDER_SCHEMA_MISMATCH_OBSERVATION",
          description: `action_observation row failed validator schema: ${result.error.message.slice(0, 128)}`,
          missingFields: result.error.issues.map((i) => i.path.join(".")),
        });
      }
    } else if (kind === "tick") {
      if (
        !("serverGameTick" in parsed) ||
        parsed.serverGameTick === undefined ||
        parsed.serverGameTick === null
      ) {
        missingServerGameTick = true;
      }
      const clean: Record<string, unknown> = {
        kind: "tick",
        experimentId: parsed.experimentId,
        seq: parsed.seq,
        at: parsed.at,
        previousHash: parsed.previousHash,
        hash: parsed.hash,
        durationMs: parsed.durationMs,
      };
      if (parsed.measuredTps !== undefined) clean.measuredTps = parsed.measuredTps;
      if (parsed.serverGameTick !== undefined) clean.serverGameTick = parsed.serverGameTick;
      if (parsed.simulatedStep !== undefined) clean.simulatedStep = parsed.simulatedStep;
      if (parsed.tickProvenance !== undefined) clean.tickProvenance = parsed.tickProvenance;

      const result = journalRowSchema.safeParse(clean);
      if (result.success) {
        journalRows.push(result.data);
        outputLines.push(trimmed); // Preserve original line for hash-chain integrity
      } else {
        notProven.push({
          code: "RECORDER_SCHEMA_MISMATCH_TICK",
          description: `tick row failed validator schema: ${result.error.message.slice(0, 128)}`,
          missingFields: result.error.issues.map((i) => i.path.join(".")),
        });
      }
    } else if (kind === "start") {
      const clean: Record<string, unknown> = {
        kind: "start",
        experimentId: parsed.experimentId,
        seq: parsed.seq,
        at: parsed.at,
        previousHash: parsed.previousHash,
        hash: parsed.hash,
        recordingAudience: parsed.recordingAudience,
        mode: parsed.mode,
      };
      if (parsed.decisionTransport !== undefined)
        clean.decisionTransport = parsed.decisionTransport;
      if (parsed.sourceSha !== undefined) clean.sourceSha = parsed.sourceSha;
      if (parsed.runId !== undefined) clean.runId = parsed.runId;
      if (parsed.citizens !== undefined) clean.citizens = parsed.citizens;

      const result = journalRowSchema.safeParse(clean);
      if (result.success) {
        journalRows.push(result.data);
        outputLines.push(trimmed); // Preserve original line for hash-chain integrity
      } else {
        notProven.push({
          code: "RECORDER_SCHEMA_MISMATCH_START",
          description: `start row failed validator schema: ${result.error.message.slice(0, 128)}`,
          missingFields: result.error.issues.map((i) => i.path.join(".")),
        });
      }
    } else {
      // Pass through all other known kinds (start, shutdown, death, respawn, etc.)
      // after stripping any extra unknown fields via schema parse.
      const result = journalRowSchema.safeParse(parsed);
      if (result.success) {
        journalRows.push(result.data);
        outputLines.push(trimmed); // Preserve original line for hash-chain integrity
      } else {
        // Try without strict extras — pick known fields for the kind
        notProven.push({
          code: "RECORDER_UNKNOWN_ROW_KIND",
          description: `Row with kind='${String(kind)}' could not be parsed: ${result.error.message.slice(0, 128)}`,
          missingFields: result.error.issues.map((i) => i.path.join(".")),
        });
      }
    }
  }

  // Aggregate gap reports
  if (missingOriginPosition) {
    recorderGaps.push(
      "originPosition absent from action_attempt rows: movement path-traversal verification not possible. " +
        "CODEX 1 integration request: add originPosition to attemptSchema (see RECORDER_GAP_ANALYSIS.md §2.1).",
    );
    notProven.push({
      code: "RECORDER_GAP_ORIGIN_POSITION",
      description:
        "action_attempt records lack originPosition. Movement path-traversal checks are NOT_PROVEN.",
      missingFields: ["originPosition"],
    });
  }

  if (missingToolDurability) {
    recorderGaps.push(
      "toolDurabilityBefore/After absent from action_observation rows: tool-wear verification not possible. " +
        "CODEX 1 integration request: add toolDurabilityBefore/After to observationSchema (see RECORDER_GAP_ANALYSIS.md §2.3).",
    );
    notProven.push({
      code: "RECORDER_GAP_TOOL_DURABILITY",
      description:
        "action_observation records lack toolDurabilityBefore/After. Tool-wear checks are NOT_PROVEN.",
      missingFields: ["toolDurabilityBefore", "toolDurabilityAfter"],
    });
  }

  if (missingServerGameTick) {
    recorderGaps.push(
      "serverGameTick absent from tick rows: Paper server tick continuity cannot be proven. " +
        "CODEX 1 integration request: add serverGameTick to recordTick() (see RECORDER_GAP_ANALYSIS.md §2.2).",
    );
    notProven.push({
      code: "RECORDER_GAP_SERVER_GAME_TICK",
      description:
        "tick records lack serverGameTick. Uninterrupted 60-minute Paper server proof is NOT_PROVEN.",
      missingFields: ["serverGameTick"],
    });
  }

  return { journalRows, rawJournalLines: outputLines, notProven, recorderGaps };
}

/**
 * Adapt a SQLite-exported `citizen_persistent_facts` row array into
 * the validator's PersistentFactItem format, reporting NOT_PROVEN when
 * `source_event_id` is absent.
 */
export function adaptPersistentFacts(
  sqliteRows: ReadonlyArray<{
    id: string;
    citizen_id: string;
    fact_key: string;
    content: string;
    kind: string;
    created_at: string;
    source_event_id?: string | null;
  }>,
): { facts: PersistentFactItem[]; notProven: MissingEvidenceItem[] } {
  const facts: PersistentFactItem[] = [];
  const notProven: MissingEvidenceItem[] = [];
  let missingSourceEventId = false;

  for (const row of sqliteRows) {
    const kind = row.kind as PersistentFactItem["kind"];
    if (kind !== "observed_fact" && kind !== "communicated_claim" && kind !== "quarantined_claim") {
      notProven.push({
        code: "RECORDER_FACT_UNKNOWN_KIND",
        citizenId: row.citizen_id,
        description: `Persistent fact '${row.id}' has unknown kind '${row.kind}'`,
        missingFields: ["kind"],
      });
      continue;
    }

    if (!row.source_event_id) {
      missingSourceEventId = true;
    }

    facts.push({
      id: row.id,
      citizenId: row.citizen_id,
      factKey: row.fact_key,
      content: row.content,
      kind,
      createdAt: row.created_at,
      sourceEventId: row.source_event_id ?? undefined,
    });
  }

  if (missingSourceEventId) {
    notProven.push({
      code: "RECORDER_GAP_SOURCE_EVENT_ID",
      description:
        "Some citizen_persistent_facts rows lack source_event_id. Provenance tracing depends on heuristics, not immutable foreign key. " +
        "CODEX 1 integration request: ensure source_event_id is always populated (see RECORDER_GAP_ANALYSIS.md §2.4).",
      missingFields: ["source_event_id"],
    });
  }

  return { facts, notProven };
}

/**
 * Re-hash a journal line array to produce a fresh hash chain.
 * Used in tests to construct valid recorder-sourced journals without
 * access to the recorder runtime itself.
 */
export function rehashJournalLines(
  rows: ReadonlyArray<Record<string, unknown>>,
  experimentId: string,
): string[] {
  const lines: string[] = [];
  let previousHash = "";
  let seq = 0;

  for (const row of rows) {
    seq++;
    const rowObj = {
      experimentId,
      seq,
      at: row.at ?? new Date(Date.now() + seq * 1000).toISOString(),
      previousHash,
      ...row,
    };
    const { hash: _dropHash, ...withoutHash } = rowObj as Record<string, unknown>;
    const hash = createHash("sha256").update(JSON.stringify(withoutHash)).digest("hex");
    const fullRow = { ...withoutHash, hash };
    previousHash = hash;
    lines.push(JSON.stringify(fullRow));
  }

  return lines;
}
