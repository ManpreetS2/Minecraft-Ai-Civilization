import {
  FARM_PAD,
  HOME_H1,
  LIVE_CIVILIZATION_PORT,
  MINDCRAFT_BODY_TEST_PORT,
  RED_WORLD_LAB_PORT,
  SITE_C,
  type Cell,
} from "./mine-test-guard.js";

/** GREEN live coal pocket. Do not reuse as a fishing origin or chest. */
export const MINE_LIVE_POCKET = { x: -953, z: 945 };
export const MINE_LIVE_CHEST = { x: -954, y: 58, z: 944 };
export const TANNERY_CHEST = { x: -1038, y: 65, z: 839 };
export const H1_PERSONAL_CHEST = { x: -1096, y: 69, z: 729 };

export type FishTestTarget =
  | {
      allowed: true;
      host: string;
      port: number;
      version: string;
      rconPort: number;
    }
  | { allowed: false; error: string };

export type ApprovedFishArea = {
  origin: Cell;
  radius: number;
  chest: Cell;
  casts: number;
  timeoutMs: number;
  home?: Cell;
  returnHome: boolean;
  verifyCancel: boolean;
};

function parseCell(raw: string | undefined, label: string): Cell | { error: string } {
  const parts = raw?.split(",").map((part) => Number(part.trim()));
  if (!parts || parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { error: `${label}=x,y,z is required. Do not invent a fishing shore.` };
  }
  return { x: Math.floor(parts[0] ?? 0), y: Math.floor(parts[1] ?? 0), z: Math.floor(parts[2] ?? 0) };
}

function xzDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function evaluateFishTestLaunch(env: NodeJS.ProcessEnv = process.env): FishTestTarget {
  if (env.MECHANICS_FISH_TEST_ENABLED !== "true") {
    return {
      allowed: false,
      error:
        "MECHANICS_FISH_TEST_ENABLED is not true. FishProbe harness is prepared only; this is not a live fishing PASS. Wait for RED shore, BLUE idle, and user approval.",
    };
  }
  if (env.FISH_TEST_ALLOW_WORLD_MUTATION !== "true") {
    return { allowed: false, error: "FISH_TEST_ALLOW_WORLD_MUTATION is not true. Refusing to connect or fish." };
  }
  if (env.FISH_TEST_RED_APPROVED !== "true") {
    return {
      allowed: false,
      error: "FISH_TEST_RED_APPROVED is not true. RED must approve a shore away from Site C, the farm pad, H1, and the coal pocket.",
    };
  }
  if (env.FISH_TEST_BLUE_IDLE !== "true") {
    return {
      allowed: false,
      error: "FISH_TEST_BLUE_IDLE is not true. Wait until BLUE releases exclusive WORLD-LAB access.",
    };
  }
  if (env.FISH_TEST_USER_APPROVED !== "true") {
    return { allowed: false, error: "FISH_TEST_USER_APPROVED is not true. The bounded fishing area must be approved." };
  }
  if (
    env.MECHANICS_HOME_TEST_ENABLED === "true" ||
    env.MECHANICS_FARM_TEST_ENABLED === "true" ||
    env.MECHANICS_MINE_TEST_ENABLED === "true" ||
    env.MECHANICS_TWO_PROBE_TEST_ENABLED === "true"
  ) {
    return { allowed: false, error: "Refusing fish test while another live harness is enabled." };
  }

  const port = Number(env.FISH_TEST_PORT ?? String(RED_WORLD_LAB_PORT));
  if (!Number.isInteger(port) || port <= 0) {
    return { allowed: false, error: `Invalid FISH_TEST_PORT=${env.FISH_TEST_PORT ?? ""}` };
  }
  if (port === LIVE_CIVILIZATION_PORT) {
    return { allowed: false, error: "Refusing fish test on live civilization port 25565" };
  }
  if (port === MINDCRAFT_BODY_TEST_PORT) {
    return { allowed: false, error: "Refusing fish test on Mindcraft body-test port 25566" };
  }
  if (port !== RED_WORLD_LAB_PORT) {
    return { allowed: false, error: `Fish test only allowed on isolated world-lab port ${RED_WORLD_LAB_PORT}` };
  }

  const version = env.FISH_TEST_VERSION ?? "1.21.11";
  if (version !== "1.21.11") {
    return { allowed: false, error: `Fish test requires Paper 1.21.11, got ${version}` };
  }

  const rconPort = Number(env.FISH_TEST_RCON_PORT ?? "25577");
  if (!Number.isInteger(rconPort) || rconPort <= 0) {
    return { allowed: false, error: `Invalid FISH_TEST_RCON_PORT=${env.FISH_TEST_RCON_PORT ?? ""}` };
  }
  if (rconPort === 25575) {
    return { allowed: false, error: "Refusing world-lab fish test against live RCON 25575. Use world-lab RCON (25577)." };
  }

  return {
    allowed: true,
    host: env.FISH_TEST_HOST ?? "127.0.0.1",
    port,
    version,
    rconPort,
  };
}

export function parseApprovedFishArea(env: NodeJS.ProcessEnv = process.env): ApprovedFishArea | { error: string } {
  const origin = parseCell(env.FISH_TEST_ORIGIN, "FISH_TEST_ORIGIN");
  if ("error" in origin) return origin;
  const chest = parseCell(env.FISH_TEST_CHEST, "FISH_TEST_CHEST");
  if ("error" in chest) return chest;
  const radius = Number(env.FISH_TEST_RADIUS ?? "8");
  if (!Number.isInteger(radius) || radius < 1 || radius > 16) {
    return { error: "FISH_TEST_RADIUS must be an integer 1–16" };
  }
  const casts = Number(env.FISH_TEST_CASTS ?? "1");
  if (!Number.isInteger(casts) || casts < 1 || casts > 4) {
    return { error: "FISH_TEST_CASTS must be an integer 1–4" };
  }
  const timeoutMs = Number(env.FISH_TEST_TIMEOUT_MS ?? "60000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 90_000) {
    return { error: "FISH_TEST_TIMEOUT_MS must be an integer 5000–90000" };
  }

  if (xzDist(origin, SITE_C) < 64) {
    return { error: "Refusing fishing shore inside Site C preserve around -1032,888" };
  }
  if (xzDist(origin, FARM_PAD) < 32) {
    return { error: "Refusing fishing shore overlapping BLUE farm pad around 20,240" };
  }
  if (xzDist(origin, HOME_H1) < 48) {
    return { error: "Refusing fishing shore overlapping HomeProbe H1 around -1097,728" };
  }
  if (xzDist(origin, MINE_LIVE_POCKET) < 24) {
    return { error: "Refusing fishing shore overlapping the GREEN coal pocket around -953,945" };
  }
  if (xzDist(chest, SITE_C) < 64) {
    return { error: "Refusing fishing chest inside Site C" };
  }
  if (sameCell(chest, MINE_LIVE_CHEST)) {
    return { error: "Refusing the GREEN mining test chest at -954,58,944" };
  }
  if (sameCell(chest, TANNERY_CHEST) || sameCell(chest, H1_PERSONAL_CHEST)) {
    return { error: "Refusing tannery or H1 personal chest as FishProbe storage" };
  }

  const returnHome = env.FISH_TEST_RETURN_HOME === "true";
  let home: Cell | undefined;
  if (env.FISH_TEST_HOME) {
    const parsed = parseCell(env.FISH_TEST_HOME, "FISH_TEST_HOME");
    if ("error" in parsed) return parsed;
    home = parsed;
  }
  if (returnHome && !home) {
    return { error: "FISH_TEST_RETURN_HOME=true requires FISH_TEST_HOME=x,y,z. Do not invent a bed." };
  }

  return {
    origin,
    radius,
    chest,
    casts,
    timeoutMs,
    home,
    returnHome,
    verifyCancel: env.FISH_TEST_VERIFY_CANCEL !== "false",
  };
}
