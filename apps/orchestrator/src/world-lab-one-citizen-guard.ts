import { basename } from "node:path";
import {
  DEFAULT_CITIZENS,
  isMechanicsProbeUsername,
  loadConfig,
  resolveFromRoot,
  type AppConfig,
  type Vec3,
} from "@civ/shared";
import { HOME_CLAIM_REACH_BLOCKS, WORLD_LAB_CLAIMABLE_HOMES } from "@civ/agent-core";
import {
  LIVE_CIVILIZATION_PORT,
  MINDCRAFT_BODY_TEST_PORT,
  RED_WORLD_LAB_PORT,
} from "./mine-test-guard.js";

export const WORLD_LAB_HOST = "127.0.0.1";
export const WORLD_LAB_RCON_PORT = 25577;
export const WORLD_LAB_DATABASE_RELATIVE = "./data/world-lab-civilization.sqlite";
export const LIVE_CIVILIZATION_DATABASE_RELATIVE = "./data/civilization.sqlite";
export const WORLD_LAB_WORLD_SPAWN = { x: -1017, y: 62, z: 831 };
/** Street cell east of H9 entrance. Operator-approved teleport only; never a silent TEST_CONTROL inject. */
export const PROPOSED_H9_STREET_STAND = { x: -1061, y: 68, z: 847 };
export const EXPECTED_ONE_CITIZEN = { name: "Atlas", id: "citizen_atlas" } as const;

/** Keys this entrypoint pins AFTER dotenv so live-civ `.env` cannot retarget the body. */
export const WORLD_LAB_ONE_CITIZEN_ENV: Record<string, string> = {
  MINECRAFT_HOST: WORLD_LAB_HOST,
  MINECRAFT_PORT: String(RED_WORLD_LAB_PORT),
  DATABASE_PATH: WORLD_LAB_DATABASE_RELATIVE,
  SIM_CITIZEN_COUNT: "1",
  AUTO_START_PAPER: "false",
  SIM_ASSIGN_WORK_ROLES: "false",
  MECHANICS_PROBE_ENABLED: "false",
};

export const READ_ONLY_WORLD_LAB_RCON = ["time query daytime", "time query gametime", "list", "seed"] as const;

export type RosterIdentity = (typeof DEFAULT_CITIZENS)[number];

export type WorldLabOneCitizenLaunch =
  | {
      allowed: true;
      config: AppConfig;
      citizen: RosterIdentity;
      activeBodies: RosterIdentity[];
      offlineRoster: RosterIdentity[];
      databasePath: string;
      rconPort: number;
    }
  | { allowed: false; error: string };

/**
 * Matches dotenv's default `populate()`: existing process.env keys are NOT overwritten.
 * `loadEnv()` calls `dotenv.config({ path })` with no `override: true`, so a shell prefix
 * wins over `.env`, and `pnpm sim:start` with no prefix uses `.env` as-is.
 */
export function mergeDotenvWithoutOverride(
  processEnv: NodeJS.ProcessEnv,
  fileEnv: Record<string, string>,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...processEnv };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (Object.prototype.hasOwnProperty.call(next, key)) continue;
    next[key] = value;
  }
  return next;
}

export function applyWorldLabOneCitizenEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...env, ...WORLD_LAB_ONE_CITIZEN_ENV };
}

export function pinWorldLabOneCitizenProcessEnv(env: NodeJS.ProcessEnv = process.env): void {
  Object.assign(env, WORLD_LAB_ONE_CITIZEN_ENV);
}

export function selectActiveRosterCitizens(count: number): RosterIdentity[] {
  const n = Math.max(0, Math.floor(count));
  return DEFAULT_CITIZENS.slice(0, n).filter((identity) => !isMechanicsProbeUsername(identity.name));
}

export function isWorldLabDatabasePath(resolved: string): boolean {
  return normalizeFsPath(resolved).endsWith("/data/world-lab-civilization.sqlite");
}

export function isLiveCivilizationDatabasePath(resolved: string): boolean {
  const norm = normalizeFsPath(resolved);
  return norm.endsWith("/data/civilization.sqlite") && !norm.endsWith("/data/world-lab-civilization.sqlite");
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function catalogClaimDistances(from: Vec3): Array<{
  id: string;
  origin: Vec3;
  distance: number;
  inClaimReach: boolean;
}> {
  return WORLD_LAB_CLAIMABLE_HOMES.map((home) => {
    const distance = distance3(from, home.origin);
    return {
      id: home.id,
      origin: home.origin,
      distance,
      inClaimReach: distance <= HOME_CLAIM_REACH_BLOCKS,
    };
  }).sort((a, b) => a.distance - b.distance);
}

export function evaluateWorldLabOneCitizenLaunch(env: NodeJS.ProcessEnv = process.env): WorldLabOneCitizenLaunch {
  let config: AppConfig;
  try {
    config = loadConfig(env);
  } catch (error) {
    return { allowed: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (config.MINECRAFT_HOST !== WORLD_LAB_HOST) {
    return { allowed: false, error: `Refusing host ${config.MINECRAFT_HOST}; WORLD-LAB one-citizen must use ${WORLD_LAB_HOST}` };
  }
  if (config.MINECRAFT_PORT === LIVE_CIVILIZATION_PORT) {
    return { allowed: false, error: "Refusing original civilization port 25565" };
  }
  if (config.MINECRAFT_PORT === MINDCRAFT_BODY_TEST_PORT) {
    return { allowed: false, error: "Refusing Mindcraft body-test port 25566" };
  }
  if (config.MINECRAFT_PORT !== RED_WORLD_LAB_PORT) {
    return {
      allowed: false,
      error: `Refusing Minecraft port ${config.MINECRAFT_PORT}; WORLD-LAB one-citizen must use ${RED_WORLD_LAB_PORT}`,
    };
  }
  if (config.AUTO_START_PAPER) {
    return {
      allowed: false,
      error: "AUTO_START_PAPER is true; refusing because ensurePaper would spawn server/paper.jar (live-civ jar) if 25567 were closed",
    };
  }
  if (config.SIM_ASSIGN_WORK_ROLES) {
    return { allowed: false, error: "SIM_ASSIGN_WORK_ROLES is true; refusing permanent work-role assignment" };
  }
  if (config.MECHANICS_PROBE_ENABLED) {
    return { allowed: false, error: "MECHANICS_PROBE_ENABLED is true; refusing extra probe body" };
  }
  if (config.SIM_CITIZEN_COUNT !== 1) {
    return {
      allowed: false,
      error: `SIM_CITIZEN_COUNT=${config.SIM_CITIZEN_COUNT}; WORLD-LAB one-citizen requires exactly 1 active roster body`,
    };
  }

  const databasePath = resolveFromRoot(config.DATABASE_PATH);
  if (isLiveCivilizationDatabasePath(databasePath) || basename(databasePath) === "civilization.sqlite") {
    return { allowed: false, error: `Refusing live-civ database ${databasePath}` };
  }
  if (!isWorldLabDatabasePath(databasePath)) {
    return {
      allowed: false,
      error: `DATABASE_PATH resolved to ${databasePath}; required ${resolveFromRoot(WORLD_LAB_DATABASE_RELATIVE)}`,
    };
  }

  const activeBodies = selectActiveRosterCitizens(config.SIM_CITIZEN_COUNT);
  if (activeBodies.length !== 1) {
    return { allowed: false, error: `Roster slice produced ${activeBodies.length} bodies; expected exactly 1` };
  }
  const citizen = activeBodies[0];
  const rosterHead = DEFAULT_CITIZENS[0];
  if (
    !citizen ||
    !rosterHead ||
    citizen.id !== EXPECTED_ONE_CITIZEN.id ||
    citizen.name !== EXPECTED_ONE_CITIZEN.name ||
    rosterHead.id !== EXPECTED_ONE_CITIZEN.id ||
    rosterHead.name !== EXPECTED_ONE_CITIZEN.name
  ) {
    return {
      allowed: false,
      error: `SIM_CITIZEN_COUNT=1 selects DEFAULT_CITIZENS[0] (${citizen?.name ?? "none"} / ${citizen?.id ?? "none"}); expected Atlas / citizen_atlas`,
    };
  }

  return {
    allowed: true,
    config,
    citizen,
    activeBodies,
    offlineRoster: DEFAULT_CITIZENS.filter((row) => row.id !== citizen.id),
    databasePath,
    rconPort: WORLD_LAB_RCON_PORT,
  };
}

function normalizeFsPath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}
