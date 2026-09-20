import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import { MinecraftBody } from "@civ/minecraft-adapter";
import { minecraftKnowledge, oreDropsFor } from "@civ/minecraft-knowledge";
import { countItem, mineKnownOre, type SkillContext } from "@civ/skills";
import { tryRcon, type RconClient } from "./rcon.js";
import { evaluateMineTestLaunch, parseApprovedMineArea, type Cell } from "./mine-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printNeeds(): void {
  console.log("");
  console.log("Mine harness: isolated Paper 1.21.11 127.0.0.1:25567 RCON 25577.");
  console.log("Flags: MECHANICS_MINE_TEST_ENABLED=true MINE_TEST_ALLOW_WORLD_MUTATION=true");
  console.log("MINE_TEST_RED_APPROVED=true MINE_TEST_BLUE_IDLE=true MINE_TEST_USER_APPROVED=true");
  console.log("Required: MINE_TEST_ORIGIN=x,y,z MINE_TEST_CHEST=x,y,z MINE_TEST_RADIUS=1-32 MINE_TEST_RESOURCE=coal|iron");
  console.log("Never 25565/25566. Never Site C / farm pad / H1. Never /setblock ore. Never pnpm sim:start.");
}

function mark(stage: Stage): string {
  if (stage.detail.startsWith("NOT FOUND") || stage.detail.startsWith("SEARCH_EXHAUSTED")) return "NOT FOUND";
  if (stage.detail.startsWith("UNVERIFIED")) return "UNVERIFIED";
  if (stage.detail.startsWith("SKIP")) return "SKIP";
  if (stage.passed) return "PASS";
  return "FAIL";
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

function rconPassed(text: string): boolean {
  return text.toLowerCase().includes("passed") || text.toLowerCase().includes("test passed");
}

async function identifyBlock(rcon: RconClient, pos: Cell, names: string[]): Promise<string> {
  for (const name of names) {
    const out = await rcon.command(`execute if block ${pos.x} ${pos.y} ${pos.z} minecraft:${name}`);
    if (rconPassed(out)) return name;
  }
  return "other";
}

async function main(): Promise<void> {
  loadEnv();
  const target = evaluateMineTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    printNeeds();
    process.exit(2);
    return;
  }
  const area = parseApprovedMineArea(process.env);
  if ("error" in area) {
    console.error(area.error);
    printNeeds();
    process.exit(2);
    return;
  }

  const username = process.env.MINE_TEST_USERNAME ?? "MineProbe";
  if (!isMechanicsProbeUsername(username) || username === "HomeProbe" || username === "FarmProbe" || username === "MechProbe") {
    throw new Error(`${username} is not MineProbe. Use MINE_TEST_USERNAME=MineProbe`);
  }

  const knowledge = minecraftKnowledge();
  const base = loadConfig();
  const config = {
    ...base,
    MINECRAFT_HOST: target.host,
    MINECRAFT_PORT: target.port,
    MINECRAFT_VERSION: target.version,
    MINECRAFT_USERNAME: username,
    AUTO_START_PAPER: false as const,
  };

  console.log("TEST-ONLY MINEPROBE HARNESS");
  console.log("Not a citizen. Does not manufacture ore. SEARCH_EXHAUSTED is NOT FOUND, not PASS.");
  console.log(`target ${target.host}:${target.port} version=${target.version} rcon=${target.rconPort}`);
  console.log(`knowledge=${knowledge.version} resource=${area.resource} origin=${area.origin.x},${area.origin.y},${area.origin.z} radius=${area.radius}`);
  console.log(`chest ${area.chest.x},${area.chest.y},${area.chest.z}`);

  const body = new MinecraftBody({
    username,
    config,
    reconnect: false,
    allowRespawn: true,
  });

  const stages: Stage[] = [];
  let rcon: RconClient | undefined;
  const suiteStarted = Date.now();
  const discovered: Cell[] = [];

  const finish = async (code: number): Promise<void> => {
    rcon?.close();
    await body.disconnect("mine-test").catch(() => undefined);
    console.log("");
    console.log("MineProbe results (live PASS only if a natural visible ore was mined, picked up, and stored)");
    for (const stage of stages) {
      console.log(`- ${mark(stage)} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
    if (discovered.length) {
      console.log(`discoveredAfterMine ${discovered.map((pos) => `${pos.x},${pos.y},${pos.z}`).join(" ")}`);
    } else {
      console.log("discoveredAfterMine none (coordinates are recorded only after legitimate discovery)");
    }
    console.log(`elapsedMs=${Date.now() - suiteStarted}`);
    process.exit(code);
  };

  try {
    const connected = await body.connect();
    if (!connected.success) {
      console.error(`Connect failed: ${connected.code} ${connected.error}`);
      printNeeds();
      process.exit(2);
      return;
    }
    await wait(1500);
    const bot = body.requireBot();
    const ctx: SkillContext = { body, bot, timeoutMs: 30_000 };

    const password = process.env.MINE_TEST_RCON_PASSWORD ?? "civ-world-lab-rcon";
    rcon = await tryRcon(target.host, target.rconPort, password);
    if (!rcon) {
      stages.push({ name: "rcon", passed: false, detail: "UNVERIFIED RCON unavailable", durationMs: 0 });
      await finish(2);
      return;
    }

    const cmd = async (command: string, label: string): Promise<string> => {
      const out = await rcon!.command(command);
      console.log(`TEST_CONTROL ${label} rcon ${command} => ${out.trim().slice(0, 160) || "(empty)"}`);
      return out;
    };

    stages.push(
      await runStage("server version 1.21.11", async () => {
        const ver = await cmd("version", "version");
        if (!/1\.21\.11/i.test(ver) && !/1\.21\.11/i.test(target.version)) {
          throw new Error(`expected Paper 1.21.11, rcon said ${ver.slice(0, 120)}`);
        }
        return ver.trim().slice(0, 120) || target.version;
      }),
    );
    if (!stages.at(-1)?.passed) {
      await finish(2);
      return;
    }

    await cmd(`op ${username}`, "op");
    await cmd(`tp ${username} ${area.origin.x + 0.5} ${area.origin.y} ${area.origin.z + 0.5}`, "tp-origin");
    await wait(800);

    const pick = area.resource === "iron" ? "stone_pickaxe" : "wooden_pickaxe";
    await cmd(`clear ${username}`, "clear");
    await cmd(`give ${username} minecraft:${pick} 1`, "give-pickaxe");
    await wait(400);

    const chestName = await identifyBlock(rcon, area.chest, ["chest", "barrel", "trapped_chest"]);
    if (chestName === "other") {
      if (process.env.MINE_TEST_PLACE_CHEST === "true") {
        await cmd(`setblock ${area.chest.x} ${area.chest.y} ${area.chest.z} minecraft:chest replace`, "place-chest");
      } else {
        stages.push({
          name: "permitted chest",
          passed: false,
          detail: "CONTAINER_NOT_FOUND designated chest missing; will not invent a chest cell",
          durationMs: 0,
        });
        await finish(2);
        return;
      }
    }

    const drop = oreDropsFor(area.resource)[0] ?? (area.resource === "iron" ? "raw_iron" : "coal");
    const beforeInv = countItem(ctx, drop);

    const mined = await runStage("mine visible natural ore", async () => {
      const result = await mineKnownOre(ctx, {
        resource: area.resource,
        searchOrigin: area.origin,
        searchRadius: area.radius,
        minY: area.minY,
        maxY: area.maxY,
        amount: 1,
        maxActions: 24,
        timeoutMs: 60_000,
        destinationStorage: area.chest,
        permittedStorage: area.chest,
      });
      if (!result.success) {
        if (result.code === "SEARCH_EXHAUSTED" || result.details?.notFound) {
          throw new Error(`NOT FOUND ${result.code} ${result.error}`);
        }
        throw new Error(`${result.code} ${result.error}`);
      }
      if (!result.data.mined.length) throw new Error("NOT FOUND mined list empty");
      const first = result.data.mined[0]!;
      discovered.push(first.position);
      return `mined ${first.name} at ${first.position.x},${first.position.y},${first.position.z} collected=${JSON.stringify(result.data.collected)} deposited=${result.data.deposited}`;
    });
    stages.push(mined);
    if (!mined.passed) {
      await finish(mined.detail.startsWith("NOT FOUND") ? 3 : 1);
      return;
    }

    const first = discovered[0];
    if (first && rcon) {
      stages.push(
        await runStage("ground-truth after discovery only", async () => {
          const now = await identifyBlock(rcon!, first, ["air", "cave_air", "coal_ore", "iron_ore", "deepslate_coal_ore", "deepslate_iron_ore"]);
          if (now !== "air" && now !== "cave_air") throw new Error(`expected air after mine, RCON sees ${now}`);
          return `post-mine ${first.x},${first.y},${first.z} is ${now}`;
        }),
      );
    }

    stages.push(
      await runStage("inventory or chest delta", async () => {
        const afterInv = countItem(ctx, drop);
        if (afterInv <= beforeInv && mined.detail.includes("deposited=0")) {
          throw new Error(`no ${drop} inventory/storage delta`);
        }
        return `${drop} inventory ${beforeInv}->${afterInv}`;
      }),
    );

    const failed = stages.some((stage) => !stage.passed && !stage.detail.startsWith("NOT FOUND") && !stage.detail.startsWith("UNVERIFIED"));
    const notFound = stages.some((stage) => stage.detail.startsWith("NOT FOUND"));
    await finish(failed ? 1 : notFound ? 3 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printNeeds();
    await finish(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  printNeeds();
  process.exit(1);
});
