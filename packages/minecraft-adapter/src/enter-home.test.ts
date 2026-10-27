import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { alreadyInsideClaimedHome, atClaimedEntrance, shouldSkipInteriorApproach, tryOpenAdjacentDoor } from "./index.js";

describe("claimed-home entry", () => {
  it("treats the interior stand as inside and the doorway as entrance-only", () => {
    const interior = { x: -1095.5, y: 69, z: 730.5 };
    const entrance = { x: -1095.5, y: 69, z: 732.5 };
    const inside = { x: -1095.5, y: 69, z: 730.2 };
    const stoop = { x: -1095.5, y: 69, z: 732.3 };
    expect(alreadyInsideClaimedHome(inside, interior)).toBe(true);
    expect(atClaimedEntrance(stoop, entrance, interior)).toBe(true);
    expect(atClaimedEntrance(inside, entrance, interior)).toBe(false);
    expect(shouldSkipInteriorApproach(inside, interior, entrance)).toBe(true);
    expect(shouldSkipInteriorApproach(stoop, interior, entrance)).toBe(false);
  });

  it("does not toggle an already-open wooden door", async () => {
    const activated: string[] = [];
    const bot = {
      entity: { position: { x: -1095.5, y: 69, z: 732.3 }, yaw: 0, pitch: 0, onGround: true },
      blockAt(pos: { x: number; y: number; z: number }) {
        if (Math.floor(pos.x) === -1096 && Math.floor(pos.z) === 731) {
          return {
            name: "oak_door",
            boundingBox: "empty",
            position: { x: -1096, y: 69, z: 731, offset: (x: number, y: number, z: number) => ({ x: -1096 + x, y: 69 + y, z: 731 + z }) },
            getProperties: () => ({ open: true, facing: "south", hinge: "left", half: "lower" }),
          };
        }
        return {
          name: pos.y < 69 ? "oak_planks" : "air",
          boundingBox: pos.y < 69 ? "block" : "empty",
          position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), offset: (dx: number, dy: number, dz: number) => ({ x: Math.floor(pos.x) + dx, y: Math.floor(pos.y) + dy, z: Math.floor(pos.z) + dz }) },
          getProperties: () => ({}),
        };
      },
      lookAt: async () => undefined,
      waitForTicks: async () => undefined,
      activateBlock: async () => {
        activated.push("door");
      },
    } as unknown as Bot;
    const door = await tryOpenAdjacentDoor(bot);
    expect(door.handled).toBe(true);
    expect(door.open).toBe(true);
    expect(door.toggled).toBe(false);
    expect(activated).toEqual([]);
  });
});
