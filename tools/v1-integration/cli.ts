import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { installOfflineNetworkGuard, assertNoBlockedAttempts } from "../../test-support/offline-network-guard.js";
import { buildManifest, validateBundle, type RunBundle } from "./manifest.js";
import { requirePreflight } from "./preflight.js";
import { charterCatalog } from "../v1-acceptance/catalog.js";
import { evaluate, markdown, type Artifact, type Evidence } from "../v1-acceptance/engine.js";
import { writeOfflineValidatorReport } from "./offline-validator-report.js";

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
  const repository = "ManpreetS2/Minecraft-Ai-Civilization-windows-backup";
  const runId = `fixture-${count}-${sourceSha.slice(0, 12)}`;
  const bundle: RunBundle = buildManifest({
    schemaVersion: 1,
    runId,
    repository,
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
    evidenceContractVersion: 2,
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
    runId,
    repository,
  });
  assertNoBlockedAttempts();
  bundle.endedAt = new Date().toISOString();
  bundle.exitCode = 0;
  bundle.restarted = true;
  bundle.actions = result.actions.map((a) => ({
    sequence: a.sequence,
    citizenId: a.citizenId,
    reportedSuccess: a.reportedSuccess,
    observedSuccess: a.observedSuccess,
    inventoryDelta: a.inventoryDelta,
    authorizedKnowledge: a.authorizedKnowledge,
    actionType: a.actionType,
    expectedDelta: a.expectedDelta,
    inventoryScope: a.inventoryScope,
    eventId: a.eventId,
    attemptId: a.attemptId,
    runId: a.runId,
    sourceSha: a.sourceSha,
    receiptId: a.receiptId,
    sourceEventId: a.sourceEventId,
  }));
  bundle.expectedActionCount = result.actions.length;
  bundle.startingPositions = Object.fromEntries(
    result.actions.map((a) => [a.citizenId, a.originPosition!]).filter(([, p]) => p),
  );
  bundle.interventions = ["operator_stop"];
  bundle.sourceReceipts = result.sourceReceipts;
  bundle.persistentFacts = result.persistentFacts;
  for (const citizen of bundle.citizens) {
    const provider = result.providers.find((p) => p.citizenId === citizen.id);
    citizen.sessionId = provider?.sessionId ?? null;
    citizen.model = provider?.model ?? null;
  }
  const perCitizen = result.providers.map((p) => ({
    citizenId: p.citizenId,
    family: p.family,
    model: p.model,
    sessionId: p.sessionId,
    requests: p.requests,
    retries: 0,
  }));
  const requests = perCitizen.reduce((n, p) => n + p.requests, 0);
  const usagePayload = {
    runId,
    repository,
    sourceSha,
    requests,
    paidRequests: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageComplete: true,
    perCitizen,
  };
  const usageBytes = JSON.stringify(usagePayload);
  writeFileSync(resolve(output, "provider-usage.json"), usageBytes);
  bundle.providerUsage = {
    requests,
    paidRequests: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageComplete: true,
    artifact: "provider-usage.json",
    sha256: createHash("sha256").update(usageBytes).digest("hex"),
    perCitizen,
  };
  bundle.persistenceArtifact = result.restart.memoryPreserved ? "scenario.json#/restart" : null;
  writeFileSync(resolve(output, "preflight.json"), JSON.stringify(preflight, null, 2));
  writeFileSync(resolve(output, "scenario.json"), JSON.stringify(result, null, 2));
  writeFileSync(
    resolve(output, "NOT_PROVEN.json"),
    JSON.stringify(
      {
        unproven: result.unproven,
        note: "Offline rehearsal — never invents Paper ticks, live model replies, or API charges",
      },
      null,
      2,
    ),
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
      name: "operator journal and V2 source receipts bound to executed gather attempts",
      passed:
        Boolean(result.evidenceJournalPath) &&
        result.evidenceSummary.attempted === count &&
        result.evidenceSummary.verified === count &&
        result.actions.every((a) => result.sourceReceipts.some((r) => r.id === a.receiptId)) &&
        result.persistentFacts.every(
          (f) => f.receiptId && result.sourceReceipts.some((r) => r.id === f.receiptId),
        ) &&
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
  const manifest = buildManifest(bundle);
  writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2));
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
  const acceptanceInput = {
    catalog: charterCatalog,
    evidence,
    repository: bundle.repository,
    candidateSha: sourceSha,
    trustedReviewers: [],
  };
  const acceptance = evaluate(acceptanceInput);
  writeFileSync(resolve(output, "acceptance-input.json"), JSON.stringify(acceptanceInput, null, 2));
  writeFileSync(resolve(output, "acceptance.json"), JSON.stringify(acceptance, null, 2));
  writeFileSync(resolve(output, "acceptance.md"), markdown(acceptance));
  const verdict = validateBundle(bundle, sourceSha, { evidenceRoot: output });
  writeFileSync(
    resolve(output, "verdict.json"),
    JSON.stringify({ ...verdict, evidenceJournalSha256: result.evidenceJournalSha256 }, null, 2),
  );
  const gemini = writeOfflineValidatorReport({
    outputDirectory: output,
    bundle: manifest,
    journalPath: result.evidenceJournalPath!,
    finalInventories: Object.fromEntries(
      result.citizens.map((c) => [c.id, { oak_log: result.inventoryAfter[c.id] ?? 0 }]),
    ),
  });
  writeFileSync(resolve(output, "gemini-validator-report.json"), JSON.stringify(gemini.report, null, 2));
  writeFileSync(resolve(output, "gemini-validator-summary.md"), gemini.summary);
  console.log(
    `Offline ${count}-citizen scripted rehearsal at ${sourceSha}. Bundle: ${output}. Journal: ${result.evidenceJournalPath}. Structural verdict: ${verdict.verdict}. Gemini: ${gemini.report.overallStatus}.`,
  );
  if (checks.some((check) => !check.passed) || verdict.verdict === "FAIL") process.exitCode = 1;
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
