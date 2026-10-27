export const LIVE_CIVILIZATION_PORT = 25565;
export const MINDCRAFT_BODY_TEST_PORT = 25566;
export const RED_WORLD_LAB_PORT = 25567;

export type HomeTestTarget =
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

function parseCell(raw: string | undefined, label: string): { x: number; y: number; z: number } | { error: string } {
  const parts = raw?.split(",").map((part) => Number(part.trim()));
  if (!parts || parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { error: `${label}=x,y,z is required. Do not invent house, bed, or chest coordinates.` };
  }
  return { x: Math.floor(parts[0] ?? 0), y: Math.floor(parts[1] ?? 0), z: Math.floor(parts[2] ?? 0) };
}

export function evaluateHomeTestLaunch(env: NodeJS.ProcessEnv = process.env): HomeTestTarget {
  if (env.MECHANICS_HOME_TEST_ENABLED !== "true") {
    return {
      allowed: false,
      error:
        "MECHANICS_HOME_TEST_ENABLED is not true. Home harness is prepared only; this is not a live PASS. Coordinate exclusive WORLD-LAB access with RED first.",
    };
  }
  if (env.HOME_TEST_ALLOW_WORLD_MUTATION !== "true") {
    return {
      allowed: false,
      error: "HOME_TEST_ALLOW_WORLD_MUTATION is not true. Refusing to connect or mutate Site C houses.",
    };
  }
  if (env.HOME_TEST_RED_APPROVED !== "true") {
    return {
      allowed: false,
      error:
        "HOME_TEST_RED_APPROVED is not true. RED must confirm chests are installed and grant exclusive WORLD-LAB access. Do not invent chest coordinates.",
    };
  }

  const port = Number(env.HOME_TEST_PORT ?? String(RED_WORLD_LAB_PORT));
  if (!Number.isInteger(port) || port <= 0) {
    return { allowed: false, error: `Invalid HOME_TEST_PORT=${env.HOME_TEST_PORT ?? ""}` };
  }
  if (port === LIVE_CIVILIZATION_PORT) {
    return { allowed: false, error: "Refusing home test on live civilization port 25565" };
  }
  if (port === MINDCRAFT_BODY_TEST_PORT) {
    return { allowed: false, error: "Refusing home test on Mindcraft body-test port 25566" };
  }
  if (port !== RED_WORLD_LAB_PORT) {
    return { allowed: false, error: `Home test only allowed on isolated world-lab port ${RED_WORLD_LAB_PORT}` };
  }

  return {
    allowed: true,
    host: env.HOME_TEST_HOST ?? "127.0.0.1",
    port,
    version: env.HOME_TEST_VERSION ?? "1.21.11",
    rconPort: Number(env.HOME_TEST_RCON_PORT ?? "25577"),
  };
}

export type Cell = { x: number; y: number; z: number };

/** RED-proposed first probe geometry. Probe-only; not a citizen roster assignment. */
export const H1_PROBE_FIXTURES = {
  homeId: "home_h1",
  origin: { x: -1097, y: 69, z: 728 },
  entrance: { x: -1096, y: 69, z: 732 },
  bedA: { x: -1097, y: 69, z: 728 },
  chestA: { x: -1096, y: 69, z: 729 },
  distractorBed: { x: -1055, y: 65, z: 779 },
  communalChest: { x: -1038, y: 65, z: 839 },
  communalStand: { x: -1037, y: 65, z: 839 },
} as const;

export type ApprovedHomeFixtures = {
  homeId: string;
  origin: Cell;
  entrance: Cell;
  bedA: Cell;
  chestA: Cell;
  distractorBed: Cell;
  communalChest: Cell;
  bedB?: Cell;
  chestB?: Cell;
};

export function parseApprovedHomeFixtures(env: NodeJS.ProcessEnv = process.env): ApprovedHomeFixtures | { error: string } {
  if (env.HOME_TEST_PROFILE === "H1_PROBE") {
    return {
      homeId: env.HOME_TEST_HOME_ID?.trim() || H1_PROBE_FIXTURES.homeId,
      origin: H1_PROBE_FIXTURES.origin,
      entrance: H1_PROBE_FIXTURES.entrance,
      bedA: H1_PROBE_FIXTURES.bedA,
      chestA: H1_PROBE_FIXTURES.chestA,
      distractorBed: H1_PROBE_FIXTURES.distractorBed,
      communalChest: H1_PROBE_FIXTURES.communalChest,
    };
  }
  const homeId = env.HOME_TEST_HOME_ID?.trim();
  if (!homeId) return { error: "HOME_TEST_HOME_ID or HOME_TEST_PROFILE=H1_PROBE is required (not Atlas=House1)." };
  const origin = parseCell(env.HOME_TEST_ORIGIN, "HOME_TEST_ORIGIN");
  if ("error" in origin) return origin;
  const entrance = parseCell(env.HOME_TEST_ENTRANCE, "HOME_TEST_ENTRANCE");
  if ("error" in entrance) return entrance;
  const bedA = parseCell(env.HOME_TEST_BED_A, "HOME_TEST_BED_A");
  if ("error" in bedA) return bedA;
  const chestA = parseCell(env.HOME_TEST_CHEST_A, "HOME_TEST_CHEST_A");
  if ("error" in chestA) return chestA;
  const distractorBed = parseCell(env.HOME_TEST_DISTRACTOR_BED, "HOME_TEST_DISTRACTOR_BED");
  if ("error" in distractorBed) return distractorBed;
  const communalChest = parseCell(env.HOME_TEST_COMMUNAL_CHEST, "HOME_TEST_COMMUNAL_CHEST");
  if ("error" in communalChest) return communalChest;
  const bedB = env.HOME_TEST_BED_B ? parseCell(env.HOME_TEST_BED_B, "HOME_TEST_BED_B") : undefined;
  if (bedB && "error" in bedB) return bedB;
  const chestB = env.HOME_TEST_CHEST_B ? parseCell(env.HOME_TEST_CHEST_B, "HOME_TEST_CHEST_B") : undefined;
  if (chestB && "error" in chestB) return chestB;
  return { homeId, origin, entrance, bedA, chestA, distractorBed, communalChest, bedB, chestB };
}
