import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import {
  MinecraftBody,
  evaluateStepJump,
  isTwoBlockObstruction,
  moveToPosition,
  terrainMemory,
  twoBlockRecovery,
} from "@civ/minecraft-adapter";
import { tryRcon } from "./rcon.js";
import { evaluateHomeTestLaunch } from "./home-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };
type Cell = { x: number; y: number; z: number };

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
    if (here && Math.hypot(here.x - dest.x, here.z - dest.z) < 1.4 && Math.abs(here.y - dest.y) < 1.6) {
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
    throw new Error("Use HomeProbe for the disposable oak_log pad.");
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
  let clippedLog = false;
  try {
    console.log("TEST-ONLY OAK_LOG DETOUR (disposable pad, not Site C, not five-citizen)");
    const list = await cmd("list", "who-online");
    if (/Atlas|Maya|Theo|Ava|Kai|FishProbe|MineProbe|FarmProbe|MechProbe/i.test(list)) {
      throw new Error(`another probe or citizen is online: ${list.trim()}`);
    }
    await cmd("forceload add 192 392 208 408", "forceload-pad");
    stepChunks = true;
    const connected = await body.connect();
    if (!connected.success) throw new Error(`connect ${connected.code}`);
    await wait(800);
    await cmd(`op ${username}`, "op");
    await cmd(`spawnpoint ${username} 200 67 400`, "pad-spawnpoint");
    await cmd(`effect give ${username} minecraft:saturation 30 4 true`, "saturation");

    stages.push(
      await runStage("two-block oak_log go around", async () => {
        await cmd("fill 199 66 399 210 66 403 minecraft:grass_block", "pad-floor");
        await cmd("fill 199 67 399 210 69 403 minecraft:air", "pad-air");
        await cmd("setblock 203 67 400 minecraft:oak_log", "place-log");
        await cmd("setblock 203 68 400 minecraft:oak_log", "place-log-top");
        await cmd(`tp ${username} 202.5 67 400.5`, "tp-log");
        const start = await waitUntilNear(body, { x: 202.5, y: 67, z: 400.5 });
        const seenFeet = await waitForNamedBlock(body, { x: 203, y: 67, z: 400 }, ["oak_log"]);
        const seenHead = await waitForNamedBlock(body, { x: 203, y: 68, z: 400 }, ["oak_log"]);
        if (seenFeet !== "oak_log") throw new Error(`client never saw oak_log feet (${seenFeet})`);
        const bot = body.requireBot();
        const dest = { x: 204.5, y: 67, z: 400.5 };
        const jump = evaluateStepJump(bot, dest);
        const memory = terrainMemory(bot);
        memory.observeVisible(bot, 4);
        const observed = memory.get({ x: 203, y: 67, z: 400 });
        const observedTop = memory.get({ x: 203, y: 68, z: 400 });
        const detour = twoBlockRecovery(bot, dest, memory);
        console.log(
          `LOG start ${fmt(start)} jump=${JSON.stringify(jump)} observed=${observed?.name}/${observedTop?.name} detour=${JSON.stringify(detour)} seenHead=${seenHead}`,
        );
        if (!isTwoBlockObstruction(jump)) {
          throw new Error(`expected two-block refuse, got ${JSON.stringify(jump)}`);
        }
        if (jump.ok) throw new Error("one-block jump was eligible against a two-block trunk");
        const route: string[] = [`start ${fmt(start)}`];
        const poll = setInterval(() => {
          const here = body.position();
          if (!here) return;
          route.push(fmt(here));
          if (Math.floor(here.x) === 203 && Math.floor(here.z) === 400) clippedLog = true;
        }, 400);
        const moved = await moveToPosition(bot, dest, { range: 0.9, timeoutMs: 18_000, recover: true });
        clearInterval(poll);
        const after = body.position();
        if (after) route.push(`end ${fmt(after)}`);
        await cmd("setblock 203 68 400 minecraft:air", "remove-log-top");
        await cmd("setblock 203 67 400 minecraft:air", "remove-log");
        console.log(`LOG route ${route.join(" -> ")}`);
        console.log(
          `LOG end ${after ? fmt(after) : "?"} success=${moved.success} ${moved.success ? "" : `${moved.code} ${moved.error}`} clipped=${clippedLog}`,
        );
        if (clippedLog) throw new Error(`clipped oak_log column at 203,400; route ${route.join(" -> ")}`);
        if (!after) throw new Error("lost body");
        if (Math.abs(after.x - 203) < 0.4 && Math.abs(after.z - 400) < 0.4) throw new Error(`stood inside trunk at ${fmt(after)}`);
        if (!moved.success) {
          throw new Error(`${moved.code} ${moved.error} at ${fmt(after)} start=${fmt(start)} route=${route.join(" -> ")}`);
        }
        if (after.x < 203.6) throw new Error(`did not pass trunk; ended ${fmt(after)}`);
        const dist = Math.hypot(after.x - dest.x, after.z - dest.z);
        if (dist > 1.4 || Math.abs(after.y - 67) > 1.2) {
          throw new Error(`did not reach dest ${fmt(dest)}; ended ${fmt(after)} dist=${dist.toFixed(2)}`);
        }
        return `around trunk ${fmt(start)} -> ${fmt(after)} detour=${detour.action} samples=${route.length}`;
      }),
    );
  } finally {
    try {
      await Promise.race([rcon.command("setblock 203 67 400 minecraft:air"), wait(4_000)]);
      await Promise.race([rcon.command("setblock 203 68 400 minecraft:air"), wait(4_000)]);
      await Promise.race([rcon.command("spawnpoint HomeProbe -1097 69 728"), wait(4_000)]);
      await Promise.race([rcon.command(`deop ${username}`), wait(4_000)]);
      if (stepChunks) await Promise.race([rcon.command("forceload remove 192 392 208 408"), wait(4_000)]);
    } catch {
      // cleanup best-effort
    }
    rcon.close();
    try {
      body.stopPathfinding();
    } catch {
      // already gone
    }
    await Promise.race([body.disconnect("oak-log-test"), wait(5_000)]).catch(() => undefined);
    const oak = stages[0];
    const failed = !oak?.passed;
    const keepalive = stages.some((stage) => /NOT_CONNECTED|keepalive/i.test(stage.detail));
    console.log("");
    console.log("TWO_BLOCK_DETOUR live (not a five-citizen PASS)");
    for (const stage of stages) {
      console.log(`- ${stage.passed ? "PASS" : "FAIL"} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
    console.log(`TWO_BLOCK_DETOUR_LIVE=${failed ? "FAIL" : "PASS"}`);
    if (keepalive) {
      console.log("TEST_LIFECYCLE FAIL: disconnect during the active task was reported, not swallowed");
    } else {
      console.log(`TEST_LIFECYCLE ${failed ? "FAIL" : "PASS"}: harness exit ${failed ? 1 : 0} after disconnect`);
    }
    process.exit(failed || keepalive ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
