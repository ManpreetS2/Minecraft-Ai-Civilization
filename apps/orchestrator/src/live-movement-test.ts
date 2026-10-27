import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import { MinecraftBody, evaluateStepJump, moveToPosition } from "@civ/minecraft-adapter";
import { tryRcon, type RconClient } from "./rcon.js";
import { evaluateHomeTestLaunch } from "./home-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };
type Cell = { x: number; y: number; z: number };

const PAD: Cell = { x: 200, y: 67, z: 400 };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt(pos: { x: number; y?: number; z: number }): string {
  return `${pos.x.toFixed(1)},${pos.y?.toFixed(1) ?? "?"},${pos.z.toFixed(1)}`;
}

async function waitUntilNear(
  body: MinecraftBody,
  dest: { x: number; y: number; z: number },
  timeoutMs = 4_000,
): Promise<{ x: number; y: number; z: number }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const here = body.position();
    if (
      here &&
      Math.hypot(here.x - dest.x, here.z - dest.z) < 1.4 &&
      Math.abs(here.y - dest.y) < 1.6
    ) {
      await wait(400);
      return body.position() ?? here;
    }
    await wait(120);
  }
  const here = body.position();
  throw new Error(`body not at ${fmt(dest)} after tp; at ${here ? fmt(here) : "?"}`);
}

async function waitForNamedBlock(
  body: MinecraftBody,
  pos: Cell,
  names: string[],
  timeoutMs = 5_000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const bot = body.requireBot();
    const origin = bot.entity?.position;
    if (origin) {
      const block = bot.blockAt(origin.offset(pos.x - origin.x, pos.y - origin.y, pos.z - origin.z).floored());
      if (block && names.includes(block.name)) return block.name;
    }
    await wait(150);
  }
  return "timeout";
}

async function runStage(name: string, fn: () => Promise<string>): Promise<Stage> {
  const started = Date.now();
  try {
    return { name, passed: true, detail: await fn(), durationMs: Date.now() - started };
  } catch (error) {
    return { name, passed: false, detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
  }
}

function rconPassed(text: string): boolean {
  return text.toLowerCase().includes("passed") || text.toLowerCase().includes("test passed");
}

async function identify(rcon: RconClient, pos: Cell, names: string[]): Promise<string> {
  for (const name of names) {
    const out = await rcon.command(`execute in minecraft:overworld if block ${pos.x} ${pos.y} ${pos.z} minecraft:${name}`);
    if (rconPassed(out)) return name;
  }
  return "unknown";
}

async function main(): Promise<void> {
  loadEnv();
  if (process.env.MECHANICS_MOVE_TEST_ENABLED !== "true") {
    console.error("MECHANICS_MOVE_TEST_ENABLED is not true.");
    process.exit(2);
    return;
  }
  const target = evaluateHomeTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    process.exit(2);
    return;
  }
  const username = process.env.HOME_TEST_USERNAME ?? "HomeProbe";
  if (!isMechanicsProbeUsername(username) || username === "FarmProbe" || username === "MineProbe") {
    throw new Error("Use HomeProbe for the disposable movement pad.");
  }
  const base = loadConfig();
  const body = new MinecraftBody({
    username,
    config: {
      ...base,
      MINECRAFT_HOST: target.host,
      MINECRAFT_PORT: target.port,
      MINECRAFT_VERSION: target.version,
      MINECRAFT_USERNAME: username,
      AUTO_START_PAPER: false as const,
    },
    reconnect: false,
    allowRespawn: true,
  });
  const password = process.env.HOME_TEST_RCON_PASSWORD ?? "civ-world-lab-rcon";
  const rcon = await tryRcon(target.host, target.rconPort, password);
  if (!rcon) throw new Error("RCON unavailable");
  const cmd = async (command: string, label: string): Promise<string> => {
    const out = await rcon.command(command);
    console.log(`TEST_CONTROL ${label} rcon ${command} => ${out.trim().slice(0, 180)}`);
    return out;
  };
  const stages: Stage[] = [];
  let stepChunks = false;
  try {
    console.log("TEST-ONLY MOVEMENT PAD HARNESS (not Site C)");
    const list = await cmd("list", "who-online");
    if (/Atlas|Maya|Theo|Ava|Kai/i.test(list)) throw new Error("a citizen is online");
    await cmd("forceload add 192 392 208 408", "forceload-pad");
    stepChunks = true;
    const connected = await body.connect();
    if (!connected.success) throw new Error(`connect ${connected.code}`);
    await wait(800);
    await cmd(`op ${username}`, "op");
    await cmd(`spawnpoint ${username} 200 67 400`, "pad-spawnpoint");
    await cmd(`effect give ${username} minecraft:saturation 30 4 true`, "saturation");

    stages.push(
      await runStage("one-block dirt rise", async () => {
        if ((await identify(rcon, { x: 200, y: 66, z: 400 }, ["grass_block", "dirt"])) === "unknown") {
          throw new Error("pad grass missing");
        }
        await cmd("fill 199 66 399 210 66 403 minecraft:grass_block", "pad-floor");
        await cmd("fill 199 67 399 210 69 403 minecraft:air", "pad-air");
        await cmd("setblock 201 67 400 minecraft:dirt", "place-dirt");
        await cmd(`tp ${username} 200.5 67 400.5`, "tp-dirt");
        const start = await waitUntilNear(body, { x: 200.5, y: 67, z: 400.5 });
        const seenDirt = await waitForNamedBlock(body, { x: 201, y: 67, z: 400 }, ["dirt"]);
        const bot = body.requireBot();
        console.log(`DIRT jump ${JSON.stringify(evaluateStepJump(bot, { x: 201.5, y: 68, z: 400.5 }))} at ${fmt(start)} seenDirt=${seenDirt}`);
        if (seenDirt !== "dirt") throw new Error(`client never saw dirt at 201,67,400 (${seenDirt})`);
        const moved = await moveToPosition(bot, { x: 201.5, y: 68, z: 400.5 }, { range: 0.9, timeoutMs: 18_000, recover: true });
        const after = body.position();
        await cmd("setblock 201 67 400 minecraft:air", "remove-dirt");
        console.log(`DIRT end ${after ? fmt(after) : "?"} success=${moved.success} ${moved.success ? "" : `${moved.code} ${moved.error}`}`);
        if (!moved.success) throw new Error(`${moved.code} ${moved.error} at ${after ? fmt(after) : "?"}`);
        if (!after || after.y < 67.6) throw new Error(`did not step up; ended y=${after?.y}`);
        return `walked onto dirt ${fmt(after)}`;
      }),
    );

    stages.push(
      await runStage("two-block oak_log go around", async () => {
        await cmd("setblock 203 67 400 minecraft:oak_log keep", "place-log");
        await cmd("setblock 203 68 400 minecraft:oak_log keep", "place-log-top");
        await cmd(`tp ${username} 202.5 67 400.5`, "tp-log");
        await waitUntilNear(body, { x: 202.5, y: 67, z: 400.5 });
        const seenLog = await waitForNamedBlock(body, { x: 203, y: 67, z: 400 }, ["oak_log"]);
        if (seenLog !== "oak_log") throw new Error(`client never saw oak_log (${seenLog})`);
        const bot = body.requireBot();
        const moved = await moveToPosition(bot, { x: 204.5, y: 67, z: 400.5 }, { range: 0.9, timeoutMs: 18_000, recover: true });
        const after = body.position();
        await cmd("setblock 203 68 400 minecraft:air", "remove-log-top");
        await cmd("setblock 203 67 400 minecraft:air", "remove-log");
        console.log(`LOG end ${after ? fmt(after) : "?"} success=${moved.success}`);
        if (!after) throw new Error("lost body");
        if (Math.abs(after.x - 203) < 0.4 && Math.abs(after.z - 400) < 0.4) throw new Error("stood inside trunk");
        if (after.x < 203.6) throw new Error(`${moved.success ? "did not pass trunk" : `${moved.code} ${moved.error}`} at ${fmt(after)}`);
        return `around trunk to ${fmt(after)}`;
      }),
    );

    stages.push(
      await runStage("lava ahead halt or bypass", async () => {
        await cmd("fill 206 66 399 210 66 401 minecraft:grass_block", "lava-pad-floor");
        await cmd("fill 206 67 399 210 69 401 minecraft:air", "lava-pad-air");
        await cmd("setblock 208 66 400 minecraft:lava", "place-lava-pit");
        await cmd(`tp ${username} 207.5 67 400.5`, "tp-lava");
        const start = await waitUntilNear(body, { x: 207.5, y: 67, z: 400.5 });
        const seenLava = await waitForNamedBlock(body, { x: 208, y: 66, z: 400 }, ["lava"]);
        const bot = body.requireBot();
        console.log(`LAVA start ${fmt(start)} seen=${seenLava} jump=${JSON.stringify(evaluateStepJump(bot, { x: 209.5, y: 67, z: 400.5 }))}`);
        if (seenLava !== "lava") throw new Error(`client never saw lava at 208,66,400 (${seenLava})`);
        const moved = await moveToPosition(bot, { x: 209.5, y: 67, z: 400.5 }, { range: 1.1, timeoutMs: 12_000, recover: true });
        const after = body.position();
        const feet = after ? await identify(rcon, { x: Math.floor(after.x), y: Math.floor(after.y), z: Math.floor(after.z) }, ["lava"]) : "unknown";
        const below = after ? await identify(rcon, { x: Math.floor(after.x), y: Math.floor(after.y) - 1, z: Math.floor(after.z) }, ["lava"]) : "unknown";
        await cmd("setblock 208 66 400 minecraft:grass_block", "remove-lava");
        console.log(`LAVA end ${after ? fmt(after) : "?"} success=${moved.success} ${moved.success ? "" : `${moved.code} ${moved.error}`} feet=${feet} below=${below}`);
        if (!after) throw new Error("lost body during lava test");
        if (after.y < 66.8) throw new Error(`fell toward lava to ${fmt(after)}`);
        if (Math.abs(after.x - start.x) > 4 || Math.abs(after.z - start.z) > 4) {
          throw new Error(`left lava stand ${fmt(start)} -> ${fmt(after)}`);
        }
        if (feet === "lava" || below === "lava") throw new Error(`stood in lava at ${fmt(after)}`);
        if (moved.success && after && Math.floor(after.x) === 208 && Math.abs(after.z - 400.5) < 0.6) {
          throw new Error(`walked onto lava pit to ${fmt(after)}`);
        }
        if (moved.success) throw new Error(`advanced past lava pit to ${fmt(after)}; expected HAZARD_BLOCKED`);
        if (moved.code !== "HAZARD_BLOCKED") {
          throw new Error(`${moved.code} ${moved.error}`);
        }
        return `${moved.code} at ${fmt(after)} without entering lava`;
      }),
    );

    await cmd(`tp ${username} 200.5 67 400.5`, "after-lava-pad");
    for (let i = 0; i < 15 && !body.position(); i += 1) await wait(400);
    if (!body.position()) {
      await wait(2000);
      await cmd(`tp ${username} 200.5 67 400.5`, "after-lava-pad-retry");
    }
    await wait(800);

    stages.push(
      await runStage("magma is not a landing", async () => {
        await cmd("setblock 205 66 402 minecraft:magma_block", "place-magma");
        await cmd(`tp ${username} 203.5 67 402.5`, "tp-magma");
        await waitUntilNear(body, { x: 203.5, y: 67, z: 402.5 });
        const bot = body.requireBot();
        const moved = await moveToPosition(bot, { x: 205.5, y: 67, z: 402.5 }, { range: 0.8, timeoutMs: 10_000, recover: true });
        const after = body.position();
        await cmd("setblock 205 66 402 minecraft:grass_block", "restore-magma");
        const below = after ? await identify(rcon, { x: Math.floor(after.x), y: Math.floor(after.y) - 1, z: Math.floor(after.z) }, ["magma_block"]) : "unknown";
        console.log(`MAGMA end ${after ? fmt(after) : "?"} success=${moved.success} below=${below}`);
        if (below === "magma_block") throw new Error(`stood on magma at ${after ? fmt(after) : "?"}`);
        return `did not stand on magma; ${moved.success ? "rerouted" : moved.code} at ${after ? fmt(after) : "?"}`;
      }),
    );
  } finally {
    try {
      await rcon.command("setblock 201 67 400 minecraft:air");
      await rcon.command("setblock 203 67 400 minecraft:air");
      await rcon.command("setblock 203 68 400 minecraft:air");
      await rcon.command("fill 207 67 399 209 67 401 minecraft:air");
      await rcon.command("setblock 208 66 400 minecraft:grass_block");
      await rcon.command("setblock 205 66 402 minecraft:grass_block");
      await rcon.command("setblock 211 66 400 minecraft:grass_block");
      await rcon.command("spawnpoint HomeProbe -1097 69 728");
      if (stepChunks) await rcon.command("forceload remove 192 392 208 408");
    } catch {
      // cleanup best-effort
    }
    rcon.close();
    await body.disconnect("move-test").catch(() => undefined);
    console.log("");
    console.log("Shared movement LIVE pad results (not a five-citizen PASS)");
    for (const stage of stages) {
      console.log(`- ${stage.passed ? "PASS" : "FAIL"} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
  }
  if (stages.some((stage) => !stage.passed) || stages.length < 4) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
