import { readFileSync } from "node:fs";
import { journalRowSchema } from "../../../experiments/evidence-validator/src/schemas.js";
import { adaptRecorderJournal, validateExperimentEvidence } from "../../../experiments/evidence-validator/src/index.js";
import { clone, reseal, type Row } from "./journal.js";
import { artDir, load } from "./pipeline.js";
export type Rec = Record<string, unknown>;
export { journalRowSchema, adaptRecorderJournal, validateExperimentEvidence, clone, reseal };
export const codes = (r: { violations: Array<{ code: string }> }) => r.violations.map((v) => v.code);
export const errorCodes = (r: { violations: Array<{ code: string; severity: string }> }) => r.violations.filter((v) => v.severity === "ERROR").map((v) => v.code);

/** The REAL recorder-shaped journal (scenario-2 artifact), as raw rows. */
export function artifactRows(name: "scenario-2" | "scenario-4" = "scenario-2"): Row[] { return clone(load(artDir("cand", name)).rows) as Row[]; }
export function artifactFinals(name: "scenario-2" | "scenario-4" = "scenario-2") { return load(artDir("cand", name)).finals; }
/** The shipped integration shape: raw recorder lines + the adapter's parsed rows (it strips fields it does not know). */
export function viaAdapter(rows: Row[], extra: Rec = {}) {
  const lines = reseal(clone(rows)).lines; const a = adaptRecorderJournal(lines);
  return validateExperimentEvidence({ rawJournalLines: lines, journalRows: a.journalRows as never, finalInventories: artifactFinals(), ...extra } as never);
}
/** Library shape: caller passes parsed rows equal to the raw rows (no adapter). */
export function viaLibrary(rows: Row[], extra: Rec = {}) {
  const s = reseal(clone(rows));
  return validateExperimentEvidence({ rawJournalLines: s.lines, journalRows: s.rows as never, finalInventories: artifactFinals(), ...extra } as never);
}
export const rawText = (name: "scenario-2" | "scenario-4" = "scenario-2") => readFileSync(`${artDir("cand", name)}/operator.jsonl`, "utf8");
