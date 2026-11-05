import type { RunBundle } from "./manifest.js";
/** Narrow Phase 1/2 report boundary. The upstream validator stays owned by Antigravity. */
export interface AntigravityReport {
  version: "1.0.0"; validatorName: "antigravity-evidence-validator";
  experimentId: string; sourceSha: string; mode: "offline_simulated" | "real_minecraft";
  overallStatus: "VERIFIED" | "VIOLATIONS_DETECTED" | "NOT_PROVEN";
  attribution: { runId: string; citizens: string[] };
  notProven: { code: string; missingFields: string[] }[];
}
export function adaptAntigravityReport(bundle: RunBundle, report: AntigravityReport, artifact: string): NonNullable<RunBundle["validator"]> {
  const expectedMode = bundle.mode === "offline-fixture" ? "offline_simulated" : "real_minecraft";
  const sameRoster = [...bundle.citizens.map((c) => c.id)].sort().join("\0") === [...report.attribution.citizens].sort().join("\0");
  if (report.version !== "1.0.0" || report.validatorName !== "antigravity-evidence-validator" || report.sourceSha !== bundle.sourceSha || report.mode !== expectedMode || report.experimentId !== bundle.runId || report.attribution.runId !== bundle.runId || !sameRoster || !artifact.trim()) throw new Error("Validator report source, run, mode or roster mismatch");
  // This maps a report, not its authenticity. Acceptance still requires artifact hashing and independent review.
  return { name: report.validatorName, artifact, verdict: report.overallStatus === "VIOLATIONS_DETECTED" ? "FAIL" : report.overallStatus === "VERIFIED" && report.notProven.length === 0 ? "PASS" : "NOT PROVEN" };
}
