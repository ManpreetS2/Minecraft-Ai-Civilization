import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkJournalCliIntegration,
  classifyOutcome,
  type JournalCliCheckResult,
  formatMarkdownSummary,
  verifyOfflineScenario,
  type OverallAcceptanceReport,
  type ScenarioVerificationResult,
} from "./offline-acceptance-verifier.js";

function getGitHeadSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function getPnpmVersion(): string | undefined {
  try {
    return execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return undefined;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Offline Acceptance CI Verifier

Usage:
  pnpm exec tsx tools/ci/verify-offline-acceptance.ts [options]

Options:
  --scenario2 <dir>       Path to 1v1 (2 citizens) artifact directory (default: artifacts/v1/scenario-2)
  --scenario4 <dir>       Path to 2v2 (4 citizens) artifact directory (default: artifacts/v1/scenario-4)
  --sha <sha>             Expected 40-character commit SHA (default: git rev-parse HEAD)
  --output <dir>          Directory to save sanitized summary reports (default: artifacts/v1)
  --help, -h              Show this help message
`);
    process.exit(0);
  }

  let scenario2Dir = "artifacts/v1/scenario-2";
  let scenario4Dir = "artifacts/v1/scenario-4";
  let expectedSha: string | undefined = undefined;
  let outputDir = "artifacts/v1";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--scenario2" && args[i + 1]) {
      scenario2Dir = args[++i]!;
    } else if (arg === "--scenario4" && args[i + 1]) {
      scenario4Dir = args[++i]!;
    } else if (arg === "--sha" && args[i + 1]) {
      expectedSha = args[++i]!;
    } else if (arg === "--output" && args[i + 1]) {
      outputDir = args[++i]!;
    }
  }

  const testedSha = expectedSha ?? getGitHeadSha();
  const cwd = process.cwd();

  const systemInfo = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pnpmVersion: getPnpmVersion(),
  };

  console.log(`[CI-Verifier] Verifying offline acceptance artifacts for commit ${testedSha}...`);
  console.log(
    `[CI-Verifier] System: ${systemInfo.platform} (${systemInfo.arch}), Node: ${systemInfo.nodeVersion}`,
  );

  const scenarios: Record<string, ScenarioVerificationResult> = {};
  const journalCliChecks: Record<string, JournalCliCheckResult> = {};

  // Each scenario is verified AND journal-cross-checked independently. A failure in one never masks or substitutes for the other.
  const targets = [
    { key: "scenario-2", label: "1v1", dir: scenario2Dir, count: 2 as const },
    { key: "scenario-4", label: "2v2", dir: scenario4Dir, count: 4 as const },
  ];
  for (const t of targets) {
    console.log(`[CI-Verifier] Inspecting ${t.label} artifacts at: ${t.dir}`);
    scenarios[t.key] = verifyOfflineScenario({
      artifactDir: resolve(cwd, t.dir),
      expectedCount: t.count,
      expectedSha: testedSha,
    });
  }
  for (const t of targets) {
    console.log(`[CI-Verifier] Running the real journal CLI controls for ${t.label}...`);
    journalCliChecks[t.key] = checkJournalCliIntegration(cwd, resolve(cwd, t.dir), testedSha);
  }

  const outcome = classifyOutcome({ scenarios, journalCliChecks });
  const passed = outcome.status === "OFFLINE_STRUCTURAL_PASS";

  const report: OverallAcceptanceReport = {
    passed,
    status: outcome.status,
    paperExecution: "NOT PROVEN",
    testedSha,
    system: systemInfo,
    scenarios,
    journalCliCheck: journalCliChecks["scenario-2"]!,
    journalCliChecks,
    contradictions: outcome.contradictions,
    incomplete: outcome.incomplete,
    acceptance: Object.fromEntries(
      Object.entries(scenarios).flatMap(([k, r]) => (r.acceptance ? [[k, r.acceptance] as const] : [])),
    ),
    allErrors: outcome.allErrors,
  };

  const markdownSummary = formatMarkdownSummary(report);

  // Write to GITHUB_STEP_SUMMARY if running in GitHub Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdownSummary}\n`, "utf8");
      console.log(
        `[CI-Verifier] Appended summary to GITHUB_STEP_SUMMARY (${process.env.GITHUB_STEP_SUMMARY})`,
      );
    } catch (err) {
      console.warn(`[CI-Verifier] Failed to write to GITHUB_STEP_SUMMARY: ${String(err)}`);
    }
  }

  // Write sanitized summary reports for CI artifact upload
  try {
    const fullOutputDir = resolve(cwd, outputDir);
    mkdirSync(fullOutputDir, { recursive: true });
    writeFileSync(resolve(fullOutputDir, "ci-summary.md"), markdownSummary, "utf8");
    writeFileSync(
      resolve(fullOutputDir, "ci-summary.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    console.log(`[CI-Verifier] Wrote sanitized summary reports to: ${fullOutputDir}`);
  } catch (err) {
    console.warn(`[CI-Verifier] Failed to write summary files: ${String(err)}`);
  }

  console.log("\n" + markdownSummary + "\n");

  if (!passed) {
    console.error(`[CI-Verifier] ❌ ${outcome.status}: offline verification did NOT pass (genuine Paper execution is NOT PROVEN regardless).`);
    process.exit(1);
  } else {
    console.log("[CI-Verifier] ✅ Offline structural checks PASSED. Genuine Paper execution is NOT PROVEN.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`[CI-Verifier] Fatal error: ${String(err)}`);
  process.exit(1);
});
