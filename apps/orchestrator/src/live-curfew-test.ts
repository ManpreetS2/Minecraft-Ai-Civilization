import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import {
  MinecraftBody,
  evaluateLateDayBedtime,
  evaluateReturnHome,
  executeReturnHome,
  moveToPosition,
  tryOpenAdjacentDoor,
  walkForward,
} from "@civ/minecraft-adapter";
import { sleep, type SkillContext } from "@civ/skills";
import { CivilizationStore, claimHome, leaveHome } from "@civ/agent-core";
import { tryRcon, type RconClient } from "./rcon.js";
import { evaluateHomeTestLaunch, parseApprovedHomeFixtures, type Cell } from "./home-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };

const VILLAGE_STREET: Cell = { x: -1082, y: 68, z: 799 };
const H1_STAND: Cell = { x: -1096, y: 69, z: 730 };
const H1_DOOR: Cell = { x: -1096, y: 69, z: 731 };
const H1_ENTRANCE: Cell = { x: -1096, y: 69, z: 732 };
const VANILLA_NIGHT = 13_000;
const SAFETY_MS = 20_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt(pos: { x: number; y?: number; z: number }): string {
  return `${pos.x.toFixed(1)},${pos.y?.toFixed(1) ?? "?"},${pos.z.toFixed(1)}`;
}

function xzDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function rconPassed(text: string): boolean {
  return text.toLowerCase().includes("passed") || text.toLowerCase().includes("test passed");
}

async function runStage(name: string, fn: () => Promise<string>): Promise<Stage> {
  const started = Date.now();
  try {
    return { name, passed: true, detail: await fn(), durationMs: Date.now() - started };
  } catch (error) {
    return { name, passed: false, detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
  }
}

function chooseDepartureTick(estimateMs: number): { tick: number; leftEarlierThan12000: boolean; reason: string } {
  const ticksNeeded = Math.ceil((estimateMs + SAFETY_MS) / 50);
  const latestSafe = VANILLA_NIGHT - ticksNeeded;
  if (latestSafe < 12_000) {
    return {
      tick: Math.max(1_000, latestSafe),
      leftEarlierThan12000: true,
      reason: `12000 too late for estimateMs=${estimateMs} plus ${SAFETY_MS}ms margin before night ${VANILLA_NIGHT}`,
    };
  }
  return { tick: 12_000, leftEarlierThan12000: false, reason: "12000 leaves enough margin before night 13000" };
}

async function openH1Door(bot: SkillContext["bot"]): Promise<{ toggled: boolean; open: boolean }> {
  const adjacent = await tryOpenAdjacentDoor(bot);
  console.log(
    `H1 door adjacent handled=${String(adjacent.handled)} toggled=${String(adjacent.toggled)} open=${String(adjacent.open)} name=${adjacent.name ?? "none"}`,
  );
  const origin = bot.entity?.position;
  if (!origin) throw new Error("no position for H1 door");
  const block = bot.blockAt(origin.offset(H1_DOOR.x - origin.x, H1_DOOR.y - origin.y, H1_DOOR.z - origin.z).floored());
  if (!block || !block.name.endsWith("_door")) throw new Error(`H1 door is ${block?.name ?? "missing"}`);
  const alreadyOpen = Boolean((block as { getProperties?: () => { open?: boolean } }).getProperties?.()?.open);
  if (alreadyOpen || (adjacent.handled && adjacent.open)) {
    console.log(`H1 door already open name=${block.name}; not toggling`);
    return { toggled: false, open: true };
  }
  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
  await bot.activateBlock(block);
  await wait(400);
  const after = bot.blockAt(block.position);
  const opened = Boolean((after as { getProperties?: () => { open?: boolean } } | null)?.getProperties?.()?.open);
  console.log(`H1 door activate once open=${String(opened)} name=${after?.name ?? block.name}`);
  if (!opened) throw new Error("H1 oak door stayed closed after activateBlock");
  return { toggled: true, open: true };
}

async function main(): Promise<void> {
  loadEnv();
  if (process.env.MECHANICS_CURFEW_TEST_ENABLED !== "true") {
    console.error("MECHANICS_CURFEW_TEST_ENABLED is not true. Prepared only; not a live PASS.");
    process.exit(2);
    return;
  }
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
    throw new Error("Use HomeProbe for the curfew live test.");
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
  const dbPath = join(mkdtempSync(join(tmpdir(), "civ-curfew-")), "homes.sqlite");
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
  if (persisted.bed.x !== -1097 || persisted.bed.y !== 69 || persisted.bed.z !== 728) {
    throw new Error(`stored bed is not H1 HEAD: ${JSON.stringify(persisted.bed)}`);
  }
  console.log("TEST-ONLY CURFEW HARNESS (not five-citizen, not two-bot)");
  console.log(`SQLITE claim probe_home home_id=${persisted.homeId} bed HEAD ${persisted.bed.x},${persisted.bed.y},${persisted.bed.z}`);

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
  let homeWalkLive = false;
  let h1SleepLive = false;
  try {
    const list = await cmd("list", "who-online");
    if (/Atlas|Maya|Theo|Ava|Kai|FishProbe|MineProbe|FarmProbe|MechProbe/i.test(list)) {
      throw new Error(`another probe or citizen is online: ${list.trim()}`);
    }
    await cmd("forceload add -1100 720 -1030 850", "forceload-site-c");
    forceloaded = true;
    const connected = await body.connect();
    if (!connected.success) throw new Error(`connect ${connected.code}`);
    await wait(800);
    await cmd(`op ${username}`, "op");
    await cmd(`effect give ${username} minecraft:saturation 30 4 true`, "saturation");
    const timeQuery = await cmd("time query daytime", "time-query");
    timeRestore = timeQuery.match(/(\d+)/)?.[1] ?? "1000";
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
      await runStage("late-day work departure and home walk", async () => {
        const bot = body.requireBot();
        const start = body.position();
        if (!start) throw new Error("no body at work site");
        const home = { x: H1_STAND.x + 0.5, y: H1_STAND.y, z: H1_STAND.z + 0.5 };
        const entrance = persisted.entrance
          ? { x: persisted.entrance.x + 0.5, y: persisted.entrance.y, z: persisted.entrance.z + 0.5 }
          : { x: H1_ENTRANCE.x + 0.5, y: H1_ENTRANCE.y, z: H1_ENTRANCE.z + 0.5 };
        const probeAt12000 = evaluateReturnHome({ position: start, home, timeOfDay: 12_000 });
        const departure = chooseDepartureTick(probeAt12000.estimateMs);
        await cmd(`time set ${departure.tick}`, "curfew-departure-clock");
        await wait(400);
        const timeOfDay = bot.time?.timeOfDay ?? departure.tick;
        const worldTick = (bot.time as { age?: number } | undefined)?.age ?? timeOfDay;
        const plan = evaluateReturnHome({ position: start, home, timeOfDay });
        const bedtime = evaluateLateDayBedtime({
          position: start,
          home,
          bed: persisted.bed,
          timeOfDay,
        });
        console.log(
          `CURFEW departure pos=${fmt(start)} claimedHome=${persisted.homeId} claimedBed=${persisted.bed.x},${persisted.bed.y},${persisted.bed.z} clock=${timeOfDay} worldTick=${worldTick} estimateMs=${plan.estimateMs} remainingMs=${plan.remainingMs} shouldStop=${plan.shouldStopOptionalWork} leftEarlier=${departure.leftEarlierThan12000} reason=${departure.reason} bedtime=${bedtime.reason}`,
        );
        if (!plan.shouldStopOptionalWork && timeOfDay >= 12_000) {
          console.log("CURFEW note: calculator did not force stop-work; continuing anyway because this is the dedicated curfew run");
        }
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
          timeoutMs: Math.max(90_000, plan.estimateMs + 45_000),
        });
        clearInterval(poll);
        const after = body.position();
        const arrivalTick = bot.time?.timeOfDay ?? 0;
        if (after) route.push(`arrive ${fmt(after)} t=${arrivalTick}`);
        console.log(`HOME_WALK route ${route.join(" -> ")}`);
        console.log(
          `HOME_WALK arrival pos=${after ? fmt(after) : "?"} clock=${arrivalTick} success=${moved.success} ${moved.success ? "" : `${moved.code} ${moved.error}`}`,
        );
        if (!moved.success) throw new Error(`${moved.code} ${moved.error} at ${after ? fmt(after) : "?"}`);
        if (!after) throw new Error("lost body");
        if (Math.abs(after.x - start.x) < 2 && Math.abs(after.z - start.z) < 2) {
          throw new Error("still at work site; TEST_CONTROL tp is not autonomous travel");
        }
        const dHome = xzDist(after, home);
        const dEntrance = xzDist(after, entrance);
        console.log(`HOME_WALK distStand=${dHome.toFixed(1)} distEntrance=${dEntrance.toFixed(1)} (entrance ≠ interior sleep)`);
        if (dHome > 2.4 && dEntrance > 2.4) {
          throw new Error(`did not reach H1 entrance or stand; ${fmt(after)}`);
        }
        homeWalkLive = true;
        return `walked ${fmt(start)} t=${timeOfDay} -> ${fmt(after)} t=${arrivalTick} dStand=${dHome.toFixed(1)} dEntrance=${dEntrance.toFixed(1)}`;
      }),
    );

    stages.push(
      await runStage("enter H1 and sleep own bed at night", async () => {
        if (!homeWalkLive) throw new Error("no physical home walk");
        let bot = body.requireBot();
        const atEntrance = body.position();
        if (!atEntrance) throw new Error("lost body before enter");
        console.log(`CURFEW at claimed home ${fmt(atEntrance)} — walk PASS is not yet a sleep PASS`);
        const interior = { x: H1_STAND.x + 0.5, y: H1_STAND.y, z: H1_STAND.z + 0.5 };
        const alreadyInside = xzDist(atEntrance, interior) <= 1.6 || atEntrance.z <= 730.8;
        let door = { toggled: false, open: true };
        if (!alreadyInside) {
          door = await openH1Door(bot);
          const here = bot.entity?.position;
          if (bot.entity && here) {
            bot.entity.yaw = Math.atan2(-(interior.x - here.x), -(interior.z - here.z));
            bot.entity.pitch = 0;
          }
          await walkForward(bot, 16);
          const toStand = await moveToPosition(bot, interior, { range: 0.8, timeoutMs: 20_000, recover: true });
          console.log(`CURFEW interior ${toStand.success ? "ok" : `${toStand.code} ${toStand.error}`}`);
        } else {
          door = await openH1Door(bot);
          console.log("CURFEW already inside H1 stand; not walking back toward the door");
        }
        const atStand = body.position();
        console.log(`CURFEW interior pos=${atStand ? fmt(atStand) : "?"}`);
        if (!atStand) throw new Error("lost body entering H1");
        if (xzDist(atStand, interior) > 2.2 && atStand.z > 731.2) {
          throw new Error(`entrance only; did not enter house at ${fmt(atStand)}`);
        }

        bot = body.requireBot();
        let tick = bot.time?.timeOfDay ?? 0;
        if (tick < VANILLA_NIGHT || tick >= 23_000) {
          await cmd("time set 18000", "night-for-own-bed-sleep");
          await wait(600);
          bot = body.requireBot();
          tick = bot.time?.timeOfDay ?? 18_000;
        }
        if (tick < VANILLA_NIGHT) throw new Error(`not a valid night tick (${tick}); need >= ${VANILLA_NIGHT}`);
        const ctx: SkillContext = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        let result = await sleep(ctx, fixtures.bedA);
        if (!result.success && result.code === "HOSTILE_NEARBY") {
          await cmd(`execute at ${username} run kill @e[type=!player,distance=..16]`, "clear-nearby-hostiles-once");
          await wait(500);
          bot = body.requireBot();
          result = await sleep({ body, bot, citizenId: "probe_home", timeoutMs: 120_000 }, fixtures.bedA);
        }
        const after = body.position();
        const sleptTick = bot.time?.timeOfDay ?? tick;
        console.log(
          `H1_SLEEP success=${result.success} ${result.success ? JSON.stringify(result.data) : `${result.code} ${result.error}`} pos=${after ? fmt(after) : "?"} tick=${sleptTick}`,
        );
        if (!result.success) throw new Error(`${result.code} ${result.error} at ${after ? fmt(after) : "?"}`);
        if (!result.data.designated) throw new Error("sleep did not use designated home bed");
        const sleptAt = (result.data as { position?: Cell }).position;
        if (!sleptAt || sleptAt.x !== -1097 || sleptAt.z !== 728) {
          throw new Error(`slept at ${JSON.stringify(sleptAt)} not H1 HEAD -1097,69,728`);
        }
        if (after && xzDist(after, H1_ENTRANCE) < 0.6 && xzDist(after, fixtures.bedA) > 3) {
          throw new Error(`still on entrance ${fmt(after)}; did not sleep inside`);
        }
        h1SleepLive = true;
        return `slept own ${ (result.data as { name?: string }).name ?? "bed" } HEAD -1097,69,728 from interior ${atStand ? fmt(atStand) : "?"} at tick ${sleptTick} doorToggled=${door.toggled}`;
      }),
    );
  } finally {
    try {
      if (timeRestore !== undefined) await Promise.race([rcon.command(`time set ${timeRestore}`), wait(4_000)]);
      await Promise.race([rcon.command(`deop ${username}`), wait(4_000)]);
      if (forceloaded) await Promise.race([rcon.command("forceload remove -1100 720 -1030 850"), wait(4_000)]);
    } catch {
      // cleanup best-effort
    }
    const chests = await verifyGreenChests(rcon).catch((error) => `CHEST_CHECK_ERROR ${error instanceof Error ? error.message : error}`);
    console.log(chests);
    try {
      await Promise.race([rcon.command("save-all flush"), wait(8_000)]);
    } catch {
      // ignore
    }
    rcon.close();
    try {
      body.stopPathfinding();
    } catch {
      // already gone
    }
    await Promise.race([body.disconnect("curfew-test"), wait(5_000)]).catch(() => undefined);
    leaveHome(store, "probe_home");
    store.close();
    const walk = stages.find((stage) => stage.name.includes("home walk"));
    const sleepStage = stages.find((stage) => stage.name.includes("sleep"));
    const failed = stages.some((stage) => !stage.passed) || stages.length < 2;
    const keepalive = stages.some((stage) => /NOT_CONNECTED|keepalive/i.test(stage.detail));
    const curfew = homeWalkLive && h1SleepLive && !failed && !keepalive;
    console.log("");
    console.log("Curfew LIVE results (not a five-citizen PASS)");
    for (const stage of stages) {
      console.log(`- ${stage.passed ? "PASS" : "FAIL"} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
    console.log(`HOME_WALK_LIVE=${walk?.passed ? "PASS" : "FAIL"}`);
    console.log(`H1_SLEEP_LIVE=${sleepStage?.passed ? "PASS" : "FAIL"}`);
    console.log(`CURFEW_LIVE=${curfew ? "PASS" : "FAIL"}`);
    if (keepalive) {
      console.log("TEST_LIFECYCLE FAIL: disconnect during the active task was reported, not swallowed");
    } else {
      console.log(`TEST_LIFECYCLE ${failed || keepalive ? "FAIL" : "PASS"}: harness exit ${failed || keepalive ? 1 : 0} after disconnect`);
    }
    process.exit(failed || keepalive ? 1 : 0);
  }
}

async function verifyGreenChests(rcon: RconClient): Promise<string> {
  await rcon.command("forceload add -1043 979 -1041 981").catch(() => undefined);
  await rcon.command("forceload add -955 943 -953 945").catch(() => undefined);
  await wait(2_000);
  let salmon = await rcon.command("execute in minecraft:overworld if items block -1042 63 980 container.* minecraft:salmon");
  let cod = await rcon.command("execute in minecraft:overworld if items block -1042 63 980 container.* minecraft:cod");
  let coal = await rcon.command("execute in minecraft:overworld if items block -954 58 944 container.* minecraft:coal");
  if (!rconPassed(salmon) || !rconPassed(cod) || !rconPassed(coal)) {
    await wait(2_000);
    salmon = await rcon.command("execute in minecraft:overworld if items block -1042 63 980 container.* minecraft:salmon");
    cod = await rcon.command("execute in minecraft:overworld if items block -1042 63 980 container.* minecraft:cod");
    coal = await rcon.command("execute in minecraft:overworld if items block -954 58 944 container.* minecraft:coal");
  }
  await rcon.command("forceload remove -1043 979 -1041 981").catch(() => undefined);
  await rcon.command("forceload remove -955 943 -953 945").catch(() => undefined);
  const ok = rconPassed(salmon) && rconPassed(cod) && rconPassed(coal);
  return `GREEN_CHESTS ${ok ? "PASS" : "FAIL"} fish=${rconPassed(salmon) && rconPassed(cod)} salmon=${rconPassed(salmon)} cod=${rconPassed(cod)} coal=${rconPassed(coal)}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
