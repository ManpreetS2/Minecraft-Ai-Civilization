import {
  FARM_PAD,
  HOME_H1,
  LIVE_CIVILIZATION_PORT,
  MINDCRAFT_BODY_TEST_PORT,
  RED_WORLD_LAB_PORT,
  SITE_C,
  type Cell,
} from "./mine-test-guard.js";
import { H1_PERSONAL_CHEST, MINE_LIVE_CHEST, MINE_LIVE_POCKET, TANNERY_CHEST } from "./fish-test-guard.js";
import { TWO_FISH_MAX_STAND_SEPARATION, TWO_FISH_MIN_STAND_SEPARATION } from "@civ/skills";

export const FISH_PROBE_CHEST = { x: -1042, y: 63, z: 980 };
export const TWO_FISH_CITIZEN_NAMES = ["Kai", "Atlas"] as const;
export const TWO_FISH_PROBE_NAMES = ["FishProbe", "FishProbeB"] as const;

export type TwoFishTarget =
  | {
      allowed: true;
      host: string;
      port: number;
      version: string;
      rconPort: number;
    }
  | { allowed: false; error: string };

export type TwoFishArea = {
  kai: { username: string; origin: Cell; chest: Cell };
  atlas: { username: string; origin: Cell; chest: Cell };
  radius: number;
  target: number;
  maxAttempts: number;
  timeoutMs: number;
  work: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
};

function parseCell(raw: string | undefined, label: string): Cell | { error: string } {
  const parts = raw?.split(",").map((part) => Number(part.trim()));
  if (!parts || parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { error: `${label}=x,y,z is required. Do not invent a two-bot fishing stand or chest.` };
  }
  return { x: Math.floor(parts[0] ?? 0), y: Math.floor(parts[1] ?? 0), z: Math.floor(parts[2] ?? 0) };
}

function xzDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function allowedUsername(name: string, allowCitizenIdentities: boolean): boolean {
  if (TWO_FISH_PROBE_NAMES.some((entry) => entry.toLowerCase() === name.toLowerCase())) return true;
  if (allowCitizenIdentities && TWO_FISH_CITIZEN_NAMES.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
    return true;
  }
  return false;
}

export function evaluateTwoFishTestLaunch(env: NodeJS.ProcessEnv = process.env): TwoFishTarget {
  if (env.MECHANICS_TWO_FISH_TEST_ENABLED !== "true") {
    return {
      allowed: false,
      error:
        "MECHANICS_TWO_FISH_TEST_ENABLED is not true. Two-citizen fishing harness is prepared only. Do not start pnpm sim:start.",
    };
  }
  if (env.TWO_FISH_ALLOW_WORLD_MUTATION !== "true") {
    return { allowed: false, error: "TWO_FISH_ALLOW_WORLD_MUTATION is not true." };
  }
  if (env.TWO_FISH_RED_APPROVED !== "true") {
    return { allowed: false, error: "TWO_FISH_RED_APPROVED is not true. RED must verify two same-pond stands." };
  }
  if (env.TWO_FISH_BLUE_SHARED !== "true") {
    return {
      allowed: false,
      error:
        "TWO_FISH_BLUE_SHARED is not true. BLUE must agree to share WORLD-LAB without kicking fishing bodies or mutating the pond/time for this run.",
    };
  }
  if (env.TWO_FISH_USER_APPROVED !== "true") {
    return { allowed: false, error: "TWO_FISH_USER_APPROVED is not true." };
  }
  if (
    env.MECHANICS_FISH_TEST_ENABLED === "true" ||
    env.MECHANICS_HOME_TEST_ENABLED === "true" ||
    env.MECHANICS_FARM_TEST_ENABLED === "true" ||
    env.MECHANICS_MINE_TEST_ENABLED === "true" ||
    env.MECHANICS_TWO_PROBE_TEST_ENABLED === "true" ||
    env.MECHANICS_CURFEW_TEST_ENABLED === "true"
  ) {
    return { allowed: false, error: "Refusing two-fish while another harness that owns global RCON/time is enabled." };
  }

  const port = Number(env.TWO_FISH_PORT ?? String(RED_WORLD_LAB_PORT));
  if (port === LIVE_CIVILIZATION_PORT) return { allowed: false, error: "Refusing two-fish test on 25565" };
  if (port === MINDCRAFT_BODY_TEST_PORT) return { allowed: false, error: "Refusing two-fish test on 25566" };
  if (port !== RED_WORLD_LAB_PORT) {
    return { allowed: false, error: `Two-fish test only allowed on isolated world-lab port ${RED_WORLD_LAB_PORT}` };
  }
  const version = env.TWO_FISH_VERSION ?? "1.21.11";
  if (version !== "1.21.11") return { allowed: false, error: `Requires Paper 1.21.11, got ${version}` };
  const rconPort = Number(env.TWO_FISH_RCON_PORT ?? "25577");
  if (rconPort === 25575) return { allowed: false, error: "Refusing live RCON 25575. Use 25577." };

  return {
    allowed: true,
    host: env.TWO_FISH_HOST ?? "127.0.0.1",
    port,
    version,
    rconPort,
  };
}

export function parseApprovedTwoFishArea(env: NodeJS.ProcessEnv = process.env): TwoFishArea | { error: string } {
  const kaiOrigin = parseCell(env.TWO_FISH_KAI_ORIGIN, "TWO_FISH_KAI_ORIGIN");
  if ("error" in kaiOrigin) return kaiOrigin;
  const atlasOrigin = parseCell(env.TWO_FISH_ATLAS_ORIGIN, "TWO_FISH_ATLAS_ORIGIN");
  if ("error" in atlasOrigin) return atlasOrigin;
  const kaiChest = parseCell(env.TWO_FISH_KAI_CHEST, "TWO_FISH_KAI_CHEST");
  if ("error" in kaiChest) return kaiChest;
  const atlasChest = parseCell(env.TWO_FISH_ATLAS_CHEST, "TWO_FISH_ATLAS_CHEST");
  if ("error" in atlasChest) return atlasChest;

  const allowCitizenIdentities = env.TWO_FISH_ALLOW_CITIZEN_IDENTITIES !== "false";
  const kaiName = env.TWO_FISH_KAI_USERNAME ?? "Kai";
  const atlasName = env.TWO_FISH_ATLAS_USERNAME ?? "Atlas";
  if (kaiName === atlasName) return { error: "Kai and Atlas usernames must be distinct" };
  if (!allowedUsername(kaiName, allowCitizenIdentities)) {
    return { error: `TWO_FISH_KAI_USERNAME=${kaiName} is not Kai/Atlas or FishProbe/FishProbeB` };
  }
  if (!allowedUsername(atlasName, allowCitizenIdentities)) {
    return { error: `TWO_FISH_ATLAS_USERNAME=${atlasName} is not Kai/Atlas or FishProbe/FishProbeB` };
  }

  const radius = Number(env.TWO_FISH_RADIUS ?? "8");
  if (!Number.isInteger(radius) || radius < 1 || radius > 16) return { error: "TWO_FISH_RADIUS must be 1–16" };
  const target = Number(env.TWO_FISH_TARGET ?? "5");
  if (!Number.isInteger(target) || (target !== 2 && target !== 5)) {
    return { error: "TWO_FISH_TARGET must be 2 (bounded live check) or 5 (full quota). Do not silently default a 2-fish check to 5." };
  }
  const maxAttempts = Number(env.TWO_FISH_MAX_ATTEMPTS ?? "12");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 5 || maxAttempts > 24) {
    return { error: "TWO_FISH_MAX_ATTEMPTS must be 5–24" };
  }
  const timeoutMs = Number(env.TWO_FISH_TIMEOUT_MS ?? "420000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
    return { error: "TWO_FISH_TIMEOUT_MS must be 30000–600000 (a 47s miss is not a permanent fishing FAIL)" };
  }

  if (sameCell(kaiOrigin, atlasOrigin)) return { error: "Kai and Atlas cannot share the same standing block" };
  const standDist = xzDist(kaiOrigin, atlasOrigin);
  if (standDist < TWO_FISH_MIN_STAND_SEPARATION) {
    return { error: "Stands overlap. Place the two bodies on separate shoreline cells." };
  }
  if (standDist > TWO_FISH_MAX_STAND_SEPARATION) {
    return { error: "Stands are too far apart. This test is one shared pond, not two fisheries." };
  }
  if (sameCell(kaiChest, atlasChest)) return { error: "Kai and Atlas must have distinct chests" };
  if (Math.abs(kaiChest.x - atlasChest.x) + Math.abs(kaiChest.z - atlasChest.z) === 1 && kaiChest.y === atlasChest.y) {
    return { error: "Kai and Atlas chests are cardinal-adjacent and would merge into a double chest" };
  }

  for (const origin of [kaiOrigin, atlasOrigin]) {
    if (xzDist(origin, SITE_C) < 64) return { error: "Refusing fishing stand inside Site C preserve" };
    if (xzDist(origin, FARM_PAD) < 32) return { error: "Refusing fishing stand on the farm pad" };
    if (xzDist(origin, HOME_H1) < 48) return { error: "Refusing fishing stand overlapping H1" };
    if (xzDist(origin, MINE_LIVE_POCKET) < 24) return { error: "Refusing fishing stand on the coal pocket" };
  }
  for (const chest of [kaiChest, atlasChest]) {
    if (xzDist(chest, SITE_C) < 64) return { error: "Refusing fishing chest inside Site C" };
    if (sameCell(chest, MINE_LIVE_CHEST)) return { error: "Refusing the mining chest at -954,58,944" };
    if (sameCell(chest, TANNERY_CHEST) || sameCell(chest, H1_PERSONAL_CHEST)) {
      return { error: "Refusing tannery or H1 personal chest" };
    }
  }

  const cells = [kaiOrigin, atlasOrigin, kaiChest, atlasChest];
  const pad = 3;
  return {
    kai: { username: kaiName, origin: kaiOrigin, chest: kaiChest },
    atlas: { username: atlasName, origin: atlasOrigin, chest: atlasChest },
    radius,
    target,
    maxAttempts,
    timeoutMs,
    work: {
      minX: Math.min(...cells.map((c) => c.x)) - pad,
      maxX: Math.max(...cells.map((c) => c.x)) + pad,
      minY: Math.min(...cells.map((c) => c.y)) - 2,
      maxY: Math.max(...cells.map((c) => c.y)) + 3,
      minZ: Math.min(...cells.map((c) => c.z)) - pad,
      maxZ: Math.max(...cells.map((c) => c.z)) + pad,
    },
  };
}

export function occupantConflictsFishingSite(
  pos: { x: number; y: number; z: number },
  area: TwoFishArea,
): boolean {
  return (
    pos.x >= area.work.minX &&
    pos.x <= area.work.maxX + 1 &&
    pos.y >= area.work.minY &&
    pos.y <= area.work.maxY &&
    pos.z >= area.work.minZ &&
    pos.z <= area.work.maxZ + 1
  );
}

export type TwoFishRodVerdict = {
  ownership: "PASS" | "FAIL" | "UNVERIFIED";
  biteResponse: "PASS" | "FAIL" | "UNVERIFIED";
  kaiBobberIds: number[];
  atlasBobberIds: number[];
  sharedBobberIds: number[];
  kaiOwnBites: number;
  atlasOwnBites: number;
  interference: boolean;
};

const ROD_LINE = /^FISH_ROD\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/;

export function evaluateTwoFishRodLogs(
  lines: readonly string[],
  kaiName: string,
  atlasName: string,
): TwoFishRodVerdict {
  const kaiBobbers = new Set<number>();
  const atlasBobbers = new Set<number>();
  let kaiOwnBites = 0;
  let atlasOwnBites = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("FISH_ROD ")) continue;
    const match = ROD_LINE.exec(line);
    if (!match) continue;
    const owner = match[1] ?? "";
    const detail = match[5] ?? "";
    const bobberMatch = /bobberId=(\d+)/.exec(detail);
    const bobberId = bobberMatch ? Number(bobberMatch[1]) : undefined;
    const isKai = owner.toLowerCase() === kaiName.toLowerCase();
    const isAtlas = owner.toLowerCase() === atlasName.toLowerCase();
    if (bobberId != null && Number.isFinite(bobberId)) {
      if (isKai) kaiBobbers.add(bobberId);
      if (isAtlas) atlasBobbers.add(bobberId);
    }
    if (detail.includes("own-particle-bite") || detail.includes("own-biting-metadata")) {
      if (isKai) kaiOwnBites += 1;
      if (isAtlas) atlasOwnBites += 1;
    }
  }
  const sharedBobberIds = [...kaiBobbers].filter((id) => atlasBobbers.has(id));
  const interference = sharedBobberIds.length > 0;
  const kaiBobberIds = [...kaiBobbers];
  const atlasBobberIds = [...atlasBobbers];
  let ownership: TwoFishRodVerdict["ownership"] = "UNVERIFIED";
  if (interference) ownership = "FAIL";
  else if (kaiBobberIds.length > 0 && atlasBobberIds.length > 0) ownership = "PASS";
  let biteResponse: TwoFishRodVerdict["biteResponse"] = "UNVERIFIED";
  if (interference) biteResponse = "FAIL";
  else if (kaiOwnBites > 0 && atlasOwnBites > 0) biteResponse = "PASS";
  else if (kaiBobberIds.length > 0 || atlasBobberIds.length > 0) biteResponse = "FAIL";
  return {
    ownership,
    biteResponse,
    kaiBobberIds,
    atlasBobberIds,
    sharedBobberIds,
    kaiOwnBites,
    atlasOwnBites,
    interference,
  };
}

export function humanBlocksStand(
  pos: { x: number; y: number; z: number },
  area: TwoFishArea,
): boolean {
  for (const stand of [area.kai.origin, area.atlas.origin, area.kai.chest, area.atlas.chest]) {
    if (Math.floor(pos.x) === stand.x && Math.floor(pos.z) === stand.z && Math.abs(pos.y - stand.y) < 1.6) {
      return true;
    }
  }
  return false;
}
