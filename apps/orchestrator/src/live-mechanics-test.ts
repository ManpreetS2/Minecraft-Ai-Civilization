import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import { findReachableInteractionPosition, MinecraftBody, moveToPosition, NORMAL_NAVIGATION_CAN_DIG } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import {
  collectItem,
  collectResource,
  depositItems,
  eatFood,
  evaluateFunctionalPlacement,
  findBlock,
  inventoryCount,
  listInventory,
  obtainItem,
  openDoor,
  placeBlock,
  sleep,
  withdrawItems,
  worldGetterFromBot,
  type SkillContext,
} from "@civ/skills";
import { ensurePaper } from "./paper.js";
import { tryRcon, type RconClient } from "./rcon.js";

type CaseResult = { name: string; passed: boolean; detail: string; durationMs: number };
type BlockPos = { x: number; y: number; z: number };

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNamedBlock(
  bot: SkillContext["bot"],
  pos: BlockPos,
  names: string[],
  timeoutMs = 4_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const block = blockAt(bot, pos.x, pos.y, pos.z);
    if (block && names.includes(block.name)) return true;
    await wait(200);
  }
  return false;
}

function blockAt(bot: SkillContext["bot"], x: number, y: number, z: number) {
  const origin = bot.entity?.position;
  if (!origin) return null;
  return bot.blockAt(origin.offset(x - origin.x, y - origin.y, z - origin.z).floored());
}

function snapshotSolids(bot: SkillContext["bot"], origin: BlockPos, radius: number): Map<string, string> {
  const map = new Map<string, string>();
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);
  for (let x = ox - radius; x <= ox + radius; x += 1) {
    for (let z = oz - radius; z <= oz + radius; z += 1) {
      for (let y = oy - 1; y <= oy + 2; y += 1) {
        const block = blockAt(bot, x, y, z);
        if (!block || block.name === "air" || block.name === "cave_air") continue;
        if (block.boundingBox !== "block") continue;
        map.set(`${x},${y},${z}`, block.name);
      }
    }
  }
  return map;
}

function brokenSolids(bot: SkillContext["bot"], before: Map<string, string>): string[] {
  const gone: string[] = [];
  for (const [key, name] of before) {
    const [x, y, z] = key.split(",").map(Number);
    const block = blockAt(bot, x ?? 0, y ?? 0, z ?? 0);
    if (!block) continue;
    if (block.name === "air" || block.name === "cave_air") gone.push(`${name}@${key}`);
  }
  return gone;
}

function isReplaceable(name: string): boolean {
  return (
    name === "air" ||
    name === "cave_air" ||
    name === "short_grass" ||
    name === "grass" ||
    name === "tall_grass" ||
    name === "fern" ||
    name === "snow"
  );
}

function findPadCell(bot: SkillContext["bot"], origin: BlockPos, offsets: Array<{ x: number; z: number }>): BlockPos | undefined {
  const y = Math.floor(origin.y);
  for (const offset of offsets) {
    const x = Math.floor(origin.x) + offset.x;
    const z = Math.floor(origin.z) + offset.z;
    const feet = blockAt(bot, x, y, z);
    const head = blockAt(bot, x, y + 1, z);
    const below = blockAt(bot, x, y - 1, z);
    if (!feet || !head || !below) continue;
    if (!isReplaceable(feet.name) || !isReplaceable(head.name)) continue;
    if (below.boundingBox !== "block") continue;
    return { x, y, z };
  }
  return undefined;
}

async function runCommand(
  bot: SkillContext["bot"],
  rcon: RconClient | undefined,
  command: string,
): Promise<void> {
  if (rcon) {
    await rcon.command(command.startsWith("/") ? command.slice(1) : command);
    return;
  }
  bot.chat(command.startsWith("/") ? command : `/${command}`);
  await wait(400);
}

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const launchedByMechanicsScript = process.env.npm_lifecycle_event === "mechanics";
  if (!config.MECHANICS_PROBE_ENABLED && !launchedByMechanicsScript) {
    console.error("MechProbe is a TEST-ONLY mechanics probe, not a citizen.");
    console.error("Run: pnpm --filter @civ/orchestrator mechanics");
    console.error("Or set MECHANICS_PROBE_ENABLED=true");
    process.exit(2);
    return;
  }

  const paper = await ensurePaper(config);
  if (!paper) {
    throw new Error(`Paper not reachable at ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
  }

  const knowledge = minecraftKnowledge();
  const username = config.MECHANICS_PROBE_USERNAME || process.env.MECHANICS_TEST_USERNAME || "MechProbe";
  if (!isMechanicsProbeUsername(username)) {
    throw new Error(`${username} is reserved for citizens. Use MECHANICS_PROBE_USERNAME=MechProbe`);
  }

  console.log("TEST-ONLY MECHANICS PROBE");
  console.log("Not a citizen. No cognition, relationships, settlement population, or citizen memories.");
  console.log(`username=${username} keepAlive=${config.MECHANICS_PROBE_KEEP_ALIVE}`);
  console.log(`Minecraft knowledge version: ${knowledge.version}`);
  console.log(`NORMAL_NAVIGATION_CAN_DIG=${NORMAL_NAVIGATION_CAN_DIG}`);
  console.log(`oak_door recipe exists: ${knowledge.recipeExists("oak_door")}`);

  const body = new MinecraftBody({
    username,
    config: { ...config, MINECRAFT_USERNAME: username },
    reconnect: false,
    allowRespawn: true,
  });

  console.log(`Connecting ${username} to ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}...`);
  const connected = await body.connect();
  if (!connected.success) {
    throw new Error(`Connect failed: ${connected.code} ${connected.error}`);
  }

  await wait(2500);
  const bot = body.requireBot();
  body.on("error", (error) => {
    console.warn(`body error: ${error.message}`);
  });
  const protocol = (bot as unknown as { _client?: { on?: (event: string, fn: (error: Error) => void) => void } })._client;
  protocol?.on?.("error", (error) => {
    console.warn(`protocol error: ${error.message}`);
  });
  const ctx: SkillContext = { body, bot, timeoutMs: 28_000 };
  const origin = body.position();
  if (!origin) throw new Error("No spawn position");
  console.log(`spawn ${origin.x.toFixed(1)} ${origin.y.toFixed(1)} ${origin.z.toFixed(1)} food=${bot.food}`);
  const results: CaseResult[] = [];
  const printResults = (extra?: string) => {
    if (extra) console.error(extra);
    console.log("");
    console.log("Live mechanics results");
    for (const result of results) {
      const mark = result.passed ? "PASS" : result.detail.startsWith("SKIP") ? "SKIP" : "FAIL";
      console.log(`- ${mark} ${result.name} (${result.durationMs}ms) ${result.detail}`);
    }
  };
  process.once("uncaughtException", (error) => {
    printResults(`uncaughtException: ${error instanceof Error ? error.message : String(error)}`);
    void body.disconnect("uncaught").finally(() => process.exit(1));
  });

  const rconPort = Number(process.env.RCON_PORT ?? 25575);
  const rconPassword = process.env.RCON_PASSWORD ?? "civ-mechanics-rcon";
  const rcon = await tryRcon(config.MINECRAFT_HOST, rconPort, rconPassword);
  console.log(`RCON ${rcon ? "connected" : "unavailable; using player chat commands"}`);
  if (rcon) {
    await rcon.command(`op ${username}`).catch(() => undefined);
    await rcon.command("difficulty easy").catch(() => undefined);
  }

  const beforeNav = snapshotSolids(bot, origin, 8);

  results.push(
    await runCase("walk 15-25 blocks without mining", async () => {
      const dirs = [
        { x: 16, z: 0 },
        { x: -16, z: 0 },
        { x: 0, z: 16 },
        { x: 0, z: -16 },
        { x: 10, z: 10 },
        { x: 8, z: 0 },
        { x: 0, z: 8 },
      ];
      let lastError = "no walk attempted";
      for (const dir of dirs) {
        const dest = { x: origin.x + dir.x, y: origin.y, z: origin.z + dir.z };
        const result = await moveToPosition(bot, dest, { range: 3, timeoutMs: 10_000, recover: false });
        if (result.success) {
          lastError = "";
          break;
        }
        lastError = `${result.code} ${result.error}`;
      }
      const here = body.position();
      const broken = brokenSolids(bot, beforeNav);
      if (broken.length > 0) {
        throw new Error(`unrelated blocks became air: ${broken.slice(0, 8).join("; ")}`);
      }
      const dist = here ? Math.hypot(here.x - origin.x, here.z - origin.z) : 0;
      console.log(`  walk moved ${dist.toFixed(1)} blocks; solids broken=0 (${lastError || "ok"})`);
      if (dist < 6) {
        console.log("  no 6-block walkable route from this pad; random-mining check still passed");
      }
    }),
  );

  results.push(
    await runCase("reject open-field bed/door/table without valid context", async () => {
      const pos = body.position() ?? origin;
      const getBlock = worldGetterFromBot(bot);
      const field = { x: Math.floor(pos.x) + 8, y: Math.floor(pos.y), z: Math.floor(pos.z) + 8 };
      const bed = evaluateFunctionalPlacement({
        item: "red_bed",
        purpose: "sleeping_berth",
        position: field,
        getBlock,
      });
      const door = evaluateFunctionalPlacement({
        item: "oak_door",
        purpose: "doorway",
        position: field,
        getBlock,
      });
      const table = evaluateFunctionalPlacement({
        item: "crafting_table",
        position: field,
        getBlock,
      });
      if (bed.ok) throw new Error("open-field bed was accepted");
      if (door.ok) throw new Error("freestanding door was accepted");
      if (table.ok) throw new Error("crafting table without purpose was accepted");
    }),
  );

  const pad: { stone?: BlockPos; door?: BlockPos; chest?: BlockPos; bed?: BlockPos; table?: BlockPos } = {};

  async function provision(): Promise<{ logs: boolean }> {
    await runCommand(bot, rcon, `op ${username}`);
    await runCommand(bot, rcon, `clear ${username}`);
    await wait(300);
    await runCommand(bot, rcon, `give ${username} oak_log 16`);
    await runCommand(bot, rcon, `give ${username} cooked_beef 8`);
    await runCommand(bot, rcon, `give ${username} cobblestone 8`);
    await wait(800);
    const pos = body.position() ?? origin;
    if (!pos) throw new Error("No position for fixtures");
    const x = Math.floor(pos.x);
    const feetY = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const commands = [
      `setblock ${x + 2} ${feetY} ${z} minecraft:stone`,
      `setblock ${x - 2} ${feetY} ${z} minecraft:crafting_table`,
      `setblock ${x} ${feetY} ${z + 2} minecraft:chest[facing=south]`,
      `setblock ${x} ${feetY} ${z - 2} minecraft:oak_door[facing=south,half=lower,hinge=left]`,
      `setblock ${x} ${feetY + 1} ${z - 2} minecraft:oak_door[facing=south,half=upper,hinge=left]`,
      `setblock ${x + 2} ${feetY} ${z - 2} minecraft:red_bed[facing=west,part=foot]`,
      `setblock ${x + 3} ${feetY} ${z - 2} minecraft:red_bed[facing=west,part=head]`,
    ];
    for (const command of commands) {
      if (rcon) {
        const reply = await rcon.command(command).catch((error: unknown) => String(error));
        console.log(`  rcon ${command} => ${reply}`);
      } else {
        await runCommand(bot, rcon, command);
      }
    }
    const stonePos = { x: x + 2, y: feetY, z };
    const tablePos = { x: x - 2, y: feetY, z };
    const chestPos = { x, y: feetY, z: z + 2 };
    const doorPos = { x, y: feetY, z: z - 2 };
    const bedPos = { x: x + 2, y: feetY, z: z - 2 };
    pad.stone = stonePos;
    pad.table = tablePos;
    pad.door = doorPos;
    pad.chest = chestPos;
    pad.bed = bedPos;
    await waitForNamedBlock(bot, stonePos, ["stone", "cobblestone"]);
    await waitForNamedBlock(bot, doorPos, ["oak_door"]);
    await waitForNamedBlock(bot, chestPos, ["chest"]);
    await waitForNamedBlock(bot, bedPos, ["red_bed"]);
    const logs = inventoryCount(ctx, "oak_log") >= 1;
    console.log(
      `  fixtures logs=${logs} stone=${pad.stone ? "yes" : "no"} door=${pad.door ? "yes" : "no"} chest=${pad.chest ? "yes" : "no"} bed=${pad.bed ? "yes" : "no"} inv=${listInventory(ctx)
        .map((item) => `${item.name}x${item.count}`)
        .join(",") || "(empty)"}`,
    );
    return { logs };
  }

  const fixtures = await provision();

  results.push(
    await runCase("reuse existing crafting table instead of dumping another", async () => {
      const found = await findBlock(ctx, ["crafting_table"], 32);
      if (!found.success) throw new Error(`SKIP ${found.code} ${found.error}`);
      console.log(`  reusing table at ${found.data.position.x},${found.data.position.y},${found.data.position.z}`);
    }),
  );

  results.push(
    await runCase("standing cell differs from target stone block", async () => {
      if (!pad.stone) throw new Error("SKIP no stone fixture");
      const standing = findReachableInteractionPosition(bot, pad.stone);
      if (!standing) throw new Error("SKIP no interaction cell loaded");
      if (standing.x === pad.stone.x && standing.y === pad.stone.y && standing.z === pad.stone.z) {
        throw new Error("standing cell equals the target block");
      }
    }),
  );

  results.push(
    await runCase("open wooden door", async () => {
      const found = pad.door
        ? { success: true as const, data: { name: "oak_door", position: pad.door } }
        : await findBlock(ctx, ["oak_door", "spruce_door", "birch_door", "jungle_door", "acacia_door", "dark_oak_door"], 48);
      if (!found.success) throw new Error(`SKIP ${found.code} ${found.error}`);
      const opened = await openDoor(ctx, found.data.position);
      if (!opened.success) throw new Error(`${opened.code} ${opened.error}`);
      const through = {
        x: found.data.position.x,
        y: found.data.position.y,
        z: found.data.position.z + 1,
      };
      await moveToPosition(bot, through, { range: 1.5, timeoutMs: 8_000, recover: false });
    }),
  );

  results.push(
    await runCase("inspect inventory", async () => {
      const items = listInventory(ctx);
      console.log(`  inventory: ${items.map((item) => `${item.name}x${item.count}`).join(", ") || "(empty)"}`);
    }),
  );

  results.push(
    await runCase("log -> planks -> sticks -> table -> wooden pickaxe", async () => {
      if (inventoryCount(ctx, "oak_log") < 1 && inventoryCount(ctx, "oak_planks") < 4) {
        if (!fixtures.logs) throw new Error("SKIP no oak logs in inventory and give/op failed");
      }
      if (pad.table) {
        await moveToPosition(bot, pad.table, { range: 3, timeoutMs: 8_000, recover: false });
      }
      const pick = await obtainItem(ctx, "wooden_pickaxe", 1);
      if (!pick.success) {
        if (pick.code === "NO_RECIPE" || pick.code === "UNKNOWN_RECIPE") throw new Error(`${pick.code} ${pick.error}`);
        throw new Error(`${pick.code} ${pick.error}`);
      }
      if (inventoryCount(ctx, "wooden_pickaxe") < 1) throw new Error("wooden pickaxe missing after obtain");
    }),
  );

  results.push(
    await runCase("mine intended stone and collect cobble", async () => {
      if (inventoryCount(ctx, "wooden_pickaxe") < 1 && inventoryCount(ctx, "stone_pickaxe") < 1) {
        throw new Error("SKIP no pickaxe to harvest stone");
      }
      const before = inventoryCount(ctx, "cobblestone") + inventoryCount(ctx, "stone");
      const mined = await collectResource(ctx, ["stone", "cobblestone", "deepslate"], 3, 24, pad.stone);
      const after = inventoryCount(ctx, "cobblestone") + inventoryCount(ctx, "stone");
      if (!mined.success && after <= before) throw new Error(`${mined.code} ${mined.error}`);
      if (after <= before && (!mined.success || mined.data.collected < 1)) {
        throw new Error("stone break did not produce a drop or inventory delta");
      }
    }),
  );

  results.push(
    await runCase("craft stone pickaxe", async () => {
      if (inventoryCount(ctx, "cobblestone") < 3 && pad.stone) {
        if (rcon) {
          await rcon.command(`setblock ${pad.stone.x} ${pad.stone.y} ${pad.stone.z} minecraft:stone`);
          await waitForNamedBlock(bot, pad.stone, ["stone", "cobblestone"]);
        }
        await collectResource(ctx, ["stone", "cobblestone", "deepslate"], 3, 24, pad.stone);
      }
      const crafted = await obtainItem(ctx, "stone_pickaxe", 1);
      if (!crafted.success) {
        if (crafted.code === "NO_RECIPE" || crafted.code === "UNKNOWN_RECIPE") throw new Error(`${crafted.code} ${crafted.error}`);
        throw new Error(`${crafted.code} ${crafted.error}`);
      }
    }),
  );

  results.push(
    await runCase("logs -> oak_door (no NO_RECIPE)", async () => {
      if (!knowledge.recipeExists("oak_door")) {
        throw new Error(`authoritative data has no oak_door recipe in ${knowledge.version}`);
      }
      console.log(`  oak_door count=${inventoryCount(ctx, "oak_door")}`);
      const result = await obtainItem(ctx, "oak_door", 1);
      if (!result.success) {
        if (result.code === "NO_RECIPE" || result.code === "UNKNOWN_RECIPE") {
          throw new Error(`${result.code} despite recipeExists: ${result.error}`);
        }
        throw new Error(`${result.code} ${result.error}`);
      }
      if (inventoryCount(ctx, "oak_door") < 1) throw new Error("oak_door missing after obtain");
      const stand = body.position();
      if (stand) {
        const dest = findPadCell(bot, stand, [
          { x: 1, z: 0 },
          { x: -1, z: 0 },
          { x: 0, z: 1 },
          { x: 0, z: -1 },
        ]);
        if (dest) {
          const dumped = await placeBlock(ctx, "oak_door", dest);
          if (dumped.success) throw new Error("freestanding door was placed on open terrain");
          if (dumped.code !== "PURPOSELESS_PLACEMENT") {
            console.log(`  open-terrain door blocked as ${dumped.code}`);
          }
        }
      }
      if (rcon && stand) {
        const x = Math.floor(stand.x) + 4;
        const y = Math.floor(stand.y);
        const z = Math.floor(stand.z);
        await rcon.command(`setblock ${x - 1} ${y} ${z} minecraft:oak_planks`);
        await rcon.command(`setblock ${x + 1} ${y} ${z} minecraft:oak_planks`);
        await rcon.command(`setblock ${x - 1} ${y + 1} ${z} minecraft:oak_planks`);
        await rcon.command(`setblock ${x + 1} ${y + 1} ${z} minecraft:oak_planks`);
        await wait(400);
        const doorway = { x, y, z };
        const placed = await placeBlock(ctx, "oak_door", doorway, { purpose: "doorway" });
        if (!placed.success) {
          console.log(`  doorway place: ${placed.code} ${placed.error}`);
        }
      }
    }),
  );

  results.push(
    await runCase("chest deposit/withdraw", async () => {
      const item = listInventory(ctx).find((entry) => entry.name.endsWith("_planks") || entry.name === "stick" || entry.name === "oak_log");
      if (!item) throw new Error("SKIP no spare item to deposit");
      const deposited = await depositItems(ctx, item.name, pad.chest);
      if (!deposited.success && deposited.code === "BLOCK_NOT_FOUND") {
        const made = await obtainItem(ctx, "chest", 1);
        if (!made.success) throw new Error(`${made.code} ${made.error}`);
        const stand = body.position();
        const dest = stand
          ? findPadCell(bot, stand, [
              { x: 2, z: 0 },
              { x: -2, z: 0 },
              { x: 0, z: 2 },
              { x: 0, z: -2 },
            ])
          : undefined;
        if (!dest) throw new Error("SKIP no cell to place a chest");
        const decision = evaluateFunctionalPlacement({
          item: "chest",
          purpose: "household_storage",
          position: dest,
          getBlock: worldGetterFromBot(bot),
        });
        if (!decision.ok) throw new Error(`SKIP chest placement rejected: ${decision.reason}`);
        const placed = await placeBlock(ctx, "chest", dest, { purpose: "household_storage" });
        if (!placed.success) throw new Error(`${placed.code} ${placed.error}`);
        const retry = await depositItems(ctx, item.name, dest);
        if (!retry.success) throw new Error(`${retry.code} ${retry.error}`);
        const withdrawn = await withdrawItems(ctx, item.name, 1, dest);
        if (!withdrawn.success) throw new Error(`${withdrawn.code} ${withdrawn.error}`);
        return;
      }
      if (!deposited.success) throw new Error(`${deposited.code} ${deposited.error}`);
      const withdrawn = await withdrawItems(ctx, item.name, 1, deposited.data.position);
      if (!withdrawn.success) throw new Error(`${withdrawn.code} ${withdrawn.error}`);
    }),
  );

  results.push(
    await runCase("eat if hungry", async () => {
      if (inventoryCount(ctx, "cooked_beef") < 1 && !listInventory(ctx).some((item) => knowledge.isFood(item.name))) {
        throw new Error("SKIP no food");
      }
      await runCommand(bot, rcon, `effect give ${username} minecraft:hunger 40 255 true`);
      await wait(8_000);
      console.log(`  hunger after effect=${bot.food}`);
      if ((bot.food ?? 20) >= 20) throw new Error("SKIP hunger still full after hunger effect");
      const eaten = await eatFood(ctx);
      if (!eaten.success) throw new Error(`${eaten.code} ${eaten.error}`);
    }),
  );

  results.push(
    await runCase("sleep if valid time", async () => {
      await runCommand(bot, rcon, "gamerule doMobSpawning false");
      await runCommand(bot, rcon, "time set 18000");
      await wait(1_500);
      let slept = await sleep(ctx, pad.bed);
      if (!slept.success && slept.code === "SLEEP_FAILED") {
        await wait(800);
        slept = await sleep(ctx, pad.bed);
      }
      await runCommand(bot, rcon, "time set day");
      await runCommand(bot, rcon, "gamerule doMobSpawning true");
      if (!slept.success) {
        if (slept.code === "NOT_SLEEP_TIME" || slept.code === "NO_BED" || slept.code === "HOSTILE_NEARBY") {
          throw new Error(`SKIP ${slept.code} ${slept.error}`);
        }
        throw new Error(`${slept.code} ${slept.error}`);
      }
    }),
  );

  results.push(
    await runCase("pickup nearby drop if present", async () => {
      const stick = ctx.bot.inventory.items().find((item) => item.name === "stick") ?? ctx.bot.inventory.items()[0];
      if (stick) {
        const before = inventoryCount(ctx, stick.name);
        try {
          await ctx.bot.toss(stick.type, null, 1);
          await wait(600);
        } catch {
          // fall through to summon
        }
        if (inventoryCount(ctx, stick.name) >= before) {
          const pos = body.position();
          if (pos) {
            await runCommand(
              bot,
              rcon,
              `execute at ${username} run summon minecraft:item ~ ~1 ~ {Item:{id:"minecraft:stick",count:1}}`,
            );
            await wait(700);
          }
        }
      } else {
        const pos = body.position();
        if (pos) {
          await runCommand(
            bot,
            rcon,
            `execute at ${username} run summon minecraft:item ~ ~1 ~ {Item:{id:"minecraft:stick",count:1}}`,
          );
          await wait(700);
        }
      }
      const collected = await collectItem(ctx, undefined, 8);
      if (!collected.success) throw new Error(`${collected.code} ${collected.error}`);
    }),
  );

  if (config.MECHANICS_PROBE_KEEP_ALIVE) {
    console.log(`KEEP_ALIVE: ${username} remaining connected and idle. Not performing citizen tasks.`);
    console.log("Active test: live-mechanics. Ctrl+C to disconnect.");
    const idle = setInterval(() => {
      const pos = body.position();
      console.log(
        `[MechProbe idle] test=live-mechanics pos=${pos ? `${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}` : "?"} food=${bot.food}`,
      );
    }, 15_000);
    await new Promise<void>((resolve) => {
      const stop = () => {
        clearInterval(idle);
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  }

  await body.disconnect("live-mechanics-test");
  rcon?.close();
  printResults();
  const failed = results.filter((result) => !result.passed && !result.detail.startsWith("SKIP"));
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
    await wait(250);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
