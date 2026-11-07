/**
 * Measures, on REAL bundles, what the CI verifier does with every tamper class T01-T26 and prints a markdown table next to the
 * outcome the ORIGINAL audit (PR #72) recorded for PR #70. Usage (from the repo root, after `pnpm v1:offline 2|4 artifacts/v1/scenario-N`):
 *   CI_QA_BUNDLE_ROOT=$PWD/artifacts/v1 CI_QA_SHA=$(git rev-parse HEAD) pnpm exec tsx qa/verify-ci-verifier/scripts/outcome-table.ts
 */
import { cleanup, fresh, l1, l2, l2Detects } from "../test/support/bundle.js";
import { CASES, ORIGINAL_L1_MISSES } from "../test/support/cases.js";

const was = (id: string, l1v: string) => (l1v === "by-design" ? "passes (by design)" : (ORIGINAL_L1_MISSES as readonly string[]).includes(id) ? "**ACCEPTED**" : "rejected");
const rows: string[] = [
  "| ID | Tamper (real bundle) | Original verifier (PR #70 audit) | Now | Status | First reason | Journal CLI (PR #68) |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];
for (const c of CASES) {
  for (const count of c.counts) {
    const d = fresh(count); c.apply(d, count);
    const a = l1(d, count);
    const b = await l2(d, count);
    const tag = c.counts.length > 1 ? ` [${count === 2 ? "1v1" : "2v2"}]` : "";
    const reason = (a.contradictions[0] ?? a.errors[0] ?? "-").replace(/\|/g, "\\|").slice(0, 110);
    rows.push(`| ${c.id}${tag} | ${c.name.replace(/\|/g, "\\|")} | ${was(c.id, c.l1)} | ${a.passed ? "passes (by design)" : "**rejected**"} | ${a.passed ? "-" : a.contradictions.length > 0 ? "contradiction" : "error"} | ${reason} | ${l2Detects(b) ? `rejects (exit ${b.exit})` : "consistent"} |`);
  }
}
cleanup();
console.log(rows.join("\n"));
