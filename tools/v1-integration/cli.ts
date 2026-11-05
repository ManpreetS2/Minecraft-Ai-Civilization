import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { installOfflineNetworkGuard, assertNoBlockedAttempts } from "../../test-support/offline-network-guard.js";
import { buildManifest, validateBundle, type RunBundle } from "./manifest.js";
import { requirePreflight } from "./preflight.js";
import { charterCatalog } from "../v1-acceptance/catalog.js";
import { evaluate, markdown, type Artifact, type Evidence } from "../v1-acceptance/engine.js";

async function main() {
  const countText = process.argv[2] ?? "2";
  if (!["2", "4"].includes(countText) || process.argv.length > 4) {
    throw new Error("Usage: pnpm v1:offline [2|4] [output-directory-under-artifacts/v1]");
  }
  const count = Number(countText) as 2 | 4;
  const cwd = process.cwd();
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const sourceSha = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  if (dirty) throw new Error("Commit tooling changes before running a provenance-recorded scenario");
  const output = resolve(process.argv[3] ?? `artifacts/v1/scenario-${count}`);
  mkdirSync(output, { recursive: true });
  const ids = count === 2 ? ["gpt-a", "claude-a"] : ["gpt-a", "gpt-b", "claude-a", "claude-b"];
  const runId = `fixture-${count}-${sourceSha.slice(0, 12)}`;
  const bundle: RunBundle = buildManifest({
    schemaVersion: 1,
    runId,
    repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup",
    sourceSha,
    mode: "offline-fixture",
    citizens: ids.map((id) => ({
      id,
      family: id.startsWith("gpt") ? "gpt" : "claude",
      model: null,
      sessionId: null,
      authentication: "synthetic",
      initialInventory: {},
    })),
    fixtureSeed: "fixed-trees-30-block-spacing",
    startingPositions: null,
    configuration: {
      count,
      body: "controlled-fixture",
      database: ":temporary-fixture:",
      decisionTransport: "scripted-in-process",
      paperTicks: "unavailable",
    },
    startedAt: null,
    endedAt: null,
    tickSource: "simulated",
    ticks: null,
    command: `pnpm v1:offline ${count}`,
    exitCode: null,
    providerUsage: { requests: null, costUsd: null, artifact: null },
    actions: [],
    expectedActionCount: null,
    persistenceArtifact: null,
    restarted: false,
    validator: null,
    interventions: [],
  });
  const preflight = requirePreflight({
    cwd,
    expectedRoot: fileURLToPath(new URL("../../", import.meta.url)),
    expectedSha: sourceSha,
    documentedChanges: null,
    mode: "offline-fixture",
    body: "controlled-fixture",
    provider: "scripted-in-process",
    database: ":temporary-fixture:",
    outputDirectory: output,
    fixturePaths: [resolve("tools/v1-integration/fixtures.ts")],
    manifest: bundle,
    minecraftPort: null,
    host: "127.0.0.1",
    binaries: ["node", "git"],
  });
  installOfflineNetworkGuard();
  const { runScenario } = await import("./scenario.js");
  bundle.startedAt = new Date().toISOString();
  const result = await runScenario({
    count,
    goal: "gather_wood",
    evidenceDirectory: output,
    experimentId: `off${count}`,
  });
  assertNoBlockedAttempts();
  bundle.endedAt = new Date().toISOString();
  bundle.exitCode = 0;
  bundle.restarted = true;
  bundle.providerUsage.requests = result.providers.reduce((n, p) => n + p.requests, 0);
  bundle.providerUsage.costUsd = 0; // synthetic scripted doubles — no real spend
  bundle.providerUsage.artifact = "scenario.json";
  bundle.persistenceArtifact = result.restart.memoryPreserved ? "scenario.json#/restart" : null;
  bundle.actions = result.actions.map((a) => ({
    sequence: a.sequence,
    citizenId: a.citizenId,
    reportedSuccess: a.reportedSuccess,
    observedSuccess: a.observedSuccess,
    inventoryDelta: a.inventoryDelta,
    authorizedKnowledge: a.authorizedKnowledge,
  }));
  bundle.expectedActionCount = result.actions.length;
  bundle.startingPositions = Object.fromEntries(
    result.actions.map((a) => [a.citizenId, a.originPosition!]).filter(([, p]) => p),
  );
  bundle.interventions = ["operator_stop"];
  for (const citizen of bundle.citizens) {
    const provider = result.providers.find((p) => p.citizenId === citizen.id);
    citizen.sessionId = provider?.sessionId ?? null;
    citizen.model = provider?.model ?? null;
  }
  writeFileSync(resolve(output, "preflight.json"), JSON.stringify(preflight, null, 2));
  writeFileSync(resolve(output, "scenario.json"), JSON.stringify(result, null, 2));
  writeFileSync(
    resolve(output, "NOT_PROVEN.json"),
    JSON.stringify({ unproven: result.unproven, note: "Offline rehearsal — never invents Paper ticks, live model replies, or API charges" }, null, 2),
  );
  const checks = [
    {
      id: "A-MEMORY",
      name: "private memories reach only their citizen prompts",
      passed: result.providers.every((p) => p.ownMemorySeen && p.leakedMemoryIds.length === 0),
    },
    {
      id: "A-SESSION",
      name: "routed scripted sessions are distinct with bounded calls",
      passed:
        result.providers.every((p) => p.requests > 0 && p.requests <= 3 && p.sessionId !== null) &&
        new Set(result.providers.map((p) => p.sessionId)).size === count,
    },
    {
      id: "A-ACTIONS",
      name: "wood inventory increases from observed empty start",
      passed: result.citizens.every((c) => result.inventoryBefore[c.id] === 0 && result.inventoryAfter[c.id]! > 0),
    },
    {
      id: "A-IDENTITY",
      name: "SQLite reopen preserves usernames and private memory",
      passed: JSON.stringify(result.citizens) === JSON.stringify(result.restart.citizens) && result.restart.memoryPreserved,
    },
    {
      id: "A-EVIDENCE",
      name: "operator journal recorded scripted decisions and physical gather witnesses",
      passed:
        Boolean(result.evidenceJournalPath) &&
        result.evidenceSummary.attempted === count &&
        result.evidenceSummary.verified === count &&
        result.decisionTransport === "scripted-in-process",
    },
  ];
  bundle.exitCode = checks.every((check) => check.passed) ? 0 : 1;
  // Offline structural adapter: missing Paper ticks stay NOT PROVEN — never fabricate a PASS from offline alone.
  bundle.validator = {
    name: "offline-bundle-structure",
    verdict: "NOT PROVEN",
    artifact: "verdict.json",
  };
  writeFileSync(resolve(output, "manifest.json"), JSON.stringify(buildManifest(bundle), null, 2));
  const evidence: Evidence[] = checks.map((check) => {
    const artifact: Artifact = {
      criterionId: check.id,
      repository: bundle.repository,
      sourceSha,
      command: bundle.command,
      exitCode: check.passed ? 0 : 1,
      mode: "offline-fixture",
      outcome: check.passed ? "PASS" : "FAIL",
      assertions: [{ name: check.name, passed: check.passed }],
    };
    const bytes = JSON.stringify(artifact, null, 2);
    const artifactPath = resolve(output, `${check.id}.json`);
    writeFileSync(artifactPath, bytes);
    return {
      criterionId: check.id,
      repository: bundle.repository,
      sourceSha,
      command: bundle.command,
      exitCode: artifact.exitCode,
      mode: "offline-fixture",
      artifactPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      reviewer: "",
      reviewStatus: "pending",
    };
  });
  const acceptanceInput = { catalog: charterCatalog, evidence, repository: bundle.repository, candidateSha: sourceSha, trustedReviewers: [] };
  const acceptance = evaluate(acceptanceInput);
  writeFileSync(resolve(output, "acceptance-input.json"), JSON.stringify(acceptanceInput, null, 2));
  writeFileSync(resolve(output, "acceptance.json"), JSON.stringify(acceptance, null, 2));
  writeFileSync(resolve(output, "acceptance.md"), markdown(acceptance));
  const verdict = validateBundle(bundle);
  writeFileSync(resolve(output, "verdict.json"), JSON.stringify({ ...verdict, evidenceJournalSha256: result.evidenceJournalSha256 }, null, 2));
  console.log(
    `Offline ${count}-citizen scripted rehearsal at ${sourceSha}. Bundle: ${output}. Journal: ${result.evidenceJournalPath}. Structural verdict: ${verdict.verdict}.`,
  );
  if (checks.some((check) => !check.passed)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
