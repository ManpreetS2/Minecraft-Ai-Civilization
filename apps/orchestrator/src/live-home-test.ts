import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import {
  MinecraftBody,
  formatTerrainReport,
  inspectLocalTerrain,
  moveToPosition,
  navigationBackend,
  tryOpenAdjacentDoor,
  walkForward,
} from "@civ/minecraft-adapter";
import { countItem, depositItems, sleep, withdrawItems, type SkillContext } from "@civ/skills";
import {
  CivilizationStore,
  assertChestAccess,
  claimHome,
  leaveHome,
} from "@civ/agent-core";
import { tryRcon, type RconClient } from "./rcon.js";
import { evaluateHomeTestLaunch, parseApprovedHomeFixtures, type Cell } from "./home-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };
type BlockPos = Cell;

const TEST_ITEM = "paper";
/** Spectator /tp -1057 71 789 stands on mossy cobble above the bell. Bell-adjacent street parks the body on y=68 cobble. */
const VILLAGE_STREET: BlockPos = { x: -1082, y: 68, z: 799 };
const H1_DIRT_PATH: BlockPos = { x: -1096, y: 68, z: 733 };
const H1_DOOR: BlockPos = { x: -1096, y: 69, z: 731 };
const H1_STAND: BlockPos = { x: -1096, y: 69, z: 730 };
const H4_CHEST: BlockPos = { x: -1056, y: 65, z: 780 };
const H4_APPROACH: BlockPos = { x: -1059, y: 65, z: 780 };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printRedNeeds(): void {
  console.log("");
  console.log("Home harness: isolated Paper 1.21.11 127.0.0.1:25567 RCON 25577 seed 20260919.");
  console.log("Flags: MECHANICS_HOME_TEST_ENABLED=true HOME_TEST_ALLOW_WORLD_MUTATION=true HOME_TEST_RED_APPROVED=true HOME_TEST_PROFILE=H1_PROBE");
  console.log("HomeProbe fixture only. Never Atlas/Maya. Never 25565/25566. Never pnpm sim:start.");
}

function mark(stage: Stage): string {
  if (stage.detail.startsWith("UNVERIFIED")) return "UNVERIFIED";
  if (stage.detail.startsWith("SKIP")) return "SKIP";
  if (stage.passed) return "PASS";
  return "FAIL";
}

function xzDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function fmt(pos: { x: number; y?: number; z: number }): string {
  const y = pos.y === undefined ? "?" : pos.y.toFixed(1);
  return `${pos.x.toFixed(1)},${y},${pos.z.toFixed(1)}`;
}

function botBlock(bot: SkillContext["bot"], pos: BlockPos): { name: string } | undefined {
  const origin = bot.entity?.position;
  if (!origin) return undefined;
  return bot.blockAt(origin.offset(pos.x - origin.x, pos.y - origin.y, pos.z - origin.z).floored()) ?? undefined;
}

async function walkOntoH1Stoop(bot: SkillContext["bot"]): Promise<void> {
  const moved = await moveToPosition(
    bot,
    { x: -1095.5, y: 69, z: 732.5 },
    { range: 1.15, timeoutMs: 25_000, recover: true },
  );
  const here = bot.entity?.position;
  console.log(`H1 stoop ${moved.success ? "ok" : `${moved.code} ${moved.error}`} at ${here ? fmt(here) : "?"}`);
  if (!moved.success || !here || here.y < 68.6) {
    throw new Error(`could not stand on H1 stoop: ${moved.success ? fmt(here ?? { x: 0, z: 0 }) : `${moved.code} ${moved.error}`}`);
  }
}

async function openH1Door(bot: SkillContext["bot"]): Promise<void> {
  const origin = bot.entity?.position;
  if (!origin) throw new Error("no position for H1 door");
  const adjacent = await tryOpenAdjacentDoor(bot);
  console.log(
    `H1 door adjacent handled=${String(adjacent.handled)} toggled=${String(adjacent.toggled)} open=${String(adjacent.open)} name=${adjacent.name ?? "none"}`,
  );
  const block = bot.blockAt(origin.offset(-1096 - origin.x, 69 - origin.y, 731 - origin.z).floored());
  if (!block || !block.name.endsWith("_door")) throw new Error(`H1 door is ${block?.name ?? "missing"}`);
  const alreadyOpen = Boolean((block as { getProperties?: () => { open?: boolean } }).getProperties?.()?.open);
  if (alreadyOpen || (adjacent.handled && adjacent.open)) {
    console.log(`H1 door already open name=${block.name}; not toggling`);
  } else {
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await bot.activateBlock(block);
    await wait(400);
    const after = bot.blockAt(block.position);
    const opened = (after as { getProperties?: () => { open?: boolean } } | null)?.getProperties?.()?.open;
    console.log(`H1 door activate once open=${String(opened)} name=${after?.name ?? block.name}`);
    if (!opened) throw new Error("H1 oak door stayed closed after activateBlock");
  }
  const inside = { x: H1_STAND.x + 0.5, y: H1_STAND.y + 0.5, z: H1_STAND.z + 0.5 };
  const here = bot.entity?.position;
  if (bot.entity && here) {
    bot.entity.yaw = Math.atan2(-(inside.x - here.x), -(inside.z - here.z));
    bot.entity.pitch = 0;
  }
  try {
    if (bot.entity?.position) {
      await bot.lookAt(
        bot.entity.position.offset(inside.x - bot.entity.position.x, 0, inside.z - bot.entity.position.z),
        true,
      );
    }
  } catch {
    // yaw already set
  }
  const afterWalk = await walkForward(bot, 16);
  console.log(`H1 enter nudge ${afterWalk ? fmt(afterWalk) : "?"}`);
}

function rconPassed(text: string): boolean {
  return text.toLowerCase().includes("passed") || text.toLowerCase().includes("test passed");
}

async function runStage(name: string, fn: () => Promise<string>): Promise<Stage> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { name, passed: true, detail, durationMs: Date.now() - started };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name, passed: false, detail, durationMs: Date.now() - started };
  }
}

function seedProbe(store: CivilizationStore, id: string, name: string): void {
  store.upsertCitizen({
    id,
    name,
    minecraftUsername: name,
    createdAt: new Date().toISOString(),
    status: "offline",
  });
}

async function itemsInclude(rcon: RconClient, pos: BlockPos, item: string): Promise<boolean> {
  const out = await rcon.command(
    `execute in minecraft:overworld if items block ${pos.x} ${pos.y} ${pos.z} container.* minecraft:${item}`,
  );
  return rconPassed(out);
}

async function identifyBlock(rcon: RconClient, pos: BlockPos, candidates: string[]): Promise<string> {
  for (const name of candidates) {
    const out = await rcon.command(`execute in minecraft:overworld if block ${pos.x} ${pos.y} ${pos.z} minecraft:${name}`);
    if (rconPassed(out)) return name;
  }
  return "unknown";
}

async function main(): Promise<void> {
  loadEnv();
  const target = evaluateHomeTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    printRedNeeds();
    process.exit(2);
    return;
  }
  const fixtures = parseApprovedHomeFixtures(process.env);
  if ("error" in fixtures) {
    console.error(fixtures.error);
    printRedNeeds();
    process.exit(2);
    return;
  }
  if (process.env.HOME_TEST_ALLOW_PLACE_CHESTS === "true") {
    console.error("Refusing to place chests. RED already installed them.");
    process.exit(2);
    return;
  }

  const username = process.env.HOME_TEST_USERNAME ?? "HomeProbe";
  if (!isMechanicsProbeUsername(username) || username === "FarmProbe") {
    throw new Error("Use reserved HomeProbe, not a citizen and not FarmProbe.");
  }

  const base = loadConfig();
  const config = {
    ...base,
    MINECRAFT_HOST: target.host,
    MINECRAFT_PORT: target.port,
    MINECRAFT_VERSION: target.version,
    MINECRAFT_USERNAME: username,
    AUTO_START_PAPER: false as const,
  };

  const dbPath = join(mkdtempSync(join(tmpdir(), "civ-home-live-")), "homes.sqlite");
  const store = new CivilizationStore(dbPath);
  seedProbe(store, "probe_home", username);
  const settlement = store.getSettlement();
  settlement.storage = fixtures.communalChest;
  store.saveSettlement(settlement);

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
  if (!persisted.personalChest || persisted.personalChest.x !== -1096 || persisted.personalChest.z !== 729) {
    throw new Error(`stored chest is not H1 block: ${JSON.stringify(persisted.personalChest)}`);
  }
  console.log(`SQLITE claim probe_home home_id=${persisted.homeId} dim=${persisted.dimension}`);
  console.log(`SQLITE bed BLOCK ${persisted.bed.x},${persisted.bed.y},${persisted.bed.z}`);
  console.log(`SQLITE chest BLOCK ${persisted.personalChest.x},${persisted.personalChest.y},${persisted.personalChest.z}`);
  console.log(`SQLITE entrance ${persisted.entrance?.x},${persisted.entrance?.y},${persisted.entrance?.z}`);
  console.log(`sqlite path ${dbPath}`);

  const stages: Stage[] = [];
  const suiteStarted = Date.now();
  const bodyOptions = { username, config, reconnect: false as const, allowRespawn: true };
  let body = new MinecraftBody(bodyOptions);
  let rcon: RconClient | undefined;
  let timeRestore: string | undefined;
  let forceloaded = false;
  let stepFixture = false;
  let stepChunks = false;

  const finish = async (code: number): Promise<void> => {
    try {
      if (rcon) {
        if (timeRestore !== undefined) {
          const out = await rcon.command(`time set ${timeRestore}`);
          console.log(`CLEANUP restore time ${timeRestore} ${out.trim()}`);
        }
        await rcon.command(`clear ${username}`).catch(() => undefined);
        await rcon.command("data merge block -1096 69 729 {Items:[]}").catch(() => undefined);
        if (stepFixture) {
          const out = await rcon.command("setblock 201 67 400 minecraft:air");
          console.log(`CLEANUP remove 1-block dirt ${out.trim()}`);
        }
        if (stepChunks) {
          await rcon.command("forceload remove 192 392 208 408").catch(() => undefined);
        }
        if (forceloaded) {
          await rcon.command("forceload remove -1100 720 -1030 850").catch(() => undefined);
          const leftover = await rcon.command("forceload query");
          console.log(`CLEANUP forceload leftover: ${leftover.trim() || "none"}`);
        }
      }
    } catch (error) {
      console.error(`cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }
    rcon?.close();
    await body.disconnect("home-test").catch(() => undefined);
    leaveHome(store, "probe_home");
    leaveHome(store, "probe_home_b");
    store.close();
    console.log("");
    console.log("Persistent home LIVE results (not a five-citizen PASS)");
    for (const stage of stages) {
      console.log(`- ${mark(stage)} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
    console.log(`elapsedMs=${Date.now() - suiteStarted}`);
    process.exit(code);
  };

  try {
    console.log("TEST-ONLY HOMEPROBE HARNESS");
    console.log(`target ${target.host}:${target.port} version=${target.version} rcon=${target.rconPort} seed=20260919`);
    console.log(`probe ${username} identity probe_home home=${fixtures.homeId} (NOT Atlas/Maya/Theo/Ava/Kai)`);
    console.log(`H1 bed HEAD ${fixtures.bedA.x},${fixtures.bedA.y},${fixtures.bedA.z} chest BLOCK ${fixtures.chestA.x},${fixtures.chestA.y},${fixtures.chestA.z}`);
    console.log(`H4 closer unclaimed bed ${fixtures.distractorBed.x},${fixtures.distractorBed.y},${fixtures.distractorBed.z}`);
    console.log(`communal tannery ${fixtures.communalChest.x},${fixtures.communalChest.y},${fixtures.communalChest.z}`);

    const password = process.env.HOME_TEST_RCON_PASSWORD ?? process.env.FARM_TEST_RCON_PASSWORD ?? "civ-world-lab-rcon";
    rcon = await tryRcon(target.host, target.rconPort, password);
    if (!rcon) throw new Error("RCON unavailable on 25577; cannot preflight fixtures");

    const cmd = async (command: string, label: string): Promise<string> => {
      const out = await rcon!.command(command);
      console.log(`TEST_CONTROL ${label} rcon ${command} => ${out.trim().slice(0, 220) || "(empty)"}`);
      return out;
    };

    await cmd("forceload add -1100 720 -1030 850", "forceload-site-c");
    forceloaded = true;
    await wait(1500);

    const seedOut = await cmd("seed", "seed");
    if (!seedOut.includes("20260919")) throw new Error(`unexpected seed ${seedOut.trim()}`);

    stages.push(
      await runStage("preflight H1/H4/tannery blocks", async () => {
        const h1Bed = await identifyBlock(rcon!, fixtures.bedA, ["yellow_bed", "white_bed"]);
        const h1Chest = await identifyBlock(rcon!, fixtures.chestA, ["chest"]);
        const h1Door = await identifyBlock(rcon!, H1_DOOR, ["oak_door"]);
        const h4Bed = await identifyBlock(rcon!, fixtures.distractorBed, ["white_bed", "yellow_bed"]);
        const h4Chest = await identifyBlock(rcon!, H4_CHEST, ["chest"]);
        const tannery = await identifyBlock(rcon!, fixtures.communalChest, ["chest"]);
        if (h1Bed === "unknown" || h1Chest !== "chest") throw new Error(`H1 missing bed=${h1Bed} chest=${h1Chest}`);
        if (h4Bed === "unknown" || h4Chest !== "chest") throw new Error(`H4 missing bed=${h4Bed} chest=${h4Chest}`);
        if (tannery !== "chest") throw new Error(`tannery missing chest=${tannery}`);
        const nbt = await rcon!.command("data get block -1038 65 839");
        console.log(`preflight tannery nbt ${nbt.trim().slice(0, 400)}`);
        const hasBread = await itemsInclude(rcon!, fixtures.communalChest, "bread");
        const hasHelmet = await itemsInclude(rcon!, fixtures.communalChest, "leather_helmet");
        if (!hasBread || !hasHelmet) {
          throw new Error(`tannery starter loot missing bread=${hasBread} helmet=${hasHelmet}`);
        }
        return `H1 ${h1Bed}+${h1Chest} door=${h1Door}; H4 ${h4Bed}+${h4Chest}; tannery chest with bread+helmet`;
      }),
    );
    if (!stages.at(-1)?.passed) {
      await finish(1);
      return;
    }

    const connected = await body.connect();
    if (!connected.success) throw new Error(`connect ${connected.code} ${connected.error}`);
    await wait(1500);
    let bot = body.requireBot();
    let ctx: SkillContext = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
    const spawn = body.position();
    if (!spawn) throw new Error("No spawn position");
    console.log(`spawn ${fmt(spawn)} food=${bot.food} time=${bot.time.timeOfDay}`);

    await cmd(`op ${username}`, "op");
    await cmd(`effect give ${username} minecraft:saturation 30 4 true`, "probe-saturation");
    const list = await cmd("list", "who-online");
    if (/Atlas|Maya|Theo|Ava|Kai/i.test(list) && !/HomeProbe/.test(list)) {
      throw new Error("a citizen is online; aborting HomeProbe exclusive test");
    }

    const timeQuery = await cmd("time query daytime", "time-query");
    timeRestore = timeQuery.match(/(\d+)/)?.[1] ?? "1000";
    const cycleQuery = await cmd("gamerule do_daylight_cycle", "daylight-query");
    console.log(`gamerule do_daylight_cycle unavailable on this Paper (${cycleQuery.trim().slice(0, 80)}); using time set only`);

    stages.push(
      await runStage("shared one-block rise (disposable 200,400)", async () => {
        await cmd("forceload add 192 392 208 408", "forceload-step-pad");
        stepChunks = true;
        await wait(400);
        const grass = await identifyBlock(rcon!, { x: 200, y: 66, z: 400 }, ["grass_block"]);
        const air = await identifyBlock(rcon!, { x: 201, y: 67, z: 400 }, ["air"]);
        if (grass !== "grass_block" || air !== "air") {
          throw new Error(`disposable pad missing grass/air grass=${grass} air=${air}`);
        }
        const placed = await cmd("setblock 201 67 400 minecraft:dirt keep", "place-one-block-dirt");
        stepFixture = true;
        await cmd(`tp ${username} 200.5 67 400.5`, "step-pad-tp");
        await wait(1200);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 40_000 };
        const before = body.position();
        if (!before) throw new Error("no position on step pad");
        console.log(
          `STEP start ${fmt(before)} toward 201.5,68,400.5 onGround=${String(bot.entity?.onGround)} food=${bot.food}`,
        );
        const moved = await moveToPosition(ctx.bot, { x: 201.5, y: 68, z: 400.5 }, { range: 1.2, timeoutMs: 20_000, recover: true });
        const after = body.position();
        console.log(`STEP end ${after ? fmt(after) : "?"} success=${moved.success} ${moved.success ? "" : `${moved.code} ${moved.error}`}`);
        const removed = await cmd("setblock 201 67 400 minecraft:air", "remove-one-block-dirt");
        stepFixture = false;
        if (!moved.success) throw new Error(`${moved.code} ${moved.error} at ${after ? fmt(after) : "?"}`);
        if (!after || after.y < 67.6) throw new Error(`did not step up; ended y=${after?.y}`);
        return `TEST_CONTROL dirt at 201,67,400 (${placed.trim().slice(0, 40)}); walked ${fmt(before)} -> ${fmt(after)}; restored air (${removed.trim().slice(0, 40)})`;
      }),
    );

    stages.push(
      await runStage("A start near village center; H4 and tannery closer than H1", async () => {
        const before = body.position();
        if (!before) throw new Error("no position");
        const tp = await cmd(
          `tp ${username} ${VILLAGE_STREET.x} ${VILLAGE_STREET.y} ${VILLAGE_STREET.z}`,
          "initial-street-tp",
        );
        await wait(1200);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        const here = body.position();
        if (!here) throw new Error("no position after TEST_CONTROL tp");
        const dH1 = xzDist(here, fixtures.bedA);
        const dH4 = xzDist(here, fixtures.distractorBed);
        const dTan = xzDist(here, fixtures.communalChest);
        const terrain = inspectLocalTerrain(bot);
        if (terrain) console.log(`NAV terrain ${formatTerrainReport(terrain)}`);
        const nearby = body.nearbyEntities(16).map((e) => `${e.name}@${e.position.x.toFixed(0)},${e.position.z.toFixed(0)}`).join("; ");
        console.log(`NAV nearby ${nearby || "none"}`);
        console.log(`NAV start ${fmt(here)} dH1=${dH1.toFixed(1)} dH4=${dH4.toFixed(1)} dTannery=${dTan.toFixed(1)}`);
        if (dH1 <= dH4) throw new Error(`start is not closer to H4 than H1 (${dH4} vs ${dH1})`);
        if (dH1 <= dTan) throw new Error(`start is not closer to tannery than H1 (${dTan} vs ${dH1})`);
        return `TEST_CONTROL tp H5 dirt_path stand (avoids bell fence/cobble) from ${fmt(before)} -> ${fmt(here)} (rcon ${tp.trim().slice(0, 40)}); H4 ${dH4.toFixed(0)}m and tannery ${dTan.toFixed(0)}m closer than H1 ${dH1.toFixed(0)}m`;
      }),
    );

    stages.push(
      await runStage("A navigate to claimed H1, not nearer H4", async () => {
        const start = body.position();
        if (!start) throw new Error("no start");
        const dest = { x: fixtures.entrance.x + 0.5, y: fixtures.entrance.y, z: fixtures.entrance.z + 0.5 };
        const route = [
          { x: H1_DIRT_PATH.x + 0.5, y: H1_DIRT_PATH.y, z: H1_DIRT_PATH.z + 0.5, label: "H1 dirt_path", range: 2.2 },
          { ...dest, label: "H1 approach stoop", range: 1.15 },
        ];
        console.log(`NAV real path ${fmt(start)} via village dirt_path to H1 (no teleport)`);
        for (let i = 0; i < 20; i += 1) {
          const loaded = botBlock(bot, { x: -1096, y: 67, z: 733 });
          if (loaded?.name === "dirt_path") {
            console.log(`NAV H1 dirt_path chunk loaded as ${loaded.name}`);
            break;
          }
          if (i === 19) console.log(`NAV H1 dirt_path still ${loaded?.name ?? "unloaded"} after wait`);
          await wait(250);
        }
        let here = start;
        for (const step of route) {
          console.log(`NAV waypoint ${step.label} ${fmt(here)} -> ${step.x},${step.y},${step.z}`);
          const moved = await moveToPosition(ctx.bot, step, { range: step.range, timeoutMs: 90_000, recover: true });
          here = body.position() ?? here;
          const dH1w = xzDist(here, fixtures.bedA);
          const dH4w = xzDist(here, fixtures.distractorBed);
          console.log(
            `NAV waypoint ${step.label} end ${fmt(here)} success=${moved.success} code=${moved.success ? "ok" : moved.code} ${moved.success ? "" : moved.error} dH1=${dH1w.toFixed(1)} dH4=${dH4w.toFixed(1)}`,
          );
          if (!moved.success) {
            throw new Error(`${moved.code} ${moved.error} at ${fmt(here)} heading ${step.label}; did not teleport to H1`);
          }
        }
        console.log(`NAV end ${fmt(here)}`);
        const dH1 = xzDist(here, fixtures.bedA);
        const dH4 = xzDist(here, fixtures.distractorBed);
        if (dH1 > 8) throw new Error(`ended ${dH1.toFixed(1)}m from H1 bed at ${fmt(here)}`);
        if (dH4 < dH1) throw new Error(`ended closer to H4 (${dH4.toFixed(1)}) than H1 (${dH1.toFixed(1)}) at ${fmt(here)}`);
        const door = botBlock(bot, H1_DOOR);
        const bed = botBlock(bot, fixtures.bedA);
        const chest = botBlock(bot, fixtures.chestA);
        console.log(`H1 visible door=${door?.name} bed=${bed?.name} chest=${chest?.name}`);
        if (!bed?.name.endsWith("_bed")) throw new Error(`H1 bed not visible as bed: ${bed?.name}`);
        if (chest?.name !== "chest") throw new Error(`H1 chest not visible: ${chest?.name}`);
        return `walked ${fmt(start)} -> ${fmt(here)}; dH1=${dH1.toFixed(1)} dH4=${dH4.toFixed(1)}; door=${door?.name} bed=${bed.name} chest=${chest.name}`;
      }),
    );
    if (!stages.at(-1)?.passed) {
      await finish(1);
      return;
    }

    stages.push(
      await runStage("C H1 sleep on claimed HEAD bed", async () => {
        await cmd("time set 18000", "night-for-sleep");
        await wait(800);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        console.log(`sleep attempt timeOfDay=${bot.time.timeOfDay} isNight=${Boolean(body.observe().isNight)} at ${fmt(body.position() ?? { x: 0, y: 0, z: 0 })}`);
        const before = body.position();
        await walkOntoH1Stoop(bot);
        await openH1Door(bot);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        const toBed = await moveToPosition(
          ctx.bot,
          { x: H1_STAND.x + 0.5, y: H1_STAND.y, z: H1_STAND.z + 0.5 },
          { range: 0.8, timeoutMs: 20_000, recover: true },
        );
        const atStand = body.position();
        console.log(`sleep walk to H1 stand success=${toBed.success} at ${atStand ? fmt(atStand) : "?"} ${toBed.success ? "" : `${toBed.code} ${toBed.error}`}`);
        if (!toBed.success) throw new Error(`BED_UNREACHABLE ${toBed.code} ${toBed.error} at ${atStand ? fmt(atStand) : "?"}`);
        const toSleep = await navigationBackend().navigateToInteractWithBlock(ctx.bot, fixtures.bedA, { timeoutMs: 20_000 });
        const atBed = body.position();
        console.log(`sleep interact-nav ${toSleep.success ? "ok" : `${toSleep.code} ${toSleep.error}`} at ${atBed ? fmt(atBed) : "?"}`);
        if (!toSleep.success) throw new Error(`BED_UNREACHABLE ${toSleep.code} ${toSleep.error}`);
        if (!atBed || xzDist(atBed, fixtures.bedA) > 3.0) {
          throw new Error(`still too far from H1 bed at ${atBed ? fmt(atBed) : "unknown"}`);
        }
        const result = await sleep(ctx, fixtures.bedA);
        const after = body.position();
        const usedBed = botBlock(bot, fixtures.bedA);
        const h4Bed = botBlock(bot, fixtures.distractorBed);
        console.log(`sleep result success=${result.success} ${result.success ? JSON.stringify(result.data) : `${result.code} ${result.error}`}`);
        console.log(`after sleep pos ${after ? fmt(after) : "none"} H1bed=${usedBed?.name} H4bed=${h4Bed?.name ?? "not in range"}`);
        if (!result.success) throw new Error(`${result.code} ${result.error}`);
        if (!result.data.designated) throw new Error("sleep did not use designated home bed");
        if (result.data.position.x !== -1097 || result.data.position.z !== 728) {
          throw new Error(`slept at ${result.data.position.x},${result.data.position.y},${result.data.position.z} not H1 HEAD`);
        }
        if (after && xzDist(after, fixtures.distractorBed) < xzDist(after, fixtures.bedA)) {
          throw new Error(`after sleep closer to H4 than H1 at ${fmt(after)}`);
        }
        return `slept designated ${result.data.name} at ${result.data.position.x},${result.data.position.y},${result.data.position.z} from ${before ? fmt(before) : "?"}`;
      }),
    );

    stages.push(
      await runStage("B personal H1 chest not closer tannery", async () => {
        await cmd(`clear ${username}`, "clear-before-give");
        await cmd(`give ${username} minecraft:${TEST_ITEM} 1`, "give-paper");
        await wait(800);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        if (countItem(ctx, TEST_ITEM) < 1) throw new Error("TEST_CONTROL paper did not appear in HomeProbe inventory");
        await cmd(
          `tp ${username} ${VILLAGE_STREET.x} ${VILLAGE_STREET.y} ${VILLAGE_STREET.z}`,
          "storage-street-tp",
        );
        await wait(1500);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        const atStreet = body.position();
        if (!atStreet) throw new Error("no position after storage TEST_CONTROL tp");
        const dTan = xzDist(atStreet, fixtures.communalChest);
        const dH1 = xzDist(atStreet, fixtures.chestA);
        console.log(`storage start at street ${fmt(atStreet)} dTannery=${dTan.toFixed(1)} dH1chest=${dH1.toFixed(1)} paper=${countItem(ctx, TEST_ITEM)}`);
        if (dH1 <= dTan) throw new Error("street start is not closer to tannery than H1 chest");
        const toPath = await moveToPosition(
          ctx.bot,
          { x: H1_DIRT_PATH.x + 0.5, y: H1_DIRT_PATH.y, z: H1_DIRT_PATH.z + 0.5 },
          { range: 2.2, timeoutMs: 90_000, recover: true },
        );
        const atPath = body.position();
        console.log(`storage walked to H1 dirt_path ${atPath ? fmt(atPath) : "?"} success=${toPath.success} ${toPath.success ? "" : `${toPath.code} ${toPath.error}`}`);
        if (!toPath.success) throw new Error(`${toPath.code} ${toPath.error} at ${atPath ? fmt(atPath) : "?"}`);
        await walkOntoH1Stoop(bot);
        await openH1Door(bot);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        const toChest = await moveToPosition(
          ctx.bot,
          { x: fixtures.chestA.x + 0.5, y: fixtures.chestA.y, z: fixtures.chestA.z + 0.5 },
          { range: 1.6, timeoutMs: 15_000, recover: true },
        );
        const atH1 = body.position();
        console.log(`storage walked toward H1 chest ${atH1 ? fmt(atH1) : "?"} success=${toChest.success} ${toChest.success ? "" : `${toChest.code} ${toChest.error}`}`);
        if (!toChest.success) throw new Error(`${toChest.code} ${toChest.error} at ${atH1 ? fmt(atH1) : "?"}`);
        const tanneryBeforeBread = await itemsInclude(rcon!, fixtures.communalChest, "bread");
        const tanneryBeforeHelmet = await itemsInclude(rcon!, fixtures.communalChest, "leather_helmet");
        const tanneryBeforePaper = await itemsInclude(rcon!, fixtures.communalChest, TEST_ITEM);
        const paperBefore = countItem(ctx, TEST_ITEM);
        const deposited = await depositItems(ctx, TEST_ITEM, fixtures.chestA);
        const afterPos = body.position();
        if (!deposited.success) throw new Error(`${deposited.code} ${deposited.error} at ${afterPos ? fmt(afterPos) : "?"}`);
        const used = deposited.data.position;
        if (Math.floor(used.x) !== -1096 || Math.floor(used.z) !== 729) {
          throw new Error(`deposited at ${used.x},${used.y},${used.z} not H1 chest`);
        }
        if (countItem(ctx, TEST_ITEM) >= paperBefore) throw new Error("paper count did not drop after deposit");
        const h1HasPaper = await itemsInclude(rcon!, fixtures.chestA, TEST_ITEM);
        const tanneryAfterBread = await itemsInclude(rcon!, fixtures.communalChest, "bread");
        const tanneryAfterHelmet = await itemsInclude(rcon!, fixtures.communalChest, "leather_helmet");
        const tanneryAfterPaper = await itemsInclude(rcon!, fixtures.communalChest, TEST_ITEM);
        const h1Nbt = await rcon!.command("data get block -1096 69 729");
        console.log(`H1 chest after deposit paper=${h1HasPaper} nbt ${h1Nbt.trim().slice(0, 300)}`);
        console.log(`tannery after deposit bread=${tanneryAfterBread} helmet=${tanneryAfterHelmet} paper=${tanneryAfterPaper}`);
        if (!h1HasPaper) throw new Error("paper not in H1 chest");
        if (!tanneryAfterBread || !tanneryAfterHelmet) throw new Error("tannery bread/helmet changed");
        if (tanneryAfterPaper && !tanneryBeforePaper) throw new Error("paper appeared in tannery");
        if (!tanneryBeforeBread || !tanneryBeforeHelmet) throw new Error("tannery loot missing at start of deposit");
        const withdrawn = await withdrawItems(ctx, TEST_ITEM, 1, fixtures.chestA);
        if (!withdrawn.success) throw new Error(`withdraw ${withdrawn.code} ${withdrawn.error}`);
        if (countItem(ctx, TEST_ITEM) < 1) throw new Error("paper not back in inventory");
        const h1AfterWithdraw = await itemsInclude(rcon!, fixtures.chestA, TEST_ITEM);
        if (h1AfterWithdraw) throw new Error("paper still in H1 after withdraw");
        return `paper 1: inv ${paperBefore}->0 into H1 ${used.x},${used.y},${used.z} then withdraw inv ${countItem(ctx, TEST_ITEM)}; tannery bread+helmet unchanged`;
      }),
    );

    stages.push(
      await runStage("access denied to another probe-claimed chest", async () => {
        seedProbe(store, "probe_home_b", "HomeProbeB");
        const other = claimHome(store, {
          citizenId: "probe_home_b",
          homeId: "home_h4_probe_b",
          origin: H4_APPROACH,
          entrance: H4_APPROACH,
          bed: fixtures.distractorBed,
          personalChest: H4_CHEST,
          storageAccess: "personal",
        });
        if (!other.success) throw new Error(`second claim ${other.error}`);
        const denied = assertChestAccess(store, "probe_home", H4_CHEST, "personal");
        if (denied.success) throw new Error("HomeProbe was allowed into HomeProbeB personal chest");
        if (denied.code !== "ACCESS_DENIED") throw new Error(`${denied.code} ${denied.error}`);
        const own = assertChestAccess(store, "probe_home", fixtures.chestA, "personal");
        if (!own.success) throw new Error(`own chest denied: ${own.error}`);
        leaveHome(store, "probe_home_b");
        return `${denied.code} for H4 chest claimed by probe_home_b; own H1 chest still allowed`;
      }),
    );

    stages.push(
      await runStage("D persist claim across disconnect/reconnect and still route to H1", async () => {
        await body.disconnect("home-reconnect");
        await wait(800);
        body = new MinecraftBody(bodyOptions);
        const again = await body.connect();
        if (!again.success) throw new Error(`${again.code} ${again.error}`);
        await wait(1200);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        const home = store.getCitizenHome("probe_home");
        if (home?.homeId !== "home_h1" || home.bed.x !== -1097 || home.personalChest?.x !== -1096) {
          throw new Error(`claim lost: ${JSON.stringify(home)}`);
        }
        const spawn2 = body.position();
        await cmd(
          `tp ${username} ${VILLAGE_STREET.x} ${VILLAGE_STREET.y} ${VILLAGE_STREET.z}`,
          "reconnect-street-tp",
        );
        await wait(800);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        const start = body.position();
        const toPath = await moveToPosition(
          ctx.bot,
          { x: H1_DIRT_PATH.x + 0.5, y: H1_DIRT_PATH.y, z: H1_DIRT_PATH.z + 0.5 },
          { range: 2.2, timeoutMs: 90_000, recover: true },
        );
        if (!toPath.success) {
          const end = body.position();
          throw new Error(`post-reconnect nav ${toPath.code} ${toPath.error} at ${end ? fmt(end) : "?"}`);
        }
        await walkOntoH1Stoop(bot);
        await openH1Door(bot);
        bot = body.requireBot();
        ctx = { body, bot, citizenId: "probe_home", timeoutMs: 120_000 };
        const moved = await navigationBackend().navigateToInteractWithBlock(ctx.bot, fixtures.chestA, { timeoutMs: 20_000 });
        const atChest = body.position();
        if (!moved.success) throw new Error(`post-reconnect interact ${moved.code} ${moved.error} at ${atChest ? fmt(atChest) : "?"}`);
        if (!atChest || xzDist(atChest, fixtures.chestA) > 3.2) throw new Error(`post-reconnect ended ${atChest ? fmt(atChest) : "unknown"} not at H1 chest`);
        return `sqlite home_h1 bed -1097,69,728 chest -1096,69,729; spawn ${spawn2 ? fmt(spawn2) : "?"} then walked ${start ? fmt(start) : "?"} -> ${atChest ? fmt(atChest) : "unknown"}`;
      }),
    );

    stages.push(
      await runStage("E missing designated bed fails without reassignment", async () => {
        const missing = await sleep(ctx, { x: fixtures.bedA.x, y: fixtures.bedA.y + 32, z: fixtures.bedA.z });
        if (missing.success) throw new Error("sleep at empty air succeeded");
        if (missing.code !== "BED_MISSING") throw new Error(`${missing.code} ${missing.error}`);
        const home = store.getCitizenHome("probe_home");
        if (home?.homeId !== "home_h1" || home.bed.x !== -1097) {
          throw new Error("ownership rewritten after missing-bed failure");
        }
        return `${missing.code}; home_id still home_h1 bed -1097,69,728 (village furniture not destroyed)`;
      }),
    );

    const failed = stages.some(
      (stage) => !stage.passed && !stage.detail.startsWith("SKIP") && !stage.detail.startsWith("UNVERIFIED"),
    );
    await finish(failed ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printRedNeeds();
    stages.push({
      name: "harness",
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - suiteStarted,
    });
    await finish(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  printRedNeeds();
  process.exit(1);
});
