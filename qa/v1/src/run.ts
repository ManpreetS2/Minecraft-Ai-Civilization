/**
 * Independent QA entry point:  npx tsx qa/v1/src/run.ts --expect-sha <full 40-char sha> (required: without it the verdict is FAIL) [--expect-branch <name>] [--require-live]
 *                              [--scenarios ADV-01,ADV-02] [--out <dir>]
 *
 * Runs the qa/v1 Vitest suites offline, then evaluates the result with the pure verdict logic. Exit 0 only for PASS.
 * It imports no application internals, so Cursor and Codex can call it against any candidate checkout.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIO_IDS } from "./scenario.js";
import { evaluate, type VitestJson } from "./verdict.js";

const argv = process.argv.slice(2);
const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const root = resolve(flag("--root") ?? process.cwd());
const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();

// The harness may live at qa/v1 or, when overlaid on a candidate that already tracks a qa/v1, at qa-independent/v1.
const harness = relative(root, dirname(dirname(fileURLToPath(import.meta.url)))).replaceAll("\\", "/");
const outDir = resolve(flag("--out") ?? join(root, harness, "out"));
mkdirSync(outDir, { recursive: true });
const jsonFile = join(outDir, "vitest.json");
if (existsSync(jsonFile)) writeFileSync(jsonFile, ""); // a stale file must never be mistaken for this run

const requiredFiles = [
  `${harness}/test/adv-identity-privacy.test.ts`,
  `${harness}/test/adv-physical.test.ts`,
  `${harness}/test/adv-provider-faults.test.ts`,
  `${harness}/test/adv-offline-boundary.test.ts`,
  `${harness}/test/adv-chest-access.test.ts`,
  `${harness}/test/adv-evidence-injection.test.ts`,
  `${harness}/test/runner-verdict.test.ts`,
  `${harness}/test/wrapper-safety.test.ts`,
  `${harness}/test/adv-shutdown.test.ts`,
  `${harness}/test/adv-chest-freshness.test.ts`,
];

const actualSha = git("rev-parse", "HEAD");
const actualBranch = git("rev-parse", "--abbrev-ref", "HEAD");
// Tracked changes, and untracked files other than the overlaid harness itself (qa/), make the tree unattributable.
const dirty = git("status", "--porcelain", "--untracked-files=all")
  .split(String.fromCharCode(10))
  .filter((l) => l.trim() && !/^\?\? "?(qa|qa-independent)\//.test(l)).length > 0;
const harnessSha = process.env.QA_HARNESS_SHA ?? "unknown (harness run in place)";

const run = spawnSync(
  process.execPath,
  [join(root, "node_modules/vitest/vitest.mjs"), "run", "-c", `${harness}/vitest.config.ts`, "--reporter=json", `--outputFile=${jsonFile}`],
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

const report = { source: { sha: actualSha, branch: actualBranch, dirty, harnessSha }, ...verdict, generatedAt: new Date().toISOString() };
writeFileSync(join(outDir, "qa-v1-report.json"), JSON.stringify(report, null, 2));
const rows = Object.entries(verdict.perScenario).sort().map(([id, s]) => `| ${id} | ${s.status} | ${s.passed} | ${s.failed} | ${s.skipped} | ${s.defects} |`);
writeFileSync(
  join(outDir, "qa-v1-report.md"),
  [
    `# QA v1 report: ${verdict.verdict}`,
    ``,
    `Source: \`${actualSha}\` (${actualBranch}${dirty ? ", DIRTY" : ""}) | QA harness commit: ${harnessSha} | Mode: ${verdict.mode} (never live Paper evidence)`,
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
