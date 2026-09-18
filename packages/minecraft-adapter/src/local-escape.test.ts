import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import {
  chooseStandingDestination,
  inspectLocalTerrain,
  localEscapeCells,
} from "./local-escape.js";
import { isWalkableStanding } from "./interaction.js";

function fakeBot(
  cells: Record<string, { name: string; boundingBox: string }>,
  origin = { x: 5.5, y: 64, z: 5.5 },
): Bot {
  return {
    username: "MechProbe",
    entity: { position: origin },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      return cells[key] ?? { name: "air", boundingBox: "empty" };
    },
  } as unknown as Bot;
}

function pitWithRim(): Record<string, { name: string; boundingBox: string }> {
  const cells: Record<string, { name: string; boundingBox: string }> = {};
  for (let x = 0; x <= 10; x += 1) {
    for (let z = 0; z <= 10; z += 1) {
      cells[`${x},63,${z}`] = { name: "grass_block", boundingBox: "block" };
      cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty" };
      cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty" };
      cells[`${x},66,${z}`] = { name: "air", boundingBox: "empty" };
    }
  }
  cells["5,63,5"] = { name: "dirt", boundingBox: "block" };
  for (const [x, z] of [
    [4, 5],
    [6, 5],
    [5, 4],
    [5, 6],
    [4, 4],
    [4, 6],
    [6, 4],
    [6, 6],
  ]) {
    cells[`${x},64,${z}`] = { name: "dirt", boundingBox: "block" };
  }
  return cells;
}

describe("local terrain classification", () => {
  it("classifies a 1-block walled pit with a jump-out rim", () => {
    const bot = fakeBot(pitWithRim());
    const report = inspectLocalTerrain(bot);
    expect(report?.kind).toBe("walled_pit");
    expect(report?.walkableSameY.length).toBe(0);
    expect(report?.walkableUp.length).toBeGreaterThan(0);
    const rim = localEscapeCells(bot)[0];
    expect(rim?.y).toBe(65);
    expect(isWalkableStanding(bot, rim!)).toBe(true);
  });

  it("classifies open grass as open", () => {
    const cells: Record<string, { name: string; boundingBox: string }> = {};
    for (let x = 0; x <= 10; x += 1) {
      for (let z = 0; z <= 10; z += 1) {
        cells[`${x},63,${z}`] = { name: "grass_block", boundingBox: "block" };
        cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty" };
        cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty" };
      }
    }
    const bot = fakeBot(cells);
    expect(inspectLocalTerrain(bot)?.kind).toBe("open");
  });

  it("classifies feet inside a solid as clipped", () => {
    const cells = pitWithRim();
    cells["5,64,5"] = { name: "dirt", boundingBox: "block" };
    const bot = fakeBot(cells);
    expect(inspectLocalTerrain(bot)?.kind).toBe("clipped");
  });

  it("prefers same-Y step-out cells before jump-up rims", () => {
    const cells = pitWithRim();
    cells["4,64,5"] = { name: "oak_slab", boundingBox: "block" };
    const bot = fakeBot(cells);
    expect(inspectLocalTerrain(bot)?.walkableSameY.length).toBeGreaterThan(0);
    const first = localEscapeCells(bot)[0];
    expect(first?.y).toBe(64);
    expect(first?.x).toBe(4);
  });

  it("picks a walkable standing cell instead of a solid target", () => {
    const bot = fakeBot(pitWithRim());
    const dest = chooseStandingDestination(bot, { x: 4, y: 64, z: 5 });
    expect(dest).toBeDefined();
    expect(dest && dest.x === 4 && dest.y === 64 && dest.z === 5).toBe(false);
    expect(isWalkableStanding(bot, dest!)).toBe(true);
  });
});
