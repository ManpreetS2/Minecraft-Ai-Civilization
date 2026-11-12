// QA120: adversarial tests of the integration glue between the V1 report wrapper (writeOfflineValidatorReport), the bridge and the validator,
// plus signed raw-journal binding with runId != experimentId. Offline only. A passing SYNTHETIC signed control proves logic, not a Paper signer.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeOfflineValidatorReport } from "../../../tools/v1-integration/offline-validator-report.js";
import { clone, readRows, reseal, type Row } from "../../v94/lib/journal.js";
import { attest, paramsFor, EXP } from "../../v94/lib/live.js";
import { RICH_FINALS, ROSTER, richLive, validateRich } from "../../v94/lib/rich.js";

const ROOT = join(import.meta.dirname, "../../../docs/evidence/offline-integration");
const tmps: string[] = [];
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });
const codes = (r: { violations: Array<{ code: string }> }) => r.violations.map((v) => v.code);

function pipeline(dirName: "1v1" | "2v2", o: { experimentId?: string; rows?: (rows: Row[]) => Row[]; bundle?: (b: Record<string, unknown>) => void } = {}) {
  const dir = join(ROOT, dirName);
  const bundle = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const finals = JSON.parse(readFileSync(join(dir, "gemini-validator-report.json"), "utf8")).inventoryAudit.citizenFinalInventories;
  o.bundle?.(bundle);
  const tmp = mkdtempSync(join(tmpdir(), "qa120-")); tmps.push(tmp);
  const journalPath = join(tmp, "operator.jsonl");
  const rows = readRows(join(dir, "operator.jsonl"));
  const lines = o.rows ? reseal(o.rows(clone(rows))).lines : readFileSync(join(dir, "operator.jsonl"), "utf8").split(/\r?\n/).filter((l) => l.trim());
  writeFileSync(journalPath, lines.join("\n") + "\n");
  return writeOfflineValidatorReport({ outputDirectory: tmp, bundle, journalPath, experimentId: o.experimentId, finalInventories: finals }).report;
}
const honest = (r: ReturnType<typeof pipeline>) => { expect(r.mode).toBe("offline_simulated"); expect(r.overallStatus).toBe("NOT_PROVEN"); expect(codes(r)).not.toContain("SOURCE_AUTHENTICATED"); expect(r.notProven.some((n) => n.code === "UNPROVEN_PAPER_AUTHENTICITY")).toBe(true); };

for (const which of ["1v1", "2v2"] as const) {
  describe(`${which}: wrapper/bridge identity on the real committed journal`, () => {
    it("control: the journal's own experiment id is accepted; runId and experimentId stay distinct; output is honest", () => {
      const r = pipeline(which, { experimentId: which === "1v1" ? "off2" : "off4" });
      expect(r.experimentId).toBe(which === "1v1" ? "off2" : "off4"); expect(r.attribution.runId).not.toBe(r.experimentId);
      expect(codes(r)).not.toContain("EXPERIMENT_ID_CONFLICT"); expect(codes(r)).not.toContain("RUN_ID_CONFLICT"); honest(r);
    });
    it("omitting the explicit experiment id derives it from the journal start row (no conflation with the bundle runId)", () => {
      const r = pipeline(which); expect(codes(r)).not.toContain("EXPERIMENT_ID_CONFLICT"); expect(r.attribution.runId).not.toBe(r.experimentId); honest(r);
    });
    it("the OLD conflation (experiment id := bundle runId) is a detected conflict", () => {
      const bundleRun = JSON.parse(readFileSync(join(ROOT, which, "manifest.json"), "utf8")).runId as string;
      const r = pipeline(which, { experimentId: bundleRun }); expect(codes(r)).toContain("EXPERIMENT_ID_CONFLICT"); expect(r.overallStatus).not.toBe("VERIFIED");
    });
    it("a foreign explicit experiment id is a conflict, never VERIFIED", () => {
      for (const id of ["foreign", "OFF2", " off2", "off2 ", "off20", "off2\n"]) { const r = pipeline(which, { experimentId: id }); expect(codes(r), id).toContain("EXPERIMENT_ID_CONFLICT"); expect(r.overallStatus).not.toBe("VERIFIED"); }
    });
    it("journal rows that mix experiment ids mid-stream conflict even when the caller supplies the first id", () => {
      const r = pipeline(which, { experimentId: which === "1v1" ? "off2" : "off4", rows: (rows) => { rows[rows.length - 2]!.experimentId = "other"; return rows; } });
      expect(codes(r)).toContain("EXPERIMENT_ID_CONFLICT"); expect(r.overallStatus).not.toBe("VERIFIED");
    });
    it("a bundle runId contradicting the journal start run id is RUN_ID_CONFLICT even with the right experiment id", () => {
      const r = pipeline(which, { experimentId: which === "1v1" ? "off2" : "off4", bundle: (b) => { b.runId = "foreign-run"; } });
      expect(codes(r)).toContain("RUN_ID_CONFLICT"); expect(r.overallStatus).not.toBe("VERIFIED");
    });
    it("an empty-string explicit experiment id does not erase the binding (journal id still governs / still no promotion)", () => {
      const r = pipeline(which, { experimentId: "" }); expect(r.experimentId).toBe(which === "1v1" ? "off2" : "off4"); honest(r);
    });
    it("a journal whose start row is removed cannot make the explicit/bundle identity the only authority", () => {
      const r = pipeline(which, { experimentId: "forged", rows: (rows) => rows.filter((x) => x.kind !== "start") });
      expect(r.overallStatus).not.toBe("VERIFIED"); expect(r.violations.length + r.notProven.length).toBeGreaterThan(0);
    });
    it("a journal whose rows are re-sealed with a foreign experiment id throughout conflicts with the explicit id and bundle run", () => {
      const r = pipeline(which, { experimentId: which === "1v1" ? "off2" : "off4", rows: (rows) => { for (const x of rows) x.experimentId = "swapped"; return rows; } });
      expect(codes(r)).toContain("EXPERIMENT_ID_CONFLICT"); expect(r.overallStatus).not.toBe("VERIFIED");
    });
  });
}

describe("signed raw-journal binding with runId != experimentId (synthetic key; proves verifier logic only)", () => {
  it("control: a signed live journal whose runId differs from its experimentId verifies with no identity conflict", () => {
    const l = richLive({ runId: "recording-run-xyz" });
    const r = validateRich(l, { runId: "recording-run-xyz" });
    expect(codes(r)).not.toContain("RUN_ID_CONFLICT"); expect(codes(r)).not.toContain("EXPERIMENT_ID_CONFLICT"); expect(r.mode).toBe("real_minecraft");
  });
  it("a caller runId that contradicts the SIGNED journal runId is a conflict and the run is not promoted", () => {
    const l = richLive({ runId: "recording-run-xyz" }); const r = validateRich(l, { runId: "other-run" });
    expect(codes(r)).toContain("RUN_ID_CONFLICT"); expect(r.overallStatus).not.toBe("VERIFIED");
  });
  it("a caller experimentId equal to the runId (the conflation) over a signed journal is a conflict and not promoted", () => {
    const l = richLive({ runId: "recording-run-xyz" }); const r = validateRich(l, { experimentId: "recording-run-xyz" });
    expect(codes(r)).toContain("EXPERIMENT_ID_CONFLICT"); expect(r.overallStatus).not.toBe("VERIFIED");
  });
  it("an attestation signed for the RUN id (not the experiment id) does not authenticate the experiment", () => {
    const l = richLive({ runId: "recording-run-xyz" }); const r = validateRich(l, {}, attest(paramsFor(l, { experimentId: "recording-run-xyz" })));
    expect(r.mode).not.toBe("real_minecraft"); expect(r.overallStatus).not.toBe("VERIFIED");
  });
  it("parsed rows carrying a different experimentId than the signed raw lines are caught by the raw-journal binding", () => {
    const l = richLive(); const rows = clone(l.rows) as Row[]; rows[3]!.experimentId = "swapped";
    const r = validateRich({ ...l, rows });
    expect(codes(r)).toContain("RAW_JOURNAL_ROW_MISMATCH"); expect(r.mode).not.toBe("real_minecraft");
  });
  it("parsed rows with a rewritten runId in the start row are caught", () => {
    const l = richLive({ runId: "recording-run-xyz" }); const rows = clone(l.rows) as Row[]; rows[0]!.runId = "forged-run";
    const r = validateRich({ ...l, rows });
    expect(codes(r)).toContain("RAW_JOURNAL_ROW_MISMATCH"); expect(r.mode).not.toBe("real_minecraft");
  });
  it("the wrapper cannot carry a signature: writeOfflineValidatorReport never reports real_minecraft or VERIFIED even for a journal that would verify when signed", () => {
    const l = richLive(); const tmp = mkdtempSync(join(tmpdir(), "qa120-sig-")); tmps.push(tmp);
    const journalPath = join(tmp, "operator.jsonl"); writeFileSync(journalPath, l.lines.join("\n") + "\n");
    const bundle = JSON.parse(readFileSync(join(ROOT, "1v1", "manifest.json"), "utf8"));
    const r = writeOfflineValidatorReport({ outputDirectory: tmp, bundle, journalPath, experimentId: EXP, finalInventories: RICH_FINALS }).report;
    expect(r.mode).not.toBe("real_minecraft"); expect(["NOT_PROVEN", "VIOLATIONS_DETECTED"]).toContain(r.overallStatus);
    expect(ROSTER.length).toBeGreaterThan(0);
  });
});
