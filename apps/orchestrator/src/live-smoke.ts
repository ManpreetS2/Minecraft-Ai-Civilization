import { loadEnv } from "./env.js";
import { loadConfig } from "@civ/shared";
import { MinecraftBody, moveToPosition } from "@civ/minecraft-adapter";
import { ensurePaper } from "./paper.js";

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const paper = await ensurePaper(config);
  if (!paper) {
    throw new Error(`Paper not reachable at ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
  }

  const body = new MinecraftBody({
    username: config.MINECRAFT_USERNAME,
    config,
    reconnect: false,
  });

  console.log(`Connecting ${config.MINECRAFT_USERNAME} to ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}...`);
  const connected = await body.connect();
  if (!connected.success) {
    throw new Error(`Connect failed: ${connected.code} ${connected.error}`);
  }

  const obs = body.observe();
  console.log(
    JSON.stringify(
      {
        username: obs.username,
        connected: obs.connected,
        spawned: obs.spawned,
        position: obs.position,
        health: obs.health,
        hunger: obs.food,
        inventory: obs.inventory,
        players: obs.players,
      },
      null,
      2,
    ),
  );

  const chat = await body.chat("Atlas reporting in — physical body online.");
  console.log("chat", chat);

  const pos = obs.position;
  if (pos) {
    const moved = await moveToPosition(
      body.requireBot(),
      { x: pos.x + 2, y: pos.y, z: pos.z + 2 },
      { range: 2, timeoutMs: 20_000 },
    );
    console.log("goto nearby", moved);
  }

  await body.disconnect("smoke-test");
  console.log("Atlas smoke test complete");
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
