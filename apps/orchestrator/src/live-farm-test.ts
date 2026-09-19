import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import { MinecraftBody, navigationBackend } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import {
  countItem,
  craftItem,
  depositItems,
  eatFood,
  inspectCrop,
  inspectFarm,
  plotCells,
  tillAndPlantPlot,
  withdrawItems,
  workFarmPlot,
  type SkillContext,
} from "@civ/skills";
import { tryRcon, type RconClient } from "./rcon.js";
import { evaluateFarmTestLaunch } from "./farm-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };
type BlockPos = { x: number; y: number; z: number };
type Snap = BlockPos & { name: string };

const BLOCK_NAMES = [
  "air",
  "cave_air",
  "grass_block",
  "dirt",
  "farmland",
  "wheat",
  "water",
  "chest",
  "crafting_table",
  "short_grass",
  "tall_grass",
  "stone",
] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printRedNeeds(): void {
  console.log("");
  console.log("Farm harness requires isolated Paper 1.21.11 at 127.0.0.1:25567 (RCON 25577).");
  console.log("Flags: MECHANICS_FARM_TEST_ENABLED=true FARM_TEST_ALLOW_WORLD_MUTATION=true");
  console.log("Never 25565 or 25566. Never Site C -1032,64,888.");
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

function mark(stage: Stage): string {
  if (stage.passed) return "PASS";
  if (stage.detail.startsWith("UNVERIFIED")) return "UNVERIFIED";
  if (stage.detail.startsWith("SKIP")) return "SKIP";
  return "FAIL";
}

function botBlockName(bot: SkillContext["bot"], pos: BlockPos): string | undefined {
  const origin = bot.entity?.position;
  if (!origin) return undefined;
  return bot.blockAt(origin.offset(pos.x - origin.x, pos.y - origin.y, pos.z - origin.z).floored())?.name;
}

function rconPassed(text: string): boolean {
  return text.toLowerCase().includes("passed") || text.toLowerCase().includes("test passed");
}

async function identifyBlock(rcon: RconClient, pos: BlockPos): Promise<string> {
  for (const name of BLOCK_NAMES) {
    const out = await rcon.command(`execute if block ${pos.x} ${pos.y} ${pos.z} minecraft:${name}`);
    if (rconPassed(out)) return name;
  }
  return "unknown";
}

async function main(): Promise<void> {
  loadEnv();
  const target = evaluateFarmTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    printRedNeeds();
    process.exit(2);
    return;
  }

  const username = process.env.FARM_TEST_USERNAME ?? "FarmProbe";
  if (!isMechanicsProbeUsername(username)) {
    throw new Error(`${username} is not a reserved probe name. Use FarmProbe.`);
  }

  const originEnv = process.env.FARM_TEST_ORIGIN?.split(",").map((part) => Number(part.trim()));
  if (!originEnv || originEnv.length !== 3 || originEnv.some((n) => !Number.isFinite(n))) {
    console.error("FARM_TEST_ORIGIN=x,y,z is required. Do not invent a pad near spawn.");
    process.exit(2);
    return;
  }
  const origin: BlockPos = {
    x: Math.floor(originEnv[0] ?? 0),
    y: Math.floor(originEnv[1] ?? 0),
    z: Math.floor(originEnv[2] ?? 0),
  };
  if (Math.abs(origin.x - -1032) < 48 && Math.abs(origin.z - 888) < 48) {
    console.error("Refusing farm fixtures inside Site C preserve box around -1032,64,888");
    process.exit(2);
    return;
  }

  const plot = plotCells(origin, 3);
  const water: BlockPos = { x: origin.x + 3, y: origin.y, z: origin.z + 1 };
  const chest: BlockPos = { x: origin.x + 3, y: origin.y + 1, z: origin.z - 2 };
  const table: BlockPos = { x: origin.x + 3, y: origin.y + 1, z: origin.z - 1 };
  const stand: BlockPos = { x: origin.x, y: origin.y + 1, z: origin.z - 2 };
  const walkway: BlockPos[] = [
    { x: origin.x, y: origin.y, z: origin.z - 1 },
    { x: origin.x + 1, y: origin.y, z: origin.z - 1 },
    { x: origin.x + 2, y: origin.y, z: origin.z - 1 },
    { x: origin.x, y: origin.y + 1, z: origin.z - 1 },
    { x: origin.x + 1, y: origin.y + 1, z: origin.z - 1 },
    { x: origin.x + 2, y: origin.y + 1, z: origin.z - 1 },
  ];
  const fixtureCells: BlockPos[] = [
    ...plot,
    ...plot.map((cell) => ({ x: cell.x, y: cell.y + 1, z: cell.z })),
    ...plot.map((cell) => ({ x: cell.x, y: cell.y + 2, z: cell.z })),
    ...walkway,
    water,
    { x: water.x, y: water.y + 1, z: water.z },
    { x: water.x, y: water.y + 2, z: water.z },
    { x: chest.x, y: chest.y - 1, z: chest.z },
    chest,
    table,
    { x: stand.x, y: stand.y - 1, z: stand.z },
  ];

  const base = loadConfig();
  const config = {
    ...base,
    MINECRAFT_HOST: target.host,
    MINECRAFT_PORT: target.port,
    MINECRAFT_VERSION: target.version,
    MINECRAFT_USERNAME: username,
    AUTO_START_PAPER: false as const,
  };

  console.log("TEST-ONLY 3x3 FARM HARNESS (fail-fast fixtures)");
  console.log(`target ${target.host}:${target.port} version=${target.version} rcon=${target.rconPort}`);
  console.log(`origin ${origin.x},${origin.y},${origin.z} water ${water.x},${water.y},${water.z} chest ${chest.x},${chest.y},${chest.z} table ${table.x},${table.y},${table.z}`);
  console.log(`stand ${stand.x + 0.5},${stand.y},${stand.z + 0.5}`);
  console.log("Spectator (stay off X 20-23, Z 238-242): /execute in minecraft:overworld run tp @s 16 73 232 -27 20");

  const body = new MinecraftBody({
    username,
    config,
    reconnect: false,
    allowRespawn: true,
  });

  const stages: Stage[] = [];
  let rcon: RconClient | undefined;
  let tickRestore: string | undefined;
  let originals: Snap[] = [];
  const suiteStarted = Date.now();
  let abortRest = false;

  const finish = async (code: number): Promise<void> => {
    try {
      if (rcon && tickRestore) {
        const restored = await rcon.command(`gamerule random_tick_speed ${tickRestore}`);
        console.log(`TEST_CONTROL restore tick ${restored.trim()}`);
      }
      if (rcon && originals.length > 0) {
        for (const snap of originals) {
          const out = await rcon.command(
            `setblock ${snap.x} ${snap.y} ${snap.z} minecraft:${snap.name === "unknown" ? "air" : snap.name} replace`,
          );
          console.log(`RESTORE ${snap.x},${snap.y},${snap.z} ${snap.name} ${out.trim().slice(0, 80)}`);
        }
      }
      if (rcon) {
        await rcon.command(`forceload remove ${origin.x - 16} ${origin.z - 16} ${origin.x + 16} ${origin.z + 16}`).catch(() => undefined);
        const leftover = await rcon.command("forceload query");
        console.log(`forceload leftover: ${leftover.trim() || "none"}`);
      }
    } catch (error) {
      console.error(`cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }
    rcon?.close();
    await body.disconnect("farm-test").catch(() => undefined);
    console.log("");
    console.log("3x3 farm results (not claimed unless every required stage PASS on live world)");
    for (const stage of stages) {
      console.log(`- ${mark(stage)} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
    console.log(`elapsedMs=${Date.now() - suiteStarted}`);
    process.exit(code);
  };

  const required = async (name: string, fn: () => Promise<string>): Promise<boolean> => {
    const stage = await runStage(name, fn);
    stages.push(stage);
    if (!stage.passed) {
      abortRest = true;
      console.error(`FAIL-FAST ${name}: ${stage.detail}`);
      return false;
    }
    return true;
  };

  try {
    const connected = await body.connect();
    if (!connected.success) {
      console.error(`Connect failed: ${connected.code} ${connected.error}`);
      printRedNeeds();
      process.exit(2);
      return;
    }
    await wait(1500);
    const bot = body.requireBot();
    const ctx: SkillContext = { body, bot, timeoutMs: 22_000 };
    const spawn = body.position();
    if (!spawn) throw new Error("No spawn position");
    console.log(`spawn ${spawn.x.toFixed(1)} ${spawn.y.toFixed(1)} ${spawn.z.toFixed(1)} food=${bot.food}`);

    const password = process.env.FARM_TEST_RCON_PASSWORD ?? "civ-world-lab-rcon";
    rcon = await tryRcon(target.host, target.rconPort, password);
    if (!rcon) {
      stages.push({ name: "rcon", passed: false, detail: "UNVERIFIED RCON unavailable", durationMs: 0 });
      await finish(2);
      return;
    }

    const cmd = async (command: string, label: string): Promise<string> => {
      const out = await rcon!.command(command);
      console.log(`TEST_CONTROL origin=${label} rcon ${command} => ${out.trim().slice(0, 160) || "(empty)"}`);
      return out;
    };

    await cmd(`op ${username}`, "op");
    const list = await cmd("list", "who-online");
    const playerPos = await rcon.command("data get entity Shadowskiii1 Pos").catch(() => "");
    if (playerPos.includes("entity data")) {
      const nums = [...playerPos.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
      const px = nums[0] ?? 0;
      const py = nums[1] ?? 0;
      const pz = nums[2] ?? 0;
      const dist = Math.hypot(px - origin.x, pz - origin.z);
      const onPad = px >= 20 && px <= 23 && pz >= 238 && pz <= 242 && py >= 68 && py <= 72;
      console.log(`human Shadowskiii1 ${px.toFixed(1)},${py.toFixed(1)},${pz.toFixed(1)} distXZ=${dist.toFixed(1)} onPad=${onPad}`);
      if (onPad) {
        stages.push({
          name: "exclusive-control",
          passed: false,
          detail: "Human is standing on the approved farm pad; refusing to mutate. Watch from 16,73,232",
          durationMs: 0,
        });
        await finish(2);
        return;
      }
    }
    console.log(`online ${list.trim()}`);

    await cmd(`forceload add ${origin.x - 16} ${origin.z - 16} ${origin.x + 16} ${origin.z + 16}`, "forceload");
    await wait(600);

    originals = [];
    for (const cell of fixtureCells) {
      const name = await identifyBlock(rcon, cell);
      originals.push({ ...cell, name });
    }
    console.log(`pre-test snapshot ${originals.map((s) => `${s.x},${s.y},${s.z}=${s.name}`).join(" ")}`);

    const knowledge = minecraftKnowledge();
    const breadRecipe = knowledge.getRecipe("bread");
    console.log(`bread recipe wheat=${breadRecipe?.ingredients.wheat} needsTable=${breadRecipe?.needsTable}`);

    const okFixture = await required("fixture preflight (read-back water/chest/plot)", async () => {
      for (const soil of plot) {
        await cmd(`setblock ${soil.x} ${soil.y} ${soil.z} minecraft:grass_block replace`, `soil-${soil.x}-${soil.z}`);
        await cmd(`setblock ${soil.x} ${soil.y + 1} ${soil.z} minecraft:air replace`, `air1-${soil.x}-${soil.z}`);
        await cmd(`setblock ${soil.x} ${soil.y + 2} ${soil.z} minecraft:air replace`, `air2-${soil.x}-${soil.z}`);
      }
      await cmd(`setblock ${stand.x} ${stand.y - 1} ${stand.z} minecraft:grass_block replace`, "stand-soil");
      await cmd(`setblock ${stand.x} ${stand.y} ${stand.z} minecraft:air replace`, "stand-air");
      for (const cell of walkway) {
        const block = cell.y === origin.y ? "minecraft:grass_block" : "minecraft:air";
        await cmd(`setblock ${cell.x} ${cell.y} ${cell.z} ${block} replace`, `walk-${cell.x}-${cell.y}-${cell.z}`);
      }
      await cmd(`setblock ${chest.x} ${chest.y - 1} ${chest.z} minecraft:grass_block replace`, "chest-support");
      await cmd(`setblock ${water.x} ${water.y + 1} ${water.z} minecraft:air replace`, "water-air");
      await cmd(`setblock ${water.x} ${water.y + 2} ${water.z} minecraft:air replace`, "water-air2");
      await cmd(`setblock ${water.x} ${water.y} ${water.z} minecraft:water replace`, "farm-pad-water");
      await cmd(`setblock ${chest.x} ${chest.y} ${chest.z} minecraft:chest[facing=west] replace`, "farm-pad-chest");
      await cmd(`setblock ${table.x} ${table.y} ${table.z} minecraft:crafting_table replace`, "farm-pad-table");
      await wait(400);

      const missing: string[] = [];
      for (const soil of plot) {
        const ground = await identifyBlock(rcon!, soil);
        const above = await identifyBlock(rcon!, { x: soil.x, y: soil.y + 1, z: soil.z });
        if (ground !== "grass_block" && ground !== "dirt") missing.push(`soil ${soil.x},${soil.y},${soil.z}=${ground}`);
        if (above !== "air" && above !== "cave_air") missing.push(`lip ${soil.x},${soil.y + 1},${soil.z}=${above}`);
      }
      const waterName = await identifyBlock(rcon!, water);
      const waterAbove = await identifyBlock(rcon!, { x: water.x, y: water.y + 1, z: water.z });
      const chestName = await identifyBlock(rcon!, chest);
      const tableName = await identifyBlock(rcon!, table);
      if (waterName !== "water") missing.push(`water ${water.x},${water.y},${water.z}=${waterName}`);
      if (waterAbove !== "air" && waterAbove !== "cave_air") missing.push(`water buried under ${waterAbove}`);
      if (chestName !== "chest") missing.push(`chest ${chest.x},${chest.y},${chest.z}=${chestName}`);
      if (tableName !== "crafting_table") missing.push(`table ${table.x},${table.y},${table.z}=${tableName}`);
      if (missing.length) throw new Error(`RCON read-back failed: ${missing.join("; ")}`);

      await cmd(`tp ${username} ${stand.x + 0.5} ${stand.y} ${stand.z + 0.5}`, "farm-pad-tp");
      if (typeof bot.waitForChunksToLoad === "function") await bot.waitForChunksToLoad();
      await wait(2500);

      const botMissing: string[] = [];
      if (botBlockName(bot, water) !== "water") botMissing.push(`bot water=${botBlockName(bot, water)}`);
      if (botBlockName(bot, chest) !== "chest") botMissing.push(`bot chest=${botBlockName(bot, chest)}`);
      if (botBlockName(bot, table) !== "crafting_table") botMissing.push(`bot table=${botBlockName(bot, table)}`);
      for (const soil of plot) {
        const ground = botBlockName(bot, soil);
        const above = botBlockName(bot, { x: soil.x, y: soil.y + 1, z: soil.z });
        if (ground !== "grass_block" && ground !== "dirt") botMissing.push(`bot soil ${soil.x},${soil.z}=${ground}`);
        if (above && above !== "air" && above !== "cave_air") botMissing.push(`bot lip ${soil.x},${soil.z}=${above}`);
      }
      if (botMissing.length) throw new Error(`Bot cannot observe fixtures: ${botMissing.join("; ")}`);

      await cmd(`clear ${username}`, "finite-inventory-reset");
      await cmd(`give ${username} wooden_hoe 1`, "finite-hoe");
      await cmd(`give ${username} wheat_seeds 16`, "finite-seeds");
      await wait(800);
      if (countItem(ctx, "wooden_hoe") < 1) throw new Error("hoe not in inventory after /give");
      if (countItem(ctx, "wheat_seeds") < 9) throw new Error("seeds not in inventory after /give");
      if (countItem(ctx, "wheat") !== 0) throw new Error("wheat already present; refusing fabricated harvest");
      if (countItem(ctx, "bread") !== 0) throw new Error("bread already present; refusing fabricated food");
      return `RCON+bot water=${waterName} chest=${chestName} table=${tableName} hoe=1 seeds=${countItem(ctx, "wheat_seeds")} wheat=0 bread=0`;
    });
    if (!okFixture) {
      await finish(1);
      return;
    }

    if (
      !(await required("locate hydrated tillable 3x3", async () => {
        const found = inspectFarm(bot, origin, 3, "wheat", water);
        if (!found.hydrated || !found.water) {
          throw new Error(`SITE_UNSUITABLE hydrated=${found.hydrated} water=${found.water ? `${found.water.x},${found.water.y},${found.water.z}` : "none"}`);
        }
        if (found.origin.x !== origin.x || found.origin.z !== origin.z) {
          throw new Error(`Refusing off-pad plot ${found.origin.x},${found.origin.y},${found.origin.z}`);
        }
        if (found.blocked > 0) throw new Error(`SITE_UNSUITABLE blocked=${found.blocked}`);
        return `origin ${found.origin.x},${found.origin.y},${found.origin.z} water ${found.water.x},${found.water.y},${found.water.z} untilled=${found.untilled}`;
      }))
    ) {
      await finish(1);
      return;
    }

    const seedsBeforeTill = countItem(ctx, "wheat_seeds");
    if (
      !(await required("till and plant 3x3 wheat", async () => {
        const made = await tillAndPlantPlot(ctx, origin, 3, "wheat");
        if (!made.success) throw new Error(`${made.code} ${made.error}`);
        if (made.data.tilled.length < 9) throw new Error(`tilled ${made.data.tilled.length}/9 failed=${JSON.stringify(made.data.failed)}`);
        if (made.data.planted.length < 9) throw new Error(`planted ${made.data.planted.length}/9 failed=${JSON.stringify(made.data.failed)}`);
        const bad: string[] = [];
        for (const soil of plot) {
          const crop = inspectCrop(bot, { x: soil.x, y: soil.y + 1, z: soil.z }, "wheat");
          if (!crop.farmland) bad.push(`no-farmland@${soil.x},${soil.y},${soil.z} soil=${crop.soilName}`);
          if (crop.cropName !== "wheat") bad.push(`crop=${crop.cropName}@${soil.x},${soil.y + 1},${soil.z}`);
        }
        if (bad.length) throw new Error(bad.join("; "));
        return `tilled=9 planted=9 seeds ${seedsBeforeTill}->${countItem(ctx, "wheat_seeds")}`;
      }))
    ) {
      await finish(1);
      return;
    }

    if (
      !(await required("grow wheat under Minecraft ticks", async () => {
        const speed = Number(process.env.FARM_TEST_RANDOM_TICK_SPEED ?? "300");
        if (Number.isInteger(speed) && speed > 3) {
          tickRestore = "3";
          await cmd(`gamerule random_tick_speed ${speed}`, "growth-acceleration");
        }
        const deadline = Date.now() + Number(process.env.FARM_TEST_GROWTH_MS ?? "240000");
        while (Date.now() < deadline) {
          const ages = plot.map((soil) => inspectCrop(bot, { x: soil.x, y: soil.y + 1, z: soil.z }, "wheat"));
          const mature = ages.filter((crop) => crop.mature).length;
          console.log(`growth poll mature=${mature}/9 ages=${ages.map((crop) => crop.age ?? "?").join(",")}`);
          if (mature >= 9) {
            if (tickRestore) {
              const restored = await rcon!.command(`gamerule random_tick_speed ${tickRestore}`);
              console.log(`TEST_CONTROL restore tick before harvest ${restored.trim()}`);
              tickRestore = undefined;
            }
            return `all 9 mature age>=7 tickSpeed=${speed || 3}`;
          }
          await wait(2000);
        }
        const ages = plot.map((soil) => inspectCrop(bot, { x: soil.x, y: soil.y + 1, z: soil.z }, "wheat").age ?? "?");
        throw new Error(`UNVERIFIED natural growth timeout ages=${ages.join(",")}`);
      }))
    ) {
      await finish(1);
      return;
    }

    const wheatBeforeHarvest = countItem(ctx, "wheat");
    const seedsBeforeHarvest = countItem(ctx, "wheat_seeds");
    if (
      !(await required("harvest mature wheat, collect drops, replant", async () => {
        const ages = plot.map((soil) => inspectCrop(bot, { x: soil.x, y: soil.y + 1, z: soil.z }, "wheat"));
        console.log(`pre-harvest ages=${ages.map((crop) => crop.age ?? "?").join(",")} mature=${ages.filter((crop) => crop.mature).length}`);
        const worked = await workFarmPlot(ctx, {
          origin,
          size: 3,
          kind: "wheat",
          water,
          seedStorage: chest,
          cropStorage: chest,
          maxHarvest: 9,
          replant: true,
        });
        if (!worked.success) throw new Error(`${worked.code} ${worked.error}`);
        const wheatHeld = countItem(ctx, "wheat");
        const wheatAfter = wheatHeld + worked.data.deposited;
        console.log(
          `workFarmPlot harvested=${worked.data.harvested.length} replanted=${worked.data.replanted.length} deposited=${worked.data.deposited} wheatDelta=${worked.data.wheatDelta} seedsDelta=${worked.data.seedsDelta} failed=${worked.data.failed.map((entry) => `${entry.position.x},${entry.position.z} ${entry.code}`).join(" | ") || "none"}`,
        );
        if (worked.data.harvested.length < 9) {
          throw new Error(`harvested ${worked.data.harvested.length}/9 remaining mature=${worked.data.inspected.mature}`);
        }
        if (wheatAfter < wheatBeforeHarvest + 3) {
          throw new Error(`wheat ${wheatBeforeHarvest}->held ${wheatHeld} chest+${worked.data.deposited}; need at least +3`);
        }
        if (worked.data.replanted.length < 1) throw new Error("no replanted wheat");
        return `harvested=${worked.data.harvested.length} replanted=${worked.data.replanted.length} wheat ${wheatBeforeHarvest}->${wheatAfter} (held ${wheatHeld}, chest +${worked.data.deposited}) seeds ${seedsBeforeHarvest}->${countItem(ctx, "wheat_seeds")}`;
      }))
    ) {
      await finish(1);
      return;
    }

    if (
      !(await required("craft bread from harvested wheat", async () => {
        if (countItem(ctx, "wheat") < 3) {
          const pulled = await withdrawItems(ctx, "wheat", 3, chest);
          if (!pulled.success) throw new Error(`need harvested wheat from designated chest: ${pulled.code} ${pulled.error}`);
        }
        const wheat = countItem(ctx, "wheat");
        if (wheat < 3) throw new Error(`UNVERIFIED not enough harvested wheat (${wheat})`);
        const beforeBread = countItem(ctx, "bread");
        const crafted = await craftItem(ctx, "bread", 1, table);
        if (!crafted.success) throw new Error(`${crafted.code} ${crafted.error}`);
        const afterBread = countItem(ctx, "bread");
        const afterWheat = countItem(ctx, "wheat");
        if (afterBread <= beforeBread) throw new Error("bread count did not increase");
        if (afterWheat > wheat - 3) throw new Error(`wheat not consumed ${wheat}->${afterWheat}`);
        return `bread ${beforeBread}->${afterBread} wheat ${wheat}->${afterWheat} (harvested wheat only)`;
      }))
    ) {
      await finish(1);
      return;
    }

    if (
      !(await required("deposit bread in chest, withdraw, eat", async () => {
        const beforeBread = countItem(ctx, "bread");
        if (beforeBread < 1) throw new Error("UNVERIFIED no bread to deposit");
        const back = await navigationBackend().navigateToPosition(
          bot,
          { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 },
          { range: 2, timeoutMs: 8_000 },
        );
        if (!back.success) {
          await cmd(`tp ${username} ${stand.x + 0.5} ${stand.y} ${stand.z + 0.5}`, "stand-before-chest");
          await wait(500);
        }
        if (botBlockName(bot, chest) !== "chest") throw new Error(`chest missing before deposit, bot sees ${botBlockName(bot, chest)}`);
        const deposited = await depositItems(ctx, "bread", chest);
        if (!deposited.success) throw new Error(`${deposited.code} ${deposited.error}`);
        if ((deposited.data.contents.bread ?? 0) < 1) throw new Error("chest bread count is 0");
        if (countItem(ctx, "bread") >= beforeBread) throw new Error("inventory bread did not decrease after deposit");
        const withdrawn = await withdrawItems(ctx, "bread", 1, chest);
        if (!withdrawn.success) throw new Error(`${withdrawn.code} ${withdrawn.error}`);
        await cmd(`effect give ${username} minecraft:hunger 8 255 true`, "hunger-for-eat");
        const hungryDeadline = Date.now() + 8_000;
        while ((bot.food ?? 20) >= 18 && Date.now() < hungryDeadline) {
          await wait(400);
        }
        await cmd(`effect clear ${username} minecraft:hunger`, "clear-hunger-before-eat");
        await wait(600);
        const hungerBefore = bot.food ?? 20;
        const foodBefore = countItem(ctx, "bread");
        if (foodBefore < 1) throw new Error("bread missing after chest withdraw");
        let eaten = await eatFood(ctx);
        if (!eaten.success) {
          await wait(800);
          eaten = await eatFood(ctx);
        }
        if (!eaten.success) throw new Error(`${eaten.code} ${eaten.error}`);
        const hungerAfter = bot.food ?? 0;
        const foodAfter = countItem(ctx, "bread");
        if (foodAfter >= foodBefore) throw new Error("bread count did not drop after eat");
        if (hungerAfter <= hungerBefore && hungerBefore < 20) {
          throw new Error(`hunger did not rise ${hungerBefore}->${hungerAfter}`);
        }
        return `chest bread ok; eat hunger ${hungerBefore}->${hungerAfter} bread ${foodBefore}->${foodAfter}`;
      }))
    ) {
      await finish(1);
      return;
    }

    void abortRest;
    const failed = stages.some((stage) => !stage.passed && !stage.detail.startsWith("UNVERIFIED") && !stage.detail.startsWith("SKIP"));
    const unverified = stages.some((stage) => stage.detail.startsWith("UNVERIFIED"));
    await finish(failed ? 1 : unverified ? 3 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printRedNeeds();
    await finish(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  printRedNeeds();
  process.exit(1);
});
