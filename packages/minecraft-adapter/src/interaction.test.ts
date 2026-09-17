import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { findReachableInteractionPosition, interactionCandidates, isWalkableStanding } from "./interaction.js";

function fakeBot(
  cells: Record<string, { name: string; boundingBox: string }>,
  origin = { x: 0.5, y: 64, z: 0.5 },
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

function grassPadWithLog(): Record<string, { name: string; boundingBox: string }> {
  const cells: Record<string, { name: string; boundingBox: string }> = {};
  for (let x = 0; x <= 8; x += 1) {
    for (let z = 0; z <= 8; z += 1) {
      cells[`${x},63,${z}`] = { name: "grass_block", boundingBox: "block" };
      cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty" };
      cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty" };
    }
  }
  cells["5,64,5"] = { name: "oak_log", boundingBox: "block" };
  cells["5,65,5"] = { name: "oak_log", boundingBox: "block" };
  return cells;
}

describe("interaction standing cells", () => {
  it("never treats the target block cell as the standing cell", () => {
    const bot = fakeBot(grassPadWithLog());
    const target = { x: 5, y: 64, z: 5 };
    expect(isWalkableStanding(bot, target)).toBe(false);
    const standing = findReachableInteractionPosition(bot, target);
    expect(standing).toBeDefined();
    expect(standing).not.toEqual(target);
    expect(standing?.x === target.x && standing?.z === target.z).toBe(false);
    const candidates = interactionCandidates(bot, target);
    expect(candidates.every((cell) => !(cell.x === target.x && cell.y === target.y && cell.z === target.z))).toBe(true);
  });
});
