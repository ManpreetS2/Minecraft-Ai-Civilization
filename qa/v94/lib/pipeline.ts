// Runs the SHIPPED integration path (tools/v1-integration/offline-validator-report.ts) on real scenario artifacts,
// optionally with an attacker-modified journal that has been re-sealed (the hash chain is unkeyed).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeOfflineValidatorReport } from "../../../tools/v1-integration/offline-validator-report.js";
import { clone, readRows, reseal, type Row } from "./journal.js";

export function artDir(which: "cand" | "base", name: "scenario-2" | "scenario-4"): string {
  const root = which === "cand" ? process.env.QA67_ART : process.env.QA67_BASE_ART;
  if (!root) throw new Error(`${which === "cand" ? "QA67_ART" : "QA67_BASE_ART"} is not set (run via scripts/run-on-candidate.sh)`);
  return join(root, name);
}
export interface Loaded { dir: string; bundle: Record<string, unknown>; rows: Row[]; rawText: string; finals: Record<string, Record<string, number>>; report: Record<string, unknown> }
export function load(dir: string): Loaded {
  const bundle = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const report = JSON.parse(readFileSync(join(dir, "gemini-validator-report.json"), "utf8"));
  const rawText = readFileSync(join(dir, "operator.jsonl"), "utf8");
  return { dir, bundle, rows: readRows(join(dir, "operator.jsonl")), rawText, finals: (report as { inventoryAudit: { citizenFinalInventories: Record<string, Record<string, number>> } }).inventoryAudit.citizenFinalInventories, report };
}
export function runPipeline(L: Loaded, o: { rows?: Row[]; rawLines?: string[]; bundle?: Record<string, unknown>; finals?: Record<string, Record<string, number>>; seal?: boolean } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "qa67-"));
  const journalPath = join(tmp, "operator.jsonl");
  let lines: string[];
  if (o.rawLines) lines = o.rawLines;
  else if (o.rows) lines = o.seal === false ? o.rows.map((r) => JSON.stringify(r)) : reseal(clone(o.rows)).lines;
  else lines = L.rawText.split(/\r?\n/).filter((x) => x.trim());
  writeFileSync(journalPath, lines.join("\n") + "\n");
  return writeOfflineValidatorReport({ outputDirectory: tmp, bundle: (o.bundle ?? L.bundle) as never, journalPath, finalInventories: o.finals ?? L.finals }).report;
}
export const attempts = (rows: Row[]) => rows.filter((r) => r.kind === "action_attempt");
export const observations = (rows: Row[]) => rows.filter((r) => r.kind === "action_observation");
export const codes = (r: { violations: Array<{ code: string }> }) => r.violations.map((v) => v.code);
