/**
 * Runtime Recorder Integration Pathway (Mission 006, Phase 3)
 *
 * Directly executes the genuine application-level `ExperimentEvidenceJournal`
 * from `@civ/agent-core` (or its relative source), exercises multi-citizen
 * operations in a disposable sandbox, and feeds the resulting authentic
 * journal lines through the validator adapter pipeline.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExperimentEvidenceJournal } from "../../../packages/agent-core/src/experiment-evidence.js";
import { adaptRecorderJournal, adaptPersistentFacts } from "./recorder-adapter.js";
import { createTestManifest } from "../fixtures/helpers.js";
import { validateExperimentEvidence, type ValidatorInput } from "./validator.js";
import type { ValidatedManifest } from "./schemas.js";
import type { ValidationReport } from "./types.js";

export interface ActualRecorderPipelineResult {
  tempDir: string;
  journalPath: string;
  rawLines: string[];
  adapted: ReturnType<typeof adaptRecorderJournal>;
  report: ValidationReport;
  cleanup: () => void;
}

/**
 * Runs the authentic runtime ExperimentEvidenceJournal end-to-end:
 * 1. Journal startup
 * 2. Two independent citizens (Atlas and Theo)
 * 3. Action attempts (gather, craft, speech)
 * 4. Physical observation receipts
 * 5. Inventory deltas
 * 6. Private and public event attribution
 * 7. Persisted fact provenance
 * 8. Simulated tick records
 * 9. Operator intervention
 * 10. Shutdown and journal finalization
 */
export function executeActualRecorderPipeline(options?: {
  experimentId?: string;
  sourceSha?: string;
}): ActualRecorderPipelineResult {
  const experimentId = options?.experimentId ?? "exp-actual-recorder-001";
  const sourceSha = options?.sourceSha ?? "ea4ada9ba3baa750cc3c1dec330e4918bb47ef49";
  const tempDir = mkdtempSync(join(tmpdir(), "civ-actual-recorder-"));
  const journalPath = join(tempDir, "experiment.evidence.jsonl");

  const citizensSet = new Set(["gpt_atlas", "claude_theo"]);

  // 1. Journal startup
  const journal = new ExperimentEvidenceJournal(
    journalPath,
    experimentId,
    citizensSet,
    "offline",
  );

  const atlas = journal.forCitizen("gpt_atlas");
  const theo = journal.forCitizen("claude_theo");

  // 2. Atlas gathers oak log
  const attAtlasGather = atlas.attempt({
    action: "gather",
    decisionSource: "model",
    decisionEventId: "ev-atlas-gather-decision",
    expectedItem: "minecraft:oak_log",
  });
  atlas.observe(attAtlasGather, {
    successReported: true,
    beforeInventory: {},
    afterInventory: { "minecraft:oak_log": 1 },
    worldChanges: [],
  });

  // 3. Theo crafts planks from log
  const attTheoCraft = theo.attempt({
    action: "craft",
    decisionSource: "model",
    decisionEventId: "ev-theo-craft-decision",
    expectedItem: "minecraft:oak_planks",
  });
  theo.observe(attTheoCraft, {
    successReported: true,
    beforeInventory: { "minecraft:oak_log": 1 },
    afterInventory: { "minecraft:oak_planks": 4 },
    worldChanges: [],
  });

  // 4. Atlas speaks to Theo (speech observation with authorizedRecipients)
  const attAtlasSpeech = atlas.attempt({
    action: "speech",
    decisionSource: "model",
    decisionEventId: "ev-atlas-speech-decision",
  });
  atlas.observe(attAtlasSpeech, {
    successReported: true,
    beforeInventory: { "minecraft:oak_log": 1 },
    afterInventory: { "minecraft:oak_log": 1 },
    authorizedRecipients: ["claude_theo"],
    worldChanges: [],
  });

  // 5. Simulated tick records
  journal.recordTick(5000, 20.0);
  journal.recordTick(5000, 19.8);

  // 6. Operator intervention
  journal.recordIntervention("operator_stop");

  // 7. Shutdown
  journal.close(true);

  // Read back genuine records
  const rawContent = readFileSync(journalPath, "utf-8").trim();
  const rawLines = rawContent.split("\n").filter((l) => l.trim().length > 0);

  // Feed through recorder adapter
  const adapted = adaptRecorderJournal(rawLines);

  // Correlated persistent facts & events
  const rawFacts = [
    {
      id: "fact-atlas-log",
      citizen_id: "gpt_atlas",
      fact_key: "gathered_log",
      content: "Gathered 1 oak log",
      kind: "observed_fact" as const,
      created_at: new Date().toISOString(),
      source_event_id: "ev-atlas-gather-decision",
    },
    {
      id: "fact-theo-craft",
      citizen_id: "claude_theo",
      fact_key: "crafted_planks",
      content: "Crafted oak planks",
      kind: "observed_fact" as const,
      created_at: new Date().toISOString(),
      source_event_id: "ev-theo-craft-decision",
    },
  ];
  const adaptedFacts = adaptPersistentFacts(rawFacts);

  const events = [
    {
      id: "ev-atlas-gather-decision",
      type: "CitizenDecisionMade",
      timestamp: new Date().toISOString(),
      citizenId: "gpt_atlas",
      payload: { action: "gather" },
    },
    {
      id: "ev-theo-craft-decision",
      type: "CitizenDecisionMade",
      timestamp: new Date().toISOString(),
      citizenId: "claude_theo",
      payload: { action: "craft" },
    },
    {
      id: "ev-atlas-speech-decision",
      type: "ConversationOccurred",
      timestamp: new Date().toISOString(),
      citizenId: "gpt_atlas",
      payload: {
        visibility: { class: "nearby_speech", audienceIds: ["claude_theo"] },
      },
    },
  ];

  const manifest = createTestManifest({
    stage: "1v1",
    durationMinutes: 0,
  });
  manifest.experimentId = experimentId;
  manifest.sourceSha = sourceSha;
  manifest.paths = {
    runRoot: tempDir,
    world: join(tempDir, "world"),
    database: join(tempDir, "db.sqlite"),
    evidence: journalPath,
  };

  const validatorInput: ValidatorInput = {
    manifest,
    rawJournalLines: rawLines,
    journalRows: adapted.journalRows,
    events,
    facts: adaptedFacts.facts,
    finalInventories: {
      gpt_atlas: { "minecraft:oak_log": 1 },
      claude_theo: { "minecraft:oak_planks": 4 },
    },
  };

  const report = validateExperimentEvidence(validatorInput);

  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore temp dir cleanup errors
    }
  };

  return {
    tempDir,
    journalPath,
    rawLines,
    adapted,
    report,
    cleanup,
  };
}
