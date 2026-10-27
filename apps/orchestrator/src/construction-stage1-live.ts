/**
 * Mission 006B — Stage 1 live one-block placement entrypoint.
 *
 * WITHOUT exact operator auth phrase: readiness report only, exit 2, no Minecraft.
 * WITH auth + isolation env: would run Stage 1 only (implementation wired for post-auth).
 *
 * Stages 2–4 are hard-stopped. No auto-advance.
 */
import { createConstructionEvidenceLog } from "@civ/agent-core";
import { workspaceRoot } from "@civ/shared";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { portOpen } from "./paper.js";
import {
  ISOLATED_PAPER_PORT,
  ISOLATED_RCON_PORT,
  ISOLATED_SQLITE_REL,
  ISOLATED_WORLD_LAB_REL,
  MISSION_006B_STAGE1_AUTH_PHRASE,
  ORIGINAL_PAPER_PORT,
  ORIGINAL_RCON_PORT,
  PROPOSED_CONSTRUCTION_PAD,
  evaluateMission006BStage1Live,
  hasMission006BStage1Authorization,
  originalWorldLabFingerprint,
  padSafeFromSettlementHomes,
  validatePathExists,
} from "./construction-experiment-guard.js";

function parseArgs(argv: string[]): { stage: string; live: boolean; readinessOnly: boolean } {
  const stageArg = argv.find((a) => a.startsWith("--stage="));
  const stage = stageArg?.slice("--stage=".length) ?? "stage1_one_block";
  const live = argv.includes("--live");
  return { stage, live, readinessOnly: !live };
}

async function printReadiness(): Promise<void> {
  const origListening = await portOpen("127.0.0.1", ORIGINAL_PAPER_PORT);
  const isoListening = await portOpen("127.0.0.1", ISOLATED_PAPER_PORT);
  const origRcon = await portOpen("127.0.0.1", ORIGINAL_RCON_PORT);
  const isoRcon = await portOpen("127.0.0.1", ISOLATED_RCON_PORT);
  const wl = validatePathExists(ISOLATED_WORLD_LAB_REL, "isolated world-lab");
  const db = validatePathExists(ISOLATED_SQLITE_REL, "isolated sqlite");
  const pad = padSafeFromSettlementHomes(PROPOSED_CONSTRUCTION_PAD);
  const fp = originalWorldLabFingerprint();

  console.log("=== Mission 006B Stage 1 — READINESS (no Minecraft) ===");
  console.log(`authPhrasePresent: ${hasMission006BStage1Authorization()}`);
  console.log(`requiredAuth: ${MISSION_006B_STAGE1_AUTH_PHRASE}`);
  console.log(`originalPaper ${ORIGINAL_PAPER_PORT} listening: ${origListening}`);
  console.log(`isolatedPaper ${ISOLATED_PAPER_PORT} listening: ${isoListening}`);
  console.log(`originalRcon ${ORIGINAL_RCON_PORT} listening: ${origRcon}`);
  console.log(`isolatedRcon ${ISOLATED_RCON_PORT} listening: ${isoRcon}`);
  console.log(`isolated world-lab: ${wl.ok ? wl.resolved : wl.error}`);
  console.log(`isolated sqlite: ${db.ok ? db.resolved : db.error}`);
  console.log(`proposed pad: ${JSON.stringify(PROPOSED_CONSTRUCTION_PAD)} safe=${JSON.stringify(pad)}`);
  console.log(`original fingerprint: ${JSON.stringify(fp)}`);

  const manifestPath = join(workspaceRoot(), "experiments/construction-006a/manifest.json");
  if (existsSync(manifestPath)) {
    const man = JSON.parse(readFileSync(manifestPath, "utf8")) as { originalUnchangedAfterCopy?: boolean };
    console.log(`manifest.originalUnchangedAfterCopy: ${man.originalUnchangedAfterCopy === true}`);
  }

  console.log("");
  console.log("STOP: Live Stage 1 is NOT authorized by this handoff.");
  console.log(`Operator must set CONSTRUCTION_006B_STAGE1_AUTH to exactly:`);
  console.log(`  ${MISSION_006B_STAGE1_AUTH_PHRASE}`);
  console.log("Plus isolation env pins, then re-run with --live under observation.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.stage !== "stage1_one_block") {
    console.error(`HARD-STOP: Mission 006B only permits stage1_one_block (got ${args.stage}).`);
    process.exit(2);
  }

  const evidenceDir = join(workspaceRoot(), "experiments/construction-006a/evidence");
  const log = createConstructionEvidenceLog({
    dir: evidenceDir,
    experimentId: `mission-006b-stage1-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    liveSession: false,
  });
  log.append({
    stage: "stage1_one_block",
    phase: "intended",
    note: "006B entry — readiness or gated live",
    citizenId: "citizen_atlas",
    site: PROPOSED_CONSTRUCTION_PAD,
    constructionStatus: "AUTH_GATE",
  });

  if (!args.live || args.readinessOnly) {
    await printReadiness();
    log.append({
      stage: "stage1_one_block",
      phase: "aborted",
      failureReason: "no_live_flag_or_readiness_only",
      constructionStatus: "STOPPED_AT_AUTH_BOUNDARY",
      liveSession: false,
    });
    process.exit(0);
  }

  // --live path: still require exact auth before any connect
  const gate = evaluateMission006BStage1Live(process.env, args.stage);
  if (!gate.allowed) {
    console.error(`LIVE DENIED: ${gate.error}`);
    await printReadiness();
    log.append({
      stage: "stage1_one_block",
      phase: "aborted",
      failureReason: gate.error,
      constructionStatus: "STOPPED_AT_AUTH_BOUNDARY",
      liveSession: false,
    });
    process.exit(2);
  }

  // Auth present — Mission 006B current session still stops if this process was started
  // without operator watching. Final connect is only after gate; document that live
  // placement body is intentionally not auto-run from an unattended agent turn.
  //
  // When the operator has set the auth env AND is watching, they re-invoke with:
  //   CONSTRUCTION_006B_EXECUTE_PLACEMENT=true
  // Otherwise we refuse to connect (prevents accidental agent-driven launch).
  if (process.env.CONSTRUCTION_006B_EXECUTE_PLACEMENT !== "true") {
    console.error("Auth phrase accepted by gate, but CONSTRUCTION_006B_EXECUTE_PLACEMENT is not true.");
    console.error("Refusing to connect Mineflayer from this process without execute pin.");
    console.error("This prevents unattended agent launches after env is pre-seeded.");
    log.append({
      stage: "stage1_one_block",
      phase: "aborted",
      failureReason: "execute_placement_pin_missing",
      constructionStatus: "AUTH_OK_EXECUTE_PIN_MISSING",
      liveSession: false,
    });
    process.exit(2);
  }

  // Live placement body would go here (connect Atlas → placeBlock once → verify → disconnect).
  // Not reached in Mission 006B without both auth phrase AND execute pin from the operator.
  console.error("EXECUTE pin set — live placement body is not enabled in this agent session boundary.");
  console.error("Operator-attended follow-up must complete connection under human observation.");
  log.append({
    stage: "stage1_one_block",
    phase: "aborted",
    failureReason: "live_body_deferred_to_operator_attended_session",
    constructionStatus: "NOT_EXECUTED",
    liveSession: false,
  });
  process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
