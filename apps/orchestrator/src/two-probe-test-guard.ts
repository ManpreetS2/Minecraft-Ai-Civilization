export const LIVE_CIVILIZATION_PORT = 25565;
export const MINDCRAFT_BODY_TEST_PORT = 25566;
export const RED_WORLD_LAB_PORT = 25567;

export type TwoProbeTarget =
  | {
      allowed: true;
      host: string;
      port: number;
      version: string;
      rconPort: number;
    }
  | { allowed: false; error: string };

export function evaluateTwoProbeTestLaunch(env: NodeJS.ProcessEnv = process.env): TwoProbeTarget {
  if (env.MECHANICS_TWO_PROBE_TEST_ENABLED !== "true") {
    return {
      allowed: false,
      error:
        "MECHANICS_TWO_PROBE_TEST_ENABLED is not true. Two-bot harness is prepared only. HomeProbe and MineProbe must pass independently first. Do not start pnpm sim:start.",
    };
  }
  if (env.TWO_PROBE_ALLOW_WORLD_MUTATION !== "true") {
    return { allowed: false, error: "TWO_PROBE_ALLOW_WORLD_MUTATION is not true." };
  }
  if (env.TWO_PROBE_RED_APPROVED !== "true") {
    return { allowed: false, error: "TWO_PROBE_RED_APPROVED is not true." };
  }
  if (env.TWO_PROBE_BLUE_APPROVED !== "true") {
    return { allowed: false, error: "TWO_PROBE_BLUE_APPROVED is not true. Coordinate shared adapter and exclusive WORLD-LAB access with BLUE." };
  }
  if (env.TWO_PROBE_USER_APPROVED !== "true") {
    return { allowed: false, error: "TWO_PROBE_USER_APPROVED is not true." };
  }
  if (env.MECHANICS_HOME_TEST_ENABLED === "true" || env.MECHANICS_MINE_TEST_ENABLED === "true" || env.MECHANICS_FARM_TEST_ENABLED === "true" || env.MECHANICS_FISH_TEST_ENABLED === "true") {
    return { allowed: false, error: "Refusing concurrent two-probe run while a single-probe harness is enabled." };
  }

  const port = Number(env.TWO_PROBE_PORT ?? String(RED_WORLD_LAB_PORT));
  if (port === LIVE_CIVILIZATION_PORT) return { allowed: false, error: "Refusing two-probe test on 25565" };
  if (port === MINDCRAFT_BODY_TEST_PORT) return { allowed: false, error: "Refusing two-probe test on 25566" };
  if (port !== RED_WORLD_LAB_PORT) {
    return { allowed: false, error: `Two-probe test only allowed on isolated world-lab port ${RED_WORLD_LAB_PORT}` };
  }
  const version = env.TWO_PROBE_VERSION ?? "1.21.11";
  if (version !== "1.21.11") return { allowed: false, error: `Requires Paper 1.21.11, got ${version}` };
  const homeName = env.TWO_PROBE_HOME_USERNAME ?? "HomeProbe";
  const mineName = env.TWO_PROBE_MINE_USERNAME ?? "MineProbe";
  if (homeName === mineName) {
    return { allowed: false, error: "HomeProbe and MineProbe must be distinct identities" };
  }

  return {
    allowed: true,
    host: env.TWO_PROBE_HOST ?? "127.0.0.1",
    port,
    version,
    rconPort: Number(env.TWO_PROBE_RCON_PORT ?? "25577"),
  };
}
