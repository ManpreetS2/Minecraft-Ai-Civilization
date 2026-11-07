import { afterEach, describe, expect, it } from "vitest";
import { cleanup, CLI_PRESENT, fresh, l1, l2, l2Detects } from "./support/bundle.js";
import { CASES } from "./support/cases.js";

/**
 * INDEPENDENT audit of PR #70. Every case tampers a REAL `pnpm v1:offline` bundle, then asks two separate questions:
 *   L1: does PR #70's verifier (verifyOfflineScenario) reject it?
 *   L2: does PR #68's real journal cross-check (called correctly) reject it?  [only when that CLI exists in the tree]
 * Confirmed gaps use `it.fails` (the repo's QA convention): the assertion states the DESIRED behaviour, the test is green while the gap
 * exists, and it must be turned into a plain `it` when the gap is fixed.
 */
afterEach(cleanup);

describe("control", () => {
  for (const count of [2, 4] as const) {
    it(`an untouched real ${count}-citizen bundle passes the PR #70 verifier`, () => {
      const r = l1(fresh(count), count);
      expect(r.errors).toEqual([]);
      expect(r.passed).toBe(true);
      expect(r.paperAttestationProven).toBe(false);
      expect(r.validatorVerdict).toBe("NOT PROVEN");
    });
    it.skipIf(!CLI_PRESENT)(`an untouched real ${count}-citizen bundle is JOURNAL CONSISTENT under PR #68's CLI when called with its experimentId`, async () => {
      const r = await l2(fresh(count), count);
      expect(r.exit).toBe(0);
      expect(r.journalConsistent).toBe(true);
    });
  }
});

for (const c of CASES) {
  for (const count of c.counts) {
    const tag = `${c.id}${c.counts.length > 1 ? ` [${count}v]` : ""}`;
    describe(`${tag} ${c.name}`, () => {
      if (c.l1 === "by-design") {
        it("[LIMITATION BY DESIGN] a coherent forgery passes the PR #70 verifier (nothing offline can tell it from a real run)", () => {
          const d = fresh(count); c.apply(d, count);
          expect(l1(d, count).passed).toBe(true);
        });
      } else if (c.l1 === "detects") {
        it("L1: PR #70 verifier rejects it", () => {
          const d = fresh(count); c.apply(d, count);
          const r = l1(d, count);
          expect(r.passed).toBe(false);
          expect(r.errors.length).toBeGreaterThan(0);
        });
      } else {
        it.fails("[GAP] L1: PR #70 verifier should reject it, but accepts the bundle", () => {
          const d = fresh(count); c.apply(d, count);
          expect(l1(d, count).passed).toBe(false);
        });
      }

      if (c.l2 === "by-design") {
        it.skipIf(!CLI_PRESENT)("[LIMITATION BY DESIGN] PR #68's journal check also reports a coherent forgery as consistent", async () => {
          const d = fresh(count); c.apply(d, count);
          const r = await l2(d, count);
          expect(r.journalConsistent).toBe(true);
          expect(r.verdict).toBe("NOT PROVEN"); // and it says so itself: authenticity stays NOT PROVEN
        });
      } else if (c.l2 === "detects") {
        it.skipIf(!CLI_PRESENT)("L2: PR #68's journal cross-check rejects it", async () => {
          const d = fresh(count); c.apply(d, count);
          expect(l2Detects(await l2(d, count))).toBe(true);
        });
      } else if (c.l1 === "misses") {
        // Neither layer sees it.
        it.fails("[GAP] neither PR #70 nor PR #68's journal check rejects it", async () => {
          const d = fresh(count); c.apply(d, count);
          const miss1 = l1(d, count).passed;
          const miss2 = CLI_PRESENT ? !l2Detects(await l2(d, count)) : true;
          expect(miss1 && miss2).toBe(false);
        });
      }
    });
  }
}
