import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import {
  arrivalAccepted,
  attemptStepJump,
  evaluateStepJump,
  inspectAdjacentDoor,
  isMovementStall,
  jumpProgressed,
  jumpApproachTicks,
  landingVerified,
  movementActivity,
  needsJumpRunUp,
  releaseMovementControls,
  stallRecoveryBudget,
  STEP_JUMP_LIMITS,
  tryOpenAdjacentDoor,
} from "./step-jump.js";

type Cell = { name: string; boundingBox: string; open?: boolean };

function fakeBot(
  cells: Record<string, Cell>,
  origin = { x: 5.5, y: 64, z: 5.5 },
  extra: Partial<Bot> = {},
): Bot {
  const controls: Record<string, boolean> = {};
  return {
    username: "MechProbe",
    isSleeping: false,
    currentWindow: null,
    entity: { position: { ...origin }, onGround: true, yaw: 0, pitch: 0 },
    pathfinder: { goal: { x: 10, y: 64, z: 5 } },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      const cell = cells[key] ?? { name: "air", boundingBox: "empty" };
      return {
        ...cell,
        position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), offset: (x: number, y: number, z: number) => ({ x: Math.floor(pos.x) + x, y: Math.floor(pos.y) + y, z: Math.floor(pos.z) + z }) },
        getProperties: () => ({ open: Boolean(cell.open) }),
      };
    },
    setControlState(name: string, value: boolean) {
      controls[name] = value;
    },
    getControlState(name: string) {
      return Boolean(controls[name]);
    },
    clearControlStates() {
      for (const key of Object.keys(controls)) controls[key] = false;
    },
    lookAt: async () => undefined,
    waitForTicks: async () => undefined,
    activateBlock: async () => {
      const controls = (extra as { _activated?: string[] })._activated;
      if (controls) controls.push("door");
    },
    supportFeature: () => false,
    _controls: controls,
    ...extra,
  } as unknown as Bot;
}

function openGrass(): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (let x = 0; x <= 12; x += 1) {
    for (let z = 0; z <= 12; z += 1) {
      cells[`${x},63,${z}`] = { name: "grass_block", boundingBox: "block" };
      cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty" };
      cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty" };
      cells[`${x},66,${z}`] = { name: "air", boundingBox: "empty" };
    }
  }
  return cells;
}

describe("one-block step jump eligibility", () => {
  it("allows a normal one-block ascent onto solid footing with two-block headroom", () => {
    const cells = openGrass();
    cells["6,64,5"] = { name: "dirt", boundingBox: "block" };
    cells["6,65,5"] = { name: "air", boundingBox: "empty" };
    cells["6,66,5"] = { name: "air", boundingBox: "empty" };
    const bot = fakeBot(cells);
    const decision = evaluateStepJump(bot, { x: 8, y: 65, z: 5 });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.landing).toEqual({ x: 6, y: 65, z: 5 });
      expect(decision.obstacle).toBe("dirt");
      expect(decision.heading).toEqual({ dx: 1, dz: 0 });
    }
  });

  it("refuses when takeoff has no two-block headroom", () => {
    const cells = openGrass();
    cells["5,66,5"] = { name: "oak_planks", boundingBox: "block" };
    cells["6,64,5"] = { name: "dirt", boundingBox: "block" };
    cells["6,65,5"] = { name: "air", boundingBox: "empty" };
    cells["6,66,5"] = { name: "air", boundingBox: "empty" };
    const bot = fakeBot(cells);
    const decision = evaluateStepJump(bot, { x: 8, y: 65, z: 5 });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/headroom at takeoff/);
  });

  it("refuses water at the feet", () => {
    const cells = openGrass();
    cells["5,64,5"] = { name: "water", boundingBox: "empty" };
    cells["6,64,5"] = { name: "dirt", boundingBox: "block" };
    const bot = fakeBot(cells);
    const decision = evaluateStepJump(bot);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/water/);
  });

  it("refuses a cliff with no solid landing", () => {
    const cells = openGrass();
    cells["6,63,5"] = { name: "air", boundingBox: "empty" };
    cells["6,64,5"] = { name: "air", boundingBox: "empty" };
    const bot = fakeBot(cells, { x: 5.5, y: 64, z: 5.5 });
    const decision = evaluateStepJump(bot, { x: 8, y: 64, z: 5 });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/obstacle|cliff|unsafe|no one-block/i);
  });

  it("refuses fences and closed doors instead of jumping them", () => {
    const cells = openGrass();
    cells["6,64,5"] = { name: "oak_fence", boundingBox: "block" };
    cells["6,65,5"] = { name: "oak_fence", boundingBox: "block" };
    const fenceBot = fakeBot(cells);
    const fence = evaluateStepJump(fenceBot, { x: 8, y: 64, z: 5 });
    expect(fence.ok).toBe(false);
    if (!fence.ok) expect(fence.reason).toMatch(/fence/);

    const doorCells = openGrass();
    doorCells["6,64,5"] = { name: "oak_door", boundingBox: "block" };
    doorCells["6,65,5"] = { name: "oak_door", boundingBox: "block" };
    const door = evaluateStepJump(fakeBot(doorCells), { x: 8, y: 64, z: 5 });
    expect(door.ok).toBe(false);
    if (!door.ok) expect(door.reason).toMatch(/door/);
  });
});

describe("stall detection", () => {
  it("detects a stall only while pathing with an active goal and no progress", () => {
    expect(
      isMovementStall({ activity: "pathing", pathStarted: true, progressed: true, msSinceMove: 1_000 }),
    ).toBe(true);
    expect(
      isMovementStall({ activity: "pathing", pathStarted: true, progressed: true, msSinceMove: 900 }),
    ).toBe(false);
    expect(
      isMovementStall({ activity: "pathing", pathStarted: true, progressed: false, msSinceMove: 1_200 }),
    ).toBe(false);
    expect(
      isMovementStall({ activity: "pathing", pathStarted: true, progressed: false, msSinceMove: 1_500 }),
    ).toBe(true);
    expect(
      isMovementStall({ activity: "sleeping", pathStarted: true, progressed: true, msSinceMove: 8_000 }),
    ).toBe(false);
    expect(
      isMovementStall({ activity: "container", pathStarted: true, progressed: true, msSinceMove: 8_000 }),
    ).toBe(false);
    expect(
      isMovementStall({ activity: "idle", pathStarted: false, progressed: false, msSinceMove: 8_000 }),
    ).toBe(false);
    expect(
      isMovementStall({ activity: "loading", pathStarted: true, progressed: false, msSinceMove: 8_000 }),
    ).toBe(false);
    expect(
      isMovementStall({ activity: "pathing", pathStarted: false, progressed: false, msSinceMove: 8_000 }),
    ).toBe(false);
    expect(
      isMovementStall({ activity: "busy", pathStarted: true, progressed: true, msSinceMove: 8_000 }),
    ).toBe(false);
  });

  it("classifies sleep, chest, loading and idle separately from pathing", () => {
    const cells = openGrass();
    expect(movementActivity(fakeBot(cells))).toBe("pathing");
    expect(movementActivity(fakeBot(cells, undefined, { isSleeping: true } as Partial<Bot>))).toBe("sleeping");
    expect(
      movementActivity(fakeBot(cells, undefined, { currentWindow: { id: 1 } } as unknown as Partial<Bot>)),
    ).toBe("container");
    const idle = fakeBot(cells);
    (idle as unknown as { pathfinder: { goal: unknown } }).pathfinder.goal = undefined;
    expect(movementActivity(idle)).toBe("idle");
  });
});

describe("retry exhaustion and cancellation cleanup", () => {
  it("keeps stall recovery counts bounded", () => {
    expect(STEP_JUMP_LIMITS.maxRecoveries).toBe(2);
    expect(STEP_JUMP_LIMITS.jumpTicks).toBeLessThanOrEqual(3);
    expect(stallRecoveryBudget(0)).toBe(true);
    expect(stallRecoveryBudget(1)).toBe(true);
    expect(stallRecoveryBudget(2)).toBe(false);
  });

  it("does not treat a same-cell Y-miss as arriving on the one-block rise", () => {
    expect(arrivalAccepted({ x: 200.7, y: 67, z: 400.4 }, { x: 201.5, y: 68, z: 400.5 }, 1.2)).toBe(false);
    expect(arrivalAccepted({ x: 200.7, y: 67, z: 400.5 }, { x: 201.5, y: 68, z: 400.5 }, 4)).toBe(false);
    expect(arrivalAccepted({ x: 201.5, y: 68, z: 400.5 }, { x: 201.5, y: 68, z: 400.5 }, 1.2)).toBe(true);
    expect(arrivalAccepted({ x: 10.5, y: 64, z: 10.5 }, { x: 12.5, y: 64, z: 10.5 }, 2)).toBe(true);
    expect(arrivalAccepted({ x: 202.7, y: 67, z: 400.5 }, { x: 204.5, y: 67, z: 400.5 }, 0.9)).toBe(false);
  });

  it("jumps immediately when already at the step face instead of walking into it", () => {
    expect(jumpApproachTicks(0.5)).toBe(0);
    expect(jumpApproachTicks(0.4)).toBe(0);
    expect(jumpApproachTicks(0.7)).toBe(1);
    expect(jumpApproachTicks(1.1)).toBe(2);
  });

  it("backs up when already pressed against the step face", () => {
    expect(needsJumpRunUp({ x: 200.7, y: 67, z: 400.5 }, { x: 201, y: 68, z: 400 }, { dx: 1, dz: 0 })).toBe(true);
    expect(needsJumpRunUp({ x: 200.4, y: 67, z: 400.5 }, { x: 201, y: 68, z: 400 }, { dx: 1, dz: 0 })).toBe(false);
  });

  it("verifies landing on the raised cell, not an in-place hop", () => {
    expect(landingVerified({ x: 200.7, y: 67.3, z: 400.4 }, { x: 201, y: 68, z: 400 })).toBe(false);
    expect(landingVerified({ x: 201.4, y: 68, z: 400.5 }, { x: 201, y: 68, z: 400 })).toBe(true);
    expect(jumpProgressed({ x: 200.5, y: 67, z: 400.5 }, { x: 201.5, y: 68, z: 400.5 }, { x: 201, y: 68, z: 400 })).toBe(true);
    expect(jumpProgressed({ x: 200.5, y: 67, z: 400.5 }, { x: 200.7, y: 67, z: 400.4 }, { x: 201, y: 68, z: 400 })).toBe(false);
  });

  it("releases jump and forward on cancel before the hop", async () => {
    const bot = fakeBot(openGrass());
    const signal = AbortSignal.abort();
    const result = await attemptStepJump(bot, { x: 6, y: 65, z: 5 }, signal);
    expect(result.hopped).toBe(false);
    expect(result.landed).toBe(false);
    const controls = (bot as unknown as { _controls: Record<string, boolean> })._controls;
    expect(controls.jump).toBe(false);
    expect(controls.forward).toBe(false);
  });

  it("clears jump and forward when releaseMovementControls runs", () => {
    const bot = fakeBot(openGrass());
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    bot.setControlState("sprint", true);
    releaseMovementControls(bot);
    const controls = (bot as unknown as { _controls: Record<string, boolean> })._controls;
    expect(controls.jump).toBe(false);
    expect(controls.forward).toBe(false);
    expect(controls.sprint).toBe(false);
  });
});

describe("doors and two-block trunks", () => {
  it("passes an already-open door without toggling it closed", async () => {
    const cells = openGrass();
    cells["6,64,5"] = { name: "oak_door", boundingBox: "block", open: true };
    cells["6,65,5"] = { name: "oak_door", boundingBox: "block", open: true };
    const activated: string[] = [];
    const bot = fakeBot(cells, undefined, { _activated: activated } as unknown as Partial<Bot>);
    const seen = inspectAdjacentDoor(bot);
    expect(seen?.open).toBe(true);
    const result = await tryOpenAdjacentDoor(bot);
    expect(result.handled).toBe(true);
    expect(result.toggled).toBe(false);
    expect(activated).toEqual([]);
  });

  it("opens a closed wooden door once when blocked", async () => {
    const cells = openGrass();
    cells["6,64,5"] = { name: "oak_door", boundingBox: "block", open: false };
    cells["6,65,5"] = { name: "oak_door", boundingBox: "block", open: false };
    let toggles = 0;
    const bot = fakeBot(cells);
    bot.activateBlock = async () => {
      toggles += 1;
      cells["6,64,5"].open = true;
      cells["6,65,5"].open = true;
    };
    const result = await tryOpenAdjacentDoor(bot);
    expect(result.handled).toBe(true);
    expect(result.toggled).toBe(true);
    expect(toggles).toBe(1);
    expect(evaluateStepJump(bot, { x: 8, y: 64, z: 5 }).ok).toBe(false);
  });

  it("refuses a two-block tree trunk as a jump", () => {
    const cells = openGrass();
    cells["6,64,5"] = { name: "oak_log", boundingBox: "block" };
    cells["6,65,5"] = { name: "oak_log", boundingBox: "block" };
    cells["6,66,5"] = { name: "oak_leaves", boundingBox: "block" };
    const decision = evaluateStepJump(fakeBot(cells), { x: 8, y: 64, z: 5 });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/taller than one block/);
  });
});
