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
  if (!["2", "4"].includes(countText) || process.argv.length > 4) throw new Error("Usage: pnpm v1:offline [2|4] [output-directory-under-artifacts/v1]");
  const count = Number(countText) as 2 | 4;
  const cwd = process.cwd();
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const sourceSha = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  if (dirty) throw new Error("Commit tooling changes before running a provenance-recorded scenario");
  const output = resolve(process.argv[3] ?? `artifacts/v1/scenario-${count}`);
  const ids = count === 2 ? ["gpt-a", "claude-a"] : ["gpt-a", "gpt-b", "claude-a", "claude-b"];
  const bundle: RunBundle = buildManifest({ schemaVersion: 1, runId: `fixture-${count}-${sourceSha.slice(0, 12)}`, repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup", sourceSha, mode: "offline-fixture",
    citizens: ids.map((id) => ({ id, family: id.startsWith("gpt") ? "gpt" : "claude", model: null, sessionId: null, authentication: "synthetic", initialInventory: {} })),
    fixtureSeed: "fixed-trees-30-block-spacing", startingPositions: null, configuration: { count, body: "controlled-fixture", database: ":temporary-fixture:" },
    startedAt: null, endedAt: null, tickSource: "simulated", ticks: null, command: `pnpm v1:offline ${count}`, exitCode: null,
    providerUsage: { requests: null, costUsd: null, artifact: null }, actions: [], expectedActionCount: null, persistenceArtifact: null, restarted: false, validator: null, interventions: [] });
  const preflight = requirePreflight({ cwd, expectedRoot: fileURLToPath(new URL("../../", import.meta.url)), expectedSha: sourceSha, documentedChanges: null, mode: "offline-fixture", body: "controlled-fixture", provider: "scripted-in-process", database: ":temporary-fixture:", outputDirectory: output, fixturePaths: [resolve("tools/v1-integration/fixtures.ts")], manifest: bundle, minecraftPort: null, host: "127.0.0.1", binaries: ["node", "git"] });
  installOfflineNetworkGuard();
  // Import executable components only after the guard and preflight are installed.
  const { runScenario } = await import("./scenario.js");
  bundle.startedAt = new Date().toISOString();
  const result = await runScenario({ count, goal: "gather_wood" });
  assertNoBlockedAttempts();
  bundle.endedAt = new Date().toISOString(); bundle.exitCode = 0; bundle.restarted = true;
  bundle.providerUsage.requests = result.providers.reduce((n, p) => n + p.requests, 0);
  bundle.providerUsage.artifact = "scenario.json";
  bundle.persistenceArtifact = result.restart.memoryPreserved ? "scenario.json#/restart" : null;
  // These are aggregate observations, not an invented complete action history.
  for (const citizen of bundle.citizens) {
    const provider = result.providers.find((p) => p.citizenId === citizen.id);
    citizen.sessionId = provider?.sessionId ?? null; citizen.model = provider?.model ?? null;
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "preflight.json"), JSON.stringify(preflight, null, 2));
  writeFileSync(resolve(output, "scenario.json"), JSON.stringify(result, null, 2));
  const checks = [
    { id: "A-MEMORY", name: "private memories reach only their citizen prompts", passed: result.providers.every((p) => p.ownMemorySeen && p.leakedMemoryIds.length === 0) },
    { id: "A-SESSION", name: "routed scripted sessions are distinct with bounded calls", passed: result.providers.every((p) => p.requests > 0 && p.requests <= 3 && p.sessionId !== null) && new Set(result.providers.map((p) => p.sessionId)).size === count },
    { id: "A-ACTIONS", name: "wood inventory increases from observed empty start", passed: result.citizens.every((c) => result.inventoryBefore[c.id] === 0 && result.inventoryAfter[c.id]! > 0) },
    { id: "A-IDENTITY", name: "SQLite reopen preserves usernames and private memory", passed: JSON.stringify(result.citizens) === JSON.stringify(result.restart.citizens) && result.restart.memoryPreserved },
  ];
  bundle.exitCode = checks.every((check) => check.passed) ? 0 : 1;
  writeFileSync(resolve(output, "manifest.json"), JSON.stringify(buildManifest(bundle), null, 2));
  const evidence: Evidence[] = checks.map((check) => {
    const artifact: Artifact = { criterionId: check.id, repository: bundle.repository, sourceSha, command: bundle.command, exitCode: check.passed ? 0 : 1, mode: "offline-fixture", outcome: check.passed ? "PASS" : "FAIL", assertions: [{ name: check.name, passed: check.passed }] };
    const bytes = JSON.stringify(artifact, null, 2), artifactPath = resolve(output, `${check.id}.json`);
    writeFileSync(artifactPath, bytes);
    return { criterionId: check.id, repository: bundle.repository, sourceSha, command: bundle.command, exitCode: artifact.exitCode, mode: "offline-fixture", artifactPath, sha256: createHash("sha256").update(bytes).digest("hex"), reviewer: "", reviewStatus: "pending" };
  });
  const acceptanceInput = { catalog: charterCatalog, evidence, repository: bundle.repository, candidateSha: sourceSha, trustedReviewers: [] };
  const acceptance = evaluate(acceptanceInput);
  writeFileSync(resolve(output, "acceptance-input.json"), JSON.stringify(acceptanceInput, null, 2));
  writeFileSync(resolve(output, "acceptance.json"), JSON.stringify(acceptance, null, 2));
  writeFileSync(resolve(output, "acceptance.md"), markdown(acceptance));
  const verdict = validateBundle(bundle);
  writeFileSync(resolve(output, "verdict.json"), JSON.stringify(verdict, null, 2));
  console.log(`Offline ${count}-citizen fixture completed at ${sourceSha}. Bundle: ${output}. Experiment validation: ${verdict.verdict}.`);
  if (checks.some((check) => !check.passed)) process.exitCode = 1;
}
main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
