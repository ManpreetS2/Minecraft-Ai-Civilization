import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { MineflayerPathfinderBackend } from "./navigation.js";

function closeBot(origin = { x: 5.5, y: 64, z: 5.5 }): Bot {
  return {
    username: "MechProbe",
    entity: { position: origin, eyeHeight: 1.62 },
    blockAt() {
      return { name: "air", boundingBox: "empty" };
    },
  } as unknown as Bot;
}

describe("interact navigation contracts", () => {
  it("returns a typed success when the bot is already within interact range", async () => {
    const backend = new MineflayerPathfinderBackend();
    const result = await backend.navigateToInteractWithBlock(closeBot(), { x: 5, y: 64, z: 5 });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("already-in-reach interact should succeed");
    expect(result.durationMs).toBe(0);
    expect(result.data.position).toEqual({ x: 5.5, y: 64, z: 5.5 });
    expect(result.data.distance).toBeLessThanOrEqual(4.5);
  });

  it("does not treat an unspawned body as already in reach", async () => {
    const backend = new MineflayerPathfinderBackend();
    const bot = { username: "MechProbe", entity: undefined, blockAt: () => null } as unknown as Bot;
    const result = await backend.navigateToInteractWithBlock(bot, { x: 5, y: 64, z: 5 }, { timeoutMs: 1 });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unspawned interact should fail");
    expect(result.code === "NO_INTERACTION_POSITION" || result.code === "VERIFY_FAILED").toBe(true);
  });
});
