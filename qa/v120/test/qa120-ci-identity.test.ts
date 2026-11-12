// QA120: independent adversarial tests of PR #120's CI identity glue (1d9967f), run on the REAL committed recorder bundles.
// Everything is an offline scripted fixture. Nothing here authenticates anything; an ordinary assertion that is red is a finding.
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fresh, l1, readJson, receiptPath, writeJson, type Count, type Doc } from "../../verify-ci-verifier/test/support/bundle.js";

afterEach(cleanup);
const COUNTS: Count[] = [2, 4];
const REPORT = "gemini-validator-report.json";
const edit = (d: string, f: (r: Doc) => void) => { const r = readJson(d, REPORT); f(r); writeJson(d, REPORT, r); };
const rejected = (d: string, c: Count) => { const r = l1(d, c); expect(r.passed, JSON.stringify(r.errors.slice(0, 3))).toBe(false); return r; };

for (const count of COUNTS) {
  const tag = count === 2 ? "1v1" : "2v2";
  describe(`${tag}: report run identity (runId vs experimentId vs attribution.runId)`, () => {
    it("control: the untouched real bundle is accepted with NOT_PROVEN / offline_simulated honesty intact", () => {
      const d = fresh(count); const r = l1(d, count);
      expect(r.errors).toEqual([]); expect(r.passed).toBe(true);
      expect(r.validatorVerdict).toBe("NOT PROVEN"); expect(r.paperAttestationProven).toBe(false);
      expect(readJson(d, REPORT).mode).toBe("offline_simulated");
      expect(r.acceptance?.live.passed).toBe(0);
    });
    it("new-style report (experimentId = journal id, runId only in attribution) is accepted", () => {
      const d = fresh(count); const journalExp = String(JSON.parse(readFileSync(`${d}/operator.jsonl`, "utf8").split("\n")[0]!).experimentId);
      edit(d, (r) => { r.experimentId = journalExp; });
      expect(l1(d, count).passed).toBe(true);
    });
    it("attribution removed from a new-style report FAILS CLOSED (experimentId never silently stands in for runId)", () => {
      const d = fresh(count); const journalExp = String(JSON.parse(readFileSync(`${d}/operator.jsonl`, "utf8").split("\n")[0]!).experimentId);
      edit(d, (r) => { r.experimentId = journalExp; delete r.attribution; });
      rejected(d, count);
    });
    it("attribution.runId foreign while top-level runId is the CORRECT run id is rejected (the ?? chain must not hide it)", () => {
      const d = fresh(count); const run = String(readJson(d, "manifest.json").runId);
      edit(d, (r) => { r.runId = run; r.attribution = { ...r.attribution, runId: "foreign-run" }; });
      rejected(d, count);
    });
    it("top-level runId correct, attribution correct, experimentId foreign is rejected", () => {
      const d = fresh(count); const run = String(readJson(d, "manifest.json").runId);
      edit(d, (r) => { r.runId = run; r.experimentId = "foreign-experiment"; });
      rejected(d, count);
    });
    it("attribution.runId foreign while experimentId equals the right run id is rejected", () => {
      const d = fresh(count); const run = String(readJson(d, "manifest.json").runId);
      edit(d, (r) => { r.experimentId = run; r.attribution = { ...r.attribution, runId: "foreign-run" }; });
      rejected(d, count);
    });
    it("attribution.runId null / empty / whitespace / case-changed / suffixed is rejected", () => {
      const run = String(readJson(fresh(count), "manifest.json").runId);
      for (const v of [null, "", ` ${run}`, `${run} `, run.toUpperCase(), `${run}x`, `${run}\u0000`]) {
        const d = fresh(count); edit(d, (r) => { delete r.runId; r.attribution = { ...r.attribution, runId: v }; });
        expect(l1(d, count).passed, JSON.stringify(v)).toBe(false);
      }
    });
    it("type-confused attribution.runId (array stringifying to the run id) is rejected", () => {
      const run = String(readJson(fresh(count), "manifest.json").runId);
      for (const v of [[run], [[run]]]) {
        const d = fresh(count); edit(d, (r) => { delete r.runId; r.attribution = { ...r.attribution, runId: v }; });
        expect(l1(d, count).passed, JSON.stringify(v)).toBe(false);
      }
    });
    it("top-level runId contradicting a CORRECT attribution.runId is rejected", () => {
      const d = fresh(count); edit(d, (r) => { r.runId = "foreign-run"; });
      rejected(d, count);
    });
    it("neither runId, attribution nor experimentId present is rejected", () => {
      const d = fresh(count); edit(d, (r) => { delete r.runId; delete r.attribution; delete r.experimentId; });
      rejected(d, count);
    });
    it("attribution citizens swapped / extra / missing are rejected", () => {
      for (const citizens of [[], ["gpt-a"], ["gpt-a", "claude-a", "intruder"], ["gpt-a", "intruder"]]) {
        const d = fresh(count); edit(d, (r) => { r.attribution = { ...r.attribution, citizens }; });
        expect(l1(d, count).passed, JSON.stringify(citizens)).toBe(false);
      }
    });
    it("manifest runId changed alone (report/journal/receipts keep the original) is rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json"); m.runId = "foreign-run"; writeJson(d, "manifest.json", m);
      rejected(d, count);
    });
    it("journal experiment id changed in the manifest configuration only is rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json"); m.configuration = { ...m.configuration, experimentId: "off-foreign" }; writeJson(d, "manifest.json", m);
      rejected(d, count);
    });
  });

  describe(`${tag}: receipts and honest output`, () => {
    it("a missing pinned receipt file is rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json"); rmSync(receiptPath(d, m.actions[0].receiptId));
      rejected(d, count);
    });
    it("every receipt deleted and every pin removed (so nothing is missing) is rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json");
      for (const a of m.actions) { try { rmSync(receiptPath(d, a.receiptId)); } catch { /* ok */ } }
      m.sourceReceipts = []; writeJson(d, "manifest.json", m);
      rejected(d, count);
    });
    it("two actions pointing at the same receipt file are rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json");
      if (m.actions.length < 2) return;
      m.actions[1].receiptId = m.actions[0].receiptId; writeJson(d, "manifest.json", m);
      rejected(d, count);
    });
    it("a receipt with a foreign runId, re-pinned, is rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json"); const id = m.actions[0].receiptId; const p = receiptPath(d, id);
      const r = JSON.parse(readFileSync(p, "utf8")); r.runId = "foreign-run"; const bytes = JSON.stringify(r, null, 2); writeFileSync(p, bytes);
      m.sourceReceipts.find((x: { id: string }) => x.id === id).sha256 = createHash("sha256").update(bytes).digest("hex"); writeJson(d, "manifest.json", m);
      rejected(d, count);
    });
    it("a receipt whose content is swapped with another citizen's receipt (both re-pinned) is rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json");
      const other = m.actions.find((a: Doc) => a.citizenId !== m.actions[0].citizenId);
      if (!other) return;
      const pa = receiptPath(d, m.actions[0].receiptId), pb = receiptPath(d, other.receiptId); const ba = readFileSync(pa), bb = readFileSync(pb);
      writeFileSync(pa, bb); writeFileSync(pb, ba);
      for (const pin of m.sourceReceipts) { const f = receiptPath(d, pin.id); pin.sha256 = createHash("sha256").update(readFileSync(f)).digest("hex"); }
      writeJson(d, "manifest.json", m);
      rejected(d, count);
    });
    it("a forged receipt whose pin was NOT updated is rejected", () => {
      const d = fresh(count); const m = readJson(d, "manifest.json"); const p = receiptPath(d, m.actions[0].receiptId);
      const r = JSON.parse(readFileSync(p, "utf8")); r.observedSuccess = !r.observedSuccess; writeFileSync(p, JSON.stringify(r, null, 2));
      rejected(d, count);
    });
    it("honesty mutations are each rejected: VERIFIED, real_minecraft mode, authentic environment, proven duration, proven attestation, gap code removed", () => {
      const muts: Array<[string, (r: Doc) => void]> = [
        ["overallStatus VERIFIED", (r) => { r.overallStatus = "VERIFIED"; }],
        ["mode real_minecraft", (r) => { r.mode = "real_minecraft"; }],
        ["mode live_paper", (r) => { r.mode = "live_paper"; }],
        ["environment authenticated paper", (r) => { r.environment = "offline simulated authenticated Paper"; }],
        ["durationAudit proven", (r) => { r.durationAudit = { ...r.durationAudit, serverTickProven: true }; }],
        ["attestation proven", (r) => { r.sourceAttestationAudit = { ...r.sourceAttestationAudit, proven: true }; }],
        ["gap code removed", (r) => { r.notProven = r.notProven.filter((n: Doc) => n.code !== "UNPROVEN_PAPER_AUTHENTICITY"); }],
        ["summary durationProven", (r) => { r.summary = { ...r.summary, durationProven: true }; }],
      ];
      for (const [name, f] of muts) { const d = fresh(count); edit(d, f); expect(l1(d, count).passed, name).toBe(false); }
    });
    it("verdict.json promoted to PASS/VERIFIED is rejected", () => {
      for (const v of ["PASS", "VERIFIED", "PROVEN"]) {
        const d = fresh(count); const vd = readJson(d, "verdict.json"); const key = Object.keys(vd).find((k) => /verdict|status/i.test(k) && typeof vd[k] === "string");
        if (!key) continue; vd[key] = v; writeJson(d, "verdict.json", vd);
        expect(l1(d, count).passed, `${key}=${v}`).toBe(false);
      }
    });
  });
}
