import { describe, expect, it } from "vitest";
import { evaluateSite } from "./site.js";

describe("construction site selection", () => {
  it("rejects water, chests, and village-like footprints", () => {
    const origin = { x: 0, y: 64, z: 0 };
    const wet = evaluateSite(origin, 5, 5, (pos) => (pos.x === 0 ? "water" : "grass_block"));
    expect(wet.ok).toBe(false);
    const chest = evaluateSite(origin, 5, 5, (pos) => (pos.x === 1 && pos.z === 1 ? "chest" : "grass_block"));
    expect(chest.ok).toBe(false);
    const village = evaluateSite(origin, 5, 5, (pos) => {
      if (pos.x === 0 && pos.z === 0) return "bell";
      if (pos.x === 1 && pos.z === 0) return "composter";
      if (pos.x === 2 && pos.z === 0) return "oak_stairs";
      return "grass_block";
    });
    expect(village.ok).toBe(false);
  });

  it("accepts a flat grassy patch", () => {
    const origin = { x: 20, y: 70, z: 20 };
    const result = evaluateSite(origin, 5, 5, (pos) => (pos.y === 69 ? "grass_block" : "air"));
    expect(result.ok).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });
});
