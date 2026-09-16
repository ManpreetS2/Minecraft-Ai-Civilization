import { loadEnv } from "./env.js";
import { AgentManager } from "@civ/agent-core";
import { loadConfig } from "@civ/shared";
import { startDashboardServer } from "./http-server.js";
import { ensurePaper } from "./paper.js";

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const paperUp = await ensurePaper(config);
  if (!paperUp) {
    console.error(`Paper is not reachable at ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
    console.error("Start it with server\\start.bat, then re-run pnpm sim:start.");
    process.exitCode = 1;
    return;
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

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
