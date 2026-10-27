import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { LocalTerrainMemory, isTreePart } from "./terrain-memory.js";
import { chooseStandingDestination } from "./local-escape.js";

function fakeBot(
  cells: Record<string, { name: string; boundingBox: string }>,
  origin = { x: 5.5, y: 64, z: 5.5 },
): Bot {
  return {
    username: "MechProbe",
    entity: { position: origin },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      const cell = cells[key] ?? { name: "air", boundingBox: "empty" };
      return { ...cell, getProperties: () => ({}) };
    },
  } as unknown as Bot;
}

function grass(): Record<string, { name: string; boundingBox: string }> {
  const cells: Record<string, { name: string; boundingBox: string }> = {};
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

describe("local terrain memory", () => {
  it("records only loaded observable cells and names tree trunks/leaves by coordinate", () => {
    const cells = grass();
    cells["6,64,5"] = { name: "oak_log", boundingBox: "block" };
    cells["6,65,5"] = { name: "oak_log", boundingBox: "block" };
    cells["6,66,5"] = { name: "oak_leaves", boundingBox: "block" };
    const memory = new LocalTerrainMemory();
    const seen = memory.observeVisible(fakeBot(cells), 2);
    expect(seen.some((cell) => cell.x === 6 && cell.y === 64 && cell.z === 5 && cell.name === "oak_log")).toBe(true);
    expect(memory.treeCells().every((cell) => isTreePart(cell.name))).toBe(true);
    expect(memory.get({ x: 99, y: 64, z: 99 })).toBeUndefined();
  });

  it("remembers a failed edge and replans around it instead of retrying the same route", () => {
    const cells = grass();
    cells["6,64,5"] = { name: "oak_log", boundingBox: "block" };
    cells["6,65,5"] = { name: "oak_log", boundingBox: "block" };
    const bot = fakeBot(cells);
    const memory = new LocalTerrainMemory();
    memory.observeVisible(bot, 3);
    memory.markEdgeBlocked({ x: 5, y: 64, z: 5 }, { x: 6, y: 64, z: 5 }, "taller than one block", "oak_log");
    expect(memory.isEdgeBlocked({ x: 5, y: 64, z: 5 }, { x: 6, y: 64, z: 5 })).toBe(true);
    const around = memory.aroundStanding(bot, { x: 8, y: 64, z: 5 }, 3);
    expect(around.some((cell) => cell.x === 6 && cell.z === 5)).toBe(false);
    expect(around.some((cell) => cell.z === 4 || cell.z === 6)).toBe(true);
    memory.invalidateAt({ x: 6, y: 64, z: 5 });
    expect(memory.isEdgeBlocked({ x: 5, y: 64, z: 5 }, { x: 6, y: 64, z: 5 })).toBe(false);
  });

  it("prefers the actual one-block landing over a same-Y walk-around cell", () => {
    const cells = grass();
    cells["6,64,5"] = { name: "dirt", boundingBox: "block" };
    const bot = fakeBot(cells);
    const dest = chooseStandingDestination(bot, { x: 6, y: 65, z: 5 }, 3, { minY: 65 });
    expect(dest).toEqual({ x: 6, y: 65, z: 5 });
  });
});
