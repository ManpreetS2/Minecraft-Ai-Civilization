// QA120 defect demonstrations: each test states the CORRECT behaviour and is RED on PR #120 (1d9967f). Low severity: all require a forged
// local report, and a coherent local forgery is already accepted by design (T26). They show the String() coercion in the identity glue.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fresh, l1, readJson, writeJson, type Count } from "../../verify-ci-verifier/test/support/bundle.js";

afterEach(cleanup);
for (const count of [2, 4] as Count[]) {
  describe(`${count === 2 ? "1v1" : "2v2"} identity coercion`, () => {
    it("QA120-L1: a single-element array top-level runId must not satisfy the run id (String(['x']) === 'x')", () => {
      const d = fresh(count); const run = String(readJson(d, "manifest.json").runId);
      const r = readJson(d, "gemini-validator-report.json"); r.runId = [run]; writeJson(d, "gemini-validator-report.json", r);
      expect(l1(d, count).passed).toBe(false);
    });
    it("QA120-L2: a hostile non-string attribution.runId must be reported as an error, not crash the verifier (String({toString:'x'}) throws)", () => {
      const d = fresh(count);
      const r = readJson(d, "gemini-validator-report.json"); delete r.runId; r.attribution = { ...r.attribution, runId: { toString: "x" } }; writeJson(d, "gemini-validator-report.json", r);
      let out: ReturnType<typeof l1> | undefined; let threw: unknown;
      try { out = l1(d, count); } catch (e) { threw = e; }
      expect(threw).toBeUndefined(); expect(out?.passed).toBe(false);
    });
  });
}
