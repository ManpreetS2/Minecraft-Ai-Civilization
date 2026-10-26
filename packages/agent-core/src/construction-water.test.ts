import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { standingInWater } from "./construction.js";

describe("standingInWater shelter safety", () => {
  it("detects water at feet and refuses dry land", () => {
    const cells: Record<string, { name: string }> = {
      "0,63,0": { name: "water" },
      "0,64,0": { name: "air" },
      "5,65,5": { name: "air" },
      "5,66,5": { name: "air" },
    };
    const makeBot = (x: number, y: number, z: number) =>
      ({
        entity: { position: new Vec3(x, y, z) },
        blockAt(pos: Vec3) {
          const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
          return cells[key] ?? { name: "air" };
        },
      }) as Parameters<typeof standingInWater>[0];

    expect(standingInWater(makeBot(0.5, 63, 0.5))).toBe(true);
    expect(standingInWater(makeBot(5.5, 65, 5.5))).toBe(false);
  });
});
