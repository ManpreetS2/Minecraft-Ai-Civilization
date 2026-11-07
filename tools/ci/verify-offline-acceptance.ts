import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkJournalCliIntegration,
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
  const allErrors: string[] = [];

  // Verify Scenario 2 (1v1)
  console.log(`[CI-Verifier] Inspecting 1v1 artifacts at: ${scenario2Dir}`);
  const res2 = verifyOfflineScenario({
    artifactDir: resolve(cwd, scenario2Dir),
    expectedCount: 2,
    expectedSha: testedSha,
  });
  scenarios["scenario-2"] = res2;
  if (!res2.passed) {
    allErrors.push(...res2.errors.map((e) => `[Scenario-2] ${e}`));
  }

  // Verify Scenario 4 (2v2)
  console.log(`[CI-Verifier] Inspecting 2v2 artifacts at: ${scenario4Dir}`);
  const res4 = verifyOfflineScenario({
    artifactDir: resolve(cwd, scenario4Dir),
    expectedCount: 4,
    expectedSha: testedSha,
  });
  scenarios["scenario-4"] = res4;
  if (!res4.passed) {
    allErrors.push(...res4.errors.map((e) => `[Scenario-4] ${e}`));
  }

  // Check Codex Journal CLI Integration
  console.log(
    "[CI-Verifier] Checking Codex journal CLI integration (PR #58 / Release candidate)...",
  );
  const journalCliCheck = checkJournalCliIntegration(cwd, resolve(cwd, scenario2Dir), testedSha);

  const journalPassed =
    journalCliCheck.status === "READY" &&
    journalCliCheck.executed === true &&
    journalCliCheck.forgedReceiptTestPassed === true;
  if (!journalPassed)
    allErrors.push(`Journal CLI was not successfully exercised: ${journalCliCheck.details}`);
  const passed = res2.passed && res4.passed && journalPassed;

  const report: OverallAcceptanceReport = {
    passed,
    testedSha,
    system: systemInfo,
    scenarios,
    journalCliCheck,
    allErrors,
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
    console.error("[CI-Verifier] ❌ Offline acceptance verification FAILED.");
    process.exit(1);
  } else {
    console.log("[CI-Verifier] ✅ Offline acceptance verification PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`[CI-Verifier] Fatal error: ${String(err)}`);
  process.exit(1);
});
