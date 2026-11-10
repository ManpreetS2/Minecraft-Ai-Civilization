// QA94 DEFECT DEMONSTRATIONS (ordinary assertions of the SAFE behaviour; RED on PR #94 (da0e1ff9) where the weakness is present). None is a
// caller-tampering bypass (every caller-side mutation is rejected; see test/adv94-canonical). They concern signed-row content and integration.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adaptRecorderJournal, validateExperimentEvidence } from "../../../experiments/evidence-validator/src/index.js";
import { clone, reseal, type Row } from "../lib/journal.js";
import { richLive, resign, validateSigned } from "../lib/hostile.js";
import { artDir, load } from "../lib/pipeline.js";

type Rec = Record<string, unknown>;
const real = (r: { mode: string }) => r.mode === "real_minecraft";

describe("[QA94-M1] additional signed recorder metadata vs the shipped adapter (compatibility; fail-closed, not a bypass)", () => {
  const L = load(artDir("cand", "scenario-2"));
  const through = (patch: (r: Rec) => void) => {
    const rows = clone(L.rows) as Row[]; rows.forEach((r) => patch(r as Rec)); const lines = reseal(rows).lines;
    const a = adaptRecorderJournal(lines);
    return validateExperimentEvidence({ rawJournalLines: lines, journalRows: a.journalRows as never } as never);
  };
  it("control: the unmodified real scenario-2 journal through adaptRecorderJournal + validator is clean", () => {
    const r = through(() => undefined); expect(r.violations).toEqual([]); expect(r.overallStatus).toBe("VERIFIED"); expect(r.mode).toBe("offline_simulated");
  });
  it("a signed tick row carrying an extra recorder field (tickCpuMs) is NOT a violation: the adapter documents stripping 'future recorder additions' and the raw row stays authoritative", () => {
    const r = through((row) => { if (row.kind === "tick") row.tickCpuMs = 3; });
    expect(r.violations.map((v) => v.code)).toEqual([]);
  });
});

describe("[QA94-L1] raw rows are now authoritative but are not schema-validated on the library path", () => {
  const base = richLive();
  it("a signed tick with durationMs:[] / measuredTps:{} (consistent in raw and parsed) must not yield a real_minecraft/VERIFIED report", () => {
    for (const [field, v] of [["durationMs", []], ["measuredTps", {}]] as Array<[string, unknown]>) {
      const l = resign(base, (rows) => { (rows.find((r) => r.kind === "tick" && r.seq === 2) as Rec)[field] = clone(v); });
      const r = validateSigned(l); expect(real(r) && r.overallStatus === "VERIFIED", field).toBe(false);
    }
  });
  it("a signed start row with runId:{} must not yield a real_minecraft/VERIFIED report", () => {
    const l = resign(base, (rows) => { (rows[0] as Rec).runId = {}; }); const r = validateSigned(l); expect(real(r) && r.overallStatus === "VERIFIED").toBe(false);
  });
  it("a signed observation with verified:\"yes\" / successReported:\"false\" (strings) must not be counted as a verified action", () => {
    for (const f of ["verified", "successReported"]) {
      const l = resign(base, (rows) => { (rows.find((r) => r.kind === "action_observation" && r.attemptId === "a1") as Rec)[f] = f === "verified" ? "yes" : "false"; });
      expect(validateSigned(l).summary.verifiedActions, f).toBeLessThan(9);
    }
  });
});

describe("[QA94-L2] malformed signed values crash the validator (pre-existing from PR #86; availability, not integrity)", () => {
  const base = richLive();
  it("start.citizens as a string, and observation.worldChanges as a non-array, return a report instead of throwing", () => {
    for (const edit of [(rows: Row[]) => { (rows[0] as Rec).citizens = "gpt_atlas"; }, (rows: Row[]) => { (rows.find((r) => r.kind === "action_observation") as Rec).worldChanges = "x"; }]) {
      expect(() => validateSigned(resign(base, edit))).not.toThrow();
    }
  });
});

describe("[QA94-I1] no signer material is shipped", () => {
  it("source files outside tests contain no PEM private key and no hard-coded 'signingAuthority' trust entry", () => {
    const hits: string[] = [];
    for (const f of ["experiments/evidence-validator/src/source-authenticator.ts", "experiments/evidence-validator/src/validator.ts", "experiments/evidence-validator/src/cli.ts", "tools/v1-integration/offline-validator-report.ts", "tools/v1-integration/cli.ts"]) {
      let t = ""; try { t = readFileSync(join(process.cwd(), f), "utf8"); } catch { continue; }
      if (/BEGIN (EC |ED25519 )?PRIVATE KEY|trustedKeys\s*[:=]\s*\{[^}]*BEGIN PUBLIC/.test(t)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});
