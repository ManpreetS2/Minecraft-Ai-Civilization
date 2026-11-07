import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./support/bundle.js";

/**
 * Static facts about PR #70's workflow, checked from source. These do not run GitHub Actions; the run itself was audited separately
 * (evidence/github-run-42328575182.md). Skipped when the workflow file is not in this tree (e.g. when overlaid on PR #68).
 */
const path = join(REPO_ROOT, ".github/workflows/offline-acceptance.yml");
const have = existsSync(path);
const yml = have ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : ""; // CRLF-safe: a Windows checkout may apply autocrlf
/** Workflow steps, split on the "      - " list marker. */
const steps = (): string[] => yml.split(/\n {6}- (?=name:|uses:|run:)/).slice(1);
const stepsUsing = (action: string): string[] => steps().filter((s) => s.includes(`${action}@`));

describe.skipIf(!have)("offline-acceptance.yml: secrets, privacy and trigger safety", () => {
  it("uses pull_request, never pull_request_target (fork code gets no secrets and no write token)", () => {
    expect(yml).toMatch(/^on:\n\s+pull_request:/m);
    expect(yml).not.toMatch(/pull_request_target/);
  });
  it("grants the token read-only contents permission and nothing else", () => {
    expect(yml).toMatch(/^permissions:\n\s+contents: read\s*$/m);
    expect(yml).not.toMatch(/:\s*write\b/);
  });
  it("never references the secrets context and blanks every provider key", () => {
    expect(yml).not.toMatch(/\$\{\{\s*secrets\./);
    for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) expect(yml).toMatch(new RegExp(`${k}:\\s*""`));
    expect(yml).toMatch(/LLM_PROVIDER:\s*"none"/);
  });
  it("every checkout disables persisted credentials", () => {
    const checkouts = stepsUsing("actions/checkout");
    expect(checkouts.length).toBe(2); // one per job (matrix job + full-test job)
    for (const c of checkouts) expect(c).toMatch(/persist-credentials:\s*false/);
  });
  it("every third-party action is pinned to a full 40-hex SHA", () => {
    const uses = [...yml.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
  it("no step masks failure with continue-on-error or '|| true'", () => {
    expect(yml).not.toMatch(/continue-on-error/);
    expect(yml).not.toMatch(/\|\|\s*true/);
  });
  it("uploads only sanitized summaries: never the raw journal, receipts, manifest or provider usage", () => {
    const uploads = stepsUsing("actions/upload-artifact");
    expect(uploads.length).toBe(2);
    for (const u of uploads) {
      const paths = u.slice(u.indexOf("path:"));
      expect(paths).not.toMatch(/operator\.jsonl|receipts|manifest\.json|provider-usage|preflight|scenario\.json|acceptance\.json/);
      expect(paths).toMatch(/ci-summary\.(md|json)/);
    }
  });
});

describe.skipIf(!have)("offline-acceptance.yml: SHA binding", () => {
  it("checks out the PR head commit explicitly (not the synthetic merge commit)", () => {
    for (const c of stepsUsing("actions/checkout")) expect(c).toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha \|\| github\.sha\s*\}\}/);
  });
  it.fails("[GAP-LOW] the SHA handed to the verifier comes from the same checkout it verifies (`git rev-parse HEAD`), not from the event that triggered the run", () => {
    // Self-referential: if the checkout ref were wrong the verifier would still agree with itself. Verified manually from the run log
    // that all four jobs did check out the PR head; the workflow does not enforce it.
    const verifierArgs = [...yml.matchAll(/--sha\s+([^\s\\]+)/g)].map((m) => m[1]!);
    expect(verifierArgs.length).toBeGreaterThanOrEqual(2);
    for (const a of verifierArgs) expect(a).toMatch(/github\.event\.pull_request\.head\.sha|github\.sha/);
  });
  it("step labels do not overclaim: the 'Full workspace tests (2260+ tests)' label is a count claim, not a gate", () => {
    // Informational: the number is a label; the gate is the exit code of `pnpm test`.
    expect(yml).toMatch(/Full workspace tests \(2260\+ tests\)\n\s+run: pnpm test\s*\n/);
  });
  it("both jobs run the independent adversarial suite on the freshly generated real bundles, after the verifier, without masking failure", () => {
    const suites = steps().filter((x) => x.includes("Independent adversarial evidence suite"));
    expect(suites.length).toBe(2); // matrix job (ubuntu/macos/windows) + full-test job
    for (const st of suites) {
      expect(st).toMatch(/CI_QA_BUNDLE_ROOT=/);
      expect(st).toMatch(/CI_QA_SHA="\$\(git rev-parse HEAD\)"/);
      expect(st).toMatch(/qa\/verify-ci-verifier\/vitest\.config\.ts/);
      expect(st).not.toMatch(/continue-on-error|\|\|\s*true/);
    }
    const order = steps().map((x) => (x.includes("tools/ci/verify-offline-acceptance.ts") ? "verify" : x.includes("Independent adversarial evidence suite") ? "suite" : ""));
    expect(order.indexOf("verify")).toBeLessThan(order.indexOf("suite"));
  });
  it("the workflow also triggers when the committed real evidence fixtures change", () => {
    expect(yml).toMatch(/docs\/evidence\/offline-integration\/\*\*/);
  });
});
