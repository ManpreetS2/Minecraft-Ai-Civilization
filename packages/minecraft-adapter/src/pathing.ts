import { createRequire } from "node:module";
import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import { distance, fail, ok, abortedResult, classifyEntityPresence, entityGoneMessage, type ActionResult, type Vec3 } from "@civ/shared";
import {
  DISPOSABLE_SCAFFOLD,
  PROTECTED_BLOCK_NAMES,
  isProtectedFromPathfinder,
  movedEnough,
  recoveryAttempts,
} from "./path-recovery.js";
import { noteYield, occupantNear, occupancyYieldCount, registerOccupancy } from "./occupancy.js";
import {
  chooseStandingDestination,
  inspectLocalTerrain,
  localEscape,
  localEscapeCells,
  type TerrainKind,
} from "./local-escape.js";
import {
  arrivalAccepted,
  attemptStepJump,
  evaluateStepJump,
  isMovementStall,
  movementActivity,
  releaseMovementControls,
  STEP_JUMP_LIMITS,
  tryOpenAdjacentDoor,
  groundWaitOutcome,
} from "./step-jump.js";
import { terrainMemory } from "./terrain-memory.js";
import { attemptHazardBridge, cellIsUnsafeToEnter, classifyHazardName, headingToward, hazardAhead, pathContainsUnsafeCell, planHazardRecovery, MAX_HAZARD_REROUTES, SAFE_FALL_MAX_DROP, retreatFromHazard } from "./hazard-nav.js";
import { installModernMovement } from "./movement-sync.js";
import { stepToStandingCell, twoBlockRecovery } from "./obstacle-detour.js";
import { navigationBodyReady, navigationParametersValid } from "./connection-health.js";

const require = createRequire(import.meta.url);
const pathfinderModule = require("mineflayer-pathfinder") as {
  pathfinder: (bot: Bot) => void;
  Movements: new (bot: Bot) => MovementSettings;
  goals: {
    GoalNear: new (x: number, y: number, z: number, range: number) => unknown;
    GoalFollow: new (entity: unknown, range: number) => unknown;
    GoalGetToBlock: new (x: number, y: number, z: number) => unknown;
    GoalLookAtBlock: new (pos: { x: number; y: number; z: number }, world: unknown, options?: { reach?: number }) => unknown;
  };
};
const { pathfinder, Movements, goals } = pathfinderModule;

type MovementSettings = {
  canDig: boolean;
  scafoldingBlocks: number[];
  allowParkour: boolean;
  allow1by1towers: boolean;
  maxDropDown: number;
  infiniteLiquidDropdownDistance: boolean;
  dontMineUnderFallingBlock: boolean;
  blocksCantBreak: Set<number>;
  blocksToAvoid?: Set<number>;
  canOpenDoors?: boolean;
  entityCost?: number;
  liquidCost?: number;
  digCost?: number;
  placeCost?: number;
  allowSprinting?: boolean;
  exclusionAreasStep?: Array<(block: { position?: Vec3; name?: string }) => number>;
};

/** Normal walking never mines. Explicit mining skills dig the chosen block themselves. */
export const NORMAL_NAVIGATION_CAN_DIG = false;

export type MovementProfile = "SAFE_NAVIGATION" | "RESOURCE_APPROACH" | "CONTROLLED_EXCAVATION";

export function movementAllowsDig(profile: MovementProfile): boolean {
  return profile === "CONTROLLED_EXCAVATION";
}

export type PathfinderApi = {
  setMovements: (movements: MovementSettings) => void;
  setGoal: (goal: unknown, dynamic?: boolean) => void;
  stop: () => void;
  goto: (goal: unknown) => Promise<void>;
  getPathTo?: (movements: MovementSettings, goal: unknown, timeout?: number) => { status?: string; cost?: number };
};

const configured = new WeakMap<Bot, { api: PathfinderApi; key: string; movements: MovementSettings }>();
let activePaths = 0;
let lastPathMs = 0;
let pathAttempts = 0;
let pathSuccess = 0;
let pathTimeout = 0;
let pathStuck = 0;

export function activePathCount(): number {
  return activePaths;
}

export function lastPathDurationMs(): number {
  return lastPathMs;
}

export function pathMetrics(): {
  attempts: number;
  success: number;
  timeout: number;
  stuck: number;
  yields: number;
  active: number;
} {
  return {
    attempts: pathAttempts,
    success: pathSuccess,
    timeout: pathTimeout,
    stuck: pathStuck,
    yields: occupancyYieldCount(),
    active: activePaths,
  };
}

function botPathfinder(bot: Bot): PathfinderApi {
  return (bot as unknown as { pathfinder: PathfinderApi }).pathfinder;
}

function scaffoldingIds(bot: Bot): number[] {
  const held = new Set((bot.inventory?.items() ?? []).map((item) => item.name));
  const ids: number[] = [];
  for (const name of DISPOSABLE_SCAFFOLD) {
    if (!held.has(name)) continue;
    const id = bot.registry.itemsByName[name]?.id;
    if (typeof id === "number") ids.push(id);
  }
  return ids;
}

export function invalidateMovementCache(bot: Bot): void {
  configured.delete(bot);
}

export function configureMovements(bot: Bot, profile: MovementProfile = "SAFE_NAVIGATION"): PathfinderApi {
  bot.loadPlugin(pathfinder);
  const scaffold = scaffoldingIds(bot);
  const key = `${profile}:${scaffold.join(",")}`;
  const api = botPathfinder(bot);
  installModernMovement(bot);
  const existing = configured.get(bot);
  if (existing && existing.key === key && existing.api === api) {
    return existing.api;
  }
  const movements = new Movements(bot);
  movements.canDig = movementAllowsDig(profile);
  // getMoveJumpUp is always registered: ordinary 1-block step-ups. Parkour is 2-block gaps.
  movements.allowParkour = true;
  movements.allowSprinting = true;
  movements.allow1by1towers = false;
  movements.maxDropDown = profile === "CONTROLLED_EXCAVATION" ? 3 : 1;
  movements.infiniteLiquidDropdownDistance = false;
  movements.dontMineUnderFallingBlock = true;
  movements.scafoldingBlocks = profile === "CONTROLLED_EXCAVATION" ? scaffold : [];
  movements.entityCost = 8;
  movements.liquidCost = 8;
  movements.digCost = 10;
  movements.placeCost = 8;
  if (typeof movements.canOpenDoors === "boolean") movements.canOpenDoors = true;
  const hazards = ["lava", "flowing_lava", "fire", "soul_fire", "magma_block", "cactus", "campfire", "soul_campfire"];
  for (const name of hazards) {
    const id = bot.registry.blocksByName[name]?.id;
    if (typeof id === "number") movements.blocksToAvoid?.add(id);
  }
  protectFromPathfinder(bot, movements);
  api.setMovements(movements);
  configured.set(bot, { api, key, movements });
  return api;
}

/** A path query needs the configured movement policy and a Goal implementation. */
export function probePathToPosition(bot: Bot, target: Vec3, timeoutMs = 40): { status?: string; cost?: number } | undefined {
  const api = configureMovements(bot);
  const settings = configured.get(bot);
  if (!api.getPathTo || !settings) return undefined;
  return api.getPathTo(settings.movements, new goals.GoalNear(Math.floor(target.x), Math.floor(target.y), Math.floor(target.z), 1), timeoutMs);
}

function protectFromPathfinder(bot: Bot, movements: MovementSettings): void {
  const names = new Set(PROTECTED_BLOCK_NAMES);
  const byName = bot.registry.blocksByName as Record<string, { id: number; name: string }>;
  for (const block of Object.values(byName)) {
    if (!block?.name) continue;
    if (isProtectedFromPathfinder(block.name) || names.has(block.name)) {
      movements.blocksCantBreak.add(block.id);
    }
  }
}

export function loadPathfinder(bot: Bot): PathfinderApi {
  return configureMovements(bot);
}

/** Shared default for Atlas/Maya/Theo/Ava/Kai: 1.21 input merge plus verified one-block auto-jump. */
export function installSharedNavigator(bot: Bot): PathfinderApi {
  installModernMovement(bot);
  return configureMovements(bot);
}

type MoveOptions = {
  range?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  recover?: boolean;
  allowHazardBridge?: boolean;
};

const recoveryLock = new WeakSet<Bot>();

export async function moveToPosition(
  bot: Bot,
  target: Vec3,
  options: MoveOptions = {},
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  const budget = options.timeoutMs ?? 22_000;
  const recover = options.recover !== false;
  if (options.signal?.aborted) return abortedResult(0);
  if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Bot has no active navigation body", 0);
  if (!navigationParametersValid(target, options.range ?? 2, budget)) return fail("INVALID_ARGUMENT", "Invalid movement target, range or timeout", 0);
  const waitStart = Date.now();
  while (activePaths >= 3 && Date.now() - waitStart < Math.min(4_000, budget)) {
    if (options.signal?.aborted) return abortedResult(Date.now() - started);
    if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost body while waiting for navigation", Date.now() - started);
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, budget - (Date.now() - started))));
  }
  if (options.signal?.aborted) return abortedResult(Date.now() - started);
  if (Date.now() - started >= budget) return fail("TIMEOUT", "Navigation budget expired while waiting", Date.now() - started, true);

  if (recover) {
    const report = inspectLocalTerrain(bot);
    if (report && report.kind !== "open" && report.kind !== "deep_pit") {
      const remaining = budget - (Date.now() - started);
      if (remaining > 900) {
        const escaped = await tryLocalReposition(bot, Math.min(6_000, remaining), options.signal);
        if (escaped.success === false && (escaped.code === "CANCELLED" || escaped.code === "NOT_CONNECTED")) {
          return escaped;
        }
      }
    }
  }

  const climb = Boolean(bot.entity && target.y > bot.entity.position.y + 0.4);
  const goingDown = Boolean(bot.entity && target.y < bot.entity.position.y - 0.4);
  const minY = bot.entity
    ? goingDown
      ? Math.floor(target.y)
      : Math.floor(bot.entity.position.y)
    : undefined;
  const standing = chooseStandingDestination(bot, target, 3, minY !== undefined ? { minY } : undefined) ?? target;
  const attempts = recover
    ? recoveryAttempts(standing, options.range ?? 2, 3, { climb, noDrop: !goingDown })
    : [{ x: standing.x, y: standing.y, z: standing.z, range: options.range ?? 2 }];

  let last: ActionResult<{ position: Vec3; distance: number }> | undefined;
  let triedEscape = false;
  for (const attempt of attempts) {
    const remaining = budget - (Date.now() - started);
    if (remaining < 800) break;
    last = await attemptGoto(bot, attempt, {
      timeoutMs: last ? Math.min(10_000, remaining) : remaining,
      signal: options.signal,
      allowHazardBridge: options.allowHazardBridge,
    });
    lastPathMs = last.durationMs;
    if (last.success) {
      const pos = bot.entity?.position;
      if (pos && arrivalAccepted(pos, target, options.range ?? 2)) return last;
      last = fail(
        "VERIFY_FAILED",
        `arrived at waypoint not the goal; finished ${pos ? fmt(pos) : "?"} from ${fmt(target)}`,
        last.durationMs,
        true,
      );
      continue;
    }
    if (last.code === "CANCELLED" || last.code === "NOT_CONNECTED") return last;
    if (!last.retryable) return last;
    if (!triedEscape && recover && (last.code === "NAV_NO_INITIAL_PROGRESS" || last.code === "PATH_FAILED")) {
      triedEscape = true;
      const leftover = budget - (Date.now() - started);
      if (leftover > 900) {
        await tryLocalReposition(bot, Math.min(5_000, leftover), options.signal);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const failed =
    last ?? fail("PATH_FAILED", `goal unreachable near ${fmt(target)}`, Date.now() - started, true);
  lastPathMs = failed.durationMs;
  return failed;
}

async function tryLocalReposition(
  bot: Bot,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ActionResult<{ position: Vec3; distance: number; kind?: TerrainKind }>> {
  const report = inspectLocalTerrain(bot);
  if (!report) return fail("NOT_CONNECTED", "Cannot reposition without a body", 0);
  if (report.kind === "open") {
    return ok({ position: report.position, distance: 0, kind: report.kind }, 0);
  }
  if (report.kind === "deep_pit") {
    return fail("PATH_BLOCKED", `no walkable rim out of pit without mining (${report.reason})`, 0, true);
  }
  const jumped = await localEscape(bot, { timeoutMs: Math.min(timeoutMs, 5_000), signal });
  if (jumped.success || jumped.code === "CANCELLED" || jumped.code === "NOT_CONNECTED") return jumped;
  const rim = localEscapeCells(bot)[0];
  if (!rim) return jumped;
  const remaining = timeoutMs - jumped.durationMs;
  if (remaining < 800) return jumped;
  const moved = await attemptGoto(bot, { x: rim.x, y: rim.y, z: rim.z, range: 1 }, { timeoutMs: Math.min(3_500, remaining), signal });
  if (moved.success) return ok({ ...moved.data, kind: report.kind }, moved.durationMs);
  return jumped;
}

async function attemptGoto(
  bot: Bot,
  target: { x: number; y: number; z: number; range: number },
  options: { timeoutMs: number; signal?: AbortSignal; allowHazardBridge?: boolean },
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  if (options.signal?.aborted) return abortedResult(0);
  if (!navigationBodyReady(bot)) {
    return fail("NOT_CONNECTED", "Bot is not spawned", 0);
  }
  const occupied = occupantNear({ x: target.x, y: target.y, z: target.z }, bot.username, 1.2);
  if (occupied) {
    noteYield();
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  const climbGoal = Boolean(bot.entity && target.y > bot.entity.position.y + 0.4);
  const goal = new goals.GoalNear(
    Math.floor(target.x),
    Math.floor(target.y),
    Math.floor(target.z),
    climbGoal ? 0 : Math.max(1, Math.floor(target.range)),
  );
  return runGoto(bot, goal, target, options);
}

export async function moveToLookAtBlock(
  bot: Bot,
  block: Vec3,
  options: { timeoutMs?: number; signal?: AbortSignal; reach?: number } = {},
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  if (!navigationParametersValid(block, options.reach ?? 4.5, options.timeoutMs ?? 12_000)) return fail("INVALID_ARGUMENT", "Invalid interaction target, reach or timeout", 0);
  if (!bot.entity?.position) {
    return fail("NOT_CONNECTED", "Bot is not spawned", Date.now() - started);
  }
  const goal = new goals.GoalLookAtBlock(
    new Vec3Class(Math.floor(block.x), Math.floor(block.y), Math.floor(block.z)),
    bot.world,
    { reach: options.reach ?? 4.5 },
  );
  return runGoto(bot, goal, { ...block, range: options.reach ?? 4.5 }, { timeoutMs: options.timeoutMs ?? 12_000, signal: options.signal });
}

export async function moveToGetToBlock(
  bot: Bot,
  block: Vec3,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  if (!navigationParametersValid(block, 2, options.timeoutMs ?? 12_000)) return fail("INVALID_ARGUMENT", "Invalid block target or timeout", 0);
  const goal = new goals.GoalGetToBlock(Math.floor(block.x), Math.floor(block.y), Math.floor(block.z));
  return runGoto(bot, goal, { ...block, range: 2 }, { timeoutMs: options.timeoutMs ?? 12_000, signal: options.signal });
}

function climbMinY(bot: Bot, target: { x: number; y: number; z: number }): number | undefined {
  const y = bot.entity?.position.y;
  if (y === undefined) return undefined;
  if (target.y > y + 0.4) return Math.floor(target.y);
  return undefined;
}

function haltPathfinder(bot: Bot, pf: PathfinderApi): void {
  try {
    pf.stop();
  } catch {
    // ignore
  }
  try {
    pf.setGoal(null);
  } catch {
    // ignore
  }
  releaseMovementControls(bot);
}

async function runGoto(
  bot: Bot,
  goal: unknown,
  target: { x: number; y: number; z: number; range?: number },
  options: { timeoutMs: number; signal?: AbortSignal; allowHazardBridge?: boolean },
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  if (options.signal?.aborted) return abortedResult(0);
  const controller = new AbortController();
  let reason: "CANCELLED" | "NOT_CONNECTED" | "TIMEOUT" | undefined;
  let settle!: (result: ActionResult<{ position: Vec3; distance: number }>) => void;
  const interrupted = new Promise<ActionResult<{ position: Vec3; distance: number }>>((resolve) => { settle = resolve; });
  const release = () => {
    recoveryLock.delete(bot);
    haltPathfinder(bot, configureMovements(bot));
  };
  const interrupt = (code: NonNullable<typeof reason>) => {
    if (reason) return;
    reason = code;
    controller.abort();
    release();
    const message = code === "NOT_CONNECTED"
      ? "Navigation life ended during recovery"
      : code === "TIMEOUT"
        ? "Navigation budget exhausted"
        : "Navigation cancelled";
    settle(fail(code, message, Date.now() - started, code === "TIMEOUT"));
  };
  const aborted = () => interrupt("CANCELLED");
  const lost = () => interrupt("NOT_CONNECTED");
  const events = ["end", "kicked", "death", "respawn"] as const;
  const timer = setTimeout(() => interrupt("TIMEOUT"), options.timeoutMs);
  options.signal?.addEventListener("abort", aborted, { once: true });
  for (const event of events) bot.on(event, lost);
  try {
    // Race the scope the way runNavigationScope does. A primitive that ignores its signal
    // cannot leave this caller pending, and release() drops the recovery lock on the way out.
    const result = await Promise.race([
      runGotoWithinScope(bot, goal, target, { ...options, signal: controller.signal }),
      interrupted,
    ]);
    if (options.signal?.aborted || reason === "CANCELLED") return abortedResult(Date.now() - started);
    if (reason) return fail(reason, reason === "NOT_CONNECTED" ? "Navigation life ended during recovery" : "Navigation budget exhausted", Date.now() - started, reason === "TIMEOUT");
    return result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", aborted);
    for (const event of events) bot.removeListener(event, lost);
    if (controller.signal.aborted) release();
  }
}

async function runGotoWithinScope(
  bot: Bot,
  goal: unknown,
  target: { x: number; y: number; z: number; range?: number },
  options: { timeoutMs: number; signal?: AbortSignal; allowHazardBridge?: boolean },
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  let recoveries = 0;
  let hazardReroutes = 0;
  let lastObstacle = "none";
  let last: ActionResult<{ position: Vec3; distance: number }> | undefined;
  while (Date.now() - started < options.timeoutMs - 400) {
    if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Lost navigation body", Date.now() - started);
    if (options.signal?.aborted) {
      haltPathfinder(bot, configureMovements(bot));
      return abortedResult(Date.now() - started);
    }
    const slice = options.timeoutMs - (Date.now() - started);
    last = await runGotoOnce(bot, goal, target, { timeoutMs: slice, signal: options.signal });
    if (last.success) return last;
    if (
      last.code === "CANCELLED" ||
      last.code === "NOT_CONNECTED" ||
      (last.code === "HAZARD_BLOCKED" && last.retryable === false) ||
      (last.code === "PATH_BLOCKED" && last.retryable === false) ||
      (last.code === "TIMEOUT" && last.retryable === false)
    ) {
      haltPathfinder(bot, configureMovements(bot));
      return last;
    }
    const stallLike =
      last.code === "STUCK" ||
      last.code === "NAV_NO_INITIAL_PROGRESS" ||
      last.code === "PATH_FAILED" ||
      last.code === "TIMEOUT" ||
      last.code === "VERIFY_FAILED" ||
      last.code === "PATH_BLOCKED" ||
      last.code === "HAZARD_BLOCKED";
    if (!stallLike || Date.now() - started >= options.timeoutMs - 400) break;
    if (recoveryLock.has(bot)) break;
    recoveryLock.add(bot);
    try {
      haltPathfinder(bot, configureMovements(bot));
      const grounded = await groundWaitOutcome(bot, 6, options.signal, started + options.timeoutMs);
      if (grounded !== "complete") {
        return fail(grounded === "cancelled" ? "CANCELLED" : grounded === "unavailable" ? "NOT_CONNECTED" : "TIMEOUT", "Recovery ground wait interrupted", Date.now() - started, false);
      }
      const memory = terrainMemory(bot);
      memory.observeVisible(bot);
      const here = bot.entity?.position;
      if (!here) break;
      const hazard = hazardAhead(bot, target);
      if (hazard && (hazard.kind === "lava" || hazard.kind === "magma" || hazard.kind === "fire" || hazard.kind === "fall")) {
        lastObstacle = hazard.name;
        releaseMovementControls(bot);
        if (hazardReroutes >= MAX_HAZARD_REROUTES) {
          haltPathfinder(bot, configureMovements(bot));
          return fail(
            "HAZARD_BLOCKED",
            `${hazard.kind} at ${hazard.cell.x},${hazard.cell.y},${hazard.cell.z}; halted at ${fmt(here)}; reroute budget exhausted`,
            Date.now() - started,
            false,
            { goal: target, position: here, attempts: hazardReroutes, obstacle: hazard.name, teleported: false },
          );
        }
        const heading = headingToward(here, target);
        const retreated = await retreatFromHazard(bot, heading, options.signal);
        if (options.signal?.aborted) {
          haltPathfinder(bot, configureMovements(bot));
          return abortedResult(Date.now() - started);
        }
        const stand = retreated.success ? retreated.data.position : here;
        memory.markEdgeBlocked(here, hazard.cell, `${hazard.kind} ahead`, hazard.name);
        const recovery = planHazardRecovery(bot, stand, target, hazard);
        if (recovery.action === "bypass") {
          const tries = [recovery.cell, ...recovery.alternatives];
          let moved = false;
          for (const cell of tries) {
            if (options.signal?.aborted) {
              haltPathfinder(bot, configureMovements(bot));
              return abortedResult(Date.now() - started);
            }
            const stepped = await stepToStandingCell(bot, cell, options.signal, {
              maxDrop: recovery.drop > 0 ? SAFE_FALL_MAX_DROP : 0,
              deadline: started + options.timeoutMs,
            });
            if (options.signal?.aborted) {
              haltPathfinder(bot, configureMovements(bot));
              return abortedResult(Date.now() - started);
            }
            if (stepped.moved) {
              moved = true;
              hazardReroutes += 1;
              goal = new goals.GoalNear(
                Math.floor(target.x),
                Math.floor(target.y),
                Math.floor(target.z),
                Math.max(1, Math.floor(target.range ?? 2)),
              );
              break;
            }
          }
          if (moved) continue;
        }
        if (options.allowHazardBridge && hazard.kind === "lava") {
          const bridged = await attemptHazardBridge(bot, hazard.cell, {
            allowConstruction: true,
            signal: options.signal,
          });
          if (options.signal?.aborted) {
            haltPathfinder(bot, configureMovements(bot));
            return abortedResult(Date.now() - started);
          }
          if (bridged.success) {
            hazardReroutes += 1;
            continue;
          }
        }
        haltPathfinder(bot, configureMovements(bot));
        return fail(
          "HAZARD_BLOCKED",
          recovery.action === "blocked"
            ? recovery.reason
            : `${hazard.kind} at ${hazard.cell.x},${hazard.cell.y},${hazard.cell.z}; halted at ${fmt(stand)}; bypass did not move`,
          Date.now() - started,
          false,
          { goal: target, position: stand, attempts: hazardReroutes, obstacle: hazard.name, teleported: false },
        );
      }
      if (recoveries >= STEP_JUMP_LIMITS.maxRecoveries) break;
      recoveries += 1;
      const jump = evaluateStepJump(bot, target);
      lastObstacle = jump.ok ? jump.obstacle : (jump.obstacle ?? jump.reason);
      if (jump.ok) {
        let hopped = await attemptStepJump(bot, jump.landing, options.signal);
        if (!hopped.landed && !options.signal?.aborted) {
          hopped = await attemptStepJump(bot, jump.landing, options.signal);
        }
        if (options.signal?.aborted) {
          haltPathfinder(bot, configureMovements(bot));
          return abortedResult(Date.now() - started);
        }
        if (hopped.landed) continue;
        memory.markEdgeBlocked(here, jump.landing, "jump did not land", jump.obstacle);
      } else if (jump.reason.includes("door")) {
        const door = await tryOpenAdjacentDoor(bot, options.signal);
        if (options.signal?.aborted) {
          haltPathfinder(bot, configureMovements(bot));
          return abortedResult(Date.now() - started);
        }
        if (door.handled) continue;
      } else {
        const detour = twoBlockRecovery(bot, target, memory);
        if (detour.action === "detour") {
          const stepped = await stepToStandingCell(bot, detour.side, options.signal, {
            deadline: started + options.timeoutMs,
          });
          if (options.signal?.aborted) {
            haltPathfinder(bot, configureMovements(bot));
            return abortedResult(Date.now() - started);
          }
          if (stepped.moved) {
            goal = new goals.GoalNear(
              Math.floor(target.x),
              Math.floor(target.y),
              Math.floor(target.z),
              Math.max(1, Math.floor(target.range ?? 2)),
            );
            continue;
          }
        }
        if (detour.action === "blocked" || detour.action === "detour") {
          haltPathfinder(bot, configureMovements(bot));
          return fail(
            "PATH_BLOCKED",
            detour.action === "blocked"
              ? detour.reason
              : `two-block ${detour.obstacle} at ${detour.obstacleCell.x},${detour.obstacleCell.y},${detour.obstacleCell.z}; side-step did not move`,
            Date.now() - started,
            false,
            { goal: target, position: here, attempts: recoveries, obstacle: detour.obstacle, teleported: false },
          );
        }
        if (jump.obstacle) {
          const obsHeading = headingToward(here, target);
          memory.markEdgeBlocked(
            here,
            { x: Math.floor(here.x) + obsHeading.dx, y: Math.floor(here.y), z: Math.floor(here.z) + obsHeading.dz },
            jump.reason,
            jump.obstacle,
          );
        }
      }
      const avoid = new Set(
        memory.treeCells().map((cell) => `${cell.x},${cell.y},${cell.z}`),
      );
      const nearby =
        memory.aroundStanding(bot, target, 3).find((cell) => !memory.isEdgeBlocked(here, cell)) ??
        chooseStandingDestination(bot, target, 2, { avoid, minY: climbMinY(bot, target) });
      if (nearby && !memory.isEdgeBlocked(here, nearby)) {
        goal = new goals.GoalNear(Math.floor(nearby.x), Math.floor(nearby.y), Math.floor(nearby.z), Math.max(1, Math.floor(target.range ?? 2)));
        continue;
      }
    } finally {
      recoveryLock.delete(bot);
    }
    break;
  }
  const pos = bot.entity?.position;
  const here = pos ? fmt({ x: pos.x, y: pos.y, z: pos.z }) : "unknown";
  const failed =
    last ?? fail("STUCK", `stuck at ${here} heading to ${fmt(target)}`, Date.now() - started, true);
  if (failed.success) return failed;
  if (failed.code === "HAZARD_BLOCKED") {
    haltPathfinder(bot, configureMovements(bot));
    return fail(
      "HAZARD_BLOCKED",
      `${failed.error}; at ${here} heading to ${fmt(target)}; recoveries=${recoveries} obstacle=${lastObstacle}`,
      Date.now() - started,
      false,
      { goal: target, position: pos, attempts: recoveries, obstacle: lastObstacle, teleported: false },
    );
  }
  if (failed.code === "PATH_BLOCKED") {
    haltPathfinder(bot, configureMovements(bot));
    return fail(
      "PATH_BLOCKED",
      `${failed.error}; at ${here} heading to ${fmt(target)}; recoveries=${recoveries} obstacle=${lastObstacle}`,
      Date.now() - started,
      failed.retryable,
      { goal: target, position: pos, attempts: recoveries, obstacle: lastObstacle, teleported: false },
    );
  }
  if (failed.code === "NOT_CONNECTED") {
    haltPathfinder(bot, configureMovements(bot));
    return fail(
      "NOT_CONNECTED",
      `${failed.error}; at ${here} heading to ${fmt(target)}`,
      Date.now() - started,
    );
  }
  return fail(
    failed.code === "TIMEOUT" ? "TIMEOUT" : "STUCK",
    `${failed.error}; at ${here} heading to ${fmt(target)}; recoveries=${recoveries} obstacle=${lastObstacle}`,
    Date.now() - started,
    true,
  );
}

async function runGotoOnce(
  bot: Bot,
  goal: unknown,
  target: { x: number; y: number; z: number; range?: number },
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  const started = Date.now();
  pathAttempts += 1;
  if (options.signal?.aborted) return abortedResult(0);
  if (!navigationBodyReady(bot)) {
    return fail("NOT_CONNECTED", "Bot is not spawned", Date.now() - started);
  }
  const pf = configureMovements(bot);
  if (!bot.entity.onGround) {
    const grounded = await groundWaitOutcome(bot, 8, options.signal, started + options.timeoutMs);
    if (grounded !== "complete") {
      haltPathfinder(bot, pf);
      return fail(grounded === "cancelled" ? "CANCELLED" : grounded === "unavailable" ? "NOT_CONNECTED" : "TIMEOUT", "Airborne preflight interrupted", Date.now() - started, false);
    }
  }
  terrainMemory(bot).observeVisible(bot);
  const preHazard = hazardAhead(bot, target);
  if (preHazard && (preHazard.kind === "lava" || preHazard.kind === "magma" || preHazard.kind === "fire" || preHazard.kind === "fall")) {
    releaseMovementControls(bot);
    haltPathfinder(bot, pf);
    const here0 = bot.entity.position;
    const recovery = planHazardRecovery(bot, here0, target, preHazard);
    return fail(
      "HAZARD_BLOCKED",
      recovery.action === "blocked"
        ? recovery.reason
        : `${preHazard.kind} at ${preHazard.cell.x},${preHazard.cell.y},${preHazard.cell.z}; halted at ${fmt(here0)}; ${recovery.reason}`,
      Date.now() - started,
      recovery.action === "bypass",
      { goal: target, position: here0, obstacle: preHazard.name, teleported: false },
    );
  }
  let pathStatus = "running";
  let unsafePath = false;
  const originPos = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
  let lastSafe = { ...originPos };
  const stall = startStallWatch(bot, Math.max(1, options.timeoutMs - (Date.now() - started)), options.signal, () => {
    const pos = bot.entity?.position;
    if (!pos) return undefined;
    if (Math.hypot(pos.x - lastSafe.x, pos.y - lastSafe.y, pos.z - lastSafe.z) > 16) {
      return "HAZARD_BLOCKED";
    }
    lastSafe = { x: pos.x, y: pos.y, z: pos.z };
    if (cellIsUnsafeToEnter(bot, pos)) return "HAZARD_BLOCKED";
    const feetKind = classifyHazardName(bot.blockAt?.(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)))?.name);
    if (feetKind === "lava" || feetKind === "magma" || feetKind === "fire") return "HAZARD_BLOCKED";
    const below = bot.blockAt?.(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z)));
    if (classifyHazardName(below?.name) === "lava" || classifyHazardName(below?.name) === "magma") {
      return "HAZARD_BLOCKED";
    }
    if (pos.y < originPos.y - 1.6 && (target.y ?? pos.y) >= originPos.y - 0.2) {
      return "HAZARD_BLOCKED";
    }
    return undefined;
  });
  const onUpdate = (result: { status?: string; path?: unknown[] }) => {
    if (result.status) pathStatus = result.status;
    if (result.path && result.path.length > 0) stall.markPathStarted();
    if (result.path && pathContainsUnsafeCell(bot, result.path, originPos.y)) {
      unsafePath = true;
      haltPathfinder(bot, pf);
    }
  };
  const pathBot = bot as Bot & {
    on(event: "path_update", listener: (result: { status?: string }) => void): Bot;
    removeListener(event: "path_update", listener: (result: { status?: string }) => void): Bot;
  };
  pathBot.on("path_update", onUpdate);

  const abort = () => {
    haltPathfinder(bot, pf);
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  activePaths += 1;
  let gotoPromise: Promise<void> | undefined;
  try {
    gotoPromise = pf.goto(goal);
    await Promise.race([gotoPromise, stall.promise]);
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const interruption = stall.failure();
    if (interruption) throw interruption;
    if (!navigationBodyReady(bot)) throw new Error("NOT_CONNECTED");
  } catch (error) {
    abort();
    // stop() is advisory: a broken/disconnected plugin may never settle goto.
    // Observe late rejection without blocking cancellation, timeout or cleanup.
    void gotoPromise?.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const duration = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    if (unsafePath || message === "HAZARD_BLOCKED") {
      const here = bot.entity?.position;
      const inHazard = Boolean(
        here &&
          (cellIsUnsafeToEnter(bot, here) ||
            classifyHazardName(bot.blockAt?.(new Vec3Class(Math.floor(here.x), Math.floor(here.y), Math.floor(here.z)))?.name) ||
            classifyHazardName(bot.blockAt?.(new Vec3Class(Math.floor(here.x), Math.floor(here.y) - 1, Math.floor(here.z)))?.name)),
      );
      return fail(
        "HAZARD_BLOCKED",
        `path included an unverified fall or hazard cell heading to ${fmt(target)}`,
        duration,
        !inHazard,
        { goal: target, position: here },
      );
    }
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      return abortedResult(duration);
    }
    if (message === "NOT_CONNECTED" || !bot.entity?.position) {
      return fail("NOT_CONNECTED", `lost body heading to ${fmt(target)}`, duration);
    }
    const lower = message.toLowerCase();
    const end = bot.entity?.position;
    const traveled = end ? Math.hypot(end.x - originPos.x, end.y - originPos.y, end.z - originPos.z) : 0;
    if (traveled < 0.25 && message === "STUCK") {
      return fail(
        "NAV_NO_INITIAL_PROGRESS",
        `no initial progress heading to ${fmt(target)}`,
        duration,
        true,
      );
    }
    if (message === "NAV_NO_INITIAL_PROGRESS") {
      return fail(
        "NAV_NO_INITIAL_PROGRESS",
        `no initial progress heading to ${fmt(target)}`,
        duration,
        true,
      );
    }
    if (pathStatus === "noPath" || lower.includes("no path")) {
      return fail(
        "PATH_BLOCKED",
        `no walkable path to ${fmt(target)} without mining terrain`,
        duration,
        true,
      );
    }
    if (message === "STUCK") {
      pathStuck += 1;
      return fail("PATH_FAILED", `stuck heading to ${fmt(target)}`, duration, true);
    }
    if (lower.includes("timeout") || pathStatus === "timeout") {
      pathTimeout += 1;
      return fail("TIMEOUT", `moveTo timed out heading to ${fmt(target)}`, duration, true);
    }
    if (lower.includes("place") || lower.includes("scaffold")) {
      return fail("PLACE_FAILED", `placement failure heading to ${fmt(target)}: ${message}`, duration, true);
    }
    if (lower.includes("dig") || lower.includes("break")) {
      return fail("DIG_FAILED", `dig failure heading to ${fmt(target)}: ${message}`, duration, true);
    }
    if (lower.includes("stopped before")) {
      return fail("PATH_FAILED", `path interrupted heading to ${fmt(target)}`, duration, true);
    }
    return fail("PATH_FAILED", message, duration, true);
  } finally {
    stall.cancel();
    activePaths = Math.max(0, activePaths - 1);
    pathBot.removeListener("path_update", onUpdate);
    options.signal?.removeEventListener("abort", abort);
  }

  if (unsafePath) {
    haltPathfinder(bot, pf);
    const here = bot.entity?.position;
    const inHazard = Boolean(
      here &&
        (cellIsUnsafeToEnter(bot, here) ||
          classifyHazardName(bot.blockAt?.(new Vec3Class(Math.floor(here.x), Math.floor(here.y), Math.floor(here.z)))?.name) ||
          classifyHazardName(bot.blockAt?.(new Vec3Class(Math.floor(here.x), Math.floor(here.y) - 1, Math.floor(here.z)))?.name)),
    );
    return fail(
      "HAZARD_BLOCKED",
      `path included an unverified fall or hazard cell heading to ${fmt(target)}`,
      Date.now() - started,
      !inHazard,
      { goal: target, position: here },
    );
  }

  const pos = bot.entity?.position;
  if (!pos) {
    return fail("NOT_CONNECTED", "Lost body during moveTo", Date.now() - started, true);
  }
  const current = { x: pos.x, y: pos.y, z: pos.z };
  const dist = distance(current, { x: target.x, y: target.y, z: target.z });
  if (!arrivalAccepted(current, { x: target.x, y: target.y, z: target.z }, target.range ?? 2)) {
    return fail("VERIFY_FAILED", `goal unreachable; finished ${dist.toFixed(1)} from ${fmt(target)}`, Date.now() - started, true);
  }
  registerOccupancy(bot.username, current);
  pathSuccess += 1;
  return ok({ position: current, distance: dist }, Date.now() - started);
}

function startStallWatch(
  bot: Bot,
  timeoutMs: number,
  signal?: AbortSignal,
  unsafe?: () => string | undefined,
): { promise: Promise<never>; cancel: () => void; markPathStarted: () => void; failure: () => Error | undefined } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stall: ReturnType<typeof setInterval> | undefined;
  let pathStarted = false;
  let failure: Error | undefined;
  const rejectWatch = (error: Error) => { failure ??= error; rejectLost(error); };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    if (stall) clearInterval(stall);
    bot.removeListener("end", onLost);
    bot.removeListener("kicked", onLost);
    bot.removeListener("death", onLost);
    bot.removeListener("respawn", onLost);
    signal?.removeEventListener("abort", onAbort);
  };
  const onLost = () => {
    cancel();
    rejectWatch(new Error("NOT_CONNECTED"));
  };
  let rejectLost: (error: Error) => void = () => undefined;
  const onAbort = () => {
    cancel();
    rejectWatch(new DOMException("Aborted", "AbortError"));
  };
  const promise = new Promise<never>((_, reject) => {
    rejectLost = reject;
    let last = bot.entity?.position
      ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
      : undefined;
    let lastMove = Date.now();
    let progressed = false;
    timer = setTimeout(() => {
      cancel();
      rejectWatch(new Error("PATH_TIMEOUT"));
    }, timeoutMs);
    bot.once("end", onLost);
    bot.once("kicked", onLost);
    bot.once("death", onLost);
    bot.once("respawn", onLost);
    stall = setInterval(() => {
      const reason = unsafe?.();
      if (reason) {
        cancel();
        rejectWatch(new Error(reason));
        return;
      }
      const pos = bot.entity?.position;
      if (!navigationBodyReady(bot) || !pos) {
        cancel();
        rejectWatch(new Error("NOT_CONNECTED"));
        return;
      }
      if (!last) return;
      const now = { x: pos.x, y: pos.y, z: pos.z };
      if (movedEnough(last, now, 0.4)) {
        last = now;
        lastMove = Date.now();
        progressed = true;
      } else if (isMovementStall({
        activity: movementActivity(bot),
        pathStarted,
        progressed,
        msSinceMove: Date.now() - lastMove,
      }) && !recoveryLock.has(bot)) {
        cancel();
        rejectWatch(new Error(progressed ? "STUCK" : "NAV_NO_INITIAL_PROGRESS"));
      }
    }, 400);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, cancel, failure: () => failure, markPathStarted: () => { pathStarted = true; } };
}

function fmt(target: { x: number; y: number; z: number }): string {
  return `${target.x.toFixed(0)} ${target.y.toFixed(0)} ${target.z.toFixed(0)}`;
}

export async function followPlayer(
  bot: Bot,
  username: string,
  options: { range?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ActionResult<{ username: string; position: Vec3 }>> {
  const started = Date.now();
  const range = options.range ?? 3;
  const timeoutMs = options.timeoutMs ?? 45_000;
  if (options.signal?.aborted) return abortedResult(0);
  if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Bot has no active navigation body", 0);
  const entity = bot.players[username]?.entity;
  if (!entity) {
    return fail("PLAYER_NOT_FOUND", `Player ${username} is not loaded nearby`, Date.now() - started, true);
  }
  if (!navigationParametersValid(entity.position, range, timeoutMs)) return fail("INVALID_ARGUMENT", "Invalid follow target, range or timeout", 0);
  const pf = configureMovements(bot);
  const goal = new goals.GoalFollow(entity, range);
  const targetState = () => {
    if (bot.players[username]?.entity !== entity) return "ENTITY_REMOVED";
    const presence = classifyEntityPresence(bot.entities, entity);
    return presence === "PRESENT" ? undefined : presence;
  };
  const watch = startStallWatch(bot, timeoutMs, options.signal, targetState);
  const onPath = (update: { path?: unknown[] }) => { if (update.path?.length) watch.markPathStarted(); };
  const pathBot = bot as Bot & {
    on(event: "path_update", listener: (update: { path?: unknown[] }) => void): Bot;
    removeListener(event: "path_update", listener: (update: { path?: unknown[] }) => void): Bot;
  };
  pathBot.on("path_update", onPath);
  const abort = () => {
    haltPathfinder(bot, pf);
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await Promise.race([pf.goto(goal), watch.promise]);
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const interruption = watch.failure();
    if (interruption) throw interruption;
  } catch (error) {
    abort();
    const duration = Date.now() - started;
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      abort();
      return abortedResult(duration);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === "NOT_CONNECTED" || !navigationBodyReady(bot)) {
      return fail("NOT_CONNECTED", "Lost body while following", duration);
    }
    if (!bot.players[username]) {
      abort();
      return fail("ENTITY_REMOVED", entityGoneMessage("ENTITY_REMOVED", username), duration, true);
    }
    const live = bot.players[username]?.entity;
    const presence = classifyEntityPresence(bot.entities, live);
    if (presence === "TARGET_DEAD" || presence === "ENTITY_REMOVED") {
      abort();
      return fail(presence, entityGoneMessage(presence, username), duration, true);
    }
    if (message.includes("TIMEOUT")) {
      return fail("TIMEOUT", `follow ${username} timed out`, duration, true);
    }
    if (message === "STUCK" || message === "NAV_NO_INITIAL_PROGRESS") {
      return fail(message, `follow ${username} made no progress`, duration, true);
    }
    if (message.toLowerCase().includes("no path")) {
      return fail("PATH_BLOCKED", message, duration, true);
    }
    return fail("PATH_FAILED", message, duration, true);
  } finally {
    watch.cancel();
    pathBot.removeListener("path_update", onPath);
    options.signal?.removeEventListener("abort", abort);
    abort();
  }
  if (options.signal?.aborted) return abortedResult(Date.now() - started);
  const pos = bot.entity?.position;
  if (!navigationBodyReady(bot) || !pos) {
    return fail("NOT_CONNECTED", "Lost body while following", Date.now() - started, true);
  }
  const state = targetState();
  if (state) return fail(state, entityGoneMessage(state, username), Date.now() - started, true);
  if (distance(pos, entity.position) > range) {
    return fail("VERIFY_FAILED", `follow ${username} finished outside range ${range}`, Date.now() - started, true);
  }
  return ok({ username, position: { x: pos.x, y: pos.y, z: pos.z } }, Date.now() - started);
}

export function startFollowing(bot: Bot, username: string, range = 3): ActionResult<{ username: string }> {
  const started = Date.now();
  if (!navigationBodyReady(bot)) return fail("NOT_CONNECTED", "Bot has no active navigation body", 0);
  const entity = bot.players[username]?.entity;
  if (!entity) {
    return fail("PLAYER_NOT_FOUND", `Player ${username} is not loaded nearby`, Date.now() - started, true);
  }
  if (!navigationParametersValid(entity.position, range, 1)) return fail("INVALID_ARGUMENT", "Invalid follow target or range", 0);
  const presence = classifyEntityPresence(bot.entities, entity);
  if (presence !== "PRESENT") return fail(presence, entityGoneMessage(presence, username), Date.now() - started, true);
  const pf = configureMovements(bot);
  pf.setGoal(new goals.GoalFollow(entity, range), true);
  return ok({ username }, Date.now() - started);
}

export function vec3Like(x: number, y: number, z: number): Vec3Class {
  return new Vec3Class(x, y, z);
}
