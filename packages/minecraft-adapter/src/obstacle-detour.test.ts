import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { terrainMemory } from "./terrain-memory.js";
import {
  isObservedTwoBlockObstacle,
  observedStepExclusion,
  planTwoBlockDetour,
  segmentHitsColumn,
  twoBlockRecovery,
} from "./obstacle-detour.js";
import { evaluateStepJump, isTwoBlockObstruction } from "./step-jump.js";

type Cell = { name: string; boundingBox: string };

function fakeBot(cells: Record<string, Cell>, origin = { x: 5.5, y: 64, z: 5.5 }): Bot {
  return {
    username: "HomeProbe",
    entity: { position: { ...origin }, onGround: true, yaw: 0, pitch: 0 },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      const cell = cells[key] ?? { name: "air", boundingBox: "empty" };
      return { ...cell, getProperties: () => ({}) };
    },
    lookAt: async () => undefined,
    waitForTicks: async () => undefined,
    setControlState: () => undefined,
    getControlState: () => false,
    clearControlStates: () => undefined,
  } as unknown as Bot;
}

function grass(): Record<string, Cell> {
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

describe("two-block oak_log detour", () => {
  it("does not jump a two-block trunk and plans a same-Y side cell that does not clip the log", () => {
    const cells = grass();
    cells["6,64,5"] = { name: "oak_log", boundingBox: "block" };
    cells["6,65,5"] = { name: "oak_log", boundingBox: "block" };
    const bot = fakeBot(cells, { x: 5.5, y: 64, z: 5.5 });
    const jump = evaluateStepJump(bot, { x: 8, y: 64, z: 5 });
    expect(jump.ok).toBe(false);
    expect(isTwoBlockObstruction(jump)).toBe(true);
    const memory = terrainMemory(bot);
    memory.observeVisible(bot, 3);
    expect(isObservedTwoBlockObstacle(memory, { x: 6, y: 64, z: 5 })).toBe(true);
    expect(observedStepExclusion(bot, { position: { x: 6, y: 64, z: 5 } })).toBe(0);
    const sides = planTwoBlockDetour(bot, { x: 5.5, y: 64, z: 5.5 }, { dx: 1, dz: 0 }, memory);
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.some((cell) => cell.z === 4 || cell.z === 6)).toBe(true);
    expect(sides.every((cell) => cell.x !== 6 || cell.z !== 5)).toBe(true);
    expect(sides.every((cell) => !segmentHitsColumn({ x: 5.5, y: 64, z: 5.5 }, cell, { x: 6, y: 64, z: 5 }))).toBe(true);
    const recovery = twoBlockRecovery(bot, { x: 8, y: 64, z: 5 }, memory);
    expect(recovery.action).toBe("detour");
    if (recovery.action === "detour") {
      expect(recovery.obstacle).toBe("oak_log");
      expect(recovery.obstacleCell).toEqual({ x: 6, y: 64, z: 5 });
    }
    expect(memory.isEdgeBlocked({ x: 5.5, y: 64, z: 5.5 }, { x: 6, y: 64, z: 5 })).toBe(true);
    expect(observedStepExclusion(bot, { position: { x: 6, y: 64, z: 5 } })).toBe(100);
    expect(observedStepExclusion(bot, { position: { x: 7, y: 64, z: 5 } })).toBe(0);
  });

  it("returns a bounded PATH_BLOCKED plan when both sides are walled in", () => {
    const cells = grass();
    cells["6,64,5"] = { name: "oak_log", boundingBox: "block" };
    cells["6,65,5"] = { name: "oak_log", boundingBox: "block" };
    cells["5,64,4"] = { name: "stone", boundingBox: "block" };
    cells["5,65,4"] = { name: "stone", boundingBox: "block" };
    cells["5,64,6"] = { name: "stone", boundingBox: "block" };
    cells["5,65,6"] = { name: "stone", boundingBox: "block" };
    const bot = fakeBot(cells);
    const memory = terrainMemory(bot);
    memory.observeVisible(bot, 3);
    const recovery = twoBlockRecovery(bot, { x: 8, y: 64, z: 5 }, memory);
    expect(recovery.action).toBe("blocked");
    if (recovery.action === "blocked") {
      expect(recovery.reason).toMatch(/no verified around/);
      expect(recovery.obstacle).toBe("oak_log");
    }
    expect(planTwoBlockDetour(bot, { x: 5.5, y: 64, z: 5.5 }, { dx: 1, dz: 0 }, memory)).toEqual([]);
  });

  it("does not treat a verified one-block dirt hop as a two-block detour", () => {
    const cells = grass();
    cells["6,64,5"] = { name: "dirt", boundingBox: "block" };
    const bot = fakeBot(cells);
    const memory = terrainMemory(bot);
    memory.observeVisible(bot, 2);
    expect(isObservedTwoBlockObstacle(memory, { x: 6, y: 64, z: 5 })).toBe(false);
    expect(observedStepExclusion(bot, { position: { x: 6, y: 64, z: 5 } })).toBe(0);
    expect(twoBlockRecovery(bot, { x: 8, y: 65, z: 5 }, memory).action).toBe("none");
    const hop = evaluateStepJump(bot, { x: 8, y: 65, z: 5 });
    expect(hop.ok).toBe(true);
    expect(isTwoBlockObstruction(hop)).toBe(false);
  });
});
