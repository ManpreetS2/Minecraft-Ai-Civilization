import { readFileSync } from "node:fs";
import {
  adaptRecorderJournal,
  bridgeV1RunBundle,
  formatHumanReport,
  validateExperimentEvidence,
  type ValidationReport,
  type V1RunBundle,
} from "../../experiments/evidence-validator/src/index.js";
import type { RunBundle } from "./manifest.js";

export function writeOfflineValidatorReport(input: {
  outputDirectory: string;
  bundle: RunBundle;
  journalPath: string;
  finalInventories?: Record<string, Record<string, number>>;
}): { report: ValidationReport; summary: string } {
  const rawLines = readFileSync(input.journalPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const adapted = adaptRecorderJournal(rawLines);
  const bridged = bridgeV1RunBundle(input.bundle as unknown as V1RunBundle);
  const report = validateExperimentEvidence({
    manifest: bridged.manifest,
    rawJournalLines: adapted.rawJournalLines.length > 0 ? adapted.rawJournalLines : bridged.rawJournalLines,
    journalRows: adapted.journalRows.length > 0 ? adapted.journalRows : bridged.journalRows,
    events: bridged.events,
    facts: bridged.facts,
    deliveries: bridged.deliveries,
    finalInventories: input.finalInventories,
    sourceAttestation: bridged.sourceAttestation,
  });
  // Preserve fail-closed gaps from both adapters without inventing Paper authenticity.
  report.notProven.push(...adapted.notProven, ...bridged.notProven);
  for (const gap of [...adapted.recorderGaps, ...bridged.gaps]) {
    if (!report.notProven.some((item) => item.description.includes(gap))) {
      report.notProven.push({
        code: "RECORDER_OR_BRIDGE_GAP",
        description: gap,
        missingFields: [],
      });
    }
  }
  // Live Paper authenticity remains Gemini-owned and unproven until real signature verification exists.
  if (!report.notProven.some((item) => item.code === "UNPROVEN_PAPER_AUTHENTICITY")) {
    report.notProven.push({
      code: "UNPROVEN_PAPER_AUTHENTICITY",
      description:
        "Offline fixture only. Paper authenticity is NOT verified; live acceptance remains blocked until Gemini implements real signature verification and a trustworthy Paper capture source.",
      missingFields: ["paper_server_attested"],
    });
  }
  if (report.overallStatus === "VERIFIED" && report.notProven.length > 0) {
    report.overallStatus = "NOT_PROVEN";
  }
  return { report, summary: formatHumanReport(report) };
}
