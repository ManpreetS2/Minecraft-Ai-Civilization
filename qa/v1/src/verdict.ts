import { SCENARIO_IDS, type CaseStatus } from "./scenario.js";

/** The slice of Vitest's JSON reporter output the runner relies on. */
export interface VitestJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests?: number;
  success?: boolean;
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{ fullName: string; title: string; status: string }>;
  }>;
}

export interface RunFacts {
  vitest: VitestJson | undefined;
  exitCode: number;
  /** SHA actually checked out when the tests ran, and whether the tree had uncommitted changes. */
  actualSha: string;
  dirty: boolean;
  claimedSha?: string;
  /** Branch/PR the caller says the evidence belongs to; compared with the checked out branch. */
  claimedBranch?: string;
  actualBranch?: string;
  /** Test files that must have produced results. */
  requiredFiles: readonly string[];
  /** Criteria the caller needs live Paper proof for. */
  requireLive?: boolean;
  /** Scenario IDs that must have at least one executed test. */
  requiredScenarios?: readonly string[];
}

export interface Verdict {
  verdict: "PASS" | "FAIL";
  mode: "OFFLINE_FIXTURE";
  reasons: string[];
  perScenario: Record<string, { status: CaseStatus; tests: number; passed: number; failed: number; skipped: number; defects: number; blocked: number }>;
  totals: { tests: number; passed: number; failed: number; skipped: number; defectsReproduced: number; blocked: number };
}

const TAG = /^\[(ADV-\d{2})\](\[DEFECT\])?(\[BLOCKED\])?/;

export function evaluate(f: RunFacts): Verdict {
  const reasons: string[] = [];
  const perScenario: Verdict["perScenario"] = {};
  const totals = { tests: 0, passed: 0, failed: 0, skipped: 0, defectsReproduced: 0, blocked: 0 };
  const results = f.vitest?.testResults ?? [];

  if (!f.vitest) reasons.push("no Vitest result was produced (the run crashed before reporting)");
  if (f.exitCode !== 0) reasons.push(`test process exited ${f.exitCode}`);
  if (f.dirty) reasons.push("working tree has uncommitted changes; evidence is not attributable to one SHA");
  if (f.claimedSha && f.claimedSha !== f.actualSha) reasons.push(`tested SHA ${f.actualSha} differs from claimed SHA ${f.claimedSha}`);
  if (f.claimedBranch && f.actualBranch && f.claimedBranch !== f.actualBranch) {
    reasons.push(`evidence is from branch ${f.actualBranch}, not claimed branch ${f.claimedBranch}`);
  }
  for (const file of f.requiredFiles) {
    if (!results.some((r) => r.name.replaceAll("\\", "/").endsWith(file))) reasons.push(`required test file ${file} produced no results`);
  }
  for (const file of results) {
    if (file.status === "failed" && file.assertionResults.length === 0) reasons.push(`${file.name}: suite failed to load or set up`);
    for (const t of file.assertionResults) {
      totals.tests++;
      const tag = TAG.exec(t.title);
      const status = t.status;
      const slot = tag ? (perScenario[tag[1]!] ??= { status: "NOT_RUN", tests: 0, passed: 0, failed: 0, skipped: 0, defects: 0, blocked: 0 }) : undefined;
      if (slot) slot.tests++;
      if (status === "passed") {
        if (tag?.[2]) { totals.defectsReproduced++; if (slot) slot.defects++; } // it.fails: a reproduced defect, never a fix
        else if (tag?.[3]) reasons.push(`${t.title}: a BLOCKED case passed; remove the marker only with the interface evidence`);
        else { totals.passed++; if (slot) slot.passed++; }
      } else if (status === "failed") { totals.failed++; if (slot) slot.failed++; }
      else { totals.skipped++; if (slot) slot.skipped++; if (tag?.[3] && slot) slot.blocked++; }
    }
  }
  for (const s of Object.values(perScenario)) {
    s.status = s.failed > 0 ? "FAIL" : s.blocked > 0 ? "BLOCKED" : s.skipped > 0 ? "SKIPPED" : s.passed > 0 ? "PASS" : s.defects > 0 ? "KNOWN_DEFECT_REPRODUCED" : "NOT_RUN";
    totals.blocked += s.blocked;
  }
  if (totals.tests === 0) reasons.push("zero tests executed");
  if (totals.failed > 0) reasons.push(`${totals.failed} test(s) failed`);
  if (totals.passed === 0 && totals.tests > 0) reasons.push("no test passed");
  for (const id of f.requiredScenarios ?? SCENARIO_IDS) {
    const s = perScenario[id];
    if (!s || s.tests === 0) reasons.push(`scenario ${id} has no executed test`);
    else if (s.status === "BLOCKED") reasons.push(`scenario ${id} is BLOCKED by a missing interface; blocked is not passed`);
    else if (s.status === "SKIPPED" || s.status === "NOT_RUN") reasons.push(`scenario ${id} only skipped (${s.status}); skipped is not passed`);
    else if (s.status === "KNOWN_DEFECT_REPRODUCED") reasons.push(`scenario ${id} only reproduces a known defect; that is not a fix`);
  }
  if (f.requireLive) reasons.push("live Paper proof was required but every scenario is OFFLINE_FIXTURE evidence");
  return { verdict: reasons.length === 0 ? "PASS" : "FAIL", mode: "OFFLINE_FIXTURE", reasons, perScenario, totals };
}
