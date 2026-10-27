/**
 * Short Atlas World-Lab connection smoke for authorized retests.
 * No planner ticks, teleport, item supply, or time change.
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "./env.js";
import { loadConfig } from "@civ/shared";
import { MinecraftBody } from "@civ/minecraft-adapter";
import { pinWorldLabOneCitizenProcessEnv } from "./world-lab-one-citizen-guard.js";
import { portOpen } from "./paper.js";

async function main(): Promise<void> {
  loadEnv();
  pinWorldLabOneCitizenProcessEnv(process.env);
  const config = loadConfig(process.env);
  const outPath = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
  if (config.MINECRAFT_PORT !== 25567 || config.AUTO_START_PAPER) {
    throw new Error(`Smoke refused: port=${config.MINECRAFT_PORT} autoPaper=${config.AUTO_START_PAPER}`);
  }
  const up = await portOpen(config.MINECRAFT_HOST, config.MINECRAFT_PORT, 2000);
  if (!up) throw new Error("Paper not listening on 25567");

  const body = new MinecraftBody({
    username: "Atlas",
    config,
    reconnect: false,
    citizenId: "citizen_atlas",
  });
  body.on("error", (error) => console.warn(`[smoke body error] ${error.message}`));

  console.log(`SMOKE connecting Atlas to ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT} db=${config.DATABASE_PATH}`);
  const connected = await body.connect();
  if (!connected.success) {
    throw new Error(`Connect failed: ${connected.code} ${connected.error}`);
  }
  await new Promise((r) => setTimeout(r, 2500));
  const obs = body.observe();
  const report = {
    ok: Boolean(obs.connected && obs.spawned && obs.position),
    username: obs.username,
    connected: obs.connected,
    spawned: obs.spawned,
    position: obs.position,
    health: obs.health,
    hunger: obs.food,
    inventory: obs.inventory,
    isNight: obs.isNight,
    gameTime: obs.gameTime,
    config: {
      host: config.MINECRAFT_HOST,
      port: config.MINECRAFT_PORT,
      database: config.DATABASE_PATH,
      autoStartPaper: config.AUTO_START_PAPER,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
  await body.disconnect("smoke-complete");
  console.log(report.ok ? "SMOKE_PASS" : "SMOKE_FAIL");
  process.exitCode = report.ok ? 0 : 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
