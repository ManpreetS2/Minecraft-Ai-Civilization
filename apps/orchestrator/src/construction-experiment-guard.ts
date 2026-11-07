/**
 * Mission 006A — construction physical experiment guards.
 * Default: refuse live connect. Isolation paths must not alias the original World-Lab.
 */
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readdirSync, realpathSync, statSync, type BigIntStats } from "node:fs";
import { isIP } from "node:net";
import { basename, dirname, isAbsolute, join, normalize, posix, win32 } from "node:path";
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
  if (!relOrAbs || relOrAbs.includes("\0")) throw new Error("Empty or invalid path");
  const windowsAbsolute = /^[A-Za-z]:[\\/]|^[\\/]{2}/.test(relOrAbs);
  if (process.platform !== "win32" && (windowsAbsolute || relOrAbs.includes("\\"))) {
    throw new Error("Windows path cannot be resolved on this host");
  }
  if (process.platform === "win32" && (/^[\\/]/.test(relOrAbs) && !windowsAbsolute || /^[A-Za-z]:(?![\\/])/.test(relOrAbs))) {
    throw new Error("Drive-relative or root-relative path has ambiguous identity");
  }
  if ((windowsAbsolute || relOrAbs.startsWith("/")) && !comparablePath(relOrAbs)) {
    throw new Error("Unsupported absolute path syntax");
  }
  const resolved = isAbsolute(relOrAbs) ? normalize(relOrAbs) : resolveFromRoot(relOrAbs);
  if (!comparablePath(resolved)) throw new Error("Unsupported resolved path syntax");
  return resolved;
}

export function validatePathExists(relOrAbs: string, label: string): PathValidation {
  try {
    const resolved = resolveWorkspacePath(relOrAbs);
    const real = realpathSync(resolved);
    if (!comparablePath(real)) throw new Error("Unsupported canonical path syntax");
    return { ok: true, resolved, real };
  } catch (error) {
    return { ok: false, error: `${label} identity unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Resolve a future output directory through its nearest existing ancestor.
 * lstat distinguishes a missing component from a dangling link; canonical lookup
 * and all errors except ENOENT must refuse rather than fall back to spelling.
 */
function validateOutputDirectory(path: string): PathValidation {
  try {
    const resolved = resolveWorkspacePath(path);
    let ancestor = resolved;
    const missing: string[] = [];
    while (true) {
      try {
        lstatSync(ancestor);
        break;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        missing.unshift(basename(ancestor));
        ancestor = parent;
      }
    }
    const canonical = realpathSync(ancestor);
    if (!statSync(canonical).isDirectory()) throw new Error("Evidence ancestor must be a directory");
    const real = join(canonical, ...missing);
    if (!comparablePath(real)) throw new Error("Unsupported evidence path syntax");
    return { ok: true, resolved, real };
  } catch (error) {
    return { ok: false, error: `Evidence identity unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Pure syntax handling: foreign Windows paths never depend on the host's path.sep. */
function comparablePath(path: string): { kind: "windows" | "posix"; value: string; separator: string } | undefined {
  if (!path || [...path].some((character) => character.charCodeAt(0) < 32)) return undefined;
  if (/^[A-Za-z]:[\\/]|^[\\/]{2}/.test(path)) {
    // Device namespaces, ADS, trailing dots/spaces and incomplete UNC roots can
    // address identities that ordinary lexical normalization does not establish.
    const slash = path.replaceAll("\\", "/");
    if (slash.startsWith("//?/") || slash.startsWith("//./")) return undefined;
    const drive = /^[A-Za-z]:\//.test(slash);
    const components = (drive ? slash.slice(3) : slash.slice(2)).split("/");
    if (!drive && (components.length < 2 || !components[0] || !components[1] || components.slice(0, 2).some((c) => c === "." || c === ".."))) return undefined;
    if (components.some((c) => /[:<>"|?*]/.test(c) || c !== "." && c !== ".." && /[. ]$/.test(c))) return undefined;
    return { kind: "windows", value: win32.normalize(path).replace(/[\\/]+$/, "").toLowerCase(), separator: "\\" };
  }
  if (!path.startsWith("/") || path.includes("\\")) return undefined;
  return { kind: "posix", value: posix.normalize(path).replace(/\/+$/, ""), separator: "/" };
}

export function pathsAliasSameTree(a: string, b: string): boolean {
  const na = comparablePath(a);
  const nb = comparablePath(b);
  // Unknown or mixed identities cannot certify isolation. true means refuse.
  if (!na || !nb || na.kind !== nb.kind) return true;
  return na.value === nb.value || na.value.startsWith(nb.value + na.separator) || nb.value.startsWith(na.value + na.separator);
}

/** Portable isolation policy is stricter than POSIX lexical identity. */
export function pathsCollideForIsolation(a: string, b: string): boolean {
  return pathsAliasSameTree(a, b) || pathsAliasSameTree(a.toLowerCase(), b.toLowerCase());
}

/** Walk a path and its ancestors; missing components are skipped, other errors refuse. */
function ancestorSharesIdentity(path: string, protectedIds: Set<string>): boolean {
  let current = path;
  while (true) {
    try {
      const stats = statSync(current, { bigint: true });
      if (protectedIds.has(`${stats.dev}:${stats.ino}`)) return true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function assertIsolatedNotOriginal(args: {
  isolatedWorldLab: string;
  isolatedSqlite: string;
}): { ok: true } | { ok: false; error: string } {
  const checked = checkIsolationPaths(args);
  return checked.ok ? { ok: true } : checked;
}

function checkIsolationPaths(args: {
  isolatedWorldLab: string;
  isolatedSqlite: string;
  evidenceDir?: string;
}): { ok: true; worldLabDir: string; sqlitePath: string; evidenceDir?: string } | { ok: false; error: string } {
  const originalWl = validatePathExists(ORIGINAL_WORLD_LAB_DIR, "original world-lab");
  const originalDb = validatePathExists(ORIGINAL_WORLD_LAB_SQLITE, "original sqlite");
  if (!originalWl.ok) return originalWl;
  if (!originalDb.ok) return originalDb;
  const originalData = validatePathExists(dirname(originalDb.resolved), "original data directory");
  const originalDbDirectory = validatePathExists(dirname(originalDb.real), "original database directory");
  if (!originalData.ok) return originalData;
  if (!originalDbDirectory.ok) return originalDbDirectory;

  const isoWl = validatePathExists(args.isolatedWorldLab, "isolated world-lab");
  const isoDb = validatePathExists(args.isolatedSqlite, "isolated sqlite");
  if (!isoWl.ok) return isoWl;
  if (!isoDb.ok) return isoDb;
  const evidence = args.evidenceDir === undefined ? undefined : validateOutputDirectory(args.evidenceDir);
  if (evidence && !evidence.ok) return evidence;

  try {
    for (const world of [originalWl, isoWl]) {
      if (!statSync(world.real).isDirectory()) throw new Error("World-lab must be a directory");
    }
    for (const db of [originalDb, isoDb]) {
      if (!statSync(db.real).isFile()) throw new Error("SQLite target must be a regular file");
    }
    for (const isolated of [isoWl, isoDb]) {
      for (const original of [originalWl, originalDb, originalData, originalDbDirectory]) {
        if (pathsCollideForIsolation(isolated.real, original.real)) {
          return { ok: false, error: `Isolated path aliases original: ${isolated.resolved}` };
        }
        const a = statSync(isolated.real, { bigint: true });
        const b = statSync(original.real, { bigint: true });
        if (a.dev === b.dev && a.ino === b.ino) {
          return { ok: false, error: `Isolated path shares original filesystem identity: ${isolated.resolved}` };
        }
      }
    }
    if (evidence?.ok && [originalWl, originalDb, originalData, originalDbDirectory].some((original) => pathsCollideForIsolation(evidence.real, original.real))) {
      return { ok: false, error: "Evidence path aliases original" };
    }
    // Spelling cannot prove containment on case-insensitive filesystems (a DATA alias
    // keeps its own case through realpath), so also compare device/inode identity of
    // every existing ancestor against the protected originals.
    const protectedIds = new Set([originalWl, originalDb, originalData, originalDbDirectory].map((original) => {
      const stats = statSync(original.real, { bigint: true });
      return `${stats.dev}:${stats.ino}`;
    }));
    for (const target of [isoWl.real, isoDb.real, evidence?.real]) {
      if (target !== undefined && ancestorSharesIdentity(target, protectedIds)) {
        return { ok: false, error: `Isolated path is inside an original filesystem tree: ${target}` };
      }
    }
    inspectIsolationFiles(isoWl.real, isoDb.real, evidence?.real);
  } catch (error) {
    return { ok: false, error: `Isolation identity unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, worldLabDir: isoWl.real, sqlitePath: isoDb.real, evidenceDir: evidence?.real };
}

const SQLITE_SIDECARS = ["-wal", "-shm", "-journal"] as const;

function identity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.nlink, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
}

/** Inspect only the disposable tree. Never follow descendant links or scan originals. */
function inspectIsolationFiles(world: string, database: string, evidence?: string): Map<string, string> {
  const manifest = new Map<string, string>();
  let entries = 0;
  const visit = (path: string, depth = 0): void => {
    if (++entries > 50_000 || depth > 64) throw new Error("Isolation scan limit exceeded");
    const stats = lstatSync(path, { bigint: true });
    if (stats.isSymbolicLink()) throw new Error(`Isolation contains a link: ${path}`);
    if (!stats.isFile() && !stats.isDirectory()) throw new Error(`Unsupported isolation entry: ${path}`);
    if (stats.isFile() && stats.nlink !== 1n) throw new Error(`Isolation file has shared or unknown link identity: ${path}`);
    manifest.set(path, identity(stats));
    if (stats.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name), depth + 1);
    }
  };
  visit(world);
  visit(database);
  for (const suffix of SQLITE_SIDECARS) {
    const path = database + suffix;
    try {
      const stats = lstatSync(path, { bigint: true });
      if (!stats.isFile()) throw new Error(`SQLite sidecar must be an unlinked regular file: ${path}`);
      visit(path);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      manifest.set(path, "missing");
    }
  }
  if (evidence) {
    // Capture existing ancestors too: replacing one after preflight invalidates handoff.
    let ancestor = evidence;
    while (true) {
      try {
        const stats = lstatSync(ancestor, { bigint: true });
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Evidence ancestor changed identity");
        manifest.set(ancestor, identity(stats));
        if (ancestor === evidence) visit(evidence);
        break;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        manifest.set(ancestor, "missing");
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
  }
  return manifest;
}

function captureConstructionManifest(gate: AllowedConstructionGate): Map<string, string> {
  const manifest = inspectIsolationFiles(gate.worldLabDir, gate.sqlitePath, gate.evidenceDir);
  for (const path of [ORIGINAL_WORLD_LAB_DIR, ORIGINAL_WORLD_LAB_SQLITE]) {
    const protectedPath = validatePathExists(path, "protected target");
    if (!protectedPath.ok) throw new Error(protectedPath.error);
    manifest.set(`protected:${protectedPath.resolved}`, `${protectedPath.real}:${identity(lstatSync(protectedPath.resolved, { bigint: true }))}:${identity(statSync(protectedPath.real, { bigint: true }))}`);
    if (path === ORIGINAL_WORLD_LAB_SQLITE) {
      for (const suffix of SQLITE_SIDECARS) {
        const sidecar = protectedPath.real + suffix;
        try {
          manifest.set(`protected:${sidecar}`, identity(lstatSync(sidecar, { bigint: true })));
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
          manifest.set(`protected:${sidecar}`, "missing");
        }
      }
    }
  }
  return manifest;
}

type AllowedConstructionGate = Extract<ConstructionLiveGate, { allowed: true }>;
const handoffs = new WeakMap<AllowedConstructionGate, Map<string, string>>();

/** Single-use, read-only descriptor handoff for offline verification. Consumers must
 * use this descriptor, not reopen its pathname. This is not a SQLite connection:
 * better-sqlite3 opens by name and needs its own launch integration/security review.
 */
export function openVerifiedConstructionDatabaseFile(gate: AllowedConstructionGate):
  | { ok: true; fd: number; close: () => void }
  | { ok: false; error: string } {
  const expected = handoffs.get(gate);
  handoffs.delete(gate);
  if (!expected) return { ok: false, error: "Unknown or consumed construction handoff" };
  let fd: number | undefined;
  try {
    const current = captureConstructionManifest(gate);
    if (current.size !== expected.size || [...expected].some(([path, value]) => current.get(path) !== value)) {
      throw new Error("Filesystem changed after construction preflight");
    }
    fd = openSync(gate.sqlitePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (identity(fstatSync(fd, { bigint: true })) !== expected.get(gate.sqlitePath)) {
      throw new Error("Database identity changed while opening");
    }
    // A second manifest check detects sidecar/tree swaps during the open syscall.
    const after = captureConstructionManifest(gate);
    if (after.size !== expected.size || [...expected].some(([path, value]) => after.get(path) !== value)) {
      throw new Error("Filesystem changed during construction handoff");
    }
    const verifiedFd = fd;
    let closed = false;
    return { ok: true, fd: verifiedFd, close: () => { if (!closed) { closed = true; closeSync(verifiedFd); } } };
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    return { ok: false, error: `Construction handoff refused: ${error instanceof Error ? error.message : String(error)}` };
  }
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
      host: string;
      paperPort: number;
      rconPort: number;
      worldLabDir: string;
      sqlitePath: string;
      evidenceDir: string;
      pad: Vec3;
    }
  | { allowed: false; error: string };

function isLoopbackLiteral(host: string): boolean {
  const version = isIP(host);
  if (version === 4) return host.startsWith("127.");
  if (version !== 6) return false;
  try { return new URL(`http://[${host}]/`).hostname === "[::1]"; }
  catch { return false; } // Scoped/unsupported IPv6 syntax cannot establish this endpoint.
}

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

  const host = env.MINECRAFT_HOST ?? "127.0.0.1";
  if (!isLoopbackLiteral(host)) return { allowed: false, error: "MINECRAFT_HOST must be a loopback IP literal" };

  const paperText = env.MINECRAFT_PORT ?? String(ISOLATED_PAPER_PORT);
  const rconText = env.CONSTRUCTION_EXPERIMENT_RCON_PORT ?? String(ISOLATED_RCON_PORT);
  if (![paperText, rconText].every((port) => /^[0-9]+$/.test(port))) {
    return { allowed: false, error: "Paper and RCON ports must use decimal digits only" };
  }
  const paperPort = Number(paperText);
  const rconPort = Number(rconText);
  if (![paperPort, rconPort].every((port) => Number.isInteger(port) && port >= 1 && port <= 65535)) {
    return { allowed: false, error: "Paper and RCON ports must be integers from 1 to 65535" };
  }
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

  if (paperPort === rconPort) return { allowed: false, error: "Paper and RCON ports must be distinct" };
  const protectedPorts = new Set([ORIGINAL_PAPER_PORT, LIVE_CIVILIZATION_PORT, ORIGINAL_RCON_PORT, 25575]);
  if (protectedPorts.has(paperPort) || protectedPorts.has(rconPort)) {
    return { allowed: false, error: "Paper and RCON must both avoid protected service ports" };
  }

  const worldLabDir = env.CONSTRUCTION_EXPERIMENT_WORLD_LAB ?? ISOLATED_WORLD_LAB_REL;
  const sqlitePath = env.DATABASE_PATH ?? ISOLATED_SQLITE_REL;
  const evidenceDir = env.CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR ?? ISOLATED_EVIDENCE_REL;

  const isolation = checkIsolationPaths({ isolatedWorldLab: worldLabDir, isolatedSqlite: sqlitePath, evidenceDir });
  if (!isolation.ok) return { allowed: false, error: isolation.error };
  if (!isolation.evidenceDir) return { allowed: false, error: "Evidence identity unavailable" };

  const pad = PROPOSED_CONSTRUCTION_PAD;
  const safe = padSafeFromSettlementHomes(pad);
  if (!safe.ok) {
    return {
      allowed: false,
      error: `Proposed pad too close to ${safe.nearestHomeId} (distance ${safe.distance?.toFixed(1)})`,
    };
  }

  const gate: AllowedConstructionGate = {
    allowed: true,
    host,
    paperPort,
    rconPort,
    worldLabDir: isolation.worldLabDir,
    sqlitePath: isolation.sqlitePath,
    evidenceDir: isolation.evidenceDir,
    pad,
  };
  try {
    const manifest = captureConstructionManifest(gate);
    handoffs.set(gate, manifest);
    return Object.freeze(gate);
  } catch (error) {
    return { allowed: false, error: `Cannot capture construction handoff: ${error instanceof Error ? error.message : String(error)}` };
  }
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
