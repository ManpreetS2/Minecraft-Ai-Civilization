import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkJournalCliIntegration } from "../../../tools/ci/offline-acceptance-verifier.js";
import { cleanup, CLI_PRESENT, fresh, l2, REPO_ROOT, run, shaOf, type Count } from "./support/bundle.js";
import { CASES } from "./support/cases.js";

/**
 * Does the wrapper that CI runs USE the journal CLI for EACH scenario, gate on it with a real nonzero exit, and report honestly?
 * Originally (PR #72) these were `it.fails` reproductions against PR #70. PR #73 fixed the experiment id / real subprocess / gating,
 * and the hardening branch fixed the rest; every formerly expected-failure assertion is now an ordinary passing test.
 * Journal-CLI claims are checked against PR #68's real CLI (it exists in this tree).
 */
const temps: string[] = [];
afterEach(() => { cleanup(); for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true }); });
const tmp = (p: string, inRepo = false) => { const d = inRepo ? (mkdirSync(join(REPO_ROOT, "artifacts"), { recursive: true }), mkdtempSync(join(REPO_ROOT, "artifacts", p))) : mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };

interface Summary {
  passed: boolean; status: string; paperExecution: string; contradictions: string[]; incomplete: string[];
  journalCliCheck: { status: string }; journalCliChecks: Record<string, { status: string; executed?: boolean; exitCodes?: Record<string, number>; forgedReceiptTestPassed?: boolean; forgedJournalTestPassed?: boolean; scenario?: { citizens: number; attempts: number; observations: number } }>;
  acceptance: Record<string, { offline: { passed: number; total: number; measurement: string }; live: { passed: number; total: number; measurement: string }; failingCriteria: string[]; notMeasurable: boolean }>;
  scenarios: Record<string, { passed: boolean; errors: string[] }>;
}
async function runWrapper(d2: string, d4: string) {
  const out = tmp("ciqa-out-");
  const r = await run(["tools/ci/verify-offline-acceptance.ts", "--scenario2", d2, "--scenario4", d4, "--sha", shaOf(d2), "--output", out]);
  const summary = JSON.parse(readFileSync(join(out, "ci-summary.json"), "utf8")) as Summary;
  return { exit: r.exit, summary, md: readFileSync(join(out, "ci-summary.md"), "utf8"), stdout: r.stdout, stderr: r.stderr };
}
const inspect = (dir: string) => checkJournalCliIntegration(REPO_ROOT, dir, shaOf(dir));
const forged = (count: Count, id: string) => { const d = fresh(count); CASES.find((c) => c.id === id)!.apply(d, count); return d; };
const EXPECT: Record<Count, { citizens: number; attempts: number }> = { 2: { citizens: 2, attempts: 6 }, 4: { citizens: 4, attempts: 12 } };

describe("journal CLI integration: independent real-subprocess controls PER scenario", () => {
  it.skipIf(!CLI_PRESENT)("[CLI behaviour] calling PR #68's CLI without the experimentId still rejects an untouched bundle (the bug PR #73 fixed in the caller)", async () => {
    const r = await l2(fresh(2), 2, { experimentId: null });
    expect(r.exit).toBe(1);
    expect(r.failures?.some((f) => /Foreign run journal event replay/.test(f))).toBe(true);
  });

  for (const count of [2, 4] as const) {
    describe(`${count === 2 ? "1v1" : "2v2"} (${EXPECT[count].citizens} citizens, ${EXPECT[count].attempts} original attempts and observations)`, () => {
      it.skipIf(!CLI_PRESENT)("positive, missing-evidence and forged-evidence controls all execute and behave on an untouched real bundle", () => {
        const r = inspect(fresh(count));
        expect(r.status).toBe("READY");
        expect(r.executed).toBe(true);
        expect(r.exitCodes?.consistent).toBe(0);
        expect(r.exitCodes?.missingRoot).toBe(2);
        expect(r.exitCodes?.missingJournal).toBe(2);
        expect(r.exitCodes?.missingReceipt).not.toBe(0);
        expect(r.exitCodes?.forgedReceipt).toBe(1);
        expect(r.exitCodes?.forgedJournal).toBe(1);
        expect(r.forgedReceiptTestPassed).toBe(true);
        expect(r.forgedJournalTestPassed).toBe(true);
      });
      it.skipIf(!CLI_PRESENT)("the control result records the citizen and original attempt/observation counts read from the journal itself", () => {
        const r = inspect(fresh(count));
        expect(r.scenario).toEqual({ citizens: EXPECT[count].citizens, attempts: EXPECT[count].attempts, observations: EXPECT[count].attempts });
      });
      it.skipIf(!CLI_PRESENT)("a forged receipt makes the helper report FAILED (never READY)", () => {
        const r = inspect(forged(count, "T07"));
        expect(r.status).toBe("FAILED");
      });
      it.skipIf(!CLI_PRESENT)("a journal with the wrong original attempt count makes the helper report FAILED", () => {
        const r = inspect(forged(count, "T13"));
        expect(r.status).toBe("FAILED");
      });
    });
  }

  it.skipIf(!CLI_PRESENT)("both scenarios are cross-checked independently by the wrapper and both are recorded", async () => {
    const r = await runWrapper(fresh(2), fresh(4));
    expect(r.exit).toBe(0);
    for (const key of ["scenario-2", "scenario-4"]) {
      const c = r.summary.journalCliChecks[key]!;
      expect(c.status).toBe("READY"); expect(c.executed).toBe(true);
      expect(c.forgedReceiptTestPassed).toBe(true); expect(c.forgedJournalTestPassed).toBe(true);
    }
    expect(r.summary.journalCliChecks["scenario-2"]!.scenario).toEqual({ citizens: 2, attempts: 6, observations: 6 });
    expect(r.summary.journalCliChecks["scenario-4"]!.scenario).toEqual({ citizens: 4, attempts: 12, observations: 12 });
  });

  it.skipIf(!CLI_PRESENT)("a failed required check produces a NONZERO exit: forged 1v1 only (2v2 stays READY, independently)", async () => {
    const r = await runWrapper(forged(2, "T07"), fresh(4));
    expect(r.exit).not.toBe(0); expect(r.summary.passed).toBe(false);
    expect(r.summary.journalCliChecks["scenario-2"]!.status).toBe("FAILED");
    expect(r.summary.journalCliChecks["scenario-4"]!.status).toBe("READY");
  });

  it.skipIf(!CLI_PRESENT)("a failed required check produces a NONZERO exit: forged 2v2 only (1v1 stays READY, independently)", async () => {
    const r = await runWrapper(fresh(2), forged(4, "T07"));
    expect(r.exit).not.toBe(0); expect(r.summary.passed).toBe(false);
    expect(r.summary.journalCliChecks["scenario-2"]!.status).toBe("READY");
    expect(r.summary.journalCliChecks["scenario-4"]!.status).toBe("FAILED");
  });

  it.skipIf(!CLI_PRESENT)("a stub CLI that always says 'consistent' (exit 0) can never earn the forgery claim", () => {
    const root = tmp("ciqa-stubroot-", true); mkdirSync(join(root, "tools/v1-integration"), { recursive: true });
    writeFileSync(join(root, "tools/v1-integration/journal-cli-main.ts"), 'console.log(JSON.stringify({status:"JOURNAL CONSISTENT",verdict:"NOT PROVEN",authenticatedLiveExecution:false,failures:[]}));\n');
    const stubDir = fresh(2);
    const r = checkJournalCliIntegration(root, stubDir, shaOf(stubDir));
    expect(r.status).toBe("FAILED");
    expect(r.forgedReceiptTestPassed).not.toBe(true);
    expect(r.forgedJournalTestPassed).not.toBe(true);
  });

  it("the helper no longer depends on a shell-resolved `pnpm` binary (Windows .cmd shim problem)", () => {
    const src = readFileSync(join(REPO_ROOT, "tools/ci/offline-acceptance-verifier.ts"), "utf8");
    const body = src.slice(src.indexOf("export function checkJournalCliIntegration"), src.indexOf("export function formatMarkdownSummary"));
    expect(body).not.toMatch(/execFileSync\(\s*["']pnpm["']/);
    expect(body).toMatch(/process\.execPath/);
  });
});

describe("process exit codes and honest top-level status", () => {
  it("untouched real bundles: exit 0, status OFFLINE_STRUCTURAL_PASS, Paper execution NOT PROVEN", async () => {
    const r = await runWrapper(fresh(2), fresh(4));
    expect(r.exit).toBe(0);
    expect(r.summary.status).toBe("OFFLINE_STRUCTURAL_PASS");
    expect(r.summary.paperExecution).toBe("NOT PROVEN");
    expect(r.summary.contradictions).toEqual([]); expect(r.summary.incomplete).toEqual([]);
  });

  it("the headline never reads as live acceptance for synthetic evidence", async () => {
    const r = await runWrapper(fresh(2), fresh(4));
    const head = r.md.split("\n")[0]!;
    expect(head).toMatch(/Offline structural checks PASSED/);
    expect(head).toMatch(/Paper execution NOT PROVEN/i);
    expect(r.md).not.toMatch(/^#\s*✅\s*Offline Acceptance Verification Report: PASSED/m);
    expect(r.md).not.toMatch(/acceptance (is )?(complete|passed|verified)/i);
  });

  it("the report separates the four states explicitly", async () => {
    const r = await runWrapper(fresh(2), fresh(4));
    expect(r.md).toMatch(/Offline structural checks:\*\*\s*PASSED/);
    expect(r.md).toMatch(/Required verification:\*\*\s*COMPLETE/);
    expect(r.md).toMatch(/Contradictory evidence:\*\*\s*none detected/);
    expect(r.md).toMatch(/Genuine Paper execution:\*\*\s*NOT PROVEN/);
  });

  it("criteria that remain NOT MEASURABLE are reported, with the failing criteria named", async () => {
    const r = await runWrapper(fresh(2), fresh(4));
    expect(r.md).toMatch(/NOT MEASURABLE/);
    expect(r.md).toMatch(/0\/30/); expect(r.md).toMatch(/0\/37/);
    for (const key of ["scenario-2", "scenario-4"]) {
      const a = r.summary.acceptance[key]!;
      expect(a.notMeasurable).toBe(true); expect(a.live.passed).toBe(0);
      expect(a.failingCriteria.length).toBeGreaterThan(0);
      for (const id of a.failingCriteria) expect(r.md).toContain(id);
    }
  });

  it("contradictory evidence is REJECTED with its own status, headline and nonzero exit (acceptance.json claims live 37/37)", async () => {
    const r = await runWrapper(forged(2, "T22"), fresh(4));
    expect(r.exit).not.toBe(0);
    expect(r.summary.status).toBe("CONTRADICTORY_EVIDENCE_REJECTED");
    expect(r.summary.contradictions.length).toBeGreaterThan(0);
    expect(r.md.split("\n")[0]).toMatch(/Contradictory evidence rejected/);
    expect(r.md).toMatch(/Genuine Paper execution:\*\*\s*NOT PROVEN/);
  });

  it("an unprovable/incomplete verification is reported as INCOMPLETE with a nonzero exit (2v2 evidence missing)", async () => {
    const r = await runWrapper(fresh(2), join(tmp("ciqa-empty-"), "does-not-exist"));
    expect(r.exit).not.toBe(0);
    expect(r.summary.status).toBe("VERIFICATION_INCOMPLETE");
    expect(r.summary.incomplete.length).toBeGreaterThan(0);
    expect(r.md.split("\n")[0]).toMatch(/Required verification incomplete/);
    expect(r.md).toMatch(/Offline structural checks:\*\*\s*NOT ESTABLISHED/);
  });

  it("removing an action everywhere is rejected as CONTRADICTORY: the unedited validator report still lists it", async () => {
    const r = await runWrapper(forged(2, "T13"), fresh(4));
    expect(r.exit).not.toBe(0);
    expect(r.summary.status).toBe("CONTRADICTORY_EVIDENCE_REJECTED");
    expect(r.summary.contradictions.some((c) => /actionVerifications|validator/i.test(c))).toBe(true);
  });

  it("a pinned receipt file that is missing is an ordinary structural VERIFICATION_FAILED, nonzero (not called contradictory)", async () => {
    const r = await runWrapper(forged(2, "T09"), fresh(4));
    expect(r.exit).not.toBe(0);
    expect(r.summary.status).toBe("VERIFICATION_FAILED");
    expect(r.summary.contradictions).toEqual([]);
    expect(r.summary.scenarios["scenario-2"]!.errors.some((e) => /receipt file/i.test(e))).toBe(true);
  });

  it("a journal edited without recomputing its hash chain is rejected, nonzero (the real CLI also rejects it, so it is CONTRADICTORY)", async () => {
    const r = await runWrapper(forged(2, "T25"), fresh(4));
    expect(r.exit).not.toBe(0);
    expect(r.summary.status).toBe("CONTRADICTORY_EVIDENCE_REJECTED");
    expect(r.summary.scenarios["scenario-2"]!.errors.some((e) => /hash chain|tampering/i.test(e))).toBe(true);
  });

  it("the Paper / live-model gaps are listed as NOT PROVEN and live execution is never claimed", async () => {
    const r = await runWrapper(fresh(2), fresh(4));
    expect(r.md).toMatch(/UNPROVEN_PAPER_AUTHENTICITY/);
    expect(r.md).not.toMatch(/live (minecraft|paper)[^.\n]*(verified|authenticated)/i);
  });
});
