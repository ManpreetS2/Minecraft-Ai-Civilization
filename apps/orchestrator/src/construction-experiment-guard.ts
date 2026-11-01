/**
 * Mission 006A — construction physical experiment guards.
 * Default: refuse live connect. Isolation paths must not alias the original World-Lab.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { resolveFromRoot, workspaceRoot, type Vec3 } from "@civ/shared";
import { WORLD_LAB_CLAIMABLE_HOMES } from "@civ/agent-core";
import { LIVE_CIVILIZATION_PORT, RED_WORLD_LAB_PORT } from "./mine-test-guard.js";

/** Original (sacred) World-Lab — never mutate for Mission 006A experiments. */
export const ORIGINAL_WORLD_LAB_DIR = "world-lab";
export const ORIGINAL_WORLD_LAB_SQLITE = "./data/world-lab-civilization.sqlite";
export const ORIGINAL_PAPER_PORT = RED_WORLD_LAB_PORT; // 25567
export const ORIGINAL_RCON_PORT = 25577;

/** Isolated disposable experiment ports (must differ from original + live-civ). */
export const ISOLATED_PAPER_PORT = 25568;
export const ISOLATED_RCON_PORT = 25578;

export const ISOLATED_ROOT_REL = "experiments/construction-006a";
export const ISOLATED_WORLD_LAB_REL = `${ISOLATED_ROOT_REL}/world-lab-isolated`;
export const ISOLATED_SQLITE_REL = `${ISOLATED_ROOT_REL}/world-lab-civilization.sqlite`;
export const ISOLATED_EVIDENCE_REL = `${ISOLATED_ROOT_REL}/evidence`;

/** H9 catalog origin — construction pad must stay far away. */
export const H9_ORIGIN: Vec3 = { x: -1065, y: 68, z: 847 };
export const MIN_H9_DISTANCE_BLOCKS = 48;

/** Proposed isolated construction pad (empty plains-style coords — operator must verify loaded/empty). */
export const PROPOSED_CONSTRUCTION_PAD: Vec3 = { x: -900, y: 70, z: 700 };

export const CONSTRUCTION_EXPERIMENT_ENV_PINS: Record<string, string> = {
  MINECRAFT_HOST: "127.0.0.1",
  MINECRAFT_PORT: String(ISOLATED_PAPER_PORT),
  DATABASE_PATH: ISOLATED_SQLITE_REL,
  AUTO_START_PAPER: "false",
  SIM_CITIZEN_COUNT: "1",
  SIM_ASSIGN_WORK_ROLES: "false",
  MECHANICS_PROBE_ENABLED: "false",
  CONSTRUCTION_EXPERIMENT_ENABLED: "false",
  CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "false",
  CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: "false",
};

/**
 * Exact operator sentence required before Mission 006B Stage 1 may touch Minecraft.
 * Anything else (including this chat handoff) is NOT authorization.
 */
export const MISSION_006B_STAGE1_AUTH_PHRASE =
  "Authorize Mission 006B Stage 1 live on isolated World-Lab port 25568 only.";

export function hasMission006BStage1Authorization(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CONSTRUCTION_006B_STAGE1_AUTH ?? "").trim() === MISSION_006B_STAGE1_AUTH_PHRASE;
}

export type Stage1LiveGate =
  | { allowed: true; live: ConstructionLiveGate & { allowed: true } }
  | { allowed: false; error: string };

/** Stage 1 live gate: isolation live gate + exact 006B auth phrase. Stages 2–4 never pass here. */
export function evaluateMission006BStage1Live(
  env: NodeJS.ProcessEnv = process.env,
  stageId = "stage1_one_block",
): Stage1LiveGate {
  if (stageId !== "stage1_one_block") {
    return {
      allowed: false,
      error: `Mission 006B hard-stop: stage '${stageId}' is not authorized (Stage 1 only)`,
    };
  }
  if (!hasMission006BStage1Authorization(env)) {
    return {
      allowed: false,
      error: `Missing exact CONSTRUCTION_006B_STAGE1_AUTH phrase. Required: "${MISSION_006B_STAGE1_AUTH_PHRASE}"`,
    };
  }
  const live = evaluateConstructionExperimentLive(env);
  if (!live.allowed) return { allowed: false, error: live.error };
  if (live.paperPort !== ISOLATED_PAPER_PORT) {
    return {
      allowed: false,
      error: `Stage 1 requires isolated paper port ${ISOLATED_PAPER_PORT}, got ${live.paperPort}`,
    };
  }
  return { allowed: true, live };
}

export type PathValidation =
  | { ok: true; resolved: string; real: string }
  | { ok: false; error: string };

export function resolveWorkspacePath(relOrAbs: string): string {
  return isAbsolute(relOrAbs) ? normalize(relOrAbs) : resolveFromRoot(relOrAbs);
}

export function validatePathExists(relOrAbs: string, label: string): PathValidation {
  const resolved = resolveWorkspacePath(relOrAbs);
  if (!existsSync(resolved)) {
    return { ok: false, error: `${label} missing: ${resolved}` };
  }
  let real = resolved;
  try {
    real = realpathSync(resolved);
  } catch {
    real = resolved;
  }
  return { ok: true, resolved, real };
}

export function pathsAliasSameTree(a: string, b: string): boolean {
  const na = normalize(a).toLowerCase().replaceAll("/", sep);
  const nb = normalize(b).toLowerCase().replaceAll("/", sep);
  return na === nb || na.startsWith(nb + sep) || nb.startsWith(na + sep);
}

export function assertIsolatedNotOriginal(args: {
  isolatedWorldLab: string;
  isolatedSqlite: string;
}): { ok: true } | { ok: false; error: string } {
  const originalWl = validatePathExists(ORIGINAL_WORLD_LAB_DIR, "original world-lab");
  const originalDb = validatePathExists(ORIGINAL_WORLD_LAB_SQLITE, "original sqlite");
  if (!originalWl.ok) return originalWl;
  if (!originalDb.ok) return originalDb;

  const isoWl = resolveWorkspacePath(args.isolatedWorldLab);
  const isoDb = resolveWorkspacePath(args.isolatedSqlite);

  if (pathsAliasSameTree(isoWl, originalWl.real)) {
    return { ok: false, error: `Isolated world-lab aliases original: ${isoWl}` };
  }
  if (pathsAliasSameTree(isoDb, originalDb.real)) {
    return { ok: false, error: `Isolated sqlite aliases original: ${isoDb}` };
  }
  // Refuse if isolated path is inside original world-lab
  if (pathsAliasSameTree(isoWl, join(originalWl.real, "world"))) {
    return { ok: false, error: "Isolated path must not sit inside original world/" };
  }
  return { ok: true };
}

export function distance2(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function padSafeFromSettlementHomes(
  pad: Vec3,
  minDistance = MIN_H9_DISTANCE_BLOCKS,
): { ok: boolean; nearestHomeId?: string; distance?: number } {
  let nearest = Number.POSITIVE_INFINITY;
  let nearestId: string | undefined;
  for (const home of WORLD_LAB_CLAIMABLE_HOMES) {
    const d = distance2(pad, home.origin);
    if (d < nearest) {
      nearest = d;
      nearestId = home.id;
    }
  }
  const h9 = distance2(pad, H9_ORIGIN);
  if (h9 < minDistance) {
    return { ok: false, nearestHomeId: "home_h9", distance: h9 };
  }
  if (nearest < minDistance) {
    return { ok: false, nearestHomeId: nearestId, distance: nearest };
  }
  return { ok: true, nearestHomeId: nearestId, distance: nearest };
}

export type ConstructionLiveGate =
  | {
      allowed: true;
      paperPort: number;
      rconPort: number;
      worldLabDir: string;
      sqlitePath: string;
      evidenceDir: string;
      pad: Vec3;
    }
  | { allowed: false; error: string };

/**
 * Live construction experiment gate. Default deny.
 * Requires explicit env approvals AND isolated paths AND non-original ports.
 */
export function evaluateConstructionExperimentLive(env: NodeJS.ProcessEnv = process.env): ConstructionLiveGate {
  if (env.CONSTRUCTION_EXPERIMENT_ENABLED !== "true") {
    return { allowed: false, error: "CONSTRUCTION_EXPERIMENT_ENABLED is not true" };
  }
  if (env.CONSTRUCTION_EXPERIMENT_ALLOW_LIVE !== "true") {
    return { allowed: false, error: "CONSTRUCTION_EXPERIMENT_ALLOW_LIVE is not true — live Minecraft unauthorized" };
  }
  if (env.CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION !== "true") {
    return { allowed: false, error: "CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION is not true" };
  }
  if (env.AUTO_START_PAPER === "true") {
    return { allowed: false, error: "AUTO_START_PAPER must be false for construction experiments" };
  }

  const paperPort = Number(env.MINECRAFT_PORT ?? ISOLATED_PAPER_PORT);
  const rconPort = Number(env.CONSTRUCTION_EXPERIMENT_RCON_PORT ?? ISOLATED_RCON_PORT);
  if (paperPort === ORIGINAL_PAPER_PORT || paperPort === LIVE_CIVILIZATION_PORT) {
    return {
      allowed: false,
      error: `Refusing paper port ${paperPort}; use isolated ${ISOLATED_PAPER_PORT}, not original 25567 or live-civ`,
    };
  }
  if (rconPort === ORIGINAL_RCON_PORT || rconPort === 25575) {
    return {
      allowed: false,
      error: `Refusing RCON port ${rconPort}; use isolated ${ISOLATED_RCON_PORT}`,
    };
  }

  const worldLabDir = env.CONSTRUCTION_EXPERIMENT_WORLD_LAB ?? ISOLATED_WORLD_LAB_REL;
  const sqlitePath = env.DATABASE_PATH ?? ISOLATED_SQLITE_REL;
  const evidenceDir = env.CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR ?? ISOLATED_EVIDENCE_REL;

  const isolation = assertIsolatedNotOriginal({ isolatedWorldLab: worldLabDir, isolatedSqlite: sqlitePath });
  if (!isolation.ok) return { allowed: false, error: isolation.error };

  const wl = validatePathExists(worldLabDir, "isolated world-lab");
  if (!wl.ok) return { allowed: false, error: wl.error };
  const db = validatePathExists(sqlitePath, "isolated sqlite");
  if (!db.ok) return { allowed: false, error: db.error };

  const pad = PROPOSED_CONSTRUCTION_PAD;
  const safe = padSafeFromSettlementHomes(pad);
  if (!safe.ok) {
    return {
      allowed: false,
      error: `Proposed pad too close to ${safe.nearestHomeId} (distance ${safe.distance?.toFixed(1)})`,
    };
  }

  return {
    allowed: true,
    paperPort,
    rconPort,
    worldLabDir: wl.resolved,
    sqlitePath: db.resolved,
    evidenceDir: resolveWorkspacePath(evidenceDir),
    pad,
  };
}

export function originalWorldLabFingerprint(): {
  worldLab: string;
  sqlite: string;
  serverPropertiesBytes?: number;
  sqliteBytes?: number;
  workspace: string;
} {
  const wl = resolveWorkspacePath(ORIGINAL_WORLD_LAB_DIR);
  const db = resolveWorkspacePath(ORIGINAL_WORLD_LAB_SQLITE);
  return {
    workspace: workspaceRoot(),
    worldLab: wl,
    sqlite: db,
    serverPropertiesBytes: existsSync(join(wl, "server.properties"))
      ? statSync(join(wl, "server.properties")).size
      : undefined,
    sqliteBytes: existsSync(db) ? statSync(db).size : undefined,
  };
}
