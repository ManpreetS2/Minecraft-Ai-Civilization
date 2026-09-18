import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import {
  canOccupyFeet,
  canStandOn,
  hasHeadroom,
  isWalkableStanding,
} from "./interaction.js";
import { nearbyOffsets } from "./path-recovery.js";

export type TerrainKind = "open" | "depression" | "walled_pit" | "deep_pit" | "clipped";

export type CellSample = {
  x: number;
  y: number;
  z: number;
  name: string;
  boundingBox: string;
  walkable: boolean;
};

export type LocalTerrainReport = {
  kind: TerrainKind;
  position: Vec3;
  feet: CellSample;
  below: CellSample;
  head: CellSample;
  adjacent: CellSample[];
  walkableSameY: Vec3[];
  walkableUp: Vec3[];
  walkableDown: Vec3[];
  reason: string;
};

function sample(bot: Bot, x: number, y: number, z: number): CellSample {
  const block = bot.blockAt(new Vec3Class(Math.floor(x), Math.floor(y), Math.floor(z)));
  const pos = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
  return {
    ...pos,
    name: block?.name ?? "unloaded",
    boundingBox: block?.boundingBox ?? "unknown",
    walkable: isWalkableStanding(bot, pos),
  };
}

function isHazardLanding(bot: Bot, pos: Vec3): boolean {
  const below = bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z)));
  const feet = bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
  const name = `${below?.name ?? ""} ${feet?.name ?? ""}`;
  return /lava|fire|cactus|magma/.test(name);
}

export function inspectLocalTerrain(bot: Bot): LocalTerrainReport | undefined {
  const origin = bot.entity?.position;
  if (!origin) return undefined;
  const x = Math.floor(origin.x);
  const y = Math.floor(origin.y);
  const z = Math.floor(origin.z);
  const feet = sample(bot, x, y, z);
  const below = sample(bot, x, y - 1, z);
  const head = sample(bot, x, y + 1, z);
  const adjacent: CellSample[] = [];
  const walkableSameY: Vec3[] = [];
  const walkableUp: Vec3[] = [];
  const walkableDown: Vec3[] = [];
  for (const offset of nearbyOffsets(1)) {
    adjacent.push(sample(bot, x + offset.x, y, z + offset.z));
    const same = { x: x + offset.x, y, z: z + offset.z };
    if (isWalkableStanding(bot, same) && !isHazardLanding(bot, same)) walkableSameY.push(same);
  }
  for (const offset of nearbyOffsets(2).slice(0, 12)) {
    const up = { x: x + offset.x, y: y + 1, z: z + offset.z };
    if (isWalkableStanding(bot, up) && !isHazardLanding(bot, up)) walkableUp.push(up);
    const down = { x: x + offset.x, y: y - 1, z: z + offset.z };
    if (isWalkableStanding(bot, down) && canStandOn(bot, down) && !isHazardLanding(bot, down)) walkableDown.push(down);
  }
  const cardinalBlocked = [
    sample(bot, x + 1, y, z),
    sample(bot, x - 1, y, z),
    sample(bot, x, y, z + 1),
    sample(bot, x, y, z - 1),
  ].filter((cell) => !canOccupyFeet(bot, cell) || cell.boundingBox === "block").length;
  const feetSolid = feet.boundingBox === "block" && !feet.name.endsWith("_slab") && !feet.name.includes("stairs") && !feet.name.endsWith("_door");
  let kind: TerrainKind = "open";
  let reason = "open standing cell with walkable neighbors";
  if (feetSolid) {
    kind = "clipped";
    reason = `feet inside ${feet.name}`;
  } else if (cardinalBlocked >= 3 && walkableUp.length === 0 && walkableSameY.length === 0) {
    kind = "deep_pit";
    reason = `walled in on ${cardinalBlocked}/4 sides with no jump-out rim`;
  } else if (cardinalBlocked >= 3 && walkableUp.length > 0) {
    kind = "walled_pit";
    reason = `1-block pit; ${walkableUp.length} rim cell(s) at y+1`;
  } else if (walkableUp.length > 0 && walkableSameY.length <= 1 && cardinalBlocked >= 1) {
    kind = "depression";
    reason = "lower than neighbors; step-up cells exist";
  }
  return {
    kind,
    position: { x: origin.x, y: origin.y, z: origin.z },
    feet,
    below,
    head,
    adjacent,
    walkableSameY,
    walkableUp,
    walkableDown,
    reason,
  };
}

export function formatTerrainReport(report: LocalTerrainReport): string {
  const adj = report.adjacent
    .slice(0, 8)
    .map((cell) => `${cell.x},${cell.y},${cell.z}=${cell.name}/${cell.boundingBox}${cell.walkable ? ":walk" : ""}`)
    .join("; ");
  return [
    `kind=${report.kind} reason=${report.reason}`,
    `pos=${report.position.x.toFixed(2)} ${report.position.y.toFixed(2)} ${report.position.z.toFixed(2)}`,
    `feet=${report.feet.name}/${report.feet.boundingBox} below=${report.below.name}/${report.below.boundingBox} head=${report.head.name}/${report.head.boundingBox}`,
    `walkable sameY=${report.walkableSameY.length} up=${report.walkableUp.length} down=${report.walkableDown.length}`,
    `adjacent: ${adj}`,
  ].join(" | ");
}

export function chooseStandingDestination(bot: Bot, target: Vec3, radius = 3): Vec3 | undefined {
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const tz = Math.floor(target.z);
  const origin = bot.entity?.position;
  const candidates: Vec3[] = [];
  for (const dy of [0, 1, -1]) {
    if (dy === -1) {
      const down = { x: tx, y: ty - 1, z: tz };
      if (!canStandOn(bot, { x: tx, y: ty, z: tz }) && isHazardLanding(bot, down)) continue;
    }
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const pos = { x: tx + dx, y: ty + dy, z: tz + dz };
        if (!isWalkableStanding(bot, pos) || isHazardLanding(bot, pos)) continue;
        candidates.push(pos);
      }
    }
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => {
    const da = (a.x - tx) ** 2 + (a.y - ty) ** 2 + (a.z - tz) ** 2;
    const db = (b.x - tx) ** 2 + (b.y - ty) ** 2 + (b.z - tz) ** 2;
    if (da !== db) return da - db;
    if (!origin) return 0;
    const oa = (a.x - origin.x) ** 2 + (a.z - origin.z) ** 2;
    const ob = (b.x - origin.x) ** 2 + (b.z - origin.z) ** 2;
    return oa - ob;
  });
  return candidates[0];
}

export function localEscapeCells(bot: Bot): Vec3[] {
  const report = inspectLocalTerrain(bot);
  if (!report) return [];
  const ordered = [...report.walkableSameY, ...report.walkableUp, ...report.walkableDown];
  const seen = new Set<string>();
  const unique: Vec3[] = [];
  for (const cell of ordered) {
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cell);
  }
  return unique.slice(0, 8);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTicks(bot: Bot, n: number): Promise<void> {
  const fn = (bot as Bot & { waitForTicks?: (ticks: number) => Promise<void> }).waitForTicks;
  if (typeof fn === "function") {
    try {
      await fn.call(bot, n);
      return;
    } catch {
      // physics ticks can time out if the body is frozen after a teleport
    }
  }
  await wait(Math.max(50, n * 50));
}

function faceXZ(bot: Bot, x: number, z: number): void {
  const start = bot.entity?.position;
  if (!start || !bot.entity) return;
  bot.entity.yaw = Math.atan2(-(x - start.x), -(z - start.z));
  bot.entity.pitch = 0;
}

function leftWalkableCell(bot: Bot, start: Vec3): boolean {
  const now = bot.entity?.position;
  if (!now) return false;
  const left =
    Math.floor(now.x) !== Math.floor(start.x) ||
    Math.floor(now.y) !== Math.floor(start.y) ||
    Math.floor(now.z) !== Math.floor(start.z);
  if (!left) return false;
  return isWalkableStanding(bot, { x: Math.floor(now.x), y: Math.floor(now.y), z: Math.floor(now.z) });
}

async function centerInCell(bot: Bot): Promise<void> {
  const start = bot.entity?.position;
  if (!start) return;
  const cx = Math.floor(start.x) + 0.5;
  const cz = Math.floor(start.z) + 0.5;
  if (Math.hypot(start.x - cx, start.z - cz) < 0.08) return;
  faceXZ(bot, cx, cz);
  bot.setControlState("forward", true);
  bot.setControlState("sprint", false);
  bot.setControlState("jump", false);
  await waitTicks(bot, 3);
  bot.clearControlStates();
  await waitTicks(bot, 1);
}

async function walkToward(bot: Bot, dest: Vec3): Promise<boolean> {
  const start = bot.entity?.position;
  if (!start) return false;
  const tx = Math.floor(dest.x) + 0.5;
  const tz = Math.floor(dest.z) + 0.5;
  faceXZ(bot, tx, tz);
  try {
    await bot.look(bot.entity?.yaw ?? 0, 0, true);
  } catch {
    // yaw already set
  }
  bot.clearControlStates();
  bot.setControlState("forward", true);
  bot.setControlState("sprint", (bot.food ?? 20) > 6);
  await waitTicks(bot, 10);
  bot.clearControlStates();
  await waitTicks(bot, 2);
  return leftWalkableCell(bot, start);
}

async function jumpToward(bot: Bot, dest: Vec3, mode: 0 | 1 = 0): Promise<boolean> {
  const start = bot.entity?.position;
  if (!start) return false;
  if (!hasHeadroom(bot, { x: Math.floor(start.x), y: Math.floor(start.y), z: Math.floor(start.z) })) return false;
  await centerInCell(bot);
  const grounded = bot.entity?.onGround;
  if (!grounded) {
    await waitTicks(bot, 6);
  }
  const from = bot.entity?.position ?? start;
  const tx = Math.floor(dest.x) + 0.5;
  const tz = Math.floor(dest.z) + 0.5;
  faceXZ(bot, tx, tz);
  try {
    await bot.look(bot.entity?.yaw ?? 0, 0, true);
  } catch {
    try {
      await bot.lookAt(new Vec3Class(tx, from.y + 1, tz), true);
    } catch {
      // yaw already set on the entity
    }
  }

  bot.clearControlStates();
  const writeInput = (inputs: Record<string, boolean>) => {
    const feature = (bot as Bot & { supportFeature?: (name: string) => boolean }).supportFeature;
    const client = (bot as unknown as { _client?: { write?: (name: string, payload: unknown) => void } })._client;
    if (!feature?.("newPlayerInputPacket") || !client?.write) return;
    try {
      client.write("player_input", { inputs });
    } catch {
      // protocol without this packet
    }
  };
  if (mode === 0) {
    // Sprint must already be on when the jump tick fires so prismarine applies the 0.2 sprint-jump boost.
    bot.setControlState("sprint", true);
    writeInput({ sprint: true });
    await waitTicks(bot, 1);
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    bot.setControlState("sprint", true);
    writeInput({ jump: true, forward: true, sprint: true });
    await waitTicks(bot, 2);
    bot.setControlState("jump", false);
    await waitTicks(bot, 10);
  } else {
    bot.setControlState("jump", true);
    writeInput({ jump: true });
    await waitTicks(bot, 2);
    bot.setControlState("forward", true);
    bot.setControlState("sprint", true);
    writeInput({ jump: true, forward: true, sprint: true });
    await waitTicks(bot, 2);
    bot.setControlState("jump", false);
    await waitTicks(bot, 10);
  }
  bot.clearControlStates();
  await waitTicks(bot, 2);
  return leftWalkableCell(bot, from);
}

export async function localEscape(
  bot: Bot,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult<{ position: Vec3; distance: number; kind: TerrainKind }>> {
  const started = Date.now();
  const budget = options.timeoutMs ?? 6_000;
  const before = inspectLocalTerrain(bot);
  if (!before) return fail("NOT_CONNECTED", "Cannot escape without a body", 0);
  const start = { ...before.position };
  if (before.kind === "open" && before.walkableSameY.length >= 2) {
    return ok(
      { position: start, distance: 0, kind: before.kind },
      Date.now() - started,
    );
  }
  if (before.kind === "deep_pit") {
    return fail(
      "PATH_BLOCKED",
      `no walkable rim out of pit without mining (${before.reason})`,
      Date.now() - started,
      true,
    );
  }
  const cells = localEscapeCells(bot);
  if (cells.length === 0) {
    return fail("PATH_BLOCKED", `no local standing cell to escape to (${before.reason})`, Date.now() - started, true);
  }
  try {
    const pf = (bot as unknown as { pathfinder?: { stop?: () => void } }).pathfinder;
    pf?.stop?.();
  } catch {
    // ignore
  }
  await waitTicks(bot, 2);
  for (const cell of cells) {
    if (options.signal?.aborted) return fail("CANCELLED", "local escape cancelled", Date.now() - started, true);
    if (Date.now() - started > budget - 400) break;
    const sameY = cell.y === Math.floor(start.y);
    for (let hop = 0; hop < 3; hop += 1) {
      const hopped = sameY
        ? await walkToward(bot, cell)
        : await jumpToward(bot, cell, hop % 2 === 0 ? 0 : 1);
      const now = bot.entity?.position;
      if (!now) break;
      const moved = Math.hypot(now.x - start.x, now.y - start.y, now.z - start.z);
      if (hopped) {
        return ok(
          { position: { x: now.x, y: now.y, z: now.z }, distance: moved, kind: before.kind },
          Date.now() - started,
        );
      }
    }
  }
  const end = bot.entity?.position ?? start;
  const dist = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const after = inspectLocalTerrain(bot);
  if (
    dist >= 0.45 &&
    isWalkableStanding(bot, { x: Math.floor(end.x), y: Math.floor(end.y), z: Math.floor(end.z) }) &&
    after &&
    after.kind === "open"
  ) {
    return ok({ position: { x: end.x, y: end.y, z: end.z }, distance: dist, kind: before.kind }, Date.now() - started);
  }
  return fail(
    "NAV_NO_INITIAL_PROGRESS",
    `local escape did not leave ${before.kind} (${before.reason})`,
    Date.now() - started,
    true,
  );
}
