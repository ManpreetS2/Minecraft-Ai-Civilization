import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import { MinecraftBody, evaluateReturnHome, executeReturnHome } from "@civ/minecraft-adapter";
import { CivilizationStore, claimHome, leaveHome } from "@civ/agent-core";
import { tryRcon, type RconClient } from "./rcon.js";
import { evaluateHomeTestLaunch, parseApprovedHomeFixtures, type Cell } from "./home-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };

const VILLAGE_STREET: Cell = { x: -1082, y: 68, z: 799 };
const H1_STAND: Cell = { x: -1096, y: 69, z: 730 };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt(pos: { x: number; y?: number; z: number }): string {
  return `${pos.x.toFixed(1)},${pos.y?.toFixed(1) ?? "?"},${pos.z.toFixed(1)}`;
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
  const target = evaluateHomeTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    process.exit(2);
    return;
  }
  const fixtures = parseApprovedHomeFixtures(process.env);
  if ("error" in fixtures) {
    console.error(fixtures.error);
    process.exit(2);
    return;
  }
  const username = process.env.HOME_TEST_USERNAME ?? "HomeProbe";
  if (!isMechanicsProbeUsername(username) || username === "FarmProbe" || username === "MineProbe") {
    throw new Error("Use HomeProbe for the return-home live test.");
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
  });
  const dbPath = join(mkdtempSync(join(tmpdir(), "civ-return-home-")), "homes.sqlite");
  const store = new CivilizationStore(dbPath);
  store.upsertCitizen({
    id: "probe_home",
    name: username,
    minecraftUsername: username,
    createdAt: new Date().toISOString(),
    status: "offline",
  });
  const claimed = claimHome(store, {
    citizenId: "probe_home",
    homeId: fixtures.homeId,
    dimension: "overworld",
    origin: fixtures.origin,
    entrance: fixtures.entrance,
    bed: fixtures.bedA,
    personalChest: fixtures.chestA,
    storageAccess: "personal",
  });
  if (!claimed.success) throw new Error(`claim failed ${claimed.error}`);
  const persisted = store.getCitizenHome("probe_home");
  if (!persisted) throw new Error("home claim did not persist");
  console.log("TEST-ONLY RETURN-HOME HARNESS (not five-citizen, not two-bot)");
  console.log(`SQLITE claim probe_home home_id=${persisted.homeId}`);
  console.log(`SQLITE claimed home origin ${persisted.origin.x},${persisted.origin.y},${persisted.origin.z}`);
  console.log(`SQLITE claimed bed HEAD ${persisted.bed.x},${persisted.bed.y},${persisted.bed.z}`);
  console.log(`SQLITE entrance ${persisted.entrance?.x},${persisted.entrance?.y},${persisted.entrance?.z}`);

  const password = process.env.HOME_TEST_RCON_PASSWORD ?? "civ-world-lab-rcon";
  const rcon = await tryRcon(target.host, target.rconPort, password);
  if (!rcon) throw new Error("RCON unavailable");
  const cmd = async (command: string, label: string): Promise<string> => {
    const out = await rcon.command(command);
    console.log(`TEST_CONTROL ${label} rcon ${command} => ${out.trim().slice(0, 180)}`);
    return out;
  };

  const stages: Stage[] = [];
  let forceloaded = false;
  let timeRestore: string | undefined;
  try {
    const list = await cmd("list", "who-online");
    if (/Atlas|Maya|Theo|Ava|Kai/i.test(list)) throw new Error("a citizen is online");
    await cmd("forceload add -1100 720 -1030 850", "forceload-site-c");
    forceloaded = true;
    const connected = await body.connect();
    if (!connected.success) throw new Error(`connect ${connected.code}`);
    await wait(800);
    await cmd(`op ${username}`, "op");
    await cmd(`effect give ${username} minecraft:saturation 30 4 true`, "saturation");
    const timeQuery = await cmd("time query daytime", "time-query");
    timeRestore = timeQuery.match(/(\d+)/)?.[1] ?? "1000";
    await cmd("time set 1000", "morning-for-bounded-work");
    await cmd(`tp ${username} ${VILLAGE_STREET.x}.5 ${VILLAGE_STREET.y} ${VILLAGE_STREET.z}.5`, "work-site-tp");
    const parked = Date.now();
    while (Date.now() - parked < 4_000) {
      const here = body.position();
      if (
        here &&
        Math.hypot(here.x - (VILLAGE_STREET.x + 0.5), here.z - (VILLAGE_STREET.z + 0.5)) < 1.6 &&
        Math.abs(here.y - VILLAGE_STREET.y) < 1.6
      ) {
        break;
      }
      await wait(150);
    }
    await wait(400);

    stages.push(
      await runStage("return-home from bounded work site", async () => {
        const bot = body.requireBot();
        const start = body.position();
        if (!start) throw new Error("no body at work site");
        const timeOfDay = bot.time?.timeOfDay ?? 0;
        const worldTick = (bot.time as { age?: number } | undefined)?.age ?? timeOfDay;
        const home = { x: H1_STAND.x + 0.5, y: H1_STAND.y, z: H1_STAND.z + 0.5 };
        const entrance = persisted.entrance
          ? { x: persisted.entrance.x + 0.5, y: persisted.entrance.y, z: persisted.entrance.z + 0.5 }
          : undefined;
        const plan = evaluateReturnHome({ position: start, home, timeOfDay });
        console.log(
          `RETURN_HOME departure pos=${fmt(start)} claimedHome=${persisted.homeId} claimedBed=${persisted.bed.x},${persisted.bed.y},${persisted.bed.z} clock=${timeOfDay} worldTick=${worldTick} estimateMs=${plan.estimateMs} remainingMs=${plan.remainingMs} reason=${plan.reason}`,
        );
        const route: string[] = [`depart ${fmt(start)} t=${timeOfDay}`];
        const poll = setInterval(() => {
          const here = body.position();
          const tick = bot.time?.timeOfDay ?? 0;
          if (here) route.push(`${fmt(here)} t=${tick}`);
        }, 1000);
        const moved = await executeReturnHome(bot, {
          home,
          bed: persisted.bed,
          entrance,
          timeoutMs: 90_000,
        });
        clearInterval(poll);
        const after = body.position();
        const arrivalTick = bot.time?.timeOfDay ?? 0;
        const arrivalWorld = (bot.time as { age?: number } | undefined)?.age ?? arrivalTick;
        if (after) route.push(`arrive ${fmt(after)} t=${arrivalTick}`);
        console.log(`RETURN_HOME route ${route.join(" -> ")}`);
        console.log(
          `RETURN_HOME arrival pos=${after ? fmt(after) : "?"} clock=${arrivalTick} worldTick=${arrivalWorld} success=${moved.success} ${moved.success ? "" : `${moved.code} ${moved.error}`}`,
        );
        if (!moved.success) throw new Error(`${moved.code} ${moved.error} at ${after ? fmt(after) : "?"}`);
        if (!after) throw new Error("lost body");
        const dist = Math.hypot(after.x - home.x, after.y - home.y, after.z - home.z);
        if (dist > 2.2) throw new Error(`did not arrive at claimed home; ${fmt(after)} dist=${dist.toFixed(1)}`);
        if (Math.abs(after.x - start.x) < 2 && Math.abs(after.z - start.z) < 2) {
          throw new Error("still at work site; return-home did not walk");
        }
        return `walked ${fmt(start)} t=${timeOfDay}/${worldTick} -> ${fmt(after)} t=${arrivalTick}/${arrivalWorld} bed ${persisted.bed.x},${persisted.bed.y},${persisted.bed.z} via ${route.length} route samples`;
      }),
    );
  } finally {
    try {
      if (timeRestore !== undefined) await Promise.race([rcon.command(`time set ${timeRestore}`), wait(4_000)]);
      if (forceloaded) await Promise.race([rcon.command("forceload remove -1100 720 -1030 850"), wait(4_000)]);
    } catch {
      // cleanup best-effort
    }
    rcon.close();
    try {
      body.stopPathfinding();
    } catch {
      // already gone
    }
    await Promise.race([body.disconnect("return-home-test"), wait(5_000)]).catch(() => undefined);
    leaveHome(store, "probe_home");
    store.close();
    console.log("");
    console.log("Return-home LIVE results (not a five-citizen PASS, not a bedtime PASS)");
    for (const stage of stages) {
      console.log(`- ${stage.passed ? "PASS" : "FAIL"} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
    const failed = stages.some((stage) => !stage.passed) || stages.length < 1;
    if (failed && stages.some((stage) => /NOT_CONNECTED|keepalive/i.test(stage.detail))) {
      console.log("TEST_LIFECYCLE FAIL: disconnect during the active walk was reported, not swallowed");
    } else {
      console.log(`TEST_LIFECYCLE ${failed ? "FAIL" : "PASS"}: harness exit ${failed ? 1 : 0} after disconnect`);
    }
    process.exit(failed ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
