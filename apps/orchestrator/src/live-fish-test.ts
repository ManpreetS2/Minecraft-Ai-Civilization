import { loadEnv } from "./env.js";
import { loadConfig, isMechanicsProbeUsername } from "@civ/shared";
import { MinecraftBody, evaluateReturnHome, navigationBackend } from "@civ/minecraft-adapter";
import {
  countItem,
  fishAtShore,
  snapshotCatchCounts,
  type SkillContext,
} from "@civ/skills";
import { tryRcon, type RconClient } from "./rcon.js";
import { evaluateFishTestLaunch, parseApprovedFishArea } from "./fish-test-guard.js";
import type { Cell } from "./mine-test-guard.js";

type Stage = { name: string; passed: boolean; detail: string; durationMs: number };
type Verdict = "PASS" | "FAIL" | "NOT FOUND" | "SKIP" | "UNVERIFIED";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printNeeds(): void {
  console.log("");
  console.log("FishProbe harness: isolated Paper 1.21.11 127.0.0.1:25567 RCON 25577.");
  console.log("Flags: MECHANICS_FISH_TEST_ENABLED=true FISH_TEST_ALLOW_WORLD_MUTATION=true");
  console.log("FISH_TEST_RED_APPROVED=true FISH_TEST_BLUE_IDLE=true FISH_TEST_USER_APPROVED=true");
  console.log("Required: FISH_TEST_ORIGIN=x,y,z FISH_TEST_CHEST=x,y,z FISH_TEST_RADIUS=1-16");
  console.log("Optional return-home: FISH_TEST_RETURN_HOME=true FISH_TEST_HOME=x,y,z");
  console.log("Never 25565/25566. Never Site C / farm / H1 shore / coal pocket. Never /give fish. Never pnpm sim:start.");
  console.log("Fishing PASS and return-home PASS are separate. Do not launch until RED/BLUE/user approve.");
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

function fmtPos(pos: { x: number; y: number; z: number } | undefined): string {
  if (!pos) return "unknown";
  return `${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`;
}

function inventorySnapshot(ctx: SkillContext): Record<string, number> {
  const items = ctx.bot.inventory.items().map((item) => ({ name: item.name, count: item.count }));
  const catchCounts = snapshotCatchCounts(items);
  const rod = items.filter((item) => item.name === "fishing_rod").reduce((sum, item) => sum + item.count, 0);
  return rod > 0 ? { ...catchCounts, fishing_rod: rod } : { ...catchCounts };
}

async function main(): Promise<void> {
  loadEnv();
  const target = evaluateFishTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    printNeeds();
    process.exit(2);
    return;
  }
  const area = parseApprovedFishArea(process.env);
  if ("error" in area) {
    console.error(area.error);
    printNeeds();
    process.exit(2);
    return;
  }

  const username = process.env.FISH_TEST_USERNAME ?? "FishProbe";
  if (!isMechanicsProbeUsername(username) || username === "HomeProbe" || username === "FarmProbe" || username === "MineProbe" || username === "MechProbe") {
    throw new Error(`${username} is not FishProbe. Use FISH_TEST_USERNAME=FishProbe`);
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

  console.log("TEST-ONLY FISHPROBE HARNESS");
  console.log("Not a citizen. Does not /give fish. SEARCH_EXHAUSTED is NOT FOUND, not fishing PASS.");
  console.log("Return-home is a separate verdict from physical fishing.");
  console.log(`target ${target.host}:${target.port} version=${target.version} rcon=${target.rconPort}`);
  console.log(`origin ${area.origin.x},${area.origin.y},${area.origin.z} radius=${area.radius} casts=${area.casts} timeoutMs=${area.timeoutMs}`);
  console.log(`chest ${area.chest.x},${area.chest.y},${area.chest.z}`);
  if (area.home) console.log(`returnHome ${area.home.x},${area.home.y},${area.home.z} enabled=${area.returnHome}`);

  const body = new MinecraftBody({
    username,
    config,
    reconnect: false,
    allowRespawn: true,
  });

  const stages: Stage[] = [];
  let rcon: RconClient | undefined;
  const suiteStarted = Date.now();
  let fishingVerdict: Verdict = "UNVERIFIED";
  let returnHomeVerdict: Verdict = area.returnHome ? "UNVERIFIED" : "SKIP";

  const finish = async (code: number): Promise<void> => {
    try {
      if (rcon) await rcon.command(`deop ${username}`).catch(() => undefined);
    } catch {
      // ignore
    }
    rcon?.close();
    await body.disconnect("fish-test").catch(() => undefined);
    console.log("");
    console.log("FishProbe results (physical fishing PASS is independent of return-home PASS)");
    for (const stage of stages) {
      console.log(`- ${mark(stage)} ${stage.name} (${stage.durationMs}ms) ${stage.detail}`);
    }
    console.log(`FISHING_LIVE=${fishingVerdict}`);
    console.log(`RETURN_HOME_LIVE=${returnHomeVerdict}`);
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
    const ctx: SkillContext = { body, bot, timeoutMs: Math.min(30_000, area.timeoutMs) };

    const password = process.env.FISH_TEST_RCON_PASSWORD ?? "civ-world-lab-rcon";
    rcon = await tryRcon(target.host, target.rconPort, password);
    if (!rcon) {
      stages.push({ name: "rcon", passed: false, detail: "UNVERIFIED RCON unavailable", durationMs: 0 });
      fishingVerdict = "UNVERIFIED";
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
      fishingVerdict = "UNVERIFIED";
      await finish(2);
      return;
    }

    const listed = await cmd("list", "list");
    if (/HomeProbe|FarmProbe|MineProbe|MechProbe|FishProbeB/i.test(listed) && !listed.includes(username)) {
      throw new Error(`another probe is online: ${listed.slice(0, 160)}`);
    }

    await cmd(`op ${username}`, "op");
    await cmd(`tp ${username} ${area.origin.x + 0.5} ${area.origin.y} ${area.origin.z + 0.5}`, "tp-origin");
    await wait(800);
    await cmd(`clear ${username}`, "clear");
    await cmd(`give ${username} minecraft:fishing_rod 1`, "give-rod");
    await wait(400);

    const chestName = await identifyBlock(rcon, area.chest, ["chest", "barrel", "trapped_chest"]);
    if (chestName === "other") {
      if (process.env.FISH_TEST_PLACE_CHEST === "true") {
        await cmd(`setblock ${area.chest.x} ${area.chest.y} ${area.chest.z} minecraft:chest replace`, "place-chest");
      } else {
        stages.push({
          name: "permitted chest",
          passed: false,
          detail: "CONTAINER_NOT_FOUND designated chest missing; will not invent a chest cell",
          durationMs: 0,
        });
        fishingVerdict = "FAIL";
        await finish(2);
        return;
      }
    }

    stages.push(
      await runStage("rod prerequisite", async () => {
        const rods = countItem(ctx, "fishing_rod");
        if (rods < 1) throw new Error("MISSING_TOOL fishing_rod not in inventory after TEST_CONTROL give");
        return `fishing_rod=${rods}`;
      }),
    );

    if (area.verifyCancel) {
      stages.push(
        await runStage("cancel before cast", async () => {
          const abort = new AbortController();
          abort.abort();
          const cancelled = await fishAtShore(
            { ...ctx, signal: abort.signal },
            {
              searchOrigin: area.origin,
              searchRadius: area.radius,
              casts: 1,
              timeoutMs: 5_000,
              destinationStorage: area.chest,
              permittedStorage: area.chest,
              returnHome: area.home,
            },
          );
          if (cancelled.success || cancelled.code !== "CANCELLED") {
            throw new Error(`expected CANCELLED, got success=${cancelled.success} code=${cancelled.success ? "ok" : cancelled.code}`);
          }
          return cancelled.error;
        }),
      );
      if (!stages.at(-1)?.passed) {
        fishingVerdict = "FAIL";
        await finish(1);
        return;
      }
    }

    const chestBefore = await cmd(`data get block ${area.chest.x} ${area.chest.y} ${area.chest.z} Items`, "chest-before");
    const invBefore = inventorySnapshot(ctx);
    const tickBefore = bot.time?.timeOfDay ?? -1;
    const posBefore = body.position() ?? bot.entity?.position;
    console.log(
      `FISH_RECORD before inv=${JSON.stringify(invBefore)} chest=${chestBefore.trim().slice(0, 240)} tick=${tickBefore} pos=${fmtPos(posBefore)}`,
    );

    const fished = await runStage("fish from shore", async () => {
      const result = await fishAtShore(ctx, {
        searchOrigin: area.origin,
        searchRadius: area.radius,
        casts: area.casts,
        timeoutMs: area.timeoutMs,
        destinationStorage: area.chest,
        permittedStorage: area.chest,
        returnHome: area.home,
      });
      if (!result.success) {
        if (result.code === "SEARCH_EXHAUSTED") throw new Error(`NOT FOUND ${result.code} ${result.error}`);
        if (result.code === "CANCELLED") throw new Error(`CANCELLED ${result.error}`);
        if (result.code === "TIMEOUT" && /return home/i.test(result.error)) {
          throw new Error(`RETURN_HOME_REQUEST ${result.code} ${result.error}`);
        }
        throw new Error(`${result.code} ${result.error}`);
      }
      const caught = result.data.caught;
      const types = Object.keys(caught);
      if (types.length === 0) throw new Error("NOT FOUND catch map empty");
      return `catch=${JSON.stringify(caught)} deposited=${result.data.deposited} shore=${result.data.shore.x},${result.data.shore.y},${result.data.shore.z} water=${result.data.water.x},${result.data.water.y},${result.data.water.z} casts=${result.data.casts}`;
    });
    stages.push(fished);
    if (!fished.passed) {
      fishingVerdict = fished.detail.startsWith("NOT FOUND") ? "NOT FOUND" : "FAIL";
    } else {
      const chestAfter = await cmd(`data get block ${area.chest.x} ${area.chest.y} ${area.chest.z} Items`, "chest-after");
      const invAfter = inventorySnapshot(ctx);
      const tickAfterFish = bot.time?.timeOfDay ?? -1;
      const posAfterFish = body.position() ?? bot.entity?.position;
      console.log(
        `FISH_RECORD after inv=${JSON.stringify(invAfter)} chest=${chestAfter.trim().slice(0, 240)} tick=${tickAfterFish} pos=${fmtPos(posAfterFish)}`,
      );
      stages.push(
        await runStage("inventory or chest delta", async () => {
          const beforeCatch = snapshotCatchCounts(Object.entries(invBefore).map(([name, count]) => ({ name, count })));
          const afterCatch = snapshotCatchCounts(Object.entries(invAfter).map(([name, count]) => ({ name, count })));
          const invGained = Object.keys(afterCatch).some((name) => (afterCatch[name] ?? 0) > (beforeCatch[name] ?? 0));
          const chestChanged = chestAfter.trim() !== chestBefore.trim();
          if (!invGained && !chestChanged && fished.detail.includes("deposited=0")) {
            throw new Error("no catch inventory/storage delta");
          }
          return `inv ${JSON.stringify(invBefore)} -> ${JSON.stringify(invAfter)}; chestChanged=${chestChanged}`;
        }),
      );
      fishingVerdict = stages.at(-1)?.passed ? "PASS" : "FAIL";
    }

    if (area.returnHome && area.home) {
      const departTick = bot.time?.timeOfDay ?? -1;
      const departPos = body.position() ?? bot.entity?.position;
      console.log(`FISH_RECORD return-home departTick=${departTick} departPos=${fmtPos(departPos)}`);
      const walked = await runStage("return home walk", async () => {
        if (!departPos) throw new Error("NOT_CONNECTED no position at departure");
        const plan = evaluateReturnHome({
          position: { x: departPos.x, y: departPos.y, z: departPos.z },
          home: area.home!,
          timeOfDay: departTick,
        });
        const moved = await navigationBackend().navigateNear(bot, area.home!, 3, {
          timeoutMs: Math.min(45_000, area.timeoutMs),
        });
        const arrivePos = body.position() ?? bot.entity?.position;
        const arriveTick = bot.time?.timeOfDay ?? -1;
        console.log(
          `FISH_RECORD return-home arriveTick=${arriveTick} arrivePos=${fmtPos(arrivePos)} estimateMs=${plan.estimateMs} remainingMs=${plan.remainingMs} reason=${plan.reason}`,
        );
        if (!moved.success) throw new Error(`${moved.code} ${moved.error}`);
        if (!arrivePos) throw new Error("lost body during return-home");
        const dist = Math.hypot(arrivePos.x - area.home!.x, arrivePos.y - area.home!.y, arrivePos.z - area.home!.z);
        if (dist > 6) throw new Error(`arrived ${fmtPos(arrivePos)} still ${dist.toFixed(1)} from home; did not teleport`);
        return `departTick=${departTick} arriveTick=${arriveTick} depart=${fmtPos(departPos)} arrive=${fmtPos(arrivePos)} dist=${dist.toFixed(1)}`;
      });
      stages.push(walked);
      returnHomeVerdict = walked.passed ? "PASS" : "FAIL";
    }

    const fishingFailed = fishingVerdict === "FAIL";
    const fishingMissing = fishingVerdict === "NOT FOUND";
    const homeFailed = returnHomeVerdict === "FAIL";
    await finish(fishingFailed || homeFailed ? 1 : fishingMissing ? 3 : fishingVerdict === "UNVERIFIED" ? 2 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printNeeds();
    fishingVerdict = fishingVerdict === "UNVERIFIED" ? "FAIL" : fishingVerdict;
    await finish(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  printNeeds();
  process.exit(1);
});
