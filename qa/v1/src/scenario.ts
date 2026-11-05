/**
 * Independent QA scenario contract. Test-only: nothing in production may import this. Every scenario runs in
 * OFFLINE_FIXTURE mode; none of them can certify live Paper behaviour.
 */
export type EvidenceMode = "OFFLINE_FIXTURE" | "LIVE_PAPER";
export type CaseStatus = "PASS" | "FAIL" | "BLOCKED" | "KNOWN_DEFECT_REPRODUCED" | "SKIPPED" | "NOT_RUN";
export type MissingEvidence = "none" | "needs_live_paper" | "needs_integration_interface" | "needs_fixed_source";

export interface ScenarioSpec {
  /** Stable ID, `ADV-01`..`ADV-14` (see docs/QA_1V1_ADVERSARIAL_ACCEPTANCE.md). Never renumbered. */
  id: string;
  name: string;
  /** project.md section the case verifies (e.g. "Gate A: independent sessions"). */
  requirement: string;
  /** Citizens the scenario creates, by id and model family. */
  citizens: ReadonlyArray<{ id: string; family: "gpt" | "claude" }>;
  /** Scripted provider behaviour, described for the evidence record. */
  providerScript: string;
  initialWorld: string;
  initialPersistentState: string;
  /** Audiences allowed to learn the scenario's secret fact. */
  allowedAudiences: readonly string[];
  expectedAction: string;
  expectedPhysicalOutcome: string;
  /** Things that must never be true afterwards. */
  negativeAssertions: readonly string[];
  cleanup: string;
  /** Where the evidence lives (test file + title prefix). */
  evidence: string;
  /** Evidence the case can never provide in OFFLINE_FIXTURE mode. */
  missingEvidence: MissingEvidence;
  /** Set when the integrated runtime does not yet expose the interface; the case must then be BLOCKED, not green. */
  blockedBy?: string;
}

export const SCENARIO_IDS = Array.from({ length: 14 }, (_, i) => `ADV-${String(i + 1).padStart(2, "0")}`);

/** Test title convention that the runner parses: `[ADV-03] ...` and `[ADV-03][DEFECT] ...` for it.fails reproductions. */
export const caseTitle = (id: string, text: string, opts: { defect?: boolean; blocked?: boolean } = {}) =>
  `[${id}]${opts.defect ? "[DEFECT]" : ""}${opts.blocked ? "[BLOCKED]" : ""} ${text}`;

export function defineScenario(spec: ScenarioSpec): ScenarioSpec {
  if (!/^ADV-\d{2}$/.test(spec.id)) throw new Error(`bad scenario id ${spec.id}`);
  if (spec.citizens.length === 0 && spec.missingEvidence === "none") throw new Error(`${spec.id}: no citizens declared`);
  if (spec.negativeAssertions.length === 0) throw new Error(`${spec.id}: a scenario needs at least one negative assertion`);
  return Object.freeze({ ...spec });
}
