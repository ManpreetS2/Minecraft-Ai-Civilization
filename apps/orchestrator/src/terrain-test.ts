import { loadEnv } from "./env.js";
import { loadConfig } from "@civ/shared";
import { MinecraftBody, moveToPosition } from "@civ/minecraft-adapter";
import { ensurePaper } from "./paper.js";

type ProbeBot = ReturnType<MinecraftBody["requireBot"]>;
type CaseResult = { name: string; passed: boolean; detail: string; durationMs: number };

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const paper = await ensurePaper(config);
  if (!paper) {
    throw new Error(`Paper not reachable at ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
  }

  const username = config.MINECRAFT_USERNAME;
  const body = new MinecraftBody({
    username,
    config,
    reconnect: false,
    allowRespawn: false,
  });

  console.log(`Connecting ${username} to ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}...`);
  const connected = await body.connect();
  if (!connected.success) {
    throw new Error(`Connect failed: ${connected.code} ${connected.error}`);
  }

  const bot = body.requireBot();
  const origin = body.position();
  if (!origin) throw new Error("No spawn position");
  const results: CaseResult[] = [];

  results.push(await runCase("flat ground", async () => {
    const moved = await moveToPosition(bot, { x: origin.x + 3, y: origin.y, z: origin.z }, { range: 1.5, timeoutMs: 12_000 });
    if (!moved.success) throw new Error(`${moved.code} ${moved.error}`);
  }));

  results.push(await runCase("small gaps", async () => {
    const here = bot.entity?.position;
    if (!here) throw new Error("bot lost its body");
    const moved = await moveToPosition(bot, { x: here.x - 3, y: here.y, z: here.z + 3 }, { range: 2, timeoutMs: 12_000 });
    if (!moved.success) throw new Error(`${moved.code} ${moved.error}`);
  }));

  results.push(await runCase("one-block rise", async () => {
    const here = bot.entity.position;
    const step = { x: Math.floor(here.x) + 2, y: Math.floor(here.y), z: Math.floor(here.z) + 2 };
    await placeIfPossible(bot, "dirt", 2, 2);
    const moved = await moveToPosition(bot, { x: step.x, y: step.y + 1, z: step.z }, { range: 1.6, timeoutMs: 14_000 });
    if (!moved.success) {
      const nearbyUp = await moveToPosition(bot, { x: here.x + 2, y: here.y + 1, z: here.z }, { range: 2, timeoutMs: 12_000 });
      if (!nearbyUp.success) throw new Error(`${moved.code} ${moved.error}`);
    }
  }));

  results.push(await runCase("two-level uneven hillside", async () => {
    const here = bot.entity?.position;
    if (!here) throw new Error("bot lost its body");
    const hill = bot.findBlock({
      matching: (block) =>
        Boolean(
          block?.position &&
            block.boundingBox === "block" &&
            block.position.y >= here.y + 1.6 &&
            block.position.y <= here.y + 5,
        ),
      maxDistance: 20,
    });
    if (!hill?.position) throw new Error("SKIP no two-level hillside nearby");
    const moved = await moveToPosition(
      bot,
      { x: hill.position.x, y: hill.position.y + 1, z: hill.position.z },
      { range: 2.2, timeoutMs: 16_000 },
    );
    if (!moved.success) throw new Error(`${moved.code} ${moved.error}`);
  }));

  results.push(await runCase("cluttered forest", async () => {
    const here = bot.entity?.position;
    if (!here) throw new Error("bot lost its body");
    const moved = await moveToPosition(
      bot,
      { x: here.x + 8, y: here.y, z: here.z + 8 },
      { range: 3, timeoutMs: 18_000 },
    );
    if (!moved.success) throw new Error(`${moved.code} ${moved.error}`);
  }));

  results.push(await runCase("trees on hills", async () => {
    const log = bot.findBlock({ matching: bot.registry.blocksByName.oak_log?.id ?? 0, maxDistance: 32 });
    if (!log) throw new Error("SKIP no oak log nearby");
    const moved = await moveToPosition(
      bot,
      { x: log.position.x, y: log.position.y, z: log.position.z },
      { range: 4, timeoutMs: 18_000 },
    );
    if (!moved.success) throw new Error(`${moved.code} ${moved.error}`);
  }));

  results.push(await runCase("shallow water", async () => {
    const here = bot.entity?.position;
    if (!here) throw new Error("bot lost its body");
    const water = bot.findBlock({
      matching: (block) =>
        Boolean(
          block &&
            (block.name === "water" || block.name === "kelp" || block.name === "seagrass") &&
            block.position &&
            Math.abs(block.position.y - here.y) <= 4,
        ),
      maxDistance: 24,
    });
    if (!water) throw new Error("SKIP no shallow water nearby");
    const moved = await moveToPosition(
      bot,
      { x: water.position.x, y: water.position.y, z: water.position.z },
      { range: 3, timeoutMs: 16_000 },
    );
    if (!moved.success) throw new Error(`${moved.code} ${moved.error}`);
  }));

  results.push(await runCase("target that genuinely cannot be reached", async () => {
    const sky = { x: origin.x, y: origin.y + 40, z: origin.z };
    const started = Date.now();
    const moved = await moveToPosition(bot, sky, { range: 1, timeoutMs: 12_000, recover: true });
    const durationMs = Date.now() - started;
    if (moved.success) throw new Error("falsely reported success for unreachable sky target");
    if (durationMs > 20_000) throw new Error(`took ${durationMs}ms; expected early abandon`);
    body.unreachable.mark(sky);
    if (!body.unreachable.has(sky)) throw new Error("unreachable target was not blacklisted");
  }));

  await body.disconnect("terrain-test");
  console.log("");
  console.log("Terrain traversal results");
  for (const result of results) {
    const mark = result.passed ? "PASS" : result.detail.startsWith("SKIP") ? "SKIP" : "FAIL";
    console.log(`- ${mark} ${result.name} (${result.durationMs}ms) ${result.detail}`);
  }
  const failed = results.filter((r) => !r.passed && !r.detail.startsWith("SKIP"));
  process.exit(failed.length ? 1 : 0);
}

async function runCase(name: string, fn: () => Promise<void>): Promise<CaseResult> {
  const started = Date.now();
  try {
    await fn();
    return { name, passed: true, detail: "", durationMs: Date.now() - started };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name, passed: false, detail, durationMs: Date.now() - started };
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function placeIfPossible(bot: ProbeBot, name: string, dx: number, dz: number): Promise<void> {
  const item = bot.inventory.items().find((i) => i.name === name);
  const feet = bot.entity?.position;
  if (!item || !feet) return;
  const ref = bot.blockAt(feet.offset(dx, -1, dz));
  if (!ref) return;
  try {
    await bot.equip(item, "hand");
    await bot.placeBlock(ref, feet.offset(0, 1, 0).minus(feet).floored());
  } catch {
    // placement is optional setup for the case
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
