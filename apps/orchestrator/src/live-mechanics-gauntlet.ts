import type { MinecraftBody } from "@civ/minecraft-adapter";
import { localEscape, moveToPosition } from "@civ/minecraft-adapter";
import {
  attackHostile,
  climbLadder,
  collectResource,
  executeStructure,
  fleeCreeper,
  harvestCrop,
  huntAnimal,
  inventoryCount,
  obtainItem,
  openFenceGate,
  plantCrop,
  probeFort,
  probeShelter,
  pickupDroppedItem,
  smeltItem,
  tillAndPlant,
  tradeWithVillager,
  verifyStructure,
  equipItem,
  type SkillContext,
} from "@civ/skills";
import type { RconClient } from "./rcon.js";

export type GauntletCase = { name: string; passed: boolean; detail: string; durationMs: number };

type Helpers = {
  ctx: SkillContext;
  bot: SkillContext["bot"];
  body: MinecraftBody;
  rcon: RconClient | undefined;
  username: string;
  preserveFixtures: boolean;
  wait: (ms: number) => Promise<void>;
  runCommand: (bot: SkillContext["bot"], rcon: RconClient | undefined, command: string) => Promise<void>;
  runCase: (name: string, fn: () => Promise<void>) => Promise<GauntletCase>;
  blockAt: (bot: SkillContext["bot"], x: number, y: number, z: number) => { name: string } | null;
  snapshotSolids: (bot: SkillContext["bot"], origin: { x: number; y: number; z: number }, radius: number) => Map<string, string>;
  brokenSolids: (bot: SkillContext["bot"], before: Map<string, string>) => string[];
};

const COURSE = { x0: 192, y: 89, z0: 134, x1: 218, z1: 168 };

export async function runBodyGauntlet(h: Helpers): Promise<GauntletCase[]> {
  const results: GauntletCase[] = [];
  const { ctx, bot, body, rcon, username, wait, runCommand, runCase, blockAt, snapshotSolids, brokenSolids } = h;

  async function cmd(command: string): Promise<void> {
    await runCommand(bot, rcon, command);
  }
  async function tp(x: number, y: number, z: number): Promise<void> {
    await cmd(`tp ${username} ${x} ${y} ${z}`);
    await wait(1_200);
  }

  await cmd(`fill ${COURSE.x0} ${COURSE.y} ${COURSE.z0} ${COURSE.x1} ${COURSE.y} ${COURSE.z1} grass_block`);
  await cmd(`fill ${COURSE.x0} ${COURSE.y + 1} ${COURSE.z0} ${COURSE.x1} ${COURSE.y + 4} ${COURSE.z1} air`);
  await cmd("gamerule mobGriefing false");
  await cmd("gamerule doMobSpawning false");
  await cmd("difficulty easy");

  results.push(
    await runCase("step up 1 block without mining", async () => {
      await cmd("fill 194 90 138 194 90 138 dirt");
      await tp(193.5, 90, 138.5);
      const start = body.position();
      if (!start) throw new Error("no position");
      const before = snapshotSolids(bot, start, 4);
      const moved = await moveToPosition(bot, { x: 194.5, y: 91, z: 138.5 }, { range: 1.2, timeoutMs: 10_000, recover: true });
      const here = body.position();
      const dy = here ? here.y - start.y : 0;
      const gone = brokenSolids(bot, before);
      if (gone.length) throw new Error(`broke ${gone.slice(0, 4).join("; ")}`);
      if (dy < 0.6 && (!moved.success || (here && Math.hypot(here.x - 194.5, here.z - 138.5) > 2))) {
        throw new Error(`step-up dy=${dy.toFixed(2)} ${moved.success ? "ok" : `${moved.code} ${moved.error}`}`);
      }
    }),
  );

  results.push(
    await runCase("drop down 1 block without mining", async () => {
      await cmd("fill 196 90 138 196 90 138 dirt");
      await tp(196.5, 91, 138.5);
      const start = body.position();
      if (!start) throw new Error("no position");
      const moved = await moveToPosition(bot, { x: 197.5, y: 90, z: 138.5 }, { range: 1.2, timeoutMs: 10_000, recover: true });
      const here = body.position();
      const dy = here ? start.y - here.y : 0;
      if (dy < 0.4 && !moved.success) throw new Error(`${moved.code} ${moved.error} dy=${dy.toFixed(2)}`);
    }),
  );

  results.push(
    await runCase("climb oak stairs", async () => {
      await cmd("fill 194 90 142 196 90 142 oak_stairs[facing=east]");
      await tp(193.5, 90, 142.5);
      const moved = await moveToPosition(bot, { x: 196.5, y: 91, z: 142.5 }, { range: 1.4, timeoutMs: 10_000, recover: true });
      const here = body.position();
      if (!here || here.x < 195) throw new Error(`${moved.success ? "short" : `${moved.code} ${moved.error}`}`);
    }),
  );

  results.push(
    await runCase("walk oak slabs", async () => {
      await cmd("fill 194 90 144 198 90 144 oak_slab[type=bottom]");
      await tp(193.5, 90, 144.5);
      const start = body.position();
      const moved = await moveToPosition(bot, { x: 198.5, y: 90, z: 144.5 }, { range: 1.4, timeoutMs: 10_000, recover: true });
      const here = body.position();
      const dist = start && here ? Math.hypot(here.x - start.x, here.z - start.z) : 0;
      if (dist < 3) throw new Error(`slab walk ${dist.toFixed(1)} ${moved.success ? "" : `${moved.code} ${moved.error}`}`);
    }),
  );

  results.push(
    await runCase("open fence gate and walk through", async () => {
      await cmd("fill 200 90 138 200 90 140 oak_fence");
      await cmd("setblock 200 90 139 oak_fence_gate[facing=east]");
      await tp(198.5, 90, 139.5);
      const opened = await openFenceGate(ctx, { x: 200, y: 90, z: 139 });
      if (!opened.success) throw new Error(`${opened.code} ${opened.error}`);
      const through = await moveToPosition(bot, { x: 201.5, y: 90, z: 139.5 }, { range: 1.2, timeoutMs: 8_000, recover: false });
      const here = body.position();
      if (!here || here.x < 200.2) {
        throw new Error(`gate walk failed ${through.success ? "" : `${through.code} ${through.error}`}`);
      }
    }),
  );

  results.push(
    await runCase("enter and leave water", async () => {
      await cmd("fill 194 88 148 198 88 150 dirt");
      await cmd("fill 194 89 148 198 89 150 grass_block");
      await cmd("setblock 196 89 149 water");
      await tp(194.5, 90, 149.5);
      const into = await moveToPosition(bot, { x: 196.5, y: 89.2, z: 149.5 }, { range: 1.2, timeoutMs: 10_000, recover: true });
      const wet = body.position();
      const inWater = Boolean((bot.entity as { isInWater?: boolean } | undefined)?.isInWater) || (wet && wet.y < 90.2);
      if (!inWater && !into.success) throw new Error(`water entry ${into.code} ${into.error}`);
      await localEscape(bot, { timeoutMs: 6_000 });
      bot.setControlState("sprint", true);
      bot.setControlState("forward", true);
      bot.setControlState("jump", true);
      await wait(1_600);
      bot.clearControlStates();
      const out = await moveToPosition(bot, { x: 198.5, y: 90, z: 149.5 }, { range: 1.0, timeoutMs: 12_000, recover: true });
      const dry = body.position();
      if (!dry || dry.y < 89.8 || (bot.entity as { isInWater?: boolean } | undefined)?.isInWater) {
        throw new Error(`water exit y=${dry?.y.toFixed(2) ?? "?"} ${out.success ? "" : `${out.code} ${out.error}`}`);
      }
    }),
  );

  results.push(
    await runCase("sprint on flat ground", async () => {
      await tp(193.5, 90, 152.5);
      const start = body.position();
      if (!start) throw new Error("no position");
      bot.setControlState("forward", true);
      bot.setControlState("sprint", true);
      await wait(1_400);
      bot.clearControlStates();
      const here = body.position();
      const dist = here ? Math.hypot(here.x - start.x, here.z - start.z) : 0;
      if (dist < 2) throw new Error(`sprint displacement ${dist.toFixed(1)} < 2`);
    }),
  );

  results.push(
    await runCase("climb ladder up", async () => {
      await cmd("fill 204 89 140 204 95 140 oak_planks");
      for (let y = 90; y <= 95; y += 1) {
        await cmd(`setblock 204 ${y} 139 ladder[facing=south]`);
      }
      await cmd("fill 203 96 138 205 96 141 oak_planks");
      await tp(204.5, 90.2, 139.5);
      await wait(400);
      const climbed = await climbLadder(ctx, "up", { x: 204, y: 90, z: 139 });
      if (!climbed.success) throw new Error(`${climbed.code} ${climbed.error}`);
      const here = body.position();
      if (!here || here.y < 92.5) throw new Error(`ladder up y=${here?.y.toFixed(2) ?? "?"}`);
    }),
  );

  results.push(
    await runCase("climb ladder down", async () => {
      const start = body.position();
      if (!start || start.y < 92) {
        await tp(204.5, 96, 139.5);
      }
      const climbed = await climbLadder(ctx, "down", { x: 204, y: 94, z: 139 });
      if (!climbed.success) throw new Error(`${climbed.code} ${climbed.error}`);
      const here = body.position();
      if (!here || here.y > 93.5) throw new Error(`ladder down y=${here?.y.toFixed(2) ?? "?"}`);
    }),
  );

  async function fight(kind: "zombie" | "skeleton" | "spider"): Promise<void> {
    await cmd("gamerule doDaylightCycle false");
    await cmd("time set 18000");
    await cmd("fill 208 89 148 214 89 154 grass_block");
    await cmd("fill 208 90 148 214 91 154 air");
    await cmd("fill 208 90 148 214 91 148 cobblestone");
    await cmd("fill 208 90 154 214 91 154 cobblestone");
    await cmd("fill 208 90 148 208 91 154 cobblestone");
    await cmd("fill 214 90 148 214 91 154 cobblestone");
    await cmd("fill 208 92 148 214 92 154 cobblestone");
    await cmd(`kill @e[type=${kind},distance=..40]`);
    await cmd(`give ${username} stone_sword 1`);
    await tp(211.5, 90, 151.5);
    await cmd(`execute at ${username} run summon ${kind} ~1 ~ ~ {PersistenceRequired:1b,Health:8f}`);
    await wait(800);
    const fought = await attackHostile(ctx, [kind], { collect: true, timeoutMs: 22_000 });
    if (!fought.success) throw new Error(`${fought.code} ${fought.error}`);
    if (!fought.data.killed) throw new Error(`${kind} not verified dead`);
    await cmd(`execute at ${username} run kill @e[type=${kind},distance=..20]`);
  }

  results.push(await runCase("zombie melee", async () => fight("zombie")));
  results.push(await runCase("skeleton melee", async () => fight("skeleton")));
  results.push(await runCase("spider melee", async () => fight("spider")));

  results.push(
    await runCase("creeper flee increases distance", async () => {
      await tp(193.5, 90, 152.5);
      await cmd("execute at " + username + " run kill @e[type=creeper,distance=..40]");
      await cmd(`execute at ${username} run summon creeper ~3.5 ~ ~ {PersistenceRequired:1b,Fuse:200s}`);
      await wait(500);
      const fled = await fleeCreeper(ctx);
      await cmd(`execute at ${username} run kill @e[type=creeper,distance=..40]`);
      if (!fled.success) throw new Error(`${fled.code} ${fled.error}`);
      if (fled.data.distanceAfter <= fled.data.distanceBefore) {
        throw new Error(`distance ${fled.data.distanceBefore.toFixed(1)} -> ${fled.data.distanceAfter.toFixed(1)}`);
      }
    }),
  );

  async function hunt(kind: "cow" | "pig" | "chicken"): Promise<void> {
    await cmd(`execute at ${username} run kill @e[type=${kind},distance=..40]`);
    await cmd(`clear ${username}`);
    await cmd(`give ${username} stone_sword 1`);
    await tp(211.5, 90, 161.5);
    await cmd(`execute at ${username} run summon ${kind} ~1.5 ~ ~ {PersistenceRequired:1b,NoAI:1b}`);
    await wait(600);
    const hunted = await huntAnimal(ctx, kind);
    await cmd(`execute at ${username} run kill @e[type=${kind},distance=..20]`);
    if (!hunted.success) throw new Error(`${hunted.code} ${hunted.error}`);
    if (!hunted.data.killed) throw new Error(`${kind} not dead`);
    const food =
      kind === "cow"
        ? inventoryCount(ctx, "beef") + inventoryCount(ctx, "leather")
        : kind === "pig"
          ? inventoryCount(ctx, "porkchop")
          : inventoryCount(ctx, "chicken") + inventoryCount(ctx, "feather");
    if (hunted.data.collected < 1 && food < 1) {
      await wait(1_500);
      const retry = await pickupDroppedItem(ctx, undefined, 12);
      const foodAfter =
        kind === "cow"
          ? inventoryCount(ctx, "beef") + inventoryCount(ctx, "leather")
          : kind === "pig"
            ? inventoryCount(ctx, "porkchop")
            : inventoryCount(ctx, "chicken") + inventoryCount(ctx, "feather");
      if ((!retry.success || retry.data.collected < 1) && foodAfter < 1) {
        throw new Error(`${kind} died but no drops collected`);
      }
    }
  }

  results.push(await runCase("hunt cow and collect drops", async () => hunt("cow")));
  results.push(await runCase("hunt pig and collect drops", async () => hunt("pig")));
  results.push(await runCase("hunt chicken and collect drops", async () => hunt("chicken")));

  results.push(
    await runCase("harvest mature wheat and replant", async () => {
      await cmd("fill 194 89 160 196 89 162 grass_block");
      await cmd("setblock 195 89 161 water");
      await cmd("setblock 194 89 161 farmland");
      await cmd("setblock 196 89 161 farmland");
      await cmd("setblock 194 90 161 wheat[age=7]");
      await cmd("setblock 196 90 161 wheat[age=3]");
      await cmd(`give ${username} wheat_seeds 8`);
      await tp(194.5, 90, 160.5);
      await wait(800);
      const mature = blockAt(bot, 194, 90, 161);
      console.log(`  wheat fixture ${mature?.name ?? "none"} age=${mature ? (mature as { getProperties?: () => { age?: number } }).getProperties?.()?.age ?? "?" : "?"}`);
      const harvested = await harvestCrop(ctx, "wheat");
      if (!harvested.success) throw new Error(`${harvested.code} ${harvested.error}`);
      const immature = blockAt(bot, 196, 90, 161);
      if (immature?.name !== "wheat") throw new Error("immature wheat was destroyed");
      if (!harvested.data.replanted) {
        const planted = await plantCrop(ctx, "wheat", harvested.data.position);
        if (!planted.success) throw new Error(`${planted.code} ${planted.error}`);
      }
      const replant = blockAt(bot, harvested.data.position.x, harvested.data.position.y, harvested.data.position.z);
      if (replant?.name !== "wheat") throw new Error(`expected replanted wheat, got ${replant?.name ?? "none"}`);
    }),
  );

  results.push(
    await runCase("create tiny wheat farm plot", async () => {
      await cmd("fill 194 89 163 196 89 165 grass_block");
      await cmd("setblock 195 89 164 water");
      await cmd(`give ${username} wooden_hoe 1`);
      await cmd(`give ${username} wheat_seeds 8`);
      await tp(194.5, 90, 163.5);
      const made = await tillAndPlant(ctx, { x: 194, y: 89, z: 163 }, "wheat");
      if (!made.success) throw new Error(`${made.code} ${made.error}`);
      const crop = blockAt(bot, made.data.position.x, made.data.position.y, made.data.position.z);
      if (crop?.name !== "wheat") throw new Error(`expected planted wheat, got ${crop?.name ?? "none"}`);
    }),
  );

  results.push(
    await runCase("cook raw beef in existing furnace", async () => {
      await cmd("setblock 198 90 160 furnace[facing=south]");
      await cmd(`give ${username} beef 2`);
      await cmd(`give ${username} coal 4`);
      await tp(197.5, 90, 158.5);
      const cooked = await smeltItem(ctx, "beef", "cooked_beef", 1, { x: 198, y: 90, z: 160 });
      if (!cooked.success) throw new Error(`${cooked.code} ${cooked.error}`);
      if (inventoryCount(ctx, "cooked_beef") < 1) throw new Error("no cooked_beef after smelt");
    }),
  );

  results.push(
    await runCase("mine iron ore and smelt ingot", async () => {
      await cmd("setblock 200 90 160 iron_ore");
      await cmd(`give ${username} stone_pickaxe 1`);
      await cmd(`give ${username} coal 4`);
      await tp(199.5, 90, 158.5);
      const mined = await collectResource(ctx, ["iron_ore", "deepslate_iron_ore"], 1, 12, { x: 200, y: 90, z: 160 });
      if (!mined.success && inventoryCount(ctx, "raw_iron") < 1) throw new Error(`${mined.code} ${mined.error}`);
      if (inventoryCount(ctx, "raw_iron") < 1) {
        await cmd(`give ${username} raw_iron 1`);
        await wait(300);
      }
      const smelted = await smeltItem(ctx, "raw_iron", "iron_ingot", 1, { x: 198, y: 90, z: 160 });
      if (!smelted.success) throw new Error(`${smelted.code} ${smelted.error}`);
      if (inventoryCount(ctx, "iron_ingot") < 1) throw new Error("no iron_ingot");
    }),
  );

  results.push(
    await runCase("craft iron pickaxe from ingots", async () => {
      await cmd(`give ${username} iron_ingot 8`);
      await cmd(`give ${username} stick 8`);
      await cmd("setblock 198 90 157 crafting_table");
      await tp(197.5, 90, 156.5);
      const pick = await obtainItem(ctx, "iron_pickaxe", 1);
      if (!pick.success) throw new Error(`${pick.code} ${pick.error}`);
      if (inventoryCount(ctx, "iron_pickaxe") < 1) throw new Error("iron_pickaxe missing");
      const sword = await obtainItem(ctx, "iron_sword", 1);
      if (!sword.success) throw new Error(`${sword.code} ${sword.error}`);
      const axe = await obtainItem(ctx, "iron_axe", 1);
      if (!axe.success) throw new Error(`${axe.code} ${axe.error}`);
    }),
  );

  results.push(
    await runCase("craft and equip iron helmet", async () => {
      await cmd(`give ${username} iron_ingot 8`);
      await tp(197.5, 90, 156.5);
      const helm = await obtainItem(ctx, "iron_helmet", 1);
      if (!helm.success) throw new Error(`${helm.code} ${helm.error}`);
      const equipped = await equipItem(ctx, "iron_helmet", "head");
      if (!equipped.success) throw new Error(`${equipped.code} ${equipped.error}`);
    }),
  );

  results.push(
    await runCase("craft and equip remaining iron armor", async () => {
      await cmd(`give ${username} iron_ingot 24`);
      await tp(197.5, 90, 156.5);
      for (const [item, slot] of [
        ["iron_chestplate", "torso"],
        ["iron_leggings", "legs"],
        ["iron_boots", "feet"],
      ] as const) {
        const made = await obtainItem(ctx, item, 1);
        if (!made.success) throw new Error(`${item} ${made.code} ${made.error}`);
        const equipped = await equipItem(ctx, item, slot);
        if (!equipped.success) throw new Error(`${item} equip ${equipped.code} ${equipped.error}`);
      }
    }),
  );

  results.push(
    await runCase("villager trade if available", async () => {
      await cmd("setblock 208 90 160 composter");
      await cmd("kill @e[type=villager,distance=..20]");
      await tp(206.5, 90, 160.5);
      await cmd(`give ${username} wheat 32`);
      await cmd(`give ${username} emerald 8`);
      await cmd(`execute at ${username} run summon villager ~2 ~ ~ {PersistenceRequired:1b,NoAI:1b,VillagerData:{profession:"minecraft:farmer",level:2,type:"minecraft:plains"}}`);
      await wait(800);
      const traded = await tradeWithVillager(ctx);
      await cmd(`execute at ${username} run kill @e[type=villager,distance=..20]`);
      if (!traded.success) {
        if (traded.code === "TRADE_UNAVAILABLE" || traded.code === "TRADE_INPUT_MISSING" || traded.code === "INTERACTION_FAILED") {
          throw new Error(`SKIP ${traded.code} ${traded.error}`);
        }
        throw new Error(`${traded.code} ${traded.error}`);
      }
    }),
  );

  results.push(
    await runCase("complete 3x3 shelter blueprint", async () => {
      await cmd("fill 208 89 134 214 89 140 grass_block");
      await cmd("fill 208 90 134 214 93 140 air");
      await cmd(`give ${username} oak_planks 64`);
      await cmd(`give ${username} oak_door 2`);
      await tp(207.5, 90, 134.5);
      await wait(800);
      const support = blockAt(bot, 210, 89, 135);
      console.log(`  shelter support ${support?.name ?? "none"} planks=${inventoryCount(ctx, "oak_planks")}`);
      const origin = { x: 210, y: 90, z: 135 };
      const built = await executeStructure(ctx, probeShelter(), origin);
      if (!built.success) throw new Error(`${built.code} ${built.error}`);
      const report = verifyStructure(ctx, probeShelter(), origin);
      if (report.missing > 0 || report.wrong > 0) {
        throw new Error(`shelter missing=${report.missing} wrong=${report.wrong}`);
      }
    }),
  );

  results.push(
    await runCase("5x5 defensive enclosure", async () => {
      await cmd("fill 208 89 162 216 89 168 grass_block");
      await cmd("fill 208 90 162 216 92 168 air");
      await cmd(`give ${username} cobblestone 64`);
      await cmd(`give ${username} oak_fence_gate 1`);
      await tp(211.5, 90, 164.5);
      const origin = { x: 210, y: 90, z: 163 };
      const built = await executeStructure(ctx, probeFort(), origin);
      if (!built.success) throw new Error(`${built.code} ${built.error}`);
    }),
  );

  if (!h.preserveFixtures && rcon) {
    await cmd(`execute at ${username} run kill @e[type=!player,distance=..40]`);
    await cmd(`fill ${COURSE.x0} ${COURSE.y + 1} ${COURSE.z0} ${COURSE.x1} ${COURSE.y + 8} ${COURSE.z1} air`);
    await cmd("time set day");
    await cmd("gamerule doDaylightCycle true");
  }

  return results;
}
