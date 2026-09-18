import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import { findReachableInteractionPosition, formatTerrainReport, inspectLocalTerrain, isKeepaliveTimeout, localEscape, MinecraftBody, moveToPosition, NORMAL_NAVIGATION_CAN_DIG } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import {
  canReceive,
  collectResource,
  compactInventoryFacts,
  clearReservations,
  depositItem,
  depositItems,
  dropItem,
  dropStack,
  eatFood,
  equipItem,
  evaluateFunctionalPlacement,
  findBlock,
  findStacks,
  freeCapacity,
  heldItem,
  inventoryCount,
  listInventory,
  obtainItem,
  openDoor,
  pickupDroppedItem,
  placeBlock,
  reserveItems,
  snapshotInventory,
  sleep,
  setQuickBarSlot,
  transferItemToCitizen,
  unequip,
  withdrawItem,
  withdrawItems,
  worldGetterFromBot,
  type SkillContext,
} from "@civ/skills";
import { ensurePaper } from "./paper.js";
import { tryRcon, type RconClient } from "./rcon.js";
import { runBodyGauntlet } from "./live-mechanics-gauntlet.js";

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

  const mechanicsFilter = (process.env.MECHANICS_TEST_FILTER ?? "").trim().toLowerCase();

  console.log("TEST-ONLY MECHANICS PROBE");
  console.log("Not a citizen. No cognition, relationships, settlement population, or citizen memories.");
  console.log(`username=${username} keepAlive=${config.MECHANICS_PROBE_KEEP_ALIVE}`);
  console.log(`Minecraft knowledge version: ${knowledge.version}`);
  console.log(`NORMAL_NAVIGATION_CAN_DIG=${NORMAL_NAVIGATION_CAN_DIG}`);
  console.log(`oak_door recipe exists: ${knowledge.recipeExists("oak_door")}`);
  if (mechanicsFilter) console.log(`MECHANICS_TEST_FILTER=${mechanicsFilter}`);
  console.log(`MECHANICS_PROBE_PRESERVE_FIXTURES=${config.MECHANICS_PROBE_PRESERVE_FIXTURES}`);
  if (process.env.MECHANICS_COLLECT_BACKEND) {
    console.log(`MECHANICS_COLLECT_BACKEND=${process.env.MECHANICS_COLLECT_BACKEND}`);
  }

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
  const spawnReport = inspectLocalTerrain(bot);
  if (spawnReport) {
    console.log(`  terrain ${formatTerrainReport(spawnReport)}`);
  }
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
  process.on("uncaughtException", (error) => {
    if (isKeepaliveTimeout(error)) {
      console.warn(`keepalive timeout (continuing): ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
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
    await rcon.command(`effect give ${username} minecraft:saturation 8 255 true`).catch(() => undefined);
    await rcon.command("fill 194 88 147 196 89 151 grass_block").catch(() => undefined);
    await rcon.command("fill 174 90 134 190 96 156 air").catch(() => undefined);
    await rcon.command(`tp ${username} 177.5 90.0 137.5`).catch(() => undefined);
    await wait(1_600);
  }

  async function assertNoBroken(before: Map<string, string>, label: string): Promise<void> {
    const broken = brokenSolids(bot, before);
    if (broken.length > 0) {
      throw new Error(`${label}: unrelated blocks became air: ${broken.slice(0, 8).join("; ")}`);
    }
  }

  async function tpTo(x: number, y: number, z: number): Promise<void> {
    if (!rcon) throw new Error("SKIP RCON required for nav fixture teleport");
    await rcon.command(`tp ${username} ${x} ${y} ${z}`);
    await wait(1_600);
  }

  results.push(
    await runCase("inspect spawn neighborhood", async () => {
      const report = inspectLocalTerrain(bot);
      if (!report) throw new Error("no terrain report");
      console.log(`  spawn kind=${report.kind} ${report.reason}`);
    }),
  );

  results.push(
    await runCase("recover from 1-block pit without mining", async () => {
      if (!rcon) throw new Error("SKIP RCON required to build pit fixture");
      await rcon.command("fill 174 89 134 190 89 156 grass_block");
      await rcon.command("fill 174 90 134 190 93 156 air");
      await rcon.command("setblock 186 88 148 dirt");
      await rcon.command("setblock 186 89 148 air");
      await rcon.command("setblock 185 88 148 grass_block");
      await rcon.command("setblock 185 89 148 oak_slab[type=bottom]");
      await tpTo(186.5, 89.0, 148.5);
      const before = snapshotSolids(bot, body.position() ?? { x: 186.5, y: 89, z: 148.5 }, 4);
      const start = body.position();
      if (!start) throw new Error("lost body in pit");
      const report = inspectLocalTerrain(bot);
      console.log(`  pit ${report ? formatTerrainReport(report) : "unloaded"}`);
      const escaped = await localEscape(bot, { timeoutMs: 8_000 });
      let here = body.position();
      let dist = here ? Math.hypot(here.x - start.x, here.y - start.y, here.z - start.z) : 0;
      if (dist < 0.6) {
        const rim = { x: 185.5, y: 90, z: 148.5 };
        const walked = await moveToPosition(bot, rim, { range: 1.2, timeoutMs: 10_000, recover: false });
        here = body.position();
        dist = here ? Math.hypot(here.x - start.x, here.y - start.y, here.z - start.z) : 0;
        if (dist < 0.6 && !walked.success) {
          const escapeDetail = escaped.success ? "" : `${escaped.code} ${escaped.error}`;
          throw new Error(`${escapeDetail || `${walked.code} ${walked.error}`} dist=${dist.toFixed(2)}`);
        }
      }
      bot.clearControlStates();
      await assertNoBroken(before, "pit");
      const endKind = inspectLocalTerrain(bot)?.kind;
      if (dist < 0.6 || endKind === "walled_pit" || endKind === "deep_pit") {
        throw new Error(`still in pit dist=${dist.toFixed(2)} kind=${endKind ?? "?"} onGround=${bot.entity?.onGround}`);
      }
      console.log(
        `  pit escape moved ${dist.toFixed(2)} kind=${report?.kind ?? "?"} (${escaped.success ? "escape" : escaped.code})`,
      );
    }),
  );

  results.push(
    await runCase("walk open flat terrain without mining", async () => {
      if (!rcon) throw new Error("SKIP RCON required for open pad");
      await rcon.command("fill 174 89 134 190 89 156 grass_block");
      await rcon.command("fill 174 90 134 190 93 156 air");
      await tpTo(177.5, 90.0, 137.5);
      const start = body.position();
      if (!start) throw new Error("no pad position");
      const before = snapshotSolids(bot, start, 10);
      const dest = { x: start.x + 12, y: start.y, z: start.z + 12 };
      const result = await moveToPosition(bot, dest, { range: 2.5, timeoutMs: 16_000, recover: true });
      const here = body.position();
      const dist = here ? Math.hypot(here.x - start.x, here.z - start.z) : 0;
      await assertNoBroken(before, "open pad");
      console.log(`  open walk ${dist.toFixed(1)} blocks (${result.success ? "ok" : `${result.code} ${result.error}`})`);
      if (dist < 8) throw new Error(`open terrain displacement ${dist.toFixed(1)} < 8`);
    }),
  );

  results.push(
    await runCase("walk village/uneven terrain without mining", async () => {
      if (!rcon) throw new Error("SKIP RCON required for uneven pad");
      await rcon.command("fill 174 89 134 190 89 156 grass_block");
      await rcon.command("fill 174 90 134 190 93 156 air");
      await rcon.command("setblock 179 90 140 dirt_path");
      await rcon.command("setblock 180 90 141 oak_slab[type=bottom]");
      await rcon.command("setblock 181 90 142 oak_stairs[facing=east]");
      await tpTo(176.5, 90.0, 138.5);
      const start = body.position();
      if (!start) throw new Error("no uneven position");
      const before = snapshotSolids(bot, start, 8);
      const dest = { x: start.x + 10, y: start.y, z: start.z + 8 };
      const result = await moveToPosition(bot, dest, { range: 3, timeoutMs: 16_000, recover: true });
      const here = body.position();
      const dist = here ? Math.hypot(here.x - start.x, here.z - start.z) : 0;
      await assertNoBroken(before, "uneven");
      console.log(`  uneven walk ${dist.toFixed(1)} blocks (${result.success ? "ok" : `${result.code} ${result.error}`})`);
      if (dist < 6) throw new Error(`uneven displacement ${dist.toFixed(1)} < 6 (${result.success ? "ok" : `${result.code} ${result.error}`})`);
    }),
  );

  results.push(
    await runCase("walk 15-25 blocks without mining", async () => {
      if (!rcon) throw new Error("SKIP RCON required");
      await rcon.command("fill 174 89 134 190 89 156 grass_block");
      await rcon.command("fill 174 90 134 190 93 156 air");
      await tpTo(176.5, 90.0, 136.5);
      const start = body.position();
      if (!start) throw new Error("no walk position");
      const before = snapshotSolids(bot, start, 8);
      const dest = { x: start.x + 14, y: start.y, z: start.z + 2 };
      const result = await moveToPosition(bot, dest, { range: 3, timeoutMs: 16_000, recover: true });
      const here = body.position();
      await assertNoBroken(before, "spawn walk");
      const dist = here ? Math.hypot(here.x - start.x, here.z - start.z) : 0;
      console.log(`  long walk moved ${dist.toFixed(1)} blocks; solids broken=0 (${result.success ? "ok" : `${result.code} ${result.error}`})`);
      if (dist < 8) throw new Error(`long walk displacement ${dist.toFixed(1)} < 8`);
    }),
  );

  await tpTo(178.5, 90.0, 140.5).catch(() => undefined);
  await moveToPosition(bot, body.position() ?? origin, { range: 4, timeoutMs: 8_000, recover: true });

  results.push(
    await runCase("reject open-field bed/door/table without valid context", async () => {
      const pos = body.position() ?? origin;
      const getBlock = worldGetterFromBot(bot);
      let field = { x: Math.floor(pos.x) + 8, y: Math.floor(pos.y), z: Math.floor(pos.z) + 8 };
      for (const offset of [
        { x: 8, z: 8 },
        { x: -8, z: 8 },
        { x: 8, z: -8 },
        { x: -8, z: -8 },
        { x: 10, z: 0 },
        { x: 0, z: 10 },
      ]) {
        const candidate = { x: Math.floor(pos.x) + offset.x, y: Math.floor(pos.y), z: Math.floor(pos.z) + offset.z };
        const roofed =
          getBlock(candidate.x, candidate.y + 2, candidate.z)?.boundingBox === "block" ||
          getBlock(candidate.x, candidate.y + 3, candidate.z)?.boundingBox === "block";
        if (!roofed) {
          field = candidate;
          break;
        }
      }
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
    const y = Math.floor(pos.y);
    const x = Math.floor(pos.x);
    const z = Math.floor(pos.z);
    const commands = [
      `fill ${x + 2} ${y} ${z} ${x + 2} ${y + 1} ${z} air`,
      `fill ${x - 2} ${y} ${z} ${x - 2} ${y + 1} ${z} air`,
      `fill ${x} ${y} ${z + 2} ${x} ${y + 1} ${z + 2} air`,
      `fill ${x} ${y} ${z - 2} ${x} ${y + 1} ${z - 2} air`,
      `fill ${x + 2} ${y} ${z - 2} ${x + 3} ${y + 1} ${z - 2} air`,
      `setblock ${x + 2} ${y} ${z} minecraft:stone`,
      `setblock ${x - 2} ${y} ${z} minecraft:crafting_table`,
      `setblock ${x} ${y} ${z + 2} minecraft:chest[facing=south]`,
      `setblock ${x} ${y} ${z - 2} minecraft:oak_door[facing=south,half=lower,hinge=left]`,
      `setblock ${x} ${y + 1} ${z - 2} minecraft:oak_door[facing=south,half=upper,hinge=left]`,
      `setblock ${x + 2} ${y} ${z - 2} minecraft:red_bed[facing=west,part=foot]`,
      `setblock ${x + 3} ${y} ${z - 2} minecraft:red_bed[facing=west,part=head]`,
    ];
    for (const command of commands) {
      if (rcon) {
        const reply = await rcon.command(command).catch((error: unknown) => String(error));
        console.log(`  rcon ${command} => ${reply}`);
      } else {
        await runCommand(bot, rcon, command);
      }
    }
    const stonePos = { x: x + 2, y, z };
    const tablePos = { x: x - 2, y, z };
    const chestPos = { x, y, z: z + 2 };
    const doorPos = { x, y, z: z - 2 };
    const bedPos = { x: x + 2, y, z: z - 2 };
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
        await rcon.command(`fill ${x} ${y} ${z - 1} ${x} ${y + 1} ${z + 1} air`);
        await rcon.command(`setblock ${x} ${y - 1} ${z} minecraft:oak_planks`);
        await rcon.command(`setblock ${x} ${y - 1} ${z + 1} minecraft:oak_planks`);
        await rcon.command(`setblock ${x} ${y - 1} ${z - 1} minecraft:oak_planks`);
        await rcon.command(`setblock ${x - 1} ${y} ${z} minecraft:oak_planks`);
        await rcon.command(`setblock ${x + 1} ${y} ${z} minecraft:oak_planks`);
        await rcon.command(`setblock ${x - 1} ${y + 1} ${z} minecraft:oak_planks`);
        await rcon.command(`setblock ${x + 1} ${y + 1} ${z} minecraft:oak_planks`);
        const wallsReady =
          (await waitForNamedBlock(bot, { x: x - 1, y, z }, ["oak_planks"], 3_000)) &&
          (await waitForNamedBlock(bot, { x: x + 1, y, z }, ["oak_planks"], 3_000)) &&
          (await waitForNamedBlock(bot, { x: x - 1, y: y + 1, z }, ["oak_planks"], 3_000)) &&
          (await waitForNamedBlock(bot, { x: x + 1, y: y + 1, z }, ["oak_planks"], 3_000));
        const doorway = { x, y, z };
        const placed = await placeBlock(ctx, "oak_door", doorway, { purpose: "doorway" });
        if (!placed.success) {
          console.log(`  doorway place: ${placed.code} ${placed.error}${wallsReady ? "" : " (walls not in bot chunk yet)"}`);
        } else {
          console.log("  doorway place: PASS");
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
      if (!rcon) throw new Error("SKIP RCON required for bed fixture");
      await rcon.command("gamerule doMobSpawning false");
      await rcon.command("gamerule doDaylightCycle false");
      const stand = body.position();
      if (!stand) throw new Error("no position for bed");
      const x = Math.floor(stand.x) + 6;
      const y = Math.floor(stand.y);
      const z = Math.floor(stand.z) + 3;
      await rcon.command(`fill ${x - 1} ${y - 1} ${z - 1} ${x + 3} ${y + 3} ${z + 2} air`);
      await rcon.command(`fill ${x - 1} ${y - 1} ${z - 1} ${x + 3} ${y - 1} ${z + 2} oak_planks`);
      await rcon.command(`fill ${x - 1} ${y} ${z - 1} ${x - 1} ${y + 1} ${z + 2} oak_planks`);
      await rcon.command(`fill ${x + 3} ${y} ${z - 1} ${x + 3} ${y + 1} ${z + 2} oak_planks`);
      await rcon.command(`fill ${x - 1} ${y} ${z - 1} ${x + 3} ${y + 1} ${z - 1} oak_planks`);
      await rcon.command(`fill ${x - 1} ${y + 2} ${z - 1} ${x + 3} ${y + 2} ${z + 2} oak_planks`);
      await rcon.command(`setblock ${x} ${y} ${z} minecraft:red_bed[facing=east,part=foot]`);
      await rcon.command(`setblock ${x + 1} ${y} ${z} minecraft:red_bed[facing=east,part=head]`);
      const bedPos = { x, y, z };
      const ready = await waitForNamedBlock(bot, bedPos, ["red_bed"], 4_000);
      if (!ready) throw new Error("BED_MISSING dedicated bed not visible");
      pad.bed = bedPos;
      const standing = findReachableInteractionPosition(bot, bedPos);
      if (standing) {
        await moveToPosition(bot, standing, { range: 1.2, timeoutMs: 8_000, recover: true });
      }
      await rcon.command("time set 18000");
      const nightDeadline = Date.now() + 4_000;
      while (Date.now() < nightDeadline) {
        const t = bot.time?.timeOfDay ?? 0;
        if (t >= 13_000 && t < 23_000) break;
        await wait(200);
      }
      console.log(`  timeOfDay=${bot.time?.timeOfDay} isSleeping=${bot.isSleeping} standing=${standing ? `${standing.x},${standing.y},${standing.z}` : "none"}`);
      const slept = await sleep(ctx, bedPos);
      const wasSleeping = slept.success;
      await rcon.command("time set day");
      await rcon.command("gamerule doDaylightCycle true");
      await rcon.command("gamerule doMobSpawning true");
      if (!slept.success) {
        throw new Error(`${slept.code} ${slept.error}`);
      }
      if (!wasSleeping) throw new Error("INTERACTION_FAILED sleep did not report rest");
    }),
  );

  results.push(
    await runCase("pickup nearby drop if present", async () => {
      const beforeStick = inventoryCount(ctx, "stick");
      await runCommand(
        bot,
        rcon,
        `execute at ${username} run summon minecraft:item ~ ~0.2 ~ {PickupDelay:0,Item:{id:"minecraft:stick",count:1}}`,
      );
      await wait(1_200);
      if (inventoryCount(ctx, "stick") > beforeStick) return;
      const collected = await pickupDroppedItem(ctx, "stick", 8);
      if (!collected.success) throw new Error(`${collected.code} ${collected.error}`);
      if (inventoryCount(ctx, "stick") <= beforeStick) {
        throw new Error("VERIFY_FAILED stick count did not increase after pickup");
      }
    }),
  );

  results.push(
    await runCase("construct approved 3-plank shelter wall", async () => {
      await runCommand(bot, rcon, `give ${username} oak_planks 16`);
      await wait(400);
      const pos = body.position() ?? origin;
      const ox = Math.floor(pos.x) + 6;
      const oy = Math.floor(pos.y);
      const oz = Math.floor(pos.z) + 6;
      await runCommand(bot, rcon, `fill ${ox} ${oy} ${oz} ${ox + 1} ${oy + 1} ${oz} air`);
      await wait(250);
      const cells = [
        { x: ox, y: oy, z: oz },
        { x: ox + 1, y: oy, z: oz },
        { x: ox, y: oy + 1, z: oz },
      ];
      for (const cell of cells) {
        const placed = await placeBlock(ctx, "oak_planks", cell, { purpose: "shelter_blueprint" });
        if (!placed.success) throw new Error(`${placed.code} ${placed.error}`);
        const block = blockAt(bot, cell.x, cell.y, cell.z);
        if (block?.name !== "oak_planks") {
          throw new Error(`VERIFY_FAILED expected oak_planks at ${cell.x},${cell.y},${cell.z} got ${block?.name ?? "none"}`);
        }
      }
    }),
  );

  results.push(
    await runCase("authoritative inventory snapshot/drop/equip/capacity", async () => {
      if (!rcon) throw new Error("SKIP RCON required for inventory fixtures");
      await rcon.command("fill 174 89 134 182 89 142 grass_block");
      await rcon.command("fill 174 90 134 182 93 142 air");
      await rcon.command(`tp ${username} 176.5 90.0 136.5`);
      await wait(1_200);
      await rcon.command(`clear ${username}`);
      await rcon.command(`execute at ${username} run kill @e[type=item,distance=..16]`);
      await wait(500);
      let snap = snapshotInventory(ctx);
      console.log(`  empty stacks=${snap.stacks.length} freeSlots=${snap.freeSlots}`);
      if (snap.counts.oak_log) throw new Error(`expected empty oak_log, have ${snap.counts.oak_log}`);

      await rcon.command(`give ${username} oak_log 64`);
      await wait(700);
      snap = snapshotInventory(ctx);
      const logStack = findStacks(ctx, "oak_log")[0];
      if ((snap.counts.oak_log ?? 0) !== 64) throw new Error(`oak_log count ${snap.counts.oak_log} != 64`);
      if (!logStack || logStack.stackSize !== 64) throw new Error(`oak_log stackSize ${logStack?.stackSize} != 64`);
      const facts = compactInventoryFacts(ctx);
      if (!facts.lines.includes("oak_log: 64")) throw new Error(`compact facts missing oak_log: ${facts.lines.join("; ")}`);

      const droppedFive = await dropItem(ctx, "oak_log", 5, "DEV_TEST");
      if (!droppedFive.success) throw new Error(`${droppedFive.code} ${droppedFive.error}`);
      if (inventoryCount(ctx, "oak_log") !== 59) throw new Error(`after drop 5 have ${inventoryCount(ctx, "oak_log")}`);

      const remaining = findStacks(ctx, "oak_log")[0];
      if (!remaining) throw new Error("remaining oak_log stack missing");
      const dumped = await dropStack(ctx, remaining, "DEV_TEST");
      if (!dumped.success) throw new Error(`${dumped.code} ${dumped.error}`);
      if (inventoryCount(ctx, "oak_log") !== 0) throw new Error(`expected 0 oak_log after stack drop, have ${inventoryCount(ctx, "oak_log")}`);
      await wait(2_500);
      if (inventoryCount(ctx, "oak_log") > 0) {
        console.log(`  pickup via thrower delay auto-collect count=${inventoryCount(ctx, "oak_log")}`);
      } else {
        const picked = await pickupDroppedItem(ctx, "oak_log", 12);
        if (!picked.success) throw new Error(`${picked.code} ${picked.error}`);
        if (inventoryCount(ctx, "oak_log") < 1) throw new Error("pickup did not increase oak_log");
      }

      await rcon.command(`give ${username} wooden_pickaxe 1`);
      await wait(400);
      const equipped = await equipItem(ctx, "wooden_pickaxe");
      if (!equipped.success) throw new Error(`${equipped.code} ${equipped.error}`);
      if (heldItem(ctx)?.name !== "wooden_pickaxe") throw new Error(`held ${heldItem(ctx)?.name ?? "nothing"}`);
      const emptied = await unequip(ctx, "hand");
      if (!emptied.success) throw new Error(`${emptied.code} ${emptied.error}`);
      const slot = await setQuickBarSlot(ctx, 1);
      if (!slot.success) throw new Error(`${slot.code} ${slot.error}`);

      reserveItems(ctx, "shelter-logs", "oak_log", Math.max(1, inventoryCount(ctx, "oak_log") - 1), "shelter");
      const reservedDrop = await dropItem(ctx, "oak_log", inventoryCount(ctx, "oak_log"), "DISCARD");
      if (reservedDrop.success) throw new Error("drop consumed reserved oak_log");
      if (reservedDrop.code !== "ITEM_RESERVED" && reservedDrop.code !== "ITEM_NOT_FOUND") {
        throw new Error(`expected ITEM_RESERVED, got ${reservedDrop.code}`);
      }
      clearReservations(ctx);

      await rcon.command(`give ${username} cobblestone 16`);
      await wait(400);
      const stand = body.position() ?? origin;
      const chestPos = { x: Math.floor(stand.x) + 2, y: Math.floor(stand.y), z: Math.floor(stand.z) };
      await rcon.command(`setblock ${chestPos.x} ${chestPos.y} ${chestPos.z} chest`);
      await wait(500);
      const citizenBefore = inventoryCount(ctx, "cobblestone");
      const deposited = await depositItem(ctx, "cobblestone", 10, chestPos);
      if (!deposited.success) throw new Error(`${deposited.code} ${deposited.error}`);
      if (inventoryCount(ctx, "cobblestone") !== citizenBefore - deposited.data.deposited) {
        throw new Error("deposit citizen delta mismatch");
      }
      const withdrawn = await withdrawItem(ctx, "cobblestone", 5, chestPos);
      if (!withdrawn.success) throw new Error(`${withdrawn.code} ${withdrawn.error}`);

      await rcon.command(`clear ${username}`);
      await wait(300);
      for (let i = 0; i < 36 && freeCapacity(ctx, "cobblestone") > 0; i += 1) {
        await rcon.command(`give ${username} cobblestone 64`);
        await wait(80);
      }
      await wait(400);
      if (freeCapacity(ctx, "oak_log") !== 0) {
        throw new Error(`expected 0 oak_log capacity, got ${freeCapacity(ctx, "oak_log")} freeSlots=${snapshotInventory(ctx).freeSlots}`);
      }
      if (canReceive(ctx, "oak_log", 1)) throw new Error("full inventory still reports canReceive oak_log");
      const refused = await withdrawItem(ctx, "cobblestone", 1, chestPos);
      if (refused.success) throw new Error("withdraw succeeded while inventory was full");
      if (refused.code !== "INVENTORY_FULL") throw new Error(`expected INVENTORY_FULL, got ${refused.code}`);
      console.log(`  capacity oak_log=${freeCapacity(ctx, "oak_log")} cobble=${inventoryCount(ctx, "cobblestone")}`);
    }),
  );

  results.push(
    await runCase("authoritative probe-to-probe transfer", async () => {
      if (!rcon) throw new Error("SKIP RCON required for transfer fixtures");
      const peerName = "MechProbeB";
      if (!isMechanicsProbeUsername(peerName)) throw new Error("MechProbeB must stay a reserved probe name");
      const peer = new MinecraftBody({
        username: peerName,
        config: { ...config, MINECRAFT_USERNAME: peerName },
        reconnect: false,
        allowRespawn: true,
      });
      const connected = await peer.connect();
      if (!connected.success) {
        throw new Error(`SKIP peer connect ${connected.code} ${connected.error}`);
      }
      try {
        await wait(1500);
        const peerBot = peer.requireBot();
        const peerCtx: SkillContext = { body: peer, bot: peerBot, timeoutMs: 20_000 };
        const here = body.position() ?? origin;
        await rcon.command(`op ${peerName}`).catch(() => undefined);
        await rcon.command(`tp ${peerName} ${here.x + 1.2} ${here.y.toFixed(1)} ${here.z.toFixed(1)}`);
        await rcon.command(`execute at ${username} run kill @e[type=item,distance=..24]`);
        await wait(1_800);
        const peerHere = peer.position();
        const giverHere = body.position();
        console.log(
          `  peer pos=${peerHere ? `${peerHere.x.toFixed(1)},${peerHere.y.toFixed(1)},${peerHere.z.toFixed(1)}` : "?"} giver=${giverHere ? `${giverHere.x.toFixed(1)},${giverHere.y.toFixed(1)},${giverHere.z.toFixed(1)}` : "?"}`,
        );
        if (!peerHere || !giverHere || Math.hypot(peerHere.x - giverHere.x, peerHere.z - giverHere.z) > 6) {
          await rcon.command(`tp ${peerName} ${username}`);
          await wait(1_200);
        }
        await rcon.command(`clear ${username}`);
        await rcon.command(`clear ${peerName}`);
        clearReservations(ctx);
        clearReservations(peerCtx);
        await rcon.command(`give ${username} oak_log 12`);
        await wait(1_000);
        const result = await transferItemToCitizen(ctx, peerCtx, "oak_log", 8);
        if (!result.success) {
          throw new Error(`${result.code} ${result.error} details=${JSON.stringify(result.details ?? {})}`);
        }
        if (inventoryCount(ctx, "oak_log") !== 4) throw new Error(`giver has ${inventoryCount(ctx, "oak_log")} != 4`);
        if (inventoryCount(peerCtx, "oak_log") !== 8) throw new Error(`receiver has ${inventoryCount(peerCtx, "oak_log")} != 8`);
      } finally {
        await peer.disconnect("inventory-transfer-peer");
      }
    }),
  );

  await wait(800);
  if (!body.position() || !ctx.bot.entity) {
    console.warn("MechProbe lost spawn before gauntlet; reconnecting");
    const again = await body.connect();
    if (!again.success) {
      throw new Error(`gauntlet reconnect ${again.code} ${again.error}`);
    }
    await wait(2_000);
    ctx.bot = body.requireBot();
  }

  const gauntlet = await runBodyGauntlet({
    ctx,
    bot: ctx.bot,
    body,
    rcon,
    username,
    preserveFixtures: config.MECHANICS_PROBE_PRESERVE_FIXTURES,
    wait,
    runCommand,
    runCase,
    blockAt,
    snapshotSolids,
    brokenSolids,
  });
  results.push(...gauntlet);

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

function wantedCase(name: string): boolean {
  const filter = (process.env.MECHANICS_TEST_FILTER ?? "").trim().toLowerCase();
  if (!filter) return true;
  if (filter === "all") return true;
  if (filter === "v1") {
    return !/authoritative inventory|authoritative probe-to-probe|step up|drop down|climb oak|walk oak slabs|fence gate|enter and leave water|sprint on flat|climb ladder|zombie melee|skeleton melee|spider melee|creeper flee|hunt |harvest mature|create tiny wheat|cook raw|mine iron|craft iron|iron helmet|remaining iron armor|villager trade|3x3 shelter|defensive enclosure/.test(
      name,
    );
  }
  if (filter === "crafting") {
    return /log ->|stone pickaxe|oak_door|inspect inventory|reuse existing crafting/.test(name);
  }
  if (filter === "nav" || filter === "navigation") {
    return /inspect spawn|pit |open flat|village\/uneven|walk 15-25|standing cell|open wooden door|step up|drop down|climb oak|walk oak slabs|fence gate|enter and leave water|sprint on flat/.test(
      name,
    );
  }
  if (filter === "sleep") {
    return /sleep |open-field/.test(name);
  }
  if (filter === "collectblock") {
    return /log ->|mine intended stone/.test(name);
  }
  if (filter === "inventory" || filter === "transfer") {
    return /authoritative inventory|authoritative probe-to-probe|chest deposit/.test(name);
  }
  if (filter === "doorway") {
    return /oak_door|open-field|doorway/.test(name);
  }
  if (filter === "gauntlet" || filter === "v11") {
    return /step up|drop down|climb oak|walk oak slabs|fence gate|enter and leave water|sprint on flat|climb ladder|zombie melee|skeleton melee|spider melee|creeper flee|hunt |harvest mature|create tiny wheat|cook raw|mine iron|craft iron|iron helmet|remaining iron armor|villager trade|3x3 shelter|defensive enclosure/.test(
      name,
    );
  }
  if (filter === "combat") {
    return /zombie melee|skeleton melee|spider melee|creeper flee/.test(name);
  }
  if (filter === "farm") {
    return /harvest mature|create tiny wheat/.test(name);
  }
  if (filter === "retry") {
    return /enter and leave water|climb ladder|hunt pig|create tiny wheat|complete 3x3/.test(name);
  }
  return name.toLowerCase().includes(filter);
}

async function runCase(name: string, fn: () => Promise<void>): Promise<CaseResult> {
  const started = Date.now();
  if (!wantedCase(name)) {
    return { name, passed: false, detail: "SKIP filter", durationMs: 0 };
  }
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
