import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadEnv } from "./env.js";
import { AgentManager, assertLiveRuntimeLaunchAllowed } from "@civ/agent-core";
import { loadConfig } from "@civ/shared";
import { startDashboardServer } from "./http-server.js";
import { ensurePaper } from "./paper.js";
import { tryRcon } from "./rcon.js";
import { enableColonyMode } from "./colony-world.js";

export async function main(): Promise<void> {
  assertLiveRuntimeLaunchAllowed();
  loadEnv();
  const config = loadConfig();
  const paperUp = await ensurePaper(config);
  if (!paperUp) {
    console.error(`Paper is not reachable at ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
    console.error("Start it with server\\start.bat, then re-run pnpm sim:start.");
    process.exitCode = 1;
    return;
  }

  const rcon = await tryRcon(config.MINECRAFT_HOST, Number(process.env.RCON_PORT ?? 25575), process.env.RCON_PASSWORD ?? "civ-mechanics-rcon");
  if (rcon) {
    try {
      const colony = await enableColonyMode(rcon);
      console.log(`Colony mode: difficulty kept non-peaceful, animals/hunger/day-night on, hostiles purged=${colony.purged}`);
    } catch (error) {
      console.warn("Colony mode RCON apply failed:", error);
    } finally {
      rcon.close();
    }
  } else {
    console.warn("Colony mode: RCON unavailable. Set spawn-monsters=false in server.properties (not Peaceful) and restart Paper.");
  }

  const manager = new AgentManager(config);
  const dashboard = await startDashboardServer(manager, "0.0.0.0", config.DASHBOARD_PORT);
  await manager.start();

  console.log("");
  console.log("Simulation ready");
  console.log(`Minecraft server: ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
  console.log(`Dashboard: ${dashboard}`);
  console.log(`Citizens: ${manager.list().map((c) => c.record.name).join(", ")}`);
  console.log(
    `Cognition: ${config.LLM_ENABLED ? `${config.LLM_PROVIDER} (${config.OLLAMA_MODEL})` : "planner/heuristic only"}`,
  );
  console.log("Human observer: join 127.0.0.1:25565 then /gamemode spectator");
  console.log("");

  const shutdown = async () => {
    console.log("Stopping simulation...");
    await manager.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
