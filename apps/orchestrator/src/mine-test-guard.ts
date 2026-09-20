export const LIVE_CIVILIZATION_PORT = 25565;
export const MINDCRAFT_BODY_TEST_PORT = 25566;
export const RED_WORLD_LAB_PORT = 25567;

/** RED Site C settlement preserve. */
export const SITE_C = { x: -1032, z: 888 };
/** BLUE farm pad from RED_FARM_TEST_SITE.md. */
export const FARM_PAD = { x: 20, z: 240 };
/** BLUE HomeProbe H1. */
export const HOME_H1 = { x: -1097, z: 728 };

export type Cell = { x: number; y: number; z: number };

export type MineTestTarget =
  | {
      allowed: true;
      host: string;
      port: number;
      version: string;
      rconPort: number;
    }
  | {
      allowed: false;
      error: string;
    };

export type ApprovedMineArea = {
  origin: Cell;
  radius: number;
  chest: Cell;
  resource: "coal" | "iron";
  minY?: number;
  maxY?: number;
};

function parseCell(raw: string | undefined, label: string): Cell | { error: string } {
  const parts = raw?.split(",").map((part) => Number(part.trim()));
  if (!parts || parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { error: `${label}=x,y,z is required. Do not invent a mining site.` };
  }
  return { x: Math.floor(parts[0] ?? 0), y: Math.floor(parts[1] ?? 0), z: Math.floor(parts[2] ?? 0) };
}

function xzDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function evaluateMineTestLaunch(env: NodeJS.ProcessEnv = process.env): MineTestTarget {
  if (env.MECHANICS_MINE_TEST_ENABLED !== "true") {
    return {
      allowed: false,
      error:
        "MECHANICS_MINE_TEST_ENABLED is not true. Mine harness is prepared only; this is not a live PASS. Coordinate exclusive WORLD-LAB access with RED and BLUE first.",
    };
  }
  if (env.MINE_TEST_ALLOW_WORLD_MUTATION !== "true") {
    return { allowed: false, error: "MINE_TEST_ALLOW_WORLD_MUTATION is not true. Refusing to connect or excavate." };
  }
  if (env.MINE_TEST_RED_APPROVED !== "true") {
    return {
      allowed: false,
      error: "MINE_TEST_RED_APPROVED is not true. RED must approve a mining location away from Site C and the farm pad.",
    };
  }
  if (env.MINE_TEST_BLUE_IDLE !== "true") {
    return {
      allowed: false,
      error: "MINE_TEST_BLUE_IDLE is not true. Wait until BLUE finishes its exclusive WORLD-LAB home-test window.",
    };
  }
  if (env.MINE_TEST_USER_APPROVED !== "true") {
    return { allowed: false, error: "MINE_TEST_USER_APPROVED is not true. The bounded excavation area must be approved." };
  }
  if (env.MECHANICS_HOME_TEST_ENABLED === "true" || env.MECHANICS_FARM_TEST_ENABLED === "true" || env.MECHANICS_FISH_TEST_ENABLED === "true") {
    return { allowed: false, error: "Refusing mine test while a home, farm, or fish live harness is enabled." };
  }

  const port = Number(env.MINE_TEST_PORT ?? String(RED_WORLD_LAB_PORT));
  if (!Number.isInteger(port) || port <= 0) {
    return { allowed: false, error: `Invalid MINE_TEST_PORT=${env.MINE_TEST_PORT ?? ""}` };
  }
  if (port === LIVE_CIVILIZATION_PORT) {
    return { allowed: false, error: "Refusing mine test on live civilization port 25565" };
  }
  if (port === MINDCRAFT_BODY_TEST_PORT) {
    return { allowed: false, error: "Refusing mine test on Mindcraft body-test port 25566" };
  }
  if (port !== RED_WORLD_LAB_PORT) {
    return { allowed: false, error: `Mine test only allowed on isolated world-lab port ${RED_WORLD_LAB_PORT}` };
  }

  const version = env.MINE_TEST_VERSION ?? "1.21.11";
  if (version !== "1.21.11") {
    return { allowed: false, error: `Mine test requires Paper 1.21.11, got ${version}` };
  }

  const rconPort = Number(env.MINE_TEST_RCON_PORT ?? "25577");
  if (!Number.isInteger(rconPort) || rconPort <= 0) {
    return { allowed: false, error: `Invalid MINE_TEST_RCON_PORT=${env.MINE_TEST_RCON_PORT ?? ""}` };
  }
  if (rconPort === 25575) {
    return { allowed: false, error: "Refusing world-lab mine test against live RCON 25575. Use world-lab RCON (25577)." };
  }

  return {
    allowed: true,
    host: env.MINE_TEST_HOST ?? "127.0.0.1",
    port,
    version,
    rconPort,
  };
}

export function parseApprovedMineArea(env: NodeJS.ProcessEnv = process.env): ApprovedMineArea | { error: string } {
  const origin = parseCell(env.MINE_TEST_ORIGIN, "MINE_TEST_ORIGIN");
  if ("error" in origin) return origin;
  const chest = parseCell(env.MINE_TEST_CHEST, "MINE_TEST_CHEST");
  if ("error" in chest) return chest;
  const radius = Number(env.MINE_TEST_RADIUS ?? "16");
  if (!Number.isInteger(radius) || radius < 1 || radius > 32) {
    return { error: "MINE_TEST_RADIUS must be an integer 1–32" };
  }
  const resource = (env.MINE_TEST_RESOURCE ?? "coal").trim().toLowerCase();
  if (resource !== "coal" && resource !== "iron") {
    return { error: "MINE_TEST_RESOURCE must be coal or iron for the first live probe" };
  }
  if (xzDist(origin, SITE_C) < 64) {
    return { error: "Refusing mining area inside Site C preserve around -1032,888" };
  }
  if (xzDist(origin, FARM_PAD) < 32) {
    return { error: "Refusing mining area overlapping BLUE farm pad around 20,240" };
  }
  if (xzDist(origin, HOME_H1) < 48) {
    return { error: "Refusing mining area overlapping HomeProbe H1 around -1097,728" };
  }
  if (xzDist(chest, SITE_C) < 64) {
    return { error: "Refusing mining chest inside Site C" };
  }
  const minY = env.MINE_TEST_MIN_Y ? Number(env.MINE_TEST_MIN_Y) : undefined;
  const maxY = env.MINE_TEST_MAX_Y ? Number(env.MINE_TEST_MAX_Y) : undefined;
  if (minY !== undefined && !Number.isFinite(minY)) return { error: "Invalid MINE_TEST_MIN_Y" };
  if (maxY !== undefined && !Number.isFinite(maxY)) return { error: "Invalid MINE_TEST_MAX_Y" };
  return {
    origin,
    radius,
    chest,
    resource,
    minY: minY !== undefined ? Math.floor(minY) : undefined,
    maxY: maxY !== undefined ? Math.floor(maxY) : undefined,
  };
}
