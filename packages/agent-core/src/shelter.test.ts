import { describe, expect, it } from "vitest";
import { classifyShelter, interiorStandingCells, isInsideShelter } from "./shelter.js";

describe("shelter standing cells", () => {
  it("does not treat standing near the origin as a finished interior", () => {
    const origin = { x: 10, y: 64, z: 10 };
    expect(isInsideShelter({ x: 10.1, y: 64, z: 10.1 }, origin)).toBe(false);
    expect(isInsideShelter({ x: 12.2, y: 65, z: 11.4 }, origin)).toBe(true);
    expect(classifyShelter({ origin, position: { x: 10.1, y: 64, z: 10.1 }, reachable: true })).toBe("reachable");
    expect(classifyShelter({ origin, position: { x: 12.2, y: 65, z: 11.4 }, hostilesNearby: false })).toBe("safe");
    expect(interiorStandingCells(origin).length).toBeGreaterThan(0);
  });
});
