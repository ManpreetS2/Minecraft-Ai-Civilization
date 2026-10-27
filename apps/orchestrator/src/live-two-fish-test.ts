import { loadEnv } from "./env.js";
import { loadConfig } from "@civ/shared";
import { MinecraftBody } from "@civ/minecraft-adapter";
import { fishQuotaAtShore, type FishQuotaResult, type SkillContext } from "@civ/skills";
import { tryRcon, type RconClient } from "./rcon.js";
import {
  evaluateTwoFishRodLogs,
  evaluateTwoFishTestLaunch,
  humanBlocksStand,
  occupantConflictsFishingSite,
  parseApprovedTwoFishArea,
  type TwoFishArea,
} from "./two-fish-test-guard.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printNeeds(): void {
  console.log("");
  console.log("Two-citizen same-pond fishing harness is prepared only.");
  console.log("Needs: RED-verified adjacent stands on ONE pond; two distinct chests; user approval to place any NEW chest.");
  console.log("Do not reuse mining chest -954,58,944. Do not merge chests next to -1042,63,980.");
  console.log("Do not assign home claims. Do not pnpm sim:start. Do not set time/weather.");
  console.log("HomeProbe may stay connected if outside the fishing AABB. TWO_FISH_BLUE_SHARED=true required.");
  console.log("TWO_FISH_TARGET=2 for the bounded live check; 5 only for the full quota.");
  console.log("Flags: MECHANICS_TWO_FISH_TEST_ENABLED TWO_FISH_ALLOW_WORLD_MUTATION TWO_FISH_RED_APPROVED");
  console.log("TWO_FISH_BLUE_SHARED TWO_FISH_USER_APPROVED TWO_FISH_KAI_ORIGIN/CHEST TWO_FISH_ATLAS_ORIGIN/CHEST");
}

function parsePos(raw: string): { x: number; y: number; z: number } | undefined {
  const match = raw.match(/\[([-\d.]+)d,\s*([-\d.]+)d,\s*([-\d.]+)d\]/);
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function quotaLine(role: "KAI" | "ATLAS", result: FishQuotaResult | undefined, target: number): void {
  const catches = result ? `${Math.min(result.caughtCount, target)}/${target}` : `0/${target}`;
  const deposit = result ? `${Math.min(result.depositedCount, target)}/${target}` : `0/${target}`;
  console.log(`${role}_CATCHES=${catches}`);
  console.log(`${role}_DEPOSIT=${deposit}`);
  console.log(`${role}_NEW_CATCHES=${catches}`);
  console.log(`${role}_NEW_DEPOSIT=${deposit}`);
  if (result) {
    console.log(`${role}_SPECIES caught=${JSON.stringify(result.caught)} deposited=${JSON.stringify(result.deposited)} attempts=${result.attempts} fishing=${result.fishing} storage=${result.storage}`);
    for (const event of result.events) {
      console.log(`${role}_EVENT ${new Date(event.t).toISOString()} ${event.kind} ${event.detail}`);
    }
  }
}

function countQuotaFishInNbt(raw: string): Record<string, number> {
  const counts: Record<string, number> = { cod: 0, salmon: 0, tropical_fish: 0, pufferfish: 0 };
  const re = /id:\s*"minecraft:(cod|salmon|tropical_fish|pufferfish)"[^}]*count:\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const name = match[1];
    const n = Number(match[2]);
    if (name && Number.isFinite(n)) counts[name] = (counts[name] ?? 0) + n;
  }
  return counts;
}

function quotaSum(counts: Record<string, number>): number {
  return (counts.cod ?? 0) + (counts.salmon ?? 0) + (counts.tropical_fish ?? 0) + (counts.pufferfish ?? 0);
}

async function prepareBody(
  rcon: RconClient,
  username: string,
  origin: { x: number; y: number; z: number },
): Promise<void> {
  const cmd = async (command: string, label: string) => {
    const out = await rcon.command(command);
    console.log(`TEST_CONTROL ${label} rcon ${command} => ${out.trim().slice(0, 160) || "(empty)"}`);
    return out;
  };
  await cmd(`op ${username}`, `op-${username}`);
  await cmd(`tp ${username} ${origin.x + 0.5} ${origin.y} ${origin.z + 0.5}`, `tp-${username}`);
  await wait(500);
  await cmd(`clear ${username}`, `clear-${username}`);
  await cmd(`give ${username} minecraft:fishing_rod 1`, `rod-${username}`);
}

async function identifyChest(rcon: RconClient, pos: { x: number; y: number; z: number }): Promise<boolean> {
  for (const name of ["chest", "barrel", "trapped_chest"]) {
    const out = await rcon.command(`execute if block ${pos.x} ${pos.y} ${pos.z} minecraft:${name}`);
    if (/passed/i.test(out)) return true;
  }
  return false;
}

async function runCitizen(
  body: MinecraftBody,
  area: TwoFishArea,
  who: "kai" | "atlas",
  signal?: AbortSignal,
): Promise<FishQuotaResult> {
  const bot = body.requireBot();
  const spec = area[who];
  const ctx: SkillContext = { body, bot, timeoutMs: Math.min(30_000, area.timeoutMs), signal };
  const result = await fishQuotaAtShore(ctx, {
    ownerId: spec.username,
    role: who === "kai" ? "Kai" : "Atlas",
    searchOrigin: spec.origin,
    searchRadius: area.radius,
    destinationStorage: spec.chest,
    permittedStorage: spec.chest,
    targetCount: area.target,
    maxAttempts: area.maxAttempts,
    timeoutMs: area.timeoutMs,
    depositCaught: false,
    depositMode: "after-each",
  });
  if (result.success) return result.data;
  const details = result.details as FishQuotaResult | undefined;
  if (details && typeof details.caughtCount === "number") return details;
  return {
    ownerId: spec.username,
    role: who === "kai" ? "Kai" : "Atlas",
    fishing: "FAIL",
    storage: "FAIL",
    caughtCount: 0,
    depositedCount: 0,
    caught: {},
    deposited: {},
    attempts: 0,
    progress: "0/5",
    events: [{ t: Date.now(), kind: "fail", detail: `${result.code} ${result.error}` }],
  };
}

async function main(): Promise<void> {
  loadEnv();
  const target = evaluateTwoFishTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    printNeeds();
    process.exit(2);
    return;
  }
  const area = parseApprovedTwoFishArea(process.env);
  if ("error" in area) {
    console.error(area.error);
    printNeeds();
    process.exit(2);
    return;
  }

  console.log("TEST-ONLY TWO-CITIZEN SAME-POND FISHING");
  console.log("Not sim:start. Not a cognition PASS. Return-home SKIP unless separately configured.");
  console.log(`kai ${area.kai.username} stand ${area.kai.origin.x},${area.kai.origin.y},${area.kai.origin.z} chest ${area.kai.chest.x},${area.kai.chest.y},${area.kai.chest.z}`);
  console.log(`atlas ${area.atlas.username} stand ${area.atlas.origin.x},${area.atlas.origin.y},${area.atlas.origin.z} chest ${area.atlas.chest.x},${area.atlas.chest.y},${area.atlas.chest.z}`);
  console.log(`timeoutMs=${area.timeoutMs} attempts=${area.maxAttempts} target=${area.target}`);

  const base = loadConfig();
  const makeBody = (username: string) =>
    new MinecraftBody({
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
      allowRespawn: true,
    });

  const kaiBody = makeBody(area.kai.username);
  const atlasBody = makeBody(area.atlas.username);
  const password = process.env.TWO_FISH_RCON_PASSWORD ?? "civ-world-lab-rcon";
  const rcon = await tryRcon(target.host, target.rconPort, password);
  if (!rcon) {
    console.error("UNVERIFIED RCON unavailable");
    printNeeds();
    process.exit(2);
    return;
  }

  const listed = await rcon.command("list");
  console.log(`TEST_CONTROL list => ${listed.trim()}`);
  const roster = listed.split(":").slice(1).join(":").split(",").map((part) => part.trim()).filter(Boolean);
  for (const name of roster) {
    if (name === area.kai.username || name === area.atlas.username) continue;
    const raw = await rcon.command(`data get entity ${name} Pos`).catch(() => "");
    const pos = parsePos(raw);
    if (!pos) continue;
    console.log(`occupant ${name} ${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`);
    if (name === "Shadowskiii1") {
      if (humanBlocksStand(pos, area)) {
        console.error("Human is standing on a fishing stand/chest cell. Move to a spectator perch first.");
        rcon.close();
        process.exit(2);
        return;
      }
      continue;
    }
    if (occupantConflictsFishingSite(pos, area)) {
      console.error(`${name} is inside the fishing work area. Not kicking them; refusing to launch.`);
      rcon.close();
      process.exit(2);
      return;
    }
    console.log(`${name} is outside the fishing AABB and will be left connected.`);
  }

  if (!(await identifyChest(rcon, area.kai.chest)) || !(await identifyChest(rcon, area.atlas.chest))) {
    console.error("CONTAINER_NOT_FOUND one of the designated chests is missing. Will not FISH_TEST_PLACE_CHEST.");
    printNeeds();
    rcon.close();
    process.exit(2);
    return;
  }

  const kaiChestBefore = await rcon.command(`data get block ${area.kai.chest.x} ${area.kai.chest.y} ${area.kai.chest.z} Items`);
  const atlasChestBefore = await rcon.command(`data get block ${area.atlas.chest.x} ${area.atlas.chest.y} ${area.atlas.chest.z} Items`);
  const mineChest = await rcon.command("data get block -954 58 944 Items");
  const probeChest = await rcon.command("data get block -1042 63 980 Items");
  console.log(`CHEST_RECORD before kai=${kaiChestBefore.trim().slice(0, 180)}`);
  console.log(`CHEST_RECORD before atlas=${atlasChestBefore.trim().slice(0, 180)}`);
  console.log(`PRESERVE mining=${mineChest.trim().slice(0, 160)}`);
  console.log(`PRESERVE fish-probe-chest=${probeChest.trim().slice(0, 160)}`);
  const kaiChestBeforeCounts = countQuotaFishInNbt(kaiChestBefore);
  const atlasChestBeforeCounts = countQuotaFishInNbt(atlasChestBefore);
  console.log(`CHEST_BEFORE_COUNTS kai=${JSON.stringify(kaiChestBeforeCounts)} atlas=${JSON.stringify(atlasChestBeforeCounts)}`);

  let kaiResult: FishQuotaResult | undefined;
  let atlasResult: FishQuotaResult | undefined;
  const kaiWindow = { startedAt: 0, endedAt: 0 };
  const atlasWindow = { startedAt: 0, endedAt: 0 };
  const rodLogs: string[] = [];
  const kaiAbort = new AbortController();
  const atlasAbort = new AbortController();
  const origLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    const line = args.map((value) => String(value)).join(" ");
    if (line.startsWith("FISH_ROD ")) {
      rodLogs.push(line);
      const live = evaluateTwoFishRodLogs(rodLogs, area.kai.username, area.atlas.username);
      if (live.interference && !kaiAbort.signal.aborted) {
        origLog(`BOBBER_OWNERSHIP=FAIL shared=${live.sharedBobberIds.join(",")}`);
        kaiAbort.abort();
        atlasAbort.abort();
      }
    }
    origLog(...args);
  };

  const finish = async (code: number): Promise<void> => {
    await rcon.command("save-all flush").catch(() => undefined);
    await rcon.command(`deop ${area.kai.username}`).catch(() => undefined);
    await rcon.command(`deop ${area.atlas.username}`).catch(() => undefined);
    rcon.close();
    await kaiBody.disconnect("two-fish-kai").catch(() => undefined);
    await atlasBody.disconnect("two-fish-atlas").catch(() => undefined);
    const overlap =
      kaiWindow.startedAt > 0 &&
      atlasWindow.startedAt > 0 &&
      kaiWindow.startedAt < atlasWindow.endedAt &&
      atlasWindow.startedAt < kaiWindow.endedAt;
    const rod = evaluateTwoFishRodLogs(rodLogs, area.kai.username, area.atlas.username);
    quotaLine("KAI", kaiResult, area.target);
    quotaLine("ATLAS", atlasResult, area.target);
    console.log(
      `KAI_WINDOW ${new Date(kaiWindow.startedAt).toISOString()} .. ${new Date(kaiWindow.endedAt).toISOString()} ms=${Math.max(0, kaiWindow.endedAt - kaiWindow.startedAt)}`,
    );
    console.log(
      `ATLAS_WINDOW ${new Date(atlasWindow.startedAt).toISOString()} .. ${new Date(atlasWindow.endedAt).toISOString()} ms=${Math.max(0, atlasWindow.endedAt - atlasWindow.startedAt)}`,
    );
    console.log(`KAI_BOBBERS ${rod.kaiBobberIds.join(",") || "none"} ownBites=${rod.kaiOwnBites}`);
    console.log(`ATLAS_BOBBERS ${rod.atlasBobberIds.join(",") || "none"} ownBites=${rod.atlasOwnBites}`);
    const kaiCaught = kaiResult?.caughtCount ?? 0;
    const atlasCaught = atlasResult?.caughtCount ?? 0;
    const kaiDeposited = kaiResult?.depositedCount ?? 0;
    const atlasDeposited = atlasResult?.depositedCount ?? 0;
    const fishing =
      rod.interference || rod.ownership === "FAIL"
        ? "FAIL"
        : kaiCaught >= area.target &&
            atlasCaught >= area.target &&
            kaiDeposited >= area.target &&
            atlasDeposited >= area.target
          ? "PASS"
          : kaiCaught > 0 || atlasCaught > 0
            ? "PARTIAL"
            : "FAIL";
    const concurrency = overlap && kaiCaught > 0 && atlasCaught > 0 ? "PASS" : "FAIL";
    console.log(`TWO_BOT_FISHING=${fishing}`);
    console.log(`TWO_BOT_CONCURRENCY=${concurrency}`);
    console.log(`BOBBER_OWNERSHIP=${rod.ownership}`);
    console.log(`BITE_RESPONSE=${rod.biteResponse}`);
    console.log("MISSING_FISH_INVESTIGATION=INCONCLUSIVE");
    console.log("RETURN_HOME=SKIP");
    process.exit(code);
  };

  try {
    const kaiJoin = await kaiBody.connect();
    const atlasJoin = await atlasBody.connect();
    if (!kaiJoin.success || !atlasJoin.success) {
      console.error(`connect failed kai=${kaiJoin.success} atlas=${atlasJoin.success}`);
      await finish(2);
      return;
    }
    console.log(`CONNECTED kai=${new Date().toISOString()} atlas=${new Date().toISOString()} list=${(await rcon.command("list")).trim()}`);
    await wait(1000);
    await prepareBody(rcon, area.kai.username, area.kai.origin);
    await prepareBody(rcon, area.atlas.username, area.atlas.origin);
    await wait(400);
    console.log(`READY ${new Date().toISOString()} list=${(await rcon.command("list")).trim()}`);

    kaiWindow.startedAt = Date.now();
    atlasWindow.startedAt = Date.now();
    const atlasDelay = wait(300).then(async () => {
      atlasWindow.startedAt = Date.now();
      const result = await runCitizen(atlasBody, area, "atlas", atlasAbort.signal);
      atlasWindow.endedAt = Date.now();
      return result;
    });
    const kaiRun = runCitizen(kaiBody, area, "kai", kaiAbort.signal).then((result) => {
      kaiWindow.endedAt = Date.now();
      return result;
    });
    const settled = await Promise.allSettled([kaiRun, atlasDelay]);
    kaiResult = settled[0]?.status === "fulfilled" ? settled[0].value : undefined;
    atlasResult = settled[1]?.status === "fulfilled" ? settled[1].value : undefined;
    if (settled[0]?.status === "rejected") console.error(settled[0].reason);
    if (settled[1]?.status === "rejected") console.error(settled[1].reason);
    if (!kaiWindow.endedAt) kaiWindow.endedAt = Date.now();
    if (!atlasWindow.endedAt) atlasWindow.endedAt = Date.now();

    const kaiPos = kaiBody.position();
    const atlasPos = atlasBody.position();
    console.log(`POS kai=${kaiPos ? `${kaiPos.x.toFixed(2)},${kaiPos.y.toFixed(2)},${kaiPos.z.toFixed(2)}` : "unknown"} atlas=${atlasPos ? `${atlasPos.x.toFixed(2)},${atlasPos.y.toFixed(2)},${atlasPos.z.toFixed(2)}` : "unknown"}`);
    const kaiInv = await rcon.command(`data get entity ${area.kai.username} Inventory`).catch(() => "");
    const atlasInv = await rcon.command(`data get entity ${area.atlas.username} Inventory`).catch(() => "");
    console.log(`INV kai=${kaiInv.trim().slice(0, 280)}`);
    console.log(`INV atlas=${atlasInv.trim().slice(0, 280)}`);
    const kaiChestAfter = await rcon.command(`data get block ${area.kai.chest.x} ${area.kai.chest.y} ${area.kai.chest.z} Items`);
    const atlasChestAfter = await rcon.command(`data get block ${area.atlas.chest.x} ${area.atlas.chest.y} ${area.atlas.chest.z} Items`);
    const mineAfter = await rcon.command("data get block -954 58 944 Items");
    console.log(`CHEST_RECORD after kai=${kaiChestAfter.trim().slice(0, 400)}`);
    console.log(`CHEST_RECORD after atlas=${atlasChestAfter.trim().slice(0, 400)}`);
    console.log(`PRESERVE mining after=${mineAfter.trim().slice(0, 160)}`);
    const kaiChestAfterCounts = countQuotaFishInNbt(kaiChestAfter);
    const atlasChestAfterCounts = countQuotaFishInNbt(atlasChestAfter);
    const kaiChestDelta = quotaSum(kaiChestAfterCounts) - quotaSum(kaiChestBeforeCounts);
    const atlasChestDelta = quotaSum(atlasChestAfterCounts) - quotaSum(atlasChestBeforeCounts);
    console.log(
      `CHEST_DELTA kai=${kaiChestDelta} ${JSON.stringify(kaiChestAfterCounts)} atlas=${atlasChestDelta} ${JSON.stringify(atlasChestAfterCounts)}`,
    );
    const atlasPreserved =
      (atlasChestAfterCounts.cod ?? 0) >= (atlasChestBeforeCounts.cod ?? 0) &&
      (atlasChestAfterCounts.salmon ?? 0) >= (atlasChestBeforeCounts.salmon ?? 0);
    const isolation =
      kaiResult &&
      atlasResult &&
      (area.kai.chest.x !== area.atlas.chest.x || area.kai.chest.y !== area.atlas.chest.y || area.kai.chest.z !== area.atlas.chest.z) &&
      atlasPreserved &&
      /minecraft:coal/.test(mineAfter)
        ? "PASS"
        : "FAIL";
    console.log(`STORAGE_ISOLATION=${isolation}`);

    const rod = evaluateTwoFishRodLogs(rodLogs, area.kai.username, area.atlas.username);
    const bothPass =
      !rod.interference &&
      kaiResult?.fishing === "PASS" &&
      atlasResult?.fishing === "PASS" &&
      kaiResult.storage === "PASS" &&
      atlasResult.storage === "PASS";
    await finish(bothPass ? 0 : 1);
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
