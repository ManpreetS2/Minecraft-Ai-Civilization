/**
 * Guarded one-citizen WORLD-LAB launcher.
 *
 * Default is dry-run: validate effective config and inspect sqlite + player.dat
 * on disk. Does not connect Paper, Mineflayer, RCON, or AgentManager.
 *
 *   pnpm world-lab:one-citizen
 *   pnpm world-lab:one-citizen -- --dry-run
 *
 * Live connect (do not run until the user is watching and explicitly approves):
 *
 *   pnpm world-lab:one-citizen -- --live
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { loadEnv } from "./env.js";
import { loadConfig, workspaceRoot, type Vec3 } from "@civ/shared";
import { HOME_CLAIM_REACH_BLOCKS, TEST_FIXTURE_CHESTS, WORLD_LAB_COMMUNAL_CHEST } from "@civ/agent-core";
import { LIVE_CIVILIZATION_PORT, RED_WORLD_LAB_PORT } from "./mine-test-guard.js";
import { portOpen } from "./paper.js";
import {
  catalogClaimDistances,
  evaluateWorldLabOneCitizenLaunch,
  pinWorldLabOneCitizenProcessEnv,
  WORLD_LAB_ONE_CITIZEN_ENV,
  WORLD_LAB_WORLD_SPAWN,
} from "./world-lab-one-citizen-guard.js";
import {
  applySimEventToDaySequence,
  daySequenceComplete,
  emptyDaySequence,
  evaluateLiveConnectPreflight,
  evaluatePositioningGate,
  formatIntegrationTrace,
  parseWorldLabOneCitizenArgs,
  reportOneCitizenDay,
  seedDaySequenceFromExistingHome,
  shouldStopForSleep,
  type DaySequenceState,
  type StopReason,
} from "./world-lab-one-citizen-sequence.js";

const LIVE_CIV_JAR_HINT = join(workspaceRoot(), "server", "paper.jar");
const ATLAS_PLAYERDATA = join(
  workspaceRoot(),
  "world-lab",
  "world",
  "playerdata",
  "1d4a9c61-6828-3517-9704-a0518eccaaa5.dat",
);

type SqliteCitizen = {
  id: string;
  name: string;
  status: string;
  home_id: string | null;
  last_x: number | null;
  last_y: number | null;
  last_z: number | null;
};

export function readPlayerDatPos(path: string): Vec3 | undefined {
  const data = gunzipSync(readFileSync(path));
  const needle = Buffer.from([0x00, 0x03, 0x50, 0x6f, 0x73]);
  const idx = data.indexOf(needle);
  if (idx < 1 || data[idx - 1] !== 9) return undefined;
  const rest = data.subarray(idx + 5);
  if (rest.length < 29 || rest[0] !== 6 || rest.readInt32BE(1) < 3) return undefined;
  return { x: rest.readDoubleBE(5), y: rest.readDoubleBE(13), z: rest.readDoubleBE(21) };
}

function sqlText(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function sqlNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapCitizenRow(row: Record<string, unknown>): SqliteCitizen {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    status: String(row.status ?? ""),
    home_id: sqlText(row.home_id),
    last_x: sqlNumber(row.last_x),
    last_y: sqlNumber(row.last_y),
    last_z: sqlNumber(row.last_z),
  };
}

async function inspectSqliteReadonlyAsync(dbPath: string): Promise<{
  citizens: SqliteCitizen[];
  homes: number;
  memberships: number;
  storage: { x: number; y: number; z: number } | null;
}> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const citizens = db
      .prepare("SELECT id, name, status, home_id, last_x, last_y, last_z FROM citizens ORDER BY name")
      .all()
      .map((row) => mapCitizenRow(row as Record<string, unknown>));
    const homes = sqlNumber(db.prepare("SELECT COUNT(*) AS n FROM homes").get()?.n) ?? 0;
    const memberships = sqlNumber(db.prepare("SELECT COUNT(*) AS n FROM home_memberships").get()?.n) ?? 0;
    const settlement = db.prepare("SELECT storage_x, storage_y, storage_z FROM settlement").get() as
      | Record<string, unknown>
      | undefined;
    const sx = sqlNumber(settlement?.storage_x);
    const sy = sqlNumber(settlement?.storage_y);
    const sz = sqlNumber(settlement?.storage_z);
    const storage = sx != null && sy != null && sz != null ? { x: sx, y: sy, z: sz } : null;
    return { citizens, homes, memberships, storage };
  } finally {
    db.close();
  }
}

function atlasSpawnFromDisk(): Vec3 | undefined {
  return existsSync(ATLAS_PLAYERDATA) ? readPlayerDatPos(ATLAS_PLAYERDATA) : undefined;
}

async function dryRun(): Promise<number> {
  loadEnv();
  const fromDotenv = loadConfig();
  console.log("dotenv/loadConfig before pin (what pnpm sim:start would use):");
  console.log(
    `  MINECRAFT_PORT=${fromDotenv.MINECRAFT_PORT} DATABASE_PATH=${fromDotenv.DATABASE_PATH} SIM_CITIZEN_COUNT=${fromDotenv.SIM_CITIZEN_COUNT} AUTO_START_PAPER=${fromDotenv.AUTO_START_PAPER}`,
  );
  if (fromDotenv.MINECRAFT_PORT === LIVE_CIVILIZATION_PORT) {
    console.log("  BLOCKED for sim:start: .env still targets original civilization 25565. This entrypoint never uses it.");
  }

  pinWorldLabOneCitizenProcessEnv();
  const decision = evaluateWorldLabOneCitizenLaunch(process.env);
  if (!decision.allowed) {
    console.error(`GUARD REFUSED: ${decision.error}`);
    return 1;
  }
  const cfg = decision.config;
  console.log("mode: dry-run");
  console.log(`citizen: ${decision.citizen.name} (${decision.citizen.id}) via DEFAULT_CITIZENS.slice(0, SIM_CITIZEN_COUNT)`);
  console.log(`offline roster: ${decision.offlineRoster.map((row) => row.name).join(", ")}`);
  console.log(`MINECRAFT_HOST=${cfg.MINECRAFT_HOST}`);
  console.log(`MINECRAFT_PORT=${cfg.MINECRAFT_PORT}`);
  console.log(`DATABASE_PATH=${cfg.DATABASE_PATH} -> ${decision.databasePath}`);
  console.log(`SIM_CITIZEN_COUNT=${cfg.SIM_CITIZEN_COUNT}`);
  console.log(`AUTO_START_PAPER=${cfg.AUTO_START_PAPER}`);
  console.log(`SIM_ASSIGN_WORK_ROLES=${cfg.SIM_ASSIGN_WORK_ROLES}`);
  console.log(`MECHANICS_PROBE_ENABLED=${cfg.MECHANICS_PROBE_ENABLED}`);
  console.log(`LLM_ENABLED=${cfg.LLM_ENABLED}`);
  console.log(`pinned after dotenv: ${JSON.stringify(WORLD_LAB_ONE_CITIZEN_ENV)}`);
  console.log(`never calling ensurePaper / java ${LIVE_CIV_JAR_HINT}`);
  console.log("DRY-RUN CONTACTS NONE OF: Paper TCP, RCON, Mineflayer, AgentManager, /tp, time set, sqlite writes");

  const dbPath = decision.databasePath;
  if (!existsSync(dbPath)) {
    console.error(`WORLD-LAB sqlite missing at ${dbPath}`);
    return 1;
  }
  const bytes = readFileSync(dbPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const size = statSync(dbPath).size;
  const snapshot = await inspectSqliteReadonlyAsync(dbPath);
  const afterBytes = readFileSync(dbPath);
  const afterSha = createHash("sha256").update(afterBytes).digest("hex");
  console.log(`sqlite ${dbPath} size=${size} sha256=${sha}`);
  console.log(`sqlite hash unchanged after readonly inspect: ${sha === afterSha}`);
  console.log(`citizens: ${JSON.stringify(snapshot.citizens)}`);
  console.log(`homes=${snapshot.homes} memberships=${snapshot.memberships} storage=${JSON.stringify(snapshot.storage)}`);
  const allOfflineFive =
    snapshot.citizens.length === 5 &&
    snapshot.citizens.every((row) => row.status === "offline" && row.home_id == null);
  const atlasRow = snapshot.citizens.find((row) => row.id === "citizen_atlas");
  console.log(`five offline roster, no preclaimed homes: ${allOfflineFive}`);
  if (!allOfflineFive) {
    console.log(
      `continuation state (expected after Day1/Day2): atlas status=${atlasRow?.status ?? "missing"} home_id=${atlasRow?.home_id ?? "none"} — not a dry-run failure`,
    );
  }
  console.log(`fixture chests remain inaccessible: ${JSON.stringify(TEST_FIXTURE_CHESTS)}`);
  console.log(`tannery communal unset (not registered): ${snapshot.storage == null} intended ${JSON.stringify(WORLD_LAB_COMMUNAL_CHEST)}`);

  console.log(`Atlas player.dat: ${existsSync(ATLAS_PLAYERDATA) ? ATLAS_PLAYERDATA : "absent"}`);
  const diskSpawn = atlasSpawnFromDisk();
  console.log(
    `vanilla last Pos (no TEST_CONTROL teleport): ${diskSpawn ? `${diskSpawn.x},${diskSpawn.y},${diskSpawn.z}` : "none; would use world spawn"}`,
  );
  const start = diskSpawn ?? WORLD_LAB_WORLD_SPAWN;
  const distances = catalogClaimDistances(start);
  console.log(`HOME_CLAIM_REACH=${HOME_CLAIM_REACH_BLOCKS}`);
  console.log(
    `claim distances from start ${start.x},${start.y},${start.z}: ${JSON.stringify(distances.map((row) => ({ id: row.id, d: Number(row.distance.toFixed(1)), inReach: row.inClaimReach })))}`,
  );
  const gate = evaluatePositioningGate(diskSpawn);
  console.log(
    `[TEST_CONTROL] spawn atPond=${gate.atPond} inClaimReach=${gate.inClaimReach} teleportApproved=${gate.teleportApproved} citizenWalkExpected=${gate.citizenWalkExpected}`,
  );
  console.log(`[TEST_CONTROL] ${gate.request}`);
  const livePreflight = evaluateLiveConnectPreflight({ env: process.env, spawn: diskSpawn });
  console.log(
    `[TEST_CONTROL] live wouldConnectCitizen=${livePreflight.wouldConnectCitizen} wouldStartPlanner=${livePreflight.wouldStartPlanner}`,
  );
  console.log("House discovery/selection remains the normal planner (no forced claimHome, no hardcoded H9, no scripted fishing, no teleport).");
  console.log(
    "Full-day observation (when live is later authorized): initial claim / optional first-night sleep -> daytime work -> curfew -> own-home return -> next legal sleep. First claimed-bed sleep does not end the run. Bounded wall-clock stop reports PARTIAL if the sequence is incomplete.",
  );
  console.log("Paper / clock not probed. Dry-run does not connect to 25567.");
  console.log("BLUE shared window: GREEN will not kick, time-set, or restart Paper.");
  console.log("live command (NOT executed): pnpm world-lab:one-citizen -- --live");
  console.log("DRY-RUN COMPLETE. No citizen connected. No Paper connection. No database write.");
  // Guard + readonly inspect are the dry-run gate. Prior Day2 claim/online status is continuation, not failure.
  return decision.allowed ? 0 : 1;
}

async function liveConnect(maxMs: number): Promise<number> {
  loadEnv();
  pinWorldLabOneCitizenProcessEnv();
  const spawn = atlasSpawnFromDisk();
  const preflight = evaluateLiveConnectPreflight({ env: process.env, spawn });
  if (!preflight.allowed) {
    const report = reportOneCitizenDay(emptyDaySequence(), "guard_refused");
    console.error(`GUARD REFUSED: ${preflight.error}`);
    console.error(report.summary);
    console.error(`verdict=${report.verdict} wouldConnectCitizen=false`);
    return 1;
  }
  if (preflight.launch.config.AUTO_START_PAPER || preflight.launch.config.MINECRAFT_PORT !== RED_WORLD_LAB_PORT) {
    console.error("Refusing live connect: isolated Paper constraints failed after pin.");
    return 1;
  }
  const up = await portOpen(preflight.launch.config.MINECRAFT_HOST, preflight.launch.config.MINECRAFT_PORT, 1500);
  if (!up) {
    console.error(`WORLD-LAB Paper is not listening on ${RED_WORLD_LAB_PORT}. Refusing to spawn ${LIVE_CIV_JAR_HINT}.`);
    return 1;
  }

  const cfg = preflight.launch.config;
  console.log("mode: live");
  console.log(`citizen: ${preflight.launch.citizen.name} (${preflight.launch.citizen.id})`);
  console.log(`MINECRAFT_HOST=${cfg.MINECRAFT_HOST} MINECRAFT_PORT=${cfg.MINECRAFT_PORT}`);
  console.log(`DATABASE_PATH=${cfg.DATABASE_PATH}`);
  console.log(`[TEST_CONTROL] ${preflight.positioning.request}`);
  console.log(
    `[TEST_CONTROL] spawn atPond=${preflight.positioning.atPond} inClaimReach=${preflight.positioning.inClaimReach} teleportApproved=false citizenWalkExpected=${preflight.positioning.citizenWalkExpected}. House is not pre-assigned.`,
  );
  console.log(`bounded stop ${maxMs}ms. First claimed-bed sleep does not end the run. enableColonyMode skipped. ensurePaper spawn skipped.`);

  const { AgentManager } = await import("@civ/agent-core");
  const { startDashboardServer } = await import("./http-server.js");
  const manager = new AgentManager(preflight.launch.config);
  const dashboard = await startDashboardServer(manager, "0.0.0.0", preflight.launch.config.DASHBOARD_PORT);
  await manager.start(1, { deferTicks: true });
  const names = manager.list().map((citizen) => citizen.record.name);
  if (names.length !== 1 || names[0] !== "Atlas") {
    console.error(`one-body enforcement failed: ${names.join(", ")}`);
    await manager.stop();
    return 1;
  }
  const livePos = manager.get("Atlas")?.body.position();
  const liveGate = evaluatePositioningGate(livePos);
  console.log(
    `[CITIZEN_OBSERVATION] live body ${livePos ? `${livePos.x.toFixed(1)},${livePos.y.toFixed(1)},${livePos.z.toFixed(1)}` : "unknown"} atPond=${liveGate.atPond} inClaimReach=${liveGate.inClaimReach}`,
  );
  if (liveGate.citizenWalkExpected) {
    console.log("[PLANNER_CHOICE] homeless/out-of-range start; travelTowardHousing may fire. No TEST_CONTROL teleport.");
  }
  if (manager.plannerTicksArmed()) {
    console.error("planner ticks were armed before the spawn log; refusing.");
    await manager.stop();
    return 1;
  }

  let sequence: DaySequenceState = seedDaySequenceFromExistingHome(
    emptyDaySequence(),
    manager.get("Atlas")?.record.homeId,
  );
  if (sequence.claimedHomeId) {
    console.log(
      `[TEST_CONTROL] sequence seeded claimedHomeId=${sequence.claimedHomeId} from existing membership (not a new claim event)`,
    );
  }
  // Spawn evidence: Minecraft player.dat Pos is authoritative for join; sqlite last_* is agent memory only.
  const diskPos = existsSync(ATLAS_PLAYERDATA) ? readPlayerDatPos(ATLAS_PLAYERDATA) : undefined;
  const memPos = manager.get("Atlas")?.record.lastKnownPosition;
  console.log(
    `[CITIZEN_OBSERVATION] spawnEvidence playerdata=${diskPos ? `${diskPos.x.toFixed(1)},${diskPos.y.toFixed(1)},${diskPos.z.toFixed(1)}` : "missing"} sqliteLast=${memPos ? `${memPos.x.toFixed(1)},${memPos.y.toFixed(1)},${memPos.z.toFixed(1)}` : "none"} (playerdata wins for Paper join; no silent teleport)`,
  );
  let finished = false;
  const shutdown = async (reason: StopReason): Promise<number> => {
    if (finished) return 0;
    finished = true;
    const report = reportOneCitizenDay(sequence, reason);
    console.log(`[TEST_CONTROL] bounded shutdown reason=${reason}`);
    console.log(report.summary);
    console.log(`verdict=${report.verdict} complete=${report.complete} firstSleepEndedRun=${report.firstSleepEndedRun}`);
    console.log(`missing=${report.missing.join(",") || "none"} claimed=${sequence.claimedHomeId ?? "none"} sleeps=${sequence.claimedBedSleepCount}`);
    await manager.stop();
    return report.verdict === "PASS" ? 0 : report.verdict === "PARTIAL" ? 2 : 1;
  };

  manager.events.on((event) => {
    console.log(formatIntegrationTrace(event));
    sequence = applySimEventToDaySequence(sequence, event);
    if (shouldStopForSleep(sequence) && daySequenceComplete(sequence)) {
      void shutdown("sequence_complete").then((code) => {
        process.exitCode = code;
        process.exit(code);
      });
    }
  });

  console.log(`Dashboard: ${dashboard}`);
  console.log("[CITIZEN_OBSERVATION] Atlas connected on 25567. Maya/Theo/Ava/Kai remain offline. Planner starting with no forced claim/H9/fishing.");
  await manager.resumeTicks();

  const timer = setTimeout(() => {
    void shutdown("time_limit").then((code) => {
      process.exitCode = code;
      process.exit(code);
    });
  }, maxMs);
  timer.unref?.();

  try {
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      process.once("SIGINT", () => {
        void shutdown("interrupt").then(() => finish());
      });
      process.once("SIGTERM", () => {
        void shutdown("interrupt").then(() => finish());
      });
    });
  } finally {
    clearTimeout(timer);
    if (!finished) {
      await shutdown("interrupt");
    }
  }
  return process.exitCode === undefined ? 0 : Number(process.exitCode);
}

async function main(): Promise<void> {
  const args = parseWorldLabOneCitizenArgs(process.argv.slice(2));
  if (args.dryRun) {
    process.exitCode = await dryRun();
    return;
  }
  process.exitCode = await liveConnect(args.maxMs);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
