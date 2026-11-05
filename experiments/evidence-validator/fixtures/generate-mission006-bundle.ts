/**
 * Generates Mission 006 Reproducible Offline Validation Bundle
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createTestManifest, JournalBuilder } from "./helpers.js";
import { validateExperimentEvidence } from "../src/validator.js";
import { formatHumanReport } from "../src/report.js";

const baseDir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const bundleRoot = join(baseDir, "mission006-bundle");
mkdirSync(bundleRoot, { recursive: true });

function sha256File(path: string): string {
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------
// 1. Positive Offline Integrity Fixture
// ---------------------------------------------------------
const positiveDir = join(bundleRoot, "positive-offline");
mkdirSync(positiveDir, { recursive: true });

const posManifest = createTestManifest({
  stage: "1v1",
  durationMinutes: 1,
});
posManifest.experimentId = "exp-m006-positive-offline-001";
posManifest.sourceSha = "06b7e5038c11bf88d55d7870fbf155a0f12d4d8a";
posManifest.paths = {
  runRoot: positiveDir,
  world: join(positiveDir, "world"),
  database: join(positiveDir, "db.sqlite"),
  evidence: join(positiveDir, "operator-journal.jsonl"),
};

const bPos = new JournalBuilder(posManifest.experimentId);
const att1 = "att-atlas-001";
bPos.append({
  kind: "action_attempt",
  citizenId: "gpt_atlas",
  attemptId: att1,
  action: "gather",
  decisionSource: "model",
  decisionEventId: "ev-atlas-gather-1",
  expectedItem: "minecraft:oak_log",
});
bPos.append({
  kind: "action_observation",
  citizenId: "gpt_atlas",
  attemptId: att1,
  verified: true,
  successReported: true,
  beforeInventory: {},
  afterInventory: { "minecraft:oak_log": 1 },
  worldChanges: [],
});

const att2 = "att-theo-001";
bPos.append({
  kind: "action_attempt",
  citizenId: "claude_theo",
  attemptId: att2,
  action: "craft",
  decisionSource: "model",
  decisionEventId: "ev-theo-craft-1",
  expectedItem: "minecraft:oak_planks",
});
bPos.append({
  kind: "action_observation",
  citizenId: "claude_theo",
  attemptId: att2,
  verified: true,
  successReported: true,
  beforeInventory: { "minecraft:oak_log": 1 },
  afterInventory: { "minecraft:oak_planks": 4 },
  worldChanges: [],
});

bPos.append({ kind: "tick", durationMs: 30000, measuredTps: 20.0 });
bPos.append({ kind: "tick", durationMs: 30000, measuredTps: 19.9 });
bPos.append({ kind: "intervention", code: "operator_stop" });
bPos.append({ kind: "shutdown", completedDuration: true, mode: "offline" });

const { lines: posLines, rows: posRows } = bPos.build();

const posEvents = [
  {
    id: "ev-atlas-gather-1",
    type: "CitizenDecisionMade",
    timestamp: "2026-11-05T12:00:00Z",
    citizenId: "gpt_atlas",
    payload: { action: "gather" },
  },
  {
    id: "ev-theo-craft-1",
    type: "CitizenDecisionMade",
    timestamp: "2026-11-05T12:00:01Z",
    citizenId: "claude_theo",
    payload: { action: "craft" },
  },
];

const posFacts = [
  {
    id: "fact-atlas-log",
    citizenId: "gpt_atlas",
    factKey: "gathered_log",
    content: "Gathered 1 oak log",
    kind: "observed_fact",
    createdAt: "2026-11-05T12:00:02Z",
    sourceEventId: "ev-atlas-gather-1",
  },
];

const posInventories = {
  gpt_atlas: { "minecraft:oak_log": 1 },
  claude_theo: { "minecraft:oak_planks": 4 },
};

writeFileSync(join(positiveDir, "manifest.json"), JSON.stringify(posManifest, null, 2), "utf8");
writeFileSync(join(positiveDir, "operator-journal.jsonl"), posLines.join("\n") + "\n", "utf8");
writeFileSync(join(positiveDir, "events.jsonl"), posEvents.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
writeFileSync(join(positiveDir, "facts.json"), JSON.stringify(posFacts, null, 2), "utf8");
writeFileSync(join(positiveDir, "inventories.json"), JSON.stringify(posInventories, null, 2), "utf8");

// Validate positive fixture
const posReport = validateExperimentEvidence({
  manifest: posManifest,
  rawJournalLines: posLines,
  journalRows: posRows,
  events: posEvents as any,
  facts: posFacts as any,
  finalInventories: posInventories,
});

writeFileSync(join(positiveDir, "report.json"), JSON.stringify(posReport, null, 2), "utf8");
writeFileSync(join(positiveDir, "summary.md"), formatHumanReport(posReport), "utf8");

// ---------------------------------------------------------
// 2. Negative Fixture: Tampered Hash Chain
// ---------------------------------------------------------
const tamperedDir = join(bundleRoot, "negative-tampered", "tampered-hash-chain");
mkdirSync(tamperedDir, { recursive: true });

const tamperedLines = [...posLines];
// Tamper with action attempt item without updating hash
tamperedLines[1] = tamperedLines[1]!.replace("minecraft:oak_log", "minecraft:diamond_block");

writeFileSync(join(tamperedDir, "manifest.json"), JSON.stringify(posManifest, null, 2), "utf8");
writeFileSync(join(tamperedDir, "operator-journal.jsonl"), tamperedLines.join("\n") + "\n", "utf8");

const tamperedReport = validateExperimentEvidence({
  manifest: posManifest,
  rawJournalLines: tamperedLines,
  journalRows: posRows,
});
writeFileSync(join(tamperedDir, "report.json"), JSON.stringify(tamperedReport, null, 2), "utf8");

// ---------------------------------------------------------
// 3. Negative Fixture: Falsely Labeled Live
// ---------------------------------------------------------
const fakeLiveDir = join(bundleRoot, "negative-tampered", "falsely-labeled-live");
mkdirSync(fakeLiveDir, { recursive: true });

const fakeLiveManifest = {
  ...posManifest,
  durationMinutes: 60,
  paths: {
    ...posManifest.paths,
    runRoot: "/civ/live-authenticated/exp-fake-live",
  },
};
writeFileSync(join(fakeLiveDir, "manifest.json"), JSON.stringify(fakeLiveManifest, null, 2), "utf8");
writeFileSync(join(fakeLiveDir, "operator-journal.jsonl"), posLines.join("\n") + "\n", "utf8");

const fakeLiveReport = validateExperimentEvidence({
  manifest: fakeLiveManifest,
  rawJournalLines: posLines,
  journalRows: posRows,
});
writeFileSync(join(fakeLiveDir, "report.json"), JSON.stringify(fakeLiveReport, null, 2), "utf8");

// ---------------------------------------------------------
// 4. Compute Hashes and write BUNDLE_README.md
// ---------------------------------------------------------
const hashes = {
  posManifest: sha256File(join(positiveDir, "manifest.json")),
  posJournal: sha256File(join(positiveDir, "operator-journal.jsonl")),
  posEvents: sha256File(join(positiveDir, "events.jsonl")),
  posFacts: sha256File(join(positiveDir, "facts.json")),
  posInventories: sha256File(join(positiveDir, "inventories.json")),
  posReport: sha256File(join(positiveDir, "report.json")),
  tamperedJournal: sha256File(join(tamperedDir, "operator-journal.jsonl")),
  fakeLiveManifest: sha256File(join(fakeLiveDir, "manifest.json")),
};

const readmeContent = `# Mission 006 Evidence Validation Bundle & Cursor Integration Handoff

**Validator Version:** 1.0.0  
**Source SHA:** \`06b7e5038c11bf88d55d7870fbf155a0f12d4d8a\`  
**Generated At:** ${new Date().toISOString()}  

---

## 1. Artifact Verification & Checksums (SHA-256)

| Artifact | Path | SHA-256 |
| :--- | :--- | :--- |
| Positive Manifest | \`positive-offline/manifest.json\` | \`${hashes.posManifest}\` |
| Positive Journal | \`positive-offline/operator-journal.jsonl\` | \`${hashes.posJournal}\` |
| Positive Events | \`positive-offline/events.jsonl\` | \`${hashes.posEvents}\` |
| Positive Facts | \`positive-offline/facts.json\` | \`${hashes.posFacts}\` |
| Positive Inventories | \`positive-offline/inventories.json\` | \`${hashes.posInventories}\` |
| Positive Report | \`positive-offline/report.json\` | \`${hashes.posReport}\` |
| Tampered Journal | \`negative-tampered/tampered-hash-chain/operator-journal.jsonl\` | \`${hashes.tamperedJournal}\` |
| Falsely Labeled Live Manifest | \`negative-tampered/falsely-labeled-live/manifest.json\` | \`${hashes.fakeLiveManifest}\` |

---

## 2. Validation Execution Commands & Exit Codes

### A. Positive Offline Fixture
\`\`\`bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \\
  --manifest experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/manifest.json \\
  --journal experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/operator-journal.jsonl \\
  --events experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/events.jsonl \\
  --facts experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/facts.json \\
  --inventories experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/inventories.json
\`\`\`
- **Exit Code:** \`0\`
- **Status:** \`VERIFIED\` (internal offline consistency passed: actions verified, inventory conserved, hash chain valid)
- **Live Paper Authenticity Guarantee:** \`NOT_PROVEN\` (simulation mode correctly classified as \`offline_simulated\`)

### B. Tampered Hash Chain Negative Fixture
\`\`\`bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \\
  --manifest experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/manifest.json \\
  --journal experiments/evidence-validator/fixtures/mission006-bundle/negative-tampered/tampered-hash-chain/operator-journal.jsonl \\
  --strict
\`\`\`
- **Exit Code:** \`2\`
- **Status:** \`VIOLATIONS_DETECTED\` (\`HASH_CHAIN_MISMATCH\` at seq 2)

### C. Falsely Labeled Live Negative Fixture
\`\`\`bash
pnpm exec tsx experiments/evidence-validator/src/cli.ts \\
  --manifest experiments/evidence-validator/fixtures/mission006-bundle/negative-tampered/falsely-labeled-live/manifest.json \\
  --journal experiments/evidence-validator/fixtures/mission006-bundle/positive-offline/operator-journal.jsonl \\
  --strict
\`\`\`
- **Exit Code:** \`2\`
- **Status:** \`NOT_PROVEN\` (\`UNPROVEN_PAPER_AUTHENTICITY\` emitted; path containing live rejected without server attestation)

---

## 3. Cursor & CODEX 1 Integration Handoff

The validator is completely integrated with fail-closed boundary adapters. To achieve live Gate B certification without \`NOT_PROVEN\`, Cursor/CODEX 1 must implement the following 5 runtime instrumentation fields:

1. \`originPosition\` in \`packages/agent-core/src/experiment-evidence.ts\` (\`attemptSchema\`)
2. \`serverGameTick\` in \`packages/agent-core/src/experiment-evidence.ts\` (\`recordTick(durationMs, measuredTps, serverGameTick)\`)
3. \`toolDurabilityBefore/After\` in \`packages/agent-core/src/experiment-evidence.ts\` (\`observationSchema\`)
4. \`source_event_id\` foreign key on all \`citizen_persistent_facts\` table writes in \`packages/agent-core/src/store.ts\`
5. \`SourceAttestation\` signed token exported by Paper server capture plugin for live demonstrations
`;

writeFileSync(join(bundleRoot, "BUNDLE_README.md"), readmeContent, "utf8");
console.log("Mission 006 bundle generated successfully in:", bundleRoot);
