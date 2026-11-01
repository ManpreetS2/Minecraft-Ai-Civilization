import { assertLiveRuntimeLaunchAllowed } from "@civ/agent-core";
/**
 * Mission 006A — staged physical construction experiment runner.
 *
 * DEFAULT: dry-run / plan-only. Prints stages, abort conditions, evidence schema.
 * Does NOT start Paper, connect Atlas, or place blocks.
 *
 * Live stages remain gated behind evaluateConstructionExperimentLive() +
 * explicit operator authorization documented in CONSTRUCTION_MISSION006A_*.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConstructionEvidenceLog, evidenceHeaderMarkdown } from "@civ/agent-core";
import { workspaceRoot } from "@civ/shared";
import {
  CONSTRUCTION_EXPERIMENT_ENV_PINS,
  ISOLATED_EVIDENCE_REL,
  ISOLATED_PAPER_PORT,
  ISOLATED_RCON_PORT,
  ISOLATED_ROOT_REL,
  ISOLATED_SQLITE_REL,
  ISOLATED_WORLD_LAB_REL,
  PROPOSED_CONSTRUCTION_PAD,
  evaluateConstructionExperimentLive,
  originalWorldLabFingerprint,
  padSafeFromSettlementHomes,
} from "./construction-experiment-guard.js";

export type ConstructionStageId = "stage1_one_block" | "stage2_wall" | "stage3_door" | "stage4_cabin";

export type StageSpec = {
  id: ConstructionStageId;
  title: string;
  objective: string;
  abortConditions: string[];
  requiresPrior: ConstructionStageId[];
  /** Explicit: next stage never auto-starts on success. */
  autoAdvance: false;
};

export const CONSTRUCTION_STAGES: StageSpec[] = [
  {
    id: "stage1_one_block",
    title: "Stage 1 — One floor block",
    objective:
      "Atlas places one legitimately held block on the isolated pad via production placeBlock; verify world identity, inventory delta, and optional SQLite note.",
    abortConditions: [
      "Wrong world / port / sqlite (not isolated copy)",
      "Pad unloaded or within H9 / home exclusion radius",
      "Navigation failure",
      "No supporting neighbor",
      "ITEM_NOT_FOUND / EQUIP_FAILED",
      "VERIFY_FAILED or wrong block identity",
      "Inventory delta inconsistent with one consumed item",
      "Operator cancel",
    ],
    requiresPrior: [],
    autoAdvance: false,
  },
  {
    id: "stage2_wall",
    title: "Stage 2 — Supported wall",
    objective: "Place one wall block atop/adjacent to stage-1 floor using neighbor support + nav.",
    abortConditions: [
      "Stage 1 not operator-verified",
      "Missing support / PLACE_FAILED",
      "Nav / equip / verify failures",
      "clearSite attempts to dig protected furniture",
    ],
    requiresPrior: ["stage1_one_block"],
    autoAdvance: false,
  },
  {
    id: "stage3_door",
    title: "Stage 3 — Door multiblock",
    objective:
      "Place oak_door in a framed opening; verify lower+upper identity, facing/half properties, and functional open/enter/exit.",
    abortConditions: [
      "Stage 2 not operator-verified",
      "PURPOSELESS doorway / freestanding door",
      "Upper half missing or wrong identity",
      "Facing/hinge mismatch or properties unavailable (unverified)",
      "Enter/exit validation failure",
    ],
    requiresPrior: ["stage2_wall"],
    autoAdvance: false,
  },
  {
    id: "stage4_cabin",
    title: "Stage 4 — workshop_cabin_v1",
    objective:
      "Full executeBuildStructurePlan → advanceBlueprintBuild with legitimate materials, checkpoints, recovery, world+property COMPLETED.",
    abortConditions: [
      "Stages 1–3 not operator-verified",
      "Site select / claim / shortfall BLOCKED",
      "Any VERIFY_FAILED / unverified door-bed state",
      "Persist failure while claiming COMPLETED",
      "clearSite ACCESS_DENIED near settlement furniture",
      "Damage to H9 or foreign property",
    ],
    requiresPrior: ["stage1_one_block", "stage2_wall", "stage3_door"],
    autoAdvance: false,
  },
];

function parseArgs(argv: string[]): { stage?: string; writePlan: boolean } {
  const stageArg = argv.find((a) => a.startsWith("--stage="));
  return {
    stage: stageArg?.slice("--stage=".length),
    writePlan: argv.includes("--write-plan") || argv.length === 0 || !argv.includes("--live"),
  };
}

function operatorCommandsMarkdown(): string {
  return `# Operator commands — Construction 006A (DO NOT RUN until authorized)

## 0. Preservation check

\`\`\`powershell
cd <WORKSPACE>
Get-FileHash .\\world-lab\\server.properties -Algorithm SHA256
Get-FileHash .\\data\\world-lab-civilization.sqlite -Algorithm SHA256
# Compare to experiments/construction-006a/manifest.json
\`\`\`

## 1. Prepare isolated copy (offline; no Paper)

\`\`\`powershell
pnpm construction:prepare-006a -- --execute-copy
\`\`\`

## 2. Dry-run stage plan (no Minecraft)

\`\`\`powershell
pnpm construction:staged-006a -- --write-plan
\`\`\`

## 3. LIVE — REQUIRES EXPLICIT OPERATOR AUTHORIZATION

Only after a written GO for a **single** stage:

\`\`\`powershell
# Pins — isolated ports only; AUTO_START_PAPER=false
# Copy from experiments/construction-006a/.env.construction-006a then:
$env:CONSTRUCTION_EXPERIMENT_ENABLED="true"
$env:CONSTRUCTION_EXPERIMENT_ALLOW_LIVE="true"
$env:CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION="true"
$env:AUTO_START_PAPER="false"
$env:MINECRAFT_PORT="${ISOLATED_PAPER_PORT}"
$env:DATABASE_PATH="${ISOLATED_SQLITE_REL}"

# Start Paper from ISOLATED tree only (never world-lab\\start.bat original):
cd experiments\\construction-006a\\world-lab-isolated
.\\start.bat
# Wait for Done on port ${ISOLATED_PAPER_PORT}

# Then run ONE stage under observation (entrypoints to be enabled only after auth):
# pnpm construction:staged-006a -- --live --stage=stage1_one_block
\`\`\`

## Emergency stop

1. Disconnect Atlas / kill bot process.
2. Paper console: \`stop\` (isolated instance only).
3. Do not touch original \`world-lab\` on 25567.
4. See \`experiments/construction-006a/ROLLBACK.md\`.
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (process.argv.includes("--live")) assertLiveRuntimeLaunchAllowed();
  const liveGate = evaluateConstructionExperimentLive(process.env);

  console.log("=== Construction staged experiment (Mission 006A) ===");
  console.log(`AUTO_START_PAPER pin expected: false (env=${process.env.AUTO_START_PAPER ?? "unset"})`);
  console.log(`Live gate: ${liveGate.allowed ? "ALLOWED" : `DENIED — ${liveGate.allowed === false ? liveGate.error : ""}`}`);
  console.log(`Original fingerprint: ${JSON.stringify(originalWorldLabFingerprint())}`);
  console.log(`Proposed pad: ${JSON.stringify(PROPOSED_CONSTRUCTION_PAD)} safety=${JSON.stringify(padSafeFromSettlementHomes(PROPOSED_CONSTRUCTION_PAD))}`);

  if (process.argv.includes("--live")) {
    console.error("LIVE flag on staged runner: use Mission 006B Stage 1 entrypoint only.");
    console.error("  pnpm construction:stage1-006b");
    console.error("Stages 2–4 remain hard-stopped. This runner never connects Mineflayer.");
    if (!liveGate.allowed) {
      console.error(`Gate: ${liveGate.error}`);
    }
    process.exit(2);
  }

  const evidenceDir = join(workspaceRoot(), ISOLATED_EVIDENCE_REL);
  mkdirSync(evidenceDir, { recursive: true });
  const experimentId = `construction-006a-plan-${new Date().toISOString().slice(0, 10)}`;
  const log = createConstructionEvidenceLog({
    dir: evidenceDir,
    experimentId,
    liveSession: false,
  });

  for (const stage of CONSTRUCTION_STAGES) {
    if (args.stage && args.stage !== stage.id) continue;
    log.append({
      stage: stage.id,
      phase: "intended",
      note: `${stage.title}: ${stage.objective}`,
      citizenId: "citizen_atlas",
      blueprintId: stage.id === "stage4_cabin" ? "workshop_cabin_v1" : undefined,
      site: PROPOSED_CONSTRUCTION_PAD,
      constructionStatus: "PLAN_ONLY",
      failureReason: undefined,
    });
    console.log(`\n## ${stage.title}`);
    console.log(stage.objective);
    console.log("Abort if:");
    for (const a of stage.abortConditions) console.log(`  - ${a}`);
    console.log(`autoAdvance=${stage.autoAdvance}; requiresPrior=${stage.requiresPrior.join(",") || "(none)"}`);
  }

  const planDir = join(workspaceRoot(), ISOLATED_ROOT_REL);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, "OPERATOR_COMMANDS.md"), operatorCommandsMarkdown(), "utf8");
  writeFileSync(
    join(planDir, "STAGES.md"),
    [
      evidenceHeaderMarkdown({ experimentId, stage: "plan", liveSession: false }),
      ...CONSTRUCTION_STAGES.map(
        (s) =>
          `## ${s.title}\n\n${s.objective}\n\nAbort:\n${s.abortConditions.map((a) => `- ${a}`).join("\n")}\n`,
      ),
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(planDir, "env-pins.example"),
    Object.entries(CONSTRUCTION_EXPERIMENT_ENV_PINS)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + `\nMINECRAFT_PORT=${ISOLATED_PAPER_PORT}\nCONSTRUCTION_EXPERIMENT_RCON_PORT=${ISOLATED_RCON_PORT}\nDATABASE_PATH=${ISOLATED_SQLITE_REL}\nCONSTRUCTION_EXPERIMENT_WORLD_LAB=${ISOLATED_WORLD_LAB_REL}\n`,
    "utf8",
  );

  console.log(`\nEvidence plan log: ${log.path}`);
  console.log(`Operator commands: ${join(planDir, "OPERATOR_COMMANDS.md")}`);
  console.log("Stopped at physical authorization boundary. No Minecraft started.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
