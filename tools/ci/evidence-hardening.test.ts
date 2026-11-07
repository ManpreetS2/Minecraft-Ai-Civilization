import { afterEach, describe, expect, it } from "vitest";
import {
  checkJournalCliIntegration,
  classifyOutcome,
  formatMarkdownSummary,
  isLegacyContradiction,
  verifyOfflineScenario,
  type JournalCliCheckResult,
  type OverallAcceptanceReport,
  type ScenarioVerificationResult,
} from "./offline-acceptance-verifier.js";
import { cleanup, fresh, l1, shaOf, type Count } from "../../qa/verify-ci-verifier/test/support/bundle.js";
import { CASES, ORIGINAL_L1_MISSES } from "../../qa/verify-ci-verifier/test/support/cases.js";

/**
 * Evidence hardening, exercised on the COMMITTED REAL recorder output (docs/evidence/offline-integration/1v1 and 2v2), not on a
 * hand-built minimal fixture. The tamper cases are the independent PR #72 adversarial QA (T01-T26); the 13 classes that PR #70's
 * verifier accepted are now ordinary rejections. T26 (a fully coherent forgery of every local artifact) still passes, by design:
 * a locally generated digest cannot authenticate locally generated evidence, and nothing here claims otherwise.
 */
afterEach(cleanup);

describe("untouched real bundles are accepted (no false positives)", () => {
  for (const count of [2, 4] as const) {
    it(`real ${count === 2 ? "1v1" : "2v2"} recorder output passes with zero errors and zero contradictions`, () => {
      const dir = fresh(count);
      const r = l1(dir, count);
      expect(r.errors).toEqual([]);
      expect(r.contradictions).toEqual([]);
      expect(r.passed).toBe(true);
      expect(r.paperAttestationProven).toBe(false);
      expect(r.acceptance?.notMeasurable).toBe(true);
      expect(r.acceptance?.live.passed).toBe(0);
    });
  }
});

describe("PR #72 tamper matrix on real bundles", () => {
  for (const c of CASES) {
    for (const count of c.counts) {
      const tag = `${c.id}${c.counts.length > 1 ? ` [${count === 2 ? "1v1" : "2v2"}]` : ""} ${c.name}`;
      if (c.l1 === "by-design") {
        it(`[LIMITATION BY DESIGN] ${tag}: a coherent forgery of every local artifact is accepted (not authenticated)`, () => {
          const d = fresh(count); c.apply(d, count);
          expect(l1(d, count).passed).toBe(true);
        });
      } else {
        it(`${tag}: rejected`, () => {
          const d = fresh(count); c.apply(d, count);
          const r = l1(d, count);
          expect(r.passed).toBe(false);
          expect(r.errors.length).toBeGreaterThan(0);
        });
      }
    }
  }

  it("every class the original audit found accepted (13 of 26) is now rejected on both real bundles", () => {
    expect(ORIGINAL_L1_MISSES).toHaveLength(13);
    for (const id of ORIGINAL_L1_MISSES) {
      const c = CASES.find((x) => x.id === id)!;
      expect(c.l1, id).toBe("detects");
      for (const count of c.counts) { const d = fresh(count); c.apply(d, count); expect(l1(d, count).passed, `${id} ${count}`).toBe(false); }
    }
  });

  it("a rehashed journal is NOT accepted merely because its hash chain and verdict digest are valid", () => {
    const d = fresh(2); CASES.find((c) => c.id === "T01")!.apply(d, 2);
    const r = l1(d, 2);
    expect(r.details.hashChainValid).toBe(true); // the chain was recomputed and is internally valid ...
    expect(r.passed).toBe(false);                // ... and the bundle is still rejected on cross-source disagreement
    expect(r.contradictions.some((m) => /worldChanges|journal/i.test(m))).toBe(true);
  });
});

describe("authenticity claims from scripted offline fixtures are contradictions", () => {
  const byId = (id: string) => CASES.find((c) => c.id === id)!;
  for (const id of ["T18", "T19", "T20", "T21", "T22", "T23", "T24"]) {
    it(`${id} ${byId(id).name}: reported as a contradiction, not just an error`, () => {
      const d = fresh(2); byId(id).apply(d, 2);
      const r = l1(d, 2);
      expect(r.passed).toBe(false);
      expect(r.contradictions.length).toBeGreaterThan(0);
    });
  }
  it("a missing UNPROVEN_PAPER_AUTHENTICITY gap code is rejected, never read as proof of authenticity", () => {
    const d = fresh(2); byId("T24").apply(d, 2);
    expect(l1(d, 2).contradictions.some((m) => /UNPROVEN_PAPER_AUTHENTICITY/.test(m))).toBe(true);
  });
  it("criteria that remain NOT MEASURABLE are returned, with the failing ones named", () => {
    const a = l1(fresh(2), 2).acceptance!;
    expect(a.offline).toMatchObject({ passed: 0, total: 30, measurement: "NOT MEASURABLE" });
    expect(a.live).toMatchObject({ passed: 0, total: 37, measurement: "NOT MEASURABLE" });
    expect(a.failingCriteria).toContain("A-IDENTITY");
  });
});

describe("outcome classification and the headline", () => {
  const scenario = (over: Partial<ScenarioVerificationResult> = {}): ScenarioVerificationResult => ({
    passed: true, scenario: 2, artifactDir: "x", runId: "r", testedSha: "s", citizens: ["a", "b"], actionAttemptsCount: 6, actionObservationsCount: 6,
    physicallyVerifiedCount: 6, hashChainTotalRows: 18, validatorVerdict: "NOT PROVEN", paperAttestationProven: false, unprovenReasons: ["UNPROVEN_PAPER_AUTHENTICITY"],
    errors: [], contradictions: [], warnings: [], details: { citizensMatch: true, countsMatch: true, observationsMatch: true, orderingValid: true, inventoriesValid: true, decisionSourcesHonest: true, receiptReferencesValid: true, authenticityHonest: true, hashChainValid: true },
    ...over,
  });
  const ready = (): JournalCliCheckResult => ({ status: "READY", command: "c", details: "d", executed: true, forgedReceiptTestPassed: true, forgedJournalTestPassed: true });
  const system = { platform: "linux", arch: "x64", nodeVersion: "v22" };
  const report = (o: ReturnType<typeof classifyOutcome>, checks: Record<string, JournalCliCheckResult>, scenarios: Record<string, ScenarioVerificationResult>): OverallAcceptanceReport =>
    ({ passed: o.status === "OFFLINE_STRUCTURAL_PASS", status: o.status, paperExecution: "NOT PROVEN", testedSha: "a".repeat(40), system, scenarios, journalCliCheck: checks["scenario-2"]!, journalCliChecks: checks, contradictions: o.contradictions, incomplete: o.incomplete, allErrors: o.allErrors });

  it("all scenarios clean and both journal checks READY -> OFFLINE_STRUCTURAL_PASS", () => {
    const o = classifyOutcome({ scenarios: { "scenario-2": scenario(), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": ready(), "scenario-4": ready() } });
    expect(o.status).toBe("OFFLINE_STRUCTURAL_PASS");
  });
  it("a contradiction outranks incompleteness, which outranks an ordinary failure", () => {
    const sc = { "scenario-2": scenario({ passed: false, errors: ["Incorrect attempt count"], contradictions: ["x disagrees"] }), "scenario-4": scenario({ scenario: 4 }) };
    const notRun: JournalCliCheckResult = { status: "NOT_RUN", command: "c", details: "absent" };
    expect(classifyOutcome({ scenarios: sc, journalCliChecks: { "scenario-2": notRun, "scenario-4": ready() } }).status).toBe("CONTRADICTORY_EVIDENCE_REJECTED");
    expect(classifyOutcome({ scenarios: { "scenario-2": scenario(), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": notRun, "scenario-4": ready() } }).status).toBe("VERIFICATION_INCOMPLETE");
    expect(classifyOutcome({ scenarios: { "scenario-2": scenario({ passed: false, errors: ["Incorrect attempt count"] }), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": ready(), "scenario-4": ready() } }).status).toBe("VERIFICATION_FAILED");
  });
  it("each scenario's journal check is judged independently: 1v1 READY cannot excuse a failed 2v2", () => {
    const failed: JournalCliCheckResult = { status: "FAILED", command: "c", details: "controls failed", executed: true, forgedReceiptTestPassed: false };
    const o = classifyOutcome({ scenarios: { "scenario-2": scenario(), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": ready(), "scenario-4": failed } });
    expect(o.status).toBe("VERIFICATION_FAILED");
    expect(o.allErrors.some((e) => e.startsWith("[Scenario-4]"))).toBe(true);
    expect(o.allErrors.some((e) => e.startsWith("[Scenario-2]"))).toBe(false);
  });
  it("a journal check that skipped the forged-journal control is not 'done' even if READY", () => {
    const partial: JournalCliCheckResult = { ...ready(), forgedJournalTestPassed: undefined };
    const o = classifyOutcome({ scenarios: { "scenario-2": scenario(), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": partial, "scenario-4": ready() } });
    expect(o.status).not.toBe("OFFLINE_STRUCTURAL_PASS");
  });
  it("the headline never reads as live acceptance, in any of the four states", () => {
    const states = [
      classifyOutcome({ scenarios: { "scenario-2": scenario(), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": ready(), "scenario-4": ready() } }),
      classifyOutcome({ scenarios: { "scenario-2": scenario(), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": { status: "NOT_RUN", command: "c", details: "d" }, "scenario-4": ready() } }),
      classifyOutcome({ scenarios: { "scenario-2": scenario({ passed: false, errors: ["m"], contradictions: ["m"] }), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": ready(), "scenario-4": ready() } }),
      classifyOutcome({ scenarios: { "scenario-2": scenario({ passed: false, errors: ["Incorrect attempt count"] }), "scenario-4": scenario({ scenario: 4 }) }, journalCliChecks: { "scenario-2": ready(), "scenario-4": ready() } }),
    ];
    const heads = states.map((o) => formatMarkdownSummary(report(o, { "scenario-2": ready(), "scenario-4": ready() }, { "scenario-2": scenario(), "scenario-4": scenario({ scenario: 4 }) })).split("\n")[0]!);
    expect(heads).toEqual([
      "# ✅ Offline structural checks PASSED — genuine Paper execution NOT PROVEN",
      "# ⚠️ Required verification incomplete — genuine Paper execution NOT PROVEN",
      "# ❌ Contradictory evidence rejected — genuine Paper execution NOT PROVEN",
      "# ❌ Offline verification failed — genuine Paper execution NOT PROVEN",
    ]);
    for (const h of heads) expect(h).toMatch(/Paper execution NOT PROVEN/);
  });
  it("legacy error texts are classified: identity / authenticity claims are contradictions, counts and absences are not", () => {
    expect(isLegacyContradiction("Simulated report promoted to authenticated Paper evidence: verdict is 'PASS'")).toBe(true);
    expect(isLegacyContradiction("Cross-citizen identity confusion: attempt citizen 'a' != observation citizen 'b'")).toBe(true);
    expect(isLegacyContradiction("Wrong source SHA: expected a, got b")).toBe(true);
    expect(isLegacyContradiction("Manifest actions count mismatch: expected 6, got 5")).toBe(false);
    expect(isLegacyContradiction("Missing required artifact file: manifest.json")).toBe(false);
    expect(isLegacyContradiction("Duplicate attempt detected in journal: x")).toBe(false);
  });
});

describe("per-scenario journal CLI controls on the committed real bundles (real subprocesses)", () => {
  for (const count of [2, 4] as const) {
    it(`${count === 2 ? "1v1: 2 citizens / 6 attempts / 6 observations" : "2v2: 4 citizens / 12 attempts / 12 observations"}: positive, missing-evidence and forged-evidence controls`, () => {
      const dir = fresh(count as Count);
      const r = checkJournalCliIntegration(process.cwd(), dir, shaOf(dir));
      expect(r).toMatchObject({
        status: "READY", executed: true, forgedReceiptTestPassed: true, forgedJournalTestPassed: true,
        scenario: { citizens: count, attempts: count * 3, observations: count * 3 },
        exitCodes: { consistent: 0, missingRoot: 2, missingJournal: 2, forged: 1, forgedReceipt: 1, forgedJournal: 1 },
      });
      expect(r.exitCodes!.missingReceipt).not.toBe(0);
    }, 120_000);
  }
  it("a verified scenario that has the wrong shape is not accepted even if the CLI is happy", () => {
    // verifyOfflineScenario pins expectedCount; asking for the wrong count on a real bundle must fail.
    const d = fresh(2);
    expect(verifyOfflineScenario({ artifactDir: d, expectedCount: 4, expectedSha: shaOf(d) }).passed).toBe(false);
  });
});
