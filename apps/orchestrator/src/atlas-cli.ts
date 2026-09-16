import { loadEnv } from "./env.js";
import readline from "node:readline";
import { loadConfig } from "@civ/shared";
import { MinecraftBody, followPlayer, moveToPosition, startFollowing } from "@civ/minecraft-adapter";
import { ensurePaper } from "./paper.js";

const HELP = `
Atlas developer CLI (no AI)

  help
  state
  players
  inventory
  nearby
  say <message>
  goto <x> <y> <z>
  follow <name>
  stop
  quit
`.trim();

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const paper = await ensurePaper(config);
  if (!paper) {
    console.error(`Paper is not reachable at ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
    console.error("Start it with server\\start.bat first.");
    process.exitCode = 1;
    return;
  }

  const body = new MinecraftBody({
    username: config.MINECRAFT_USERNAME,
    config,
    reconnect: true,
  });

  console.log(
    `Connecting ${config.MINECRAFT_USERNAME} to ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT} (${config.MINECRAFT_AUTH_MODE})...`,
  );
  const connected = await body.connect();
  if (!connected.success) {
    console.error(`Connect failed: ${connected.code} ${connected.error}`);
    await body.disconnect("connect-failed");
    process.exitCode = 1;
    return;
  }

  const obs = body.observe();
  console.log(`Spawned at ${fmt(obs.position)}  health=${obs.health} hunger=${obs.food}`);
  console.log(HELP);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question("atlas> ", (line) => void handle(line));

  const shutdown = async () => {
    rl.close();
    await body.disconnect("cli-quit");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());

  async function handle(line: string): Promise<void> {
    const raw = line.trim();
    const [cmd, ...rest] = raw.split(/\s+/);
    try {
      switch ((cmd ?? "").toLowerCase()) {
        case "":
          break;
        case "help":
          console.log(HELP);
          break;
        case "state": {
          const s = body.observe();
          console.log(
            JSON.stringify(
              {
                username: s.username,
                connected: s.connected,
                position: s.position,
                health: s.health,
                hunger: s.food,
                night: s.isNight,
                held: s.heldItem,
              },
              null,
              2,
            ),
          );
          break;
        }
        case "players":
          console.log(body.nearbyPlayers());
          break;
        case "inventory":
          console.log(body.inventory());
          break;
        case "nearby":
          console.log(body.nearbyEntities());
          break;
        case "say": {
          const message = rest.join(" ");
          const result = await body.chat(message);
          console.log(result);
          break;
        }
        case "goto": {
          const [x, y, z] = rest.map(Number);
          if ([x, y, z].some((n) => !Number.isFinite(n))) {
            console.log("usage: goto <x> <y> <z>");
            break;
          }
          const bot = body.requireBot();
          const result = await moveToPosition(bot, { x: x!, y: y!, z: z! });
          console.log(result);
          break;
        }
        case "follow": {
          const name = rest.join(" ");
          if (!name) {
            console.log("usage: follow <name>");
            break;
          }
          const bot = body.requireBot();
          const live = startFollowing(bot, name);
          if (!live.success) {
            const once = await followPlayer(bot, name);
            console.log(once);
          } else {
            console.log(live);
          }
          break;
        }
        case "stop":
          body.stopPathfinding();
          console.log("stopped");
          break;
        case "quit":
        case "exit":
          await shutdown();
          return;
        default:
          console.log(`unknown command: ${cmd}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    prompt();
  }

  prompt();
}

function fmt(pos?: { x: number; y: number; z: number }): string {
  if (!pos) return "unknown";
  return `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
}

void main();
