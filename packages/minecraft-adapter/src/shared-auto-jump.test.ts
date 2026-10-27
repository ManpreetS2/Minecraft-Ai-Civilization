import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { CITIZEN_NAMES } from "@civ/shared";
import { evaluateStepJump, jumpApproachTicks, STEP_JUMP_LIMITS } from "./step-jump.js";
import { navigationBackend } from "./navigation.js";
import { citizenInheritsSharedAutoJump, sharedAutoJumpPolicy, SHARED_AUTO_JUMP } from "./shared-auto-jump.js";
import { movementAllowsDig } from "./pathing.js";

type Cell = { name: string; boundingBox: string };

function fakeBot(username: string, cells: Record<string, Cell>, origin = { x: 5.5, y: 64, z: 5.5 }): Bot {
  return {
    username,
    entity: { position: { ...origin }, onGround: true, yaw: 0, pitch: 0 },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      const cell = cells[key] ?? { name: "air", boundingBox: "empty" };
      return { ...cell, getProperties: () => ({}) };
    },
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

describe("shared auto-jump for five citizen bodies", () => {
  it("enables the same verified one-block hop through the common navigator for Atlas, Maya, Theo, Ava and Kai", () => {
    const policy = sharedAutoJumpPolicy();
    expect(policy.enabled).toBe(true);
    expect(policy.humanClientSettingAffectsBots).toBe(false);
    expect(policy.navigator).toBe("mineflayer-pathfinder");
    expect(policy.maxApproachTicks).toBe(2);
    expect(policy.maxJumpAttempts).toBe(2);
    expect(policy.maxRecoveries).toBe(2);
    expect(policy.approachAtFaceTicks).toBe(0);
    expect(policy.recoverByDefault).toBe(true);
    expect(policy.citizens).toEqual(["Atlas", "Maya", "Theo", "Ava", "Kai"]);
    expect(jumpApproachTicks(0.5)).toBe(0);
    expect(STEP_JUMP_LIMITS.maxJumpAttempts).toBeLessThanOrEqual(2);
    expect(navigationBackend().name).toBe(SHARED_AUTO_JUMP.navigator);

    const oneBlock = grass();
    oneBlock["6,64,5"] = { name: "dirt", boundingBox: "block" };
    oneBlock["6,65,5"] = { name: "air", boundingBox: "empty" };
    oneBlock["6,66,5"] = { name: "air", boundingBox: "empty" };
    const twoBlock = grass();
    twoBlock["6,64,5"] = { name: "oak_log", boundingBox: "block" };
    twoBlock["6,65,5"] = { name: "oak_log", boundingBox: "block" };

    expect(CITIZEN_NAMES).toHaveLength(5);
    for (const name of CITIZEN_NAMES) {
      expect(citizenInheritsSharedAutoJump(name, navigationBackend().name)).toBe(true);
      const hop = evaluateStepJump(fakeBot(name, oneBlock), { x: 8, y: 65, z: 5 });
      expect(hop.ok).toBe(true);
      const trunk = evaluateStepJump(fakeBot(name, twoBlock), { x: 8, y: 64, z: 5 });
      expect(trunk.ok).toBe(false);
      if (!trunk.ok) expect(trunk.reason).toMatch(/taller than one block/);
    }
    expect(citizenInheritsSharedAutoJump("HomeProbe", navigationBackend().name)).toBe(false);
    expect(movementAllowsDig("SAFE_NAVIGATION")).toBe(false);
    expect(movementAllowsDig("RESOURCE_APPROACH")).toBe(false);
  });
});
