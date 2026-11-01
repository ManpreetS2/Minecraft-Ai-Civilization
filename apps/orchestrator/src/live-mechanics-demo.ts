import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import {
  isKeepaliveTimeout,
  localEscape,
  MinecraftBody,
  moveToPosition,
  NORMAL_NAVIGATION_CAN_DIG,
} from "@civ/minecraft-adapter";
import {
  attackHostile,
  climbLadder,
  clearReservations,
  collectResource,
  depositItem,
  dropItem,
  dropStack,
  executeStructure,
  findStacks,
  fleeCreeper,
  harvestCrop,
  huntAnimal,
  inventoryCount,
  obtainItem,
  openDoor,
  openFenceGate,
  pickupDroppedItem,
  plantCrop,
  probeFort,
  probeShelter,
  smeltItem,
  tillAndPlant,
  tradeWithVillager,
  transferItemToCitizen,
  equipItem,
  verifyStructure,
  withdrawItem,
  type SkillContext,
} from "@civ/skills";
import { ensurePaper } from "./paper.js";
import { tryRcon } from "./rcon.js";

type CapResult = {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
  rconSetup: string[];
  physical: string[];
};

type BlockPos = { x: number; y: number; z: number };

const DEMO_PAUSE_MS = 3_500;
const SPECTATOR_WAIT_MS = Number(process.env.MECHANICS_DEMO_WAIT_MS ?? 75_000);

/** Isolated spectator course: one pad, one viewing deck. */
const PAD = { x0: 188, y: 89, z0: 140, x1: 216, z1: 170 };
const SPECTATOR = { x: 200.5, y: 97.0, z: 156.5 };
const START = { x: 191.5, y: 90.0, z: 141.5 };
const CHEST = { x: 190, y: 90, z: 141 };
const _PEER_STAND = { x: 193.5, y: 90.0, z: 141.5 };
const NAV_START = { x: 190.5, y: 90, z: 144.5 };
const WATER_IN = { x: 212.5, y: 89.2, z: 147.5 };
const WATER_OUT = { x: 209.5, y: 90, z: 147.5 };
const LADDER = { x: 214, y: 90, z: 144 };
const PEN = { x: 199.5, y: 90, z: 151.5 };
const _FARM_MATURE = { x: 191, y: 90, z: 158 };
const FARM_IMMATURE = { x: 193, y: 90, z: 158 };
const TILL = { x: 191, y: 89, z: 160 };
const FURNACE = { x: 198, y: 90, z: 158 };
const ORE = { x: 200, y: 90, z: 158 };
const TABLE = { x: 199, y: 90, z: 157 };
const VILLAGER = { x: 196.5, y: 90, z: 160.5 };
const SHELTER = { x: 190, y: 90, z: 163 };
const FORT = { x: 198, y: 90, z: 163 };

const CHECKLIST = [
  "inventory/drop",
  "chest",
  "transfer",
  "movement",
  "water",
  "ladder",
  "zombie",
  "skeleton",
  "spider",
  "creeper flee",
  "cow",
  "pig",
  "chicken",
  "farming",
  "cooking",
  "iron mining",
  "smelting",
  "tools",
  "armor",
  "villager trade",
  "shelter",
  "fort",
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blockAt(bot: SkillContext["bot"], x: number, y: number, z: number) {
  const origin = bot.entity?.position;
  if (!origin) return null;
  return bot.blockAt(origin.offset(x - origin.x, y - origin.y, z - origin.z).floored());
}

function posLine(body: MinecraftBody): string {
  const pos = body.position();
  return pos ? `${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}` : "?";
}

function invSummary(ctx: SkillContext): string {
  const items = ctx.bot.inventory.items().map((item) => `${item.name}x${item.count}`);
  return items.slice(0, 14).join(", ") || "(empty)";
}

function banner(title: string): void {
  console.log("");
  console.log("========================");
  console.log(`DEMO: ${title}`);
  console.log("========================");
}

export async function runMechanicsDemo(): Promise<void> {
  process.env.MECHANICS_DEMO = "true";
  process.env.MECHANICS_PROBE_ENABLED = "true";
  process.env.MECHANICS_PROBE_KEEP_ALIVE = "true";
  process.env.MECHANICS_PROBE_PRESERVE_FIXTURES = "true";

  loadEnv();
  process.env.MECHANICS_DEMO = "true";
  process.env.MECHANICS_PROBE_ENABLED = "true";
  process.env.MECHANICS_PROBE_KEEP_ALIVE = "true";
  process.env.MECHANICS_PROBE_PRESERVE_FIXTURES = "true";

  const config = loadConfig();
  const paper = await ensurePaper(config);
  if (!paper) {
    throw new Error(`Paper not reachable at ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}`);
  }

  const username = config.MECHANICS_PROBE_USERNAME || "MechProbe";
  if (!isMechanicsProbeUsername(username)) {
    throw new Error(`${username} is reserved for citizens. Use MechProbe`);
  }

  console.log("VISIBLE BODY ENGINE V1.1 DEMO — MANUAL SPECTATOR MODE");
  console.log("MECHPROBE DEMO LOCATION:");
  console.log(`${SPECTATOR.x} ${SPECTATOR.y} ${SPECTATOR.z}`);
  console.log("/tp <YOUR_USERNAME> 200.5 97.0 156.5");
  console.log("Not a citizen. Atlas / Maya / Theo / Ava / Kai stay offline.");
  console.log("RCON is fixture setup only. Actions under test are physical Mineflayer skills.");
  console.log(`NORMAL_NAVIGATION_CAN_DIG=${NORMAL_NAVIGATION_CAN_DIG}`);
  console.log("MECHANICS_PROBE_PRESERVE_FIXTURES=true");
  console.log("MECHANICS_PROBE_KEEP_ALIVE=true");
  console.log("");
  console.log("MANUAL CHECKLIST");
  for (const item of CHECKLIST) console.log(`[ ] ${item}`);

  const rconPort = Number(process.env.RCON_PORT ?? 25575);
  const rconPassword = process.env.RCON_PASSWORD ?? "civ-mechanics-rcon";
  const rcon = await tryRcon(config.MINECRAFT_HOST, rconPort, rconPassword);
  if (!rcon) throw new Error("RCON required for demo fixture setup");
  const rconClient = rcon;
  console.log("RCON connected (setup only)");

  await rcon.command(`kick ${username} demo-restart`).catch(() => undefined);
  await rcon.command("kick MechProbeB demo-restart").catch(() => undefined);
  await wait(1_200);

  const body = new MinecraftBody({
    username,
    config: { ...config, MINECRAFT_USERNAME: username, MECHANICS_PROBE_KEEP_ALIVE: true },
    reconnect: false,
    allowRespawn: true,
  });
  console.log(`Connecting ${username} to ${config.MINECRAFT_HOST}:${config.MINECRAFT_PORT}...`);
  const connected = await body.connect();
  if (!connected.success) throw new Error(`Connect failed: ${connected.code} ${connected.error}`);
  await wait(2_500);
  const bot = body.requireBot();
  body.on("error", (error) => console.warn(`body error: ${error.message}`));
  const protocol = (bot as unknown as { _client?: { on?: (event: string, fn: (error: Error) => void) => void } })._client;
  protocol?.on?.("error", (error) => console.warn(`protocol error: ${error.message}`));
  const ctx: SkillContext = { body, bot, timeoutMs: 45_000 };

  let peer: MinecraftBody | undefined;
  let peerCtx: SkillContext | undefined;

  const results: CapResult[] = [];
  const rconUsed: string[] = [];
  const nonPhysical: string[] = [];

  async function cmd(command: string, reason: string): Promise<void> {
    rconUsed.push(`${reason}: ${command}`);
    await rconClient.command(command.startsWith("/") ? command.slice(1) : command);
  }

  async function tpProbe(x: number, y: number, z: number, reason: string): Promise<void> {
    await cmd(`tp ${username} ${x} ${y} ${z}`, reason);
    await wait(1_400);
  }

  async function say(line: string): Promise<void> {
    try {
      bot.chat(line.slice(0, 240));
    } catch {
      // chat is optional
    }
    await pause();
    console.log("START");
    console.log("PHYSICAL ACTIONS");
  }

  async function pause(ms = DEMO_PAUSE_MS): Promise<void> {
    await wait(ms);
  }

  async function walkTo(target: BlockPos, label: string, timeoutMs = 14_000): Promise<void> {
    console.log(`  PHYSICAL: walk ${label} -> ${target.x} ${target.y} ${target.z}`);
    const moved = await moveToPosition(bot, target, { range: 1.3, timeoutMs, recover: true });
    const here = body.position();
    if (!here) throw new Error(`no position after ${label}`);
    const dist = Math.hypot(here.x - target.x, here.z - target.z);
    if (!moved.success && dist > 2.2) {
      throw new Error(`${label} PATH_FAILED ${moved.code} ${moved.error} dist=${dist.toFixed(1)}`);
    }
  }

  function note(result: Omit<CapResult, "durationMs"> & { durationMs?: number; started: number }): void {
    results.push({
      name: result.name,
      passed: result.passed,
      detail: result.detail,
      durationMs: Date.now() - result.started,
      rconSetup: result.rconSetup,
      physical: result.physical,
    });
    console.log(`VERIFY: ${result.passed ? "PASS" : "FAIL"} ${result.name} ${result.detail}`);
  }

  process.on("uncaughtException", (error) => {
    if (isKeepaliveTimeout(error)) {
      console.warn(`keepalive timeout (continuing): ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    console.error(`uncaughtException: ${error instanceof Error ? error.message : String(error)}`);
  });

  await cmd("gamerule mobGriefing false", "prevent creeper/world damage");
  await cmd("gamerule doMobSpawning false", "TEST-ONLY course isolation; colony worlds use spawn-monsters=false instead");
  await cmd("gamerule doDaylightCycle false", "hold time for visibility");
  await cmd("difficulty easy", "combat can happen");
  await cmd("time set day", "start in daylight");
  await cmd(`op ${username}`, "probe can use chat fallback");
  await cmd(`effect give ${username} minecraft:saturation 8 255 true`, "don't starve mid-demo");

  console.log("PHYSICAL ACTIONS: building isolated demo course (RCON fixtures only)");
  await cmd(`fill ${PAD.x0} ${PAD.y} ${PAD.z0} ${PAD.x1} ${PAD.y} ${PAD.z1} grass_block`, "grass pad");
  await cmd(`fill ${PAD.x0} ${PAD.y + 1} ${PAD.z0} ${PAD.x1} ${PAD.y + 8} ${PAD.z1} air`, "clear air above pad");
  await cmd("fill 198 95 154 202 96 158 glass", "spectator deck");
  await cmd("fill 199 97 155 201 97 157 barrier", "spectator rail");
  await cmd("fill 199 95 155 201 95 157 glass", "spectator floor hole patch");
  await cmd("setblock 200 95 156 glass", "spectator stand glass");
  await cmd(`setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} chest[facing=east]`, "inventory chest");
  await cmd("fill 194 90 144 194 90 144 dirt", "1-block step");
  await cmd("fill 197 90 144 198 90 144 oak_stairs[facing=east]", "stairs");
  await cmd("fill 199 90 144 201 90 144 oak_slab[type=bottom]", "slabs");
  await cmd("fill 203 90 143 203 90 145 oak_fence", "gate posts");
  await cmd("setblock 203 90 144 oak_fence_gate[facing=east]", "gate");
  await cmd("setblock 206 90 143 oak_planks", "door frame");
  await cmd("setblock 206 90 145 oak_planks", "door frame");
  await cmd("setblock 206 91 143 oak_planks", "door frame");
  await cmd("setblock 206 91 145 oak_planks", "door frame");
  await cmd("setblock 206 90 144 oak_door[facing=east,half=lower]", "door");
  await cmd("setblock 206 91 144 oak_door[facing=east,half=upper]", "door");
  await cmd("setblock 209 89 144 air", "1-block pit");
  await cmd("setblock 209 88 144 dirt", "pit floor");
  await cmd("setblock 211 90 144 dirt_path", "uneven terrain");
  await cmd("setblock 212 90 144 oak_slab[type=bottom]", "uneven slab");
  await cmd("fill 211 88 146 213 88 148 dirt", "water basin floor");
  await cmd("fill 211 89 146 213 89 148 grass_block", "water basin rim");
  await cmd("fill 211 89 147 213 89 147 water", "water fixture");
  await cmd("fill 208 89 146 210 89 148 grass_block", "water exit land");
  await cmd("fill 214 89 145 214 95 145 oak_planks", "ladder pillar");
  for (let y = 90; y <= 95; y += 1) {
    await cmd(`setblock 214 ${y} 144 ladder[facing=south]`, "ladder");
  }
  await cmd("fill 213 96 143 215 96 146 oak_planks", "ladder top platform");
  await cmd("fill 196 89 148 202 89 154 grass_block", "combat pen floor");
  await cmd("fill 196 90 148 202 92 154 glass", "visible combat pen");
  await cmd("fill 197 90 149 201 91 153 air", "combat pen interior");
  await cmd("setblock 196 90 151 oak_fence_gate[facing=east]", "pen entrance");
  await cmd("fill 190 89 157 194 89 161 grass_block", "farm pad");
  await cmd("setblock 192 89 158 water", "farm water");
  await cmd("setblock 191 89 158 farmland", "mature wheat soil");
  await cmd("setblock 193 89 158 farmland", "immature wheat soil");
  await cmd("setblock 191 90 158 wheat[age=7]", "mature wheat");
  await cmd("setblock 193 90 158 wheat[age=3]", "immature wheat");
  await cmd(`setblock ${FURNACE.x} ${FURNACE.y} ${FURNACE.z} furnace[facing=south]`, "furnace");
  await cmd(`setblock ${TABLE.x} ${TABLE.y} ${TABLE.z} crafting_table`, "crafting table");
  await cmd(`setblock ${ORE.x} ${ORE.y} ${ORE.z} iron_ore`, "iron ore target");
  await cmd("setblock 196 90 161 composter", "farmer workstation");
  await cmd("fill 190 89 163 196 89 168 grass_block", "empty shelter pad");
  await cmd("fill 190 90 163 196 93 168 air", "empty shelter volume");
  await cmd("fill 198 89 163 206 89 168 grass_block", "empty fort pad");
  await cmd("fill 198 90 163 206 92 168 air", "empty fort volume");

  await tpProbe(START.x, START.y, START.z, "place MechProbe at demo start");

  const online = await rcon.command("list").catch(() => "");
  const names = online
    .split(":")
    .slice(1)
    .join(":")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && !isMechanicsProbeUsername(name));
  const spectatorName = names[0] ?? "<YOUR_USERNAME>";

  console.log("");
  console.log("MECHPROBE DEMO LOCATION:");
  console.log(`${SPECTATOR.x} ${SPECTATOR.y} ${SPECTATOR.z}`);
  console.log(`MechProbe start: ${START.x} ${START.y} ${START.z}`);
  console.log(`Teleport (spectator glass deck):`);
  console.log(`/tp ${spectatorName} ${SPECTATOR.x} ${SPECTATOR.y} ${SPECTATOR.z}`);
  if (spectatorName === "<YOUR_USERNAME>") {
    console.log("/tp <YOUR_USERNAME> 200.5 97.0 156.5");
  }
  console.log(`Course pad ${PAD.x0},${PAD.z0} -> ${PAD.x1},${PAD.z1} y=${PAD.y}`);
  console.log(`Demo starts in ${Math.round(SPECTATOR_WAIT_MS / 1000)} seconds. Join and spectate now.`);
  try {
    bot.chat("[MechProbe] Spectator demo starting. Stand on the glass deck.");
  } catch {
    // optional
  }
  await wait(SPECTATOR_WAIT_MS);

  // --- 1. INVENTORY ---
  {
    const started = Date.now();
    const rconSetup = ["clear", "give 64 oak_log", "kill nearby item entities"];
    const physical: string[] = [];
    banner("INVENTORY");
    await say("[MechProbe] Starting inventory demo");
    try {
      await cmd(`clear ${username}`, "known empty inventory");
      await cmd(`execute at ${username} run kill @e[type=item,distance=..12]`, "clear leftover drops");
      await cmd(`give ${username} oak_log 64`, "starting 64 oak logs");
      await wait(800);
      if (inventoryCount(ctx, "oak_log") !== 64) throw new Error(`expected 64 oak_log, have ${inventoryCount(ctx, "oak_log")}`);
      console.log(`  received 64 oak_log (${invSummary(ctx)})`);
      console.log("  PHYSICAL: drop exactly 5 oak_log");
      const dropped5 = await dropItem(ctx, "oak_log", 5, "DEV_TEST");
      if (!dropped5.success) throw new Error(`${dropped5.code} ${dropped5.error}`);
      if (inventoryCount(ctx, "oak_log") !== 59) throw new Error(`after drop 5 have ${inventoryCount(ctx, "oak_log")}`);
      physical.push("drop 5 oak_log");
      await pause();
      const stacks = findStacks(ctx, "oak_log");
      const rest = stacks[0];
      if (!rest) throw new Error("no remaining oak_log stack");
      console.log(`  PHYSICAL: drop remaining stack count=${rest.count}`);
      const droppedRest = await dropStack(ctx, rest, "DEV_TEST");
      if (!droppedRest.success) throw new Error(`${droppedRest.code} ${droppedRest.error}`);
      if (inventoryCount(ctx, "oak_log") !== 0) throw new Error(`expected 0 oak_log after stack drop`);
      physical.push("drop remaining oak_log stack");
      await pause();
      console.log("  PHYSICAL: pick dropped logs back up");
      const deadline = Date.now() + 8_000;
      while (inventoryCount(ctx, "oak_log") < 59 && Date.now() < deadline) {
        await pickupDroppedItem(ctx, "oak_log", 10);
        await wait(400);
      }
      const picked = inventoryCount(ctx, "oak_log");
      if (picked < 59) throw new Error(`pickup left ${picked} oak_log`);
      physical.push(`pickup oak_log now=${picked}`);
      note({ name: "inventory/drop", passed: true, detail: `picked=${picked}`, rconSetup, physical, started });
    } catch (error) {
      note({
        name: "inventory/drop",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["chest already placed"];
    const physical: string[] = [];
    banner("CHEST");
    await say("[MechProbe] Starting chest demo");
    try {
      await walkTo({ x: 191.5, y: 90, z: 141.5 }, "chest");
      const before = inventoryCount(ctx, "oak_log");
      console.log("  PHYSICAL: deposit 16 oak_log into chest");
      const deposited = await depositItem(ctx, "oak_log", 16, CHEST);
      if (!deposited.success) throw new Error(`${deposited.code} ${deposited.error}`);
      physical.push(`deposit ${deposited.data.deposited}`);
      await pause(2_000);
      console.log("  PHYSICAL: withdraw 16 oak_log from chest");
      const withdrawn = await withdrawItem(ctx, "oak_log", 16, CHEST);
      if (!withdrawn.success) throw new Error(`${withdrawn.code} ${withdrawn.error}`);
      physical.push("withdraw 16");
      const after = inventoryCount(ctx, "oak_log");
      if (after < before - 1) throw new Error(`chest round-trip oak_log ${before} -> ${after}`);
      note({ name: "chest", passed: true, detail: `oak_log ${before} -> ${after}`, rconSetup, physical, started });
    } catch (error) {
      note({
        name: "chest",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["spawn MechProbeB", "clear both", "give 12 oak_log"];
    const physical: string[] = [];
    banner("TRANSFER");
    await say("[MechProbe] Starting transfer demo");
    try {
      peer = new MinecraftBody({
        username: "MechProbeB",
        config: { ...config, MINECRAFT_USERNAME: "MechProbeB", MECHANICS_PROBE_KEEP_ALIVE: true },
        reconnect: false,
        allowRespawn: true,
      });
      const peerConnected = await peer.connect();
      if (!peerConnected.success) throw new Error(`MechProbeB ${peerConnected.code} ${peerConnected.error}`);
      await wait(2_000);
      peerCtx = { body: peer, bot: peer.requireBot(), timeoutMs: 28_000 };
      await cmd("tp MechProbeB 193.5 90.0 141.5", "place visible recipient");
      await wait(1_200);
      await cmd(`clear ${username}`, "transfer starting inventory");
      await cmd("clear MechProbeB", "empty recipient");
      clearReservations(ctx);
      clearReservations(peerCtx);
      await cmd(`give ${username} oak_log 12`, "12 logs for 4/8 split");
      await wait(800);
      console.log("  PHYSICAL: toss 8 oak_log to visible MechProbeB");
      const transferred = await transferItemToCitizen(ctx, peerCtx, "oak_log", 8);
      if (!transferred.success) throw new Error(`${transferred.code} ${transferred.error}`);
      physical.push("toss + pickup transfer 8 oak_log");
      const giver = inventoryCount(ctx, "oak_log");
      const receiver = inventoryCount(peerCtx, "oak_log");
      console.log(`  verified giver=${giver} recipient=${receiver} (want 4 / 8)`);
      if (giver !== 4 || receiver !== 8) throw new Error(`giver ${giver} recipient ${receiver}`);
      note({ name: "transfer", passed: true, detail: "sender 4 / recipient 8", rconSetup, physical, started });
    } catch (error) {
      note({
        name: "transfer",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  // --- 2. TRAVERSAL ---
  {
    const started = Date.now();
    const rconSetup = ["nav fixtures built at course setup"];
    const physical: string[] = [];
    banner("TRAVERSAL");
    await say("[MechProbe] Starting traversal demo");
    try {
      await walkTo(NAV_START, "flat ground start");
      physical.push("flat");
      await pause(2_000);
      await walkTo({ x: 194.5, y: 91, z: 144.5 }, "1-block step");
      physical.push("step");
      await pause(2_000);
      await walkTo({ x: 196.5, y: 90, z: 144.5 }, "1-block drop");
      physical.push("drop");
      await pause(2_000);
      await walkTo({ x: 198.5, y: 91, z: 144.5 }, "stairs");
      physical.push("stairs");
      await pause(2_000);
      await walkTo({ x: 201.5, y: 90, z: 144.5 }, "slabs");
      physical.push("slabs");
      await pause(2_000);
      console.log("  PHYSICAL: open fence gate and walk through");
      const gate = await openFenceGate(ctx, { x: 203, y: 90, z: 144 });
      if (!gate.success) throw new Error(`gate ${gate.code} ${gate.error}`);
      await walkTo({ x: 204.5, y: 90, z: 144.5 }, "through gate");
      physical.push("gate");
      await pause(2_000);
      console.log("  PHYSICAL: open door and walk through");
      const door = await openDoor(ctx, { x: 206, y: 90, z: 144 });
      if (!door.success) throw new Error(`door ${door.code} ${door.error}`);
      await walkTo({ x: 207.5, y: 90, z: 144.5 }, "through door");
      physical.push("door");
      await pause(2_000);
      await walkTo({ x: 209.5, y: 89, z: 144.5 }, "into pit");
      await localEscape(bot, { timeoutMs: 5_000 });
      await walkTo({ x: 210.5, y: 90, z: 144.5 }, "out of pit");
      physical.push("pit");
      await pause(2_000);
      await walkTo({ x: 212.5, y: 90, z: 144.5 }, "uneven terrain");
      physical.push("uneven");
      console.log("  PHYSICAL: short sprint");
      const sprintFrom = body.position();
      bot.setControlState("forward", true);
      bot.setControlState("sprint", true);
      await wait(1_600);
      bot.clearControlStates();
      const sprintTo = body.position();
      const sprintDist =
        sprintFrom && sprintTo ? Math.hypot(sprintTo.x - sprintFrom.x, sprintTo.z - sprintFrom.z) : 0;
      physical.push(`sprint ${sprintDist.toFixed(1)}`);
      if (sprintDist < 1.5) throw new Error(`sprint displacement ${sprintDist.toFixed(1)}`);
      note({ name: "movement", passed: true, detail: physical.join(", "), rconSetup, physical, started });
    } catch (error) {
      note({
        name: "movement",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  // --- 3. WATER (known failure) ---
  {
    const started = Date.now();
    const rconSetup = ["water basin at course setup"];
    const physical: string[] = [];
    banner("WATER");
    await say("[MechProbe] Starting water demo");
    console.log("  known 1.21.11 failure: exit often leaves MechProbe swimming at y~89");
    try {
      await walkTo({ x: 210.5, y: 90, z: 146.5 }, "water rim");
      console.log("  PHYSICAL: enter water");
      const into = await moveToPosition(bot, WATER_IN, { range: 1.2, timeoutMs: 10_000, recover: true });
      await pause(2_500);
      const wet = body.position();
      const inWater = Boolean((bot.entity as { isInWater?: boolean } | undefined)?.isInWater) || (wet && wet.y < 90.2);
      physical.push(`enter y=${wet?.y.toFixed(2) ?? "?"} inWater=${inWater} ${into.success ? "path-ok" : into.code}`);
      console.log("  PHYSICAL: attempt exit");
      await localEscape(bot, { timeoutMs: 6_000 });
      bot.setControlState("sprint", true);
      bot.setControlState("forward", true);
      bot.setControlState("jump", true);
      await wait(1_800);
      bot.clearControlStates();
      const out = await moveToPosition(bot, WATER_OUT, { range: 1.0, timeoutMs: 12_000, recover: true });
      const dry = body.position();
      const stillWet = Boolean((bot.entity as { isInWater?: boolean } | undefined)?.isInWater);
      const reason = `water exit y=${dry?.y.toFixed(2) ?? "?"} inWater=${stillWet} ${out.success ? "" : `${out.code} ${out.error}`}`;
      physical.push(reason);
      if (!dry || dry.y < 89.8 || stillWet) {
        throw new Error(reason.trim());
      }
      note({ name: "water", passed: true, detail: reason, rconSetup, physical, started });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`  KNOWN FAILURE VISIBLE: ${detail}`);
      note({ name: "water", passed: false, detail, rconSetup, physical, started });
      await tpProbe(213.5, 90, 144.5, "recovery after documented water failure so ladder can be shown");
    }
  }

  // --- 4. LADDER (known failure) ---
  {
    const started = Date.now();
    const rconSetup = ["ladder pillar at course setup"];
    const physical: string[] = [];
    banner("LADDER");
    await say("[MechProbe] Starting ladder demo");
    console.log("  known 1.21.11 failure: control-state climb ΔY ~ 0");
    try {
      await walkTo({ x: 214.5, y: 90, z: 144.5 }, "ladder base");
      await bot.look(0, -1.1, true).catch(() => undefined);
      console.log("  PHYSICAL: hold camera on ladder");
      await pause(3_500);
      const startY = body.position()?.y ?? 0;
      console.log("  PHYSICAL: attempt climb");
      const climbed = await climbLadder(ctx, "up", LADDER);
      await pause(3_000);
      const endY = body.position()?.y ?? startY;
      const dy = endY - startY;
      physical.push(`climb up ΔY=${dy.toFixed(2)} y=${startY.toFixed(2)}->${endY.toFixed(2)} ${climbed.success ? "ok" : climbed.code}`);
      console.log(`  observed Y delta=${dy.toFixed(2)}`);
      console.log("  PHYSICAL: attempt descent");
      const down = await climbLadder(ctx, "down", { x: 214, y: 94, z: 144 });
      const afterDown = body.position()?.y ?? endY;
      physical.push(`down y=${afterDown.toFixed(2)} ${down.success ? "ok" : down.code}`);
      if (dy < 2.4) {
        throw new Error(`LADDER_FAILED ΔY=${dy.toFixed(2)} ${climbed.success ? "" : `${climbed.code} ${climbed.error}`}`);
      }
      note({ name: "ladder", passed: true, detail: `ΔY=${dy.toFixed(2)}`, rconSetup, physical, started });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`  KNOWN FAILURE VISIBLE: ${detail}`);
      note({ name: "ladder", passed: false, detail, rconSetup, physical, started });
      await tpProbe(PEN.x, PEN.y, PEN.z, "recovery after documented ladder failure so combat can be shown");
    }
  }

  await cmd("time set 18000", "night for undead combat");

  async function fightVisible(kind: "zombie" | "skeleton" | "spider"): Promise<void> {
    const started = Date.now();
    const rconSetup = [`summon ${kind}`, "give stone_sword if missing", "clear leftover hostiles in pen"];
    const physical: string[] = [];
    banner(`${kind.toUpperCase()} COMBAT`);
    await say(`[MechProbe] Starting ${kind} combat demo`);
    try {
      await cmd(`execute at ${username} run kill @e[type=zombie,distance=..24]`, "pen cleanup before spawn");
      await cmd(`execute at ${username} run kill @e[type=skeleton,distance=..24]`, "pen cleanup before spawn");
      await cmd(`execute at ${username} run kill @e[type=spider,distance=..24]`, "pen cleanup before spawn");
      if (inventoryCount(ctx, "stone_sword") < 1 && inventoryCount(ctx, "iron_sword") < 1) {
        await cmd(`give ${username} stone_sword 1`, "weapon for combat");
      }
      await walkTo(PEN, `${kind} pen`);
      await cmd(`execute at ${username} run summon ${kind} ~1.4 ~ ~ {PersistenceRequired:1b,Health:12f}`, `spawn ${kind}`);
      await wait(900);
      const healthBefore = bot.health;
      console.log(`  health before=${healthBefore}`);
      console.log(`  PHYSICAL: approach, equip weapon, attack ${kind}`);
      const fought = await attackHostile(ctx, [kind], { collect: true, timeoutMs: 28_000 });
      const healthAfter = bot.health;
      console.log(`  health after=${healthAfter} result=${fought.success ? "ok" : fought.code}`);
      physical.push(`attack ${kind} hp ${healthBefore}->${healthAfter}`);
      if (!fought.success) throw new Error(`${fought.code} ${fought.error}`);
      if (!fought.data.killed) throw new Error(`${kind} not verified dead`);
      physical.push(`killed hits=${fought.data.hits}`);
      note({
        name: kind,
        passed: true,
        detail: `hp ${healthBefore}->${healthAfter} hits=${fought.data.hits}`,
        rconSetup,
        physical,
        started,
      });
    } catch (error) {
      note({
        name: kind,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
      await cmd(`execute at ${username} run kill @e[type=${kind},distance=..20]`, `${kind} leftover cleanup after FAIL`);
    }
    await pause();
  }

  await fightVisible("zombie");
  await fightVisible("skeleton");
  await fightVisible("spider");

  {
    const started = Date.now();
    const rconSetup = ["summon creeper Fuse:200", "kill creeper after flee to prevent explosion"];
    const physical: string[] = [];
    banner("CREEPER FLEE");
    await say("[MechProbe] Starting creeper flee demo");
    try {
      await walkTo({ x: 193.5, y: 90, z: 152.5 }, "creeper start");
      await cmd(`execute at ${username} run kill @e[type=creeper,distance=..40]`, "no leftover creeper");
      await cmd(`execute at ${username} run summon creeper ~3.5 ~ ~ {PersistenceRequired:1b,Fuse:200s}`, "controlled creeper");
      await wait(600);
      console.log("  PHYSICAL: flee, do not attack");
      const fled = await fleeCreeper(ctx);
      physical.push(`flee ${fled.success ? "ok" : fled.code}`);
      await cmd(`execute at ${username} run kill @e[type=creeper,distance=..40]`, "prevent world damage after flee");
      if (!fled.success) throw new Error(`${fled.code} ${fled.error}`);
      console.log(`  distance before=${fled.data.distanceBefore.toFixed(1)} after=${fled.data.distanceAfter.toFixed(1)}`);
      if (fled.data.distanceAfter <= fled.data.distanceBefore) {
        throw new Error(`distance ${fled.data.distanceBefore.toFixed(1)} -> ${fled.data.distanceAfter.toFixed(1)}`);
      }
      note({
        name: "creeper flee",
        passed: true,
        detail: `${fled.data.distanceBefore.toFixed(1)} -> ${fled.data.distanceAfter.toFixed(1)}`,
        rconSetup,
        physical,
        started,
      });
    } catch (error) {
      await cmd(`execute at ${username} run kill @e[type=creeper,distance=..40]`, "creeper safety cleanup");
      note({
        name: "creeper flee",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  await cmd("time set day", "daylight for hunting/farm");

  async function huntVisible(kind: "cow" | "pig" | "chicken"): Promise<void> {
    const started = Date.now();
    const rconSetup = [`summon ${kind} NoAI`, "give stone_sword if missing"];
    const physical: string[] = [];
    banner(`ANIMAL HUNTING ${kind.toUpperCase()}`);
    await say(`[MechProbe] Starting ${kind} hunt demo`);
    try {
      await cmd(`execute at ${username} run kill @e[type=${kind},distance=..24]`, `clear leftover ${kind} fixture`);
      if (inventoryCount(ctx, "stone_sword") < 1 && inventoryCount(ctx, "iron_sword") < 1) {
        await cmd(`give ${username} stone_sword 1`, "weapon for hunt");
      }
      await walkTo({ x: 199.5, y: 90, z: 151.5 }, `${kind} pen`);
      await cmd(`execute at ${username} run summon ${kind} ~1.6 ~ ~ {PersistenceRequired:1b,NoAI:1b}`, `spawn ${kind}`);
      await wait(700);
      const before =
        kind === "cow"
          ? inventoryCount(ctx, "beef") + inventoryCount(ctx, "leather")
          : kind === "pig"
            ? inventoryCount(ctx, "porkchop")
            : inventoryCount(ctx, "chicken") + inventoryCount(ctx, "feather");
      console.log(`  PHYSICAL: approach, kill ${kind}, collect drops (no /kill)`);
      const hunted = await huntAnimal(ctx, kind);
      physical.push(`hunt ${kind}`);
      if (!hunted.success) throw new Error(`${hunted.code} ${hunted.error}`);
      if (!hunted.data.killed) throw new Error(`${kind} not dead`);
      await wait(800);
      await pickupDroppedItem(ctx, undefined, 12);
      const after =
        kind === "cow"
          ? inventoryCount(ctx, "beef") + inventoryCount(ctx, "leather")
          : kind === "pig"
            ? inventoryCount(ctx, "porkchop")
            : inventoryCount(ctx, "chicken") + inventoryCount(ctx, "feather");
      console.log(`  inventory drop items ${before} -> ${after} collected=${hunted.data.collected}`);
      if (hunted.data.collected < 1 && after <= before) {
        throw new Error(`${kind} died but inventory did not increase`);
      }
      note({
        name: kind,
        passed: true,
        detail: `drops ${before}->${after}`,
        rconSetup,
        physical,
        started,
      });
    } catch (error) {
      note({
        name: kind,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
    await pause();
  }

  await huntVisible("cow");
  await huntVisible("pig");
  await huntVisible("chicken");

  {
    const started = Date.now();
    const rconSetup = ["farmland + wheat age 7 and age 3", "give seeds/hoe"];
    const physical: string[] = [];
    banner("FARMING");
    await say("[MechProbe] Starting farming demo");
    try {
      await cmd(`give ${username} wheat_seeds 8`, "seeds for replant");
      await cmd(`give ${username} wooden_hoe 1`, "hoe for till-and-plant");
      await walkTo({ x: 191.5, y: 90, z: 157.5 }, "farm plot");
      const immatureBefore = blockAt(bot, FARM_IMMATURE.x, FARM_IMMATURE.y, FARM_IMMATURE.z);
      console.log(`  immature=${immatureBefore?.name ?? "none"} (must stay)`);
      console.log("  PHYSICAL: harvest mature wheat only");
      const harvested = await harvestCrop(ctx, "wheat");
      if (!harvested.success) throw new Error(`${harvested.code} ${harvested.error}`);
      physical.push("harvest mature");
      const immatureAfter = blockAt(bot, FARM_IMMATURE.x, FARM_IMMATURE.y, FARM_IMMATURE.z);
      if (immatureAfter?.name !== "wheat") throw new Error("immature wheat was destroyed");
      if (!harvested.data.replanted) {
        const planted = await plantCrop(ctx, "wheat", harvested.data.position);
        if (!planted.success) throw new Error(`${planted.code} ${planted.error}`);
      }
      physical.push("replant");
      const replant = blockAt(bot, harvested.data.position.x, harvested.data.position.y, harvested.data.position.z);
      if (replant?.name !== "wheat") throw new Error(`replant got ${replant?.name ?? "none"}`);
      await pause(2_000);
      console.log("  PHYSICAL: till-and-plant tiny plot");
      const tilled = await tillAndPlant(ctx, TILL, "wheat");
      if (!tilled.success) throw new Error(`${tilled.code} ${tilled.error}`);
      physical.push("till-and-plant");
      note({ name: "farming", passed: true, detail: physical.join(", "), rconSetup, physical, started });
    } catch (error) {
      note({
        name: "farming",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["existing furnace", "give beef/coal if missing"];
    const physical: string[] = [];
    banner("COOKING");
    await say("[MechProbe] Starting cooking demo");
    try {
      if (inventoryCount(ctx, "beef") < 1) await cmd(`give ${username} beef 2`, "raw beef for cooking");
      if (inventoryCount(ctx, "coal") < 1) await cmd(`give ${username} coal 4`, "furnace fuel");
      await walkTo({ x: 197.5, y: 90, z: 157.5 }, "furnace");
      const before = inventoryCount(ctx, "cooked_beef");
      console.log("  PHYSICAL: load furnace with raw beef + fuel, wait for real cook");
      const cooked = await smeltItem(ctx, "beef", "cooked_beef", 1, FURNACE);
      physical.push("openFurnace putInput putFuel wait takeOutput");
      if (!cooked.success) throw new Error(`${cooked.code} ${cooked.error}`);
      const after = inventoryCount(ctx, "cooked_beef");
      if (after <= before) throw new Error("no cooked_beef produced");
      note({ name: "cooking", passed: true, detail: `cooked_beef ${before}->${after}`, rconSetup, physical, started });
    } catch (error) {
      note({
        name: "cooking",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["setblock iron_ore", "give stone_pickaxe"];
    const physical: string[] = [];
    banner("IRON MINING");
    await say("[MechProbe] Starting iron mining demo");
    try {
      await cmd(`setblock ${ORE.x} ${ORE.y} ${ORE.z} iron_ore`, "replace ore target");
      if (inventoryCount(ctx, "stone_pickaxe") < 1 && inventoryCount(ctx, "iron_pickaxe") < 1) {
        await cmd(`give ${username} stone_pickaxe 1`, "tool to mine ore");
      }
      await walkTo({ x: 199.5, y: 90, z: 157.5 }, "iron ore");
      const before = inventoryCount(ctx, "raw_iron");
      console.log("  PHYSICAL: mine iron ore and collect raw iron");
      const mined = await collectResource(ctx, ["iron_ore", "deepslate_iron_ore"], 1, 12, ORE);
      physical.push("collectResource iron_ore");
      const after = inventoryCount(ctx, "raw_iron");
      if (after <= before) {
        throw new Error(`${mined.success ? "no raw_iron collected" : `${mined.code} ${mined.error}`}`);
      }
      note({ name: "iron mining", passed: true, detail: `raw_iron ${before}->${after}`, rconSetup, physical, started });
    } catch (error) {
      note({
        name: "iron mining",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["reuse furnace", "give coal if missing — NOT iron_ingot"];
    const physical: string[] = [];
    banner("SMELTING");
    await say("[MechProbe] Starting smelting demo");
    try {
      if (inventoryCount(ctx, "raw_iron") < 1) throw new Error("no physically mined raw_iron to smelt");
      if (inventoryCount(ctx, "coal") < 1) await cmd(`give ${username} coal 4`, "fuel for iron smelt");
      const before = inventoryCount(ctx, "iron_ingot");
      console.log("  PHYSICAL: smelt raw_iron in furnace (no /give iron_ingot)");
      const smelted = await smeltItem(ctx, "raw_iron", "iron_ingot", 1, FURNACE);
      physical.push("smelt raw_iron -> iron_ingot");
      if (!smelted.success) throw new Error(`${smelted.code} ${smelted.error}`);
      const after = inventoryCount(ctx, "iron_ingot");
      if (after <= before) throw new Error("no iron_ingot produced");
      note({ name: "smelting", passed: true, detail: `iron_ingot ${before}->${after}`, rconSetup, physical, started });
    } catch (error) {
      note({
        name: "smelting",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["give oak_log/cobble/sticks/extra ingots as craft inputs", "crafting table already placed"];
    const physical: string[] = [];
    banner("TOOL PROGRESSION");
    await say("[MechProbe] Starting tool progression demo");
    try {
      await cmd(`give ${username} oak_log 16`, "wood for wooden pickaxe");
      await cmd(`give ${username} cobblestone 16`, "stone for stone pickaxe");
      await cmd(`give ${username} stick 16`, "sticks");
      await cmd(`give ${username} iron_ingot 12`, "extra ingots for iron tools (smelt already proven)");
      await walkTo({ x: 198.5, y: 90, z: 156.5 }, "crafting table");
      for (const item of ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "iron_sword", "iron_axe"] as const) {
        console.log(`  PHYSICAL: craft ${item}`);
        const made = await obtainItem(ctx, item, 1);
        if (!made.success) throw new Error(`${item} ${made.code} ${made.error}`);
        if (inventoryCount(ctx, item) < 1) throw new Error(`${item} missing after craft`);
        physical.push(item);
        console.log(`  inventory after ${item}: ${invSummary(ctx)}`);
        await pause(2_000);
      }
      note({ name: "tools", passed: true, detail: physical.join(", "), rconSetup, physical, started });
    } catch (error) {
      note({
        name: "tools",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["give iron_ingot for armor recipes — not finished armor"];
    const physical: string[] = [];
    banner("ARMOR");
    await say("[MechProbe] Starting armor demo");
    try {
      await cmd(`give ${username} iron_ingot 24`, "armor craft inputs");
      await walkTo({ x: 198.5, y: 90, z: 156.5 }, "crafting table");
      const pieces = [
        ["iron_helmet", "head"],
        ["iron_chestplate", "torso"],
        ["iron_leggings", "legs"],
        ["iron_boots", "feet"],
      ] as const;
      for (const [item, slot] of pieces) {
        console.log(`  PHYSICAL: craft and equip ${item}`);
        const made = await obtainItem(ctx, item, 1);
        if (!made.success) throw new Error(`${item} ${made.code} ${made.error}`);
        const equipped = await equipItem(ctx, item, slot);
        if (!equipped.success) throw new Error(`${item} equip ${equipped.code} ${equipped.error}`);
        physical.push(`${item} equipped`);
        await pause(2_000);
      }
      console.log("  pause for visual armor inspection");
      await bot.look(bot.entity?.yaw ?? 0, 0, true).catch(() => undefined);
      await pause(5_000);
      note({ name: "armor", passed: true, detail: "full iron set equipped", rconSetup, physical, started });
    } catch (error) {
      note({
        name: "armor",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["summon farmer villager", "give wheat/emerald", "composter"];
    const physical: string[] = [];
    banner("VILLAGER TRADE");
    await say("[MechProbe] Starting villager trade demo");
    try {
      await cmd(`execute at ${username} run kill @e[type=villager,distance=..20]`, "one controlled villager");
      await cmd(`give ${username} wheat 32`, "trade input");
      await cmd(`give ${username} emerald 8`, "trade input fallback");
      await walkTo(VILLAGER, "villager");
      await cmd(
        `execute at ${username} run summon villager ~1.8 ~ ~ {PersistenceRequired:1b,NoAI:1b,VillagerData:{profession:"minecraft:farmer",level:2,type:"minecraft:plains"}}`,
        "controlled farmer",
      );
      await wait(1_000);
      const beforeWheat = inventoryCount(ctx, "wheat");
      const beforeEmerald = inventoryCount(ctx, "emerald");
      console.log("  PHYSICAL: approach, openVillager, perform one trade");
      const traded = await tradeWithVillager(ctx);
      physical.push("openVillager + trade");
      if (!traded.success) throw new Error(`${traded.code} ${traded.error}`);
      const afterWheat = inventoryCount(ctx, "wheat");
      const afterEmerald = inventoryCount(ctx, "emerald");
      if (afterWheat === beforeWheat && afterEmerald === beforeEmerald) {
        throw new Error("inventory did not change after trade");
      }
      note({
        name: "villager trade",
        passed: true,
        detail: `${traded.data.input ?? "?"} -> ${traded.data.output ?? "?"} wheat ${beforeWheat}->${afterWheat} emerald ${beforeEmerald}->${afterEmerald}`,
        rconSetup,
        physical,
        started,
      });
    } catch (error) {
      note({
        name: "villager trade",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["empty pad", "give oak_planks + oak_door"];
    const physical: string[] = [];
    banner("COMPLETE SHELTER");
    await say("[MechProbe] Starting shelter demo");
    try {
      await cmd("fill 190 90 163 196 93 168 air", "ensure empty shelter pad");
      await cmd(`give ${username} oak_planks 64`, "shelter materials");
      await cmd(`give ${username} oak_door 2`, "door item");
      await walkTo({ x: 190.5, y: 90, z: 162.5 }, "shelter pad");
      console.log("  PHYSICAL: place floor, walls, doorway, door, roof");
      const built = await executeStructure(ctx, probeShelter(), SHELTER);
      physical.push("executeStructure probeShelter");
      if (!built.success) throw new Error(`${built.code} ${built.error}`);
      const report = verifyStructure(ctx, probeShelter(), SHELTER);
      if (report.missing > 0 || report.wrong > 0) {
        throw new Error(`shelter missing=${report.missing} wrong=${report.wrong}`);
      }
      console.log("  pause for shelter inspection");
      await pause(4_000);
      note({ name: "shelter", passed: true, detail: `placed=${report.placed}`, rconSetup, physical, started });
    } catch (error) {
      note({
        name: "shelter",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  {
    const started = Date.now();
    const rconSetup = ["empty pad", "give cobblestone + oak_fence_gate"];
    const physical: string[] = [];
    banner("DEFENSIVE ENCLOSURE");
    await say("[MechProbe] Starting fort demo");
    try {
      await cmd("fill 198 90 163 206 92 168 air", "ensure empty fort pad");
      await cmd(`give ${username} cobblestone 64`, "fort materials");
      await cmd(`give ${username} oak_fence_gate 1`, "fort gate");
      await walkTo({ x: 199.5, y: 90, z: 163.5 }, "fort pad");
      console.log("  PHYSICAL: place 5x5 cobble enclosure + gate");
      const built = await executeStructure(ctx, probeFort(), FORT);
      physical.push("executeStructure probeFort");
      if (!built.success) throw new Error(`${built.code} ${built.error}`);
      const report = verifyStructure(ctx, probeFort(), FORT);
      if (report.missing > 0 || report.wrong > 0) {
        throw new Error(`fort missing=${report.missing} wrong=${report.wrong}`);
      }
      console.log("  pause for fort inspection");
      await pause(4_000);
      note({ name: "fort", passed: true, detail: `placed=${report.placed}`, rconSetup, physical, started });
    } catch (error) {
      note({
        name: "fort",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
        rconSetup,
        physical,
        started,
      });
    }
  }

  const finalPos = posLine(body);
  console.log("");
  console.log("========================");
  console.log("DEMO COMPLETE — MECHPROBE REMAINS ONLINE FOR MANUAL INSPECTION");
  console.log("========================");
  console.log(`MECHPROBE FINAL POSITION: ${finalPos}`);
  console.log("MECHPROBE STILL ONLINE: YES");
  if (peer) console.log("MECHPROBEB STILL ONLINE: YES (transfer recipient, left visible)");
  console.log("Fixtures preserved: shelter, fort, farm, ladder, water, chest, furnace.");
  console.log("No cleanup. Ctrl+C to disconnect.");
  console.log("");
  console.log("DEMO RESULTS");
  for (const result of results) {
    console.log(
      `- ${result.passed ? "PASS" : "FAIL"} ${result.name} (${result.durationMs}ms) ${result.detail}`,
    );
  }
  console.log("");
  console.log("RCON SETUP COMMANDS USED:");
  for (const line of rconUsed.slice(0, 80)) console.log(`  ${line}`);
  if (rconUsed.length > 80) console.log(`  ... ${rconUsed.length - 80} more setup commands`);
  if (nonPhysical.length) {
    console.log("ACTIONS THAT DID NOT PHYSICALLY EXECUTE:");
    for (const line of nonPhysical) console.log(`  ${line}`);
  } else {
    console.log("ACTIONS THAT DID NOT PHYSICALLY EXECUTE: none recorded (failures still attempted in-world)");
  }

  console.log(`KEEP_ALIVE: ${username} remaining connected and idle. Not performing citizen tasks.`);
  const idle = setInterval(() => {
    console.log(`[MechProbe idle] demo-complete pos=${posLine(body)} food=${bot.food} health=${bot.health}`);
  }, 15_000);
  await new Promise<void>((resolve) => {
    const stop = () => {
      clearInterval(idle);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await body.disconnect("demo-stop");
  if (peer) await peer.disconnect("demo-stop");
  await rcon.command("gamerule doMobSpawning true").catch(() => undefined);
  rcon.close();
}

if (process.argv[1]?.includes("live-mechanics-demo")) {
  void runMechanicsDemo().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
