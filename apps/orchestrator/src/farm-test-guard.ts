export const LIVE_CIVILIZATION_PORT = 25565;
export const MINDCRAFT_BODY_TEST_PORT = 25566;
export const RED_WORLD_LAB_PORT = 25567;

export type FarmTestTarget =
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

export function evaluateFarmTestLaunch(env: NodeJS.ProcessEnv = process.env): FarmTestTarget {
  if (env.MECHANICS_FARM_TEST_ENABLED !== "true") {
    return {
      allowed: false,
      error:
        "MECHANICS_FARM_TEST_ENABLED is not true. Farm harness is prepared only; this is not a live PASS. Do not run against 25565 or 25566.",
    };
  }
  if (env.FARM_TEST_ALLOW_WORLD_MUTATION !== "true") {
    return {
      allowed: false,
      error:
        "FARM_TEST_ALLOW_WORLD_MUTATION is not true. Refusing to connect or place a farm pad. Isolated Paper 1.21.11 (world-lab :25567) must be idle and explicitly allowed.",
    };
  }

  const port = Number(env.FARM_TEST_PORT ?? String(RED_WORLD_LAB_PORT));
  if (!Number.isInteger(port) || port <= 0) {
    return { allowed: false, error: `Invalid FARM_TEST_PORT=${env.FARM_TEST_PORT ?? ""}` };
  }
  if (port === LIVE_CIVILIZATION_PORT) {
    return { allowed: false, error: "Refusing farm test on live civilization port 25565" };
  }
  if (port === MINDCRAFT_BODY_TEST_PORT) {
    return { allowed: false, error: "Refusing farm test on Mindcraft 1.21.4 port 25566" };
  }

  const version = env.FARM_TEST_VERSION ?? "1.21.11";
  if (version !== "1.21.11") {
    return { allowed: false, error: `Farm test requires Paper 1.21.11, got ${version}` };
  }

  const rconPort = Number(env.FARM_TEST_RCON_PORT ?? "25577");
  if (!Number.isInteger(rconPort) || rconPort <= 0) {
    return { allowed: false, error: `Invalid FARM_TEST_RCON_PORT=${env.FARM_TEST_RCON_PORT ?? ""}` };
  }
  if (rconPort === 25575 && port !== LIVE_CIVILIZATION_PORT) {
    return {
      allowed: false,
      error: "Refusing world-lab farm test against live RCON 25575. Use world-lab RCON (25577).",
    };
  }

  return {
    allowed: true,
    host: env.FARM_TEST_HOST ?? "127.0.0.1",
    port,
    version,
    rconPort,
  };
}
