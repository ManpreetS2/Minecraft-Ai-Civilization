/**
 * Independent QA entry point:  npx tsx qa/v1/src/run.ts --expect-sha <full 40-char sha> (required: without it the verdict is FAIL) [--expect-branch <name>] [--require-live]
 *                              [--scenarios ADV-01,ADV-02] [--out <dir>]
 *
 * Runs the qa/v1 Vitest suites offline, then evaluates the result with the pure verdict logic. Exit 0 only for PASS.
 * It imports no application internals, so Cursor and Codex can call it against any candidate checkout.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { SCENARIO_IDS } from "./scenario.js";
import { evaluate, type VitestJson } from "./verdict.js";

const argv = process.argv.slice(2);
const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const root = resolve(flag("--root") ?? process.cwd());
const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();

const outDir = resolve(flag("--out") ?? join(root, "qa/v1/out"));
mkdirSync(outDir, { recursive: true });
const jsonFile = join(outDir, "vitest.json");
if (existsSync(jsonFile)) writeFileSync(jsonFile, ""); // a stale file must never be mistaken for this run

const requiredFiles = [
  "qa/v1/test/adv-identity-privacy.test.ts",
  "qa/v1/test/adv-physical.test.ts",
  "qa/v1/test/adv-provider-faults.test.ts",
  "qa/v1/test/adv-offline-boundary.test.ts",
  "qa/v1/test/adv-chest-access.test.ts",
  "qa/v1/test/adv-evidence-injection.test.ts",
  "qa/v1/test/runner-verdict.test.ts",
];

const actualSha = git("rev-parse", "HEAD");
const actualBranch = git("rev-parse", "--abbrev-ref", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;

const run = spawnSync(
  process.execPath,
  [join(root, "node_modules/vitest/vitest.mjs"), "run", "-c", "qa/v1/vitest.config.ts", "--reporter=json", `--outputFile=${jsonFile}`],
  { cwd: root, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
);

let vitest: VitestJson | undefined;
try {
  vitest = JSON.parse(readFileSync(jsonFile, "utf8")) as VitestJson;
} catch {
  vitest = undefined;
}

const scenarios = flag("--scenarios")?.split(",") ?? [...SCENARIO_IDS];
const verdict = evaluate({
  vitest,
  exitCode: run.status ?? 1,
  actualSha,
  dirty,
  claimedSha: flag("--expect-sha"),
  claimedBranch: flag("--expect-branch"),
  actualBranch,
  requiredFiles,
  requiredScenarios: scenarios,
  requireLive: argv.includes("--require-live"),
});

const report = { source: { sha: actualSha, branch: actualBranch, dirty }, ...verdict, generatedAt: new Date().toISOString() };
writeFileSync(join(outDir, "qa-v1-report.json"), JSON.stringify(report, null, 2));
const rows = Object.entries(verdict.perScenario).sort().map(([id, s]) => `| ${id} | ${s.status} | ${s.passed} | ${s.failed} | ${s.skipped} | ${s.defects} |`);
writeFileSync(
  join(outDir, "qa-v1-report.md"),
  [
    `# QA v1 report: ${verdict.verdict}`,
    ``,
    `Source: \`${actualSha}\` (${actualBranch}${dirty ? ", DIRTY" : ""}) | Mode: ${verdict.mode} (never live Paper evidence)`,
    `Totals: ${verdict.totals.tests} tests, ${verdict.totals.passed} passed, ${verdict.totals.failed} failed, ${verdict.totals.skipped} skipped, ${verdict.totals.defectsReproduced} known defects reproduced, ${verdict.totals.blocked} blocked`,
    ``,
    verdict.reasons.length ? `Reasons for FAIL:\n${verdict.reasons.map((r) => `- ${r}`).join("\n")}\n` : "",
    `| Scenario | Status | Passed | Failed | Skipped | Defects reproduced |`,
    `|---|---|---|---|---|---|`,
    ...rows,
    ``,
  ].join("\n"),
);
process.stdout.write(readFileSync(join(outDir, "qa-v1-report.md"), "utf8"));
process.exit(verdict.verdict === "PASS" ? 0 : 1);
