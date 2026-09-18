import { describe, expect, it } from "vitest";
import { cellKey, movedEnough, nearbyOffsets, recoveryAttempts, shouldBlacklistTarget, TargetBlacklist } from "./path-recovery.js";

describe("path recovery helpers", () => {
  it("detects lack of progress", () => {
    expect(movedEnough({ x: 0, y: 64, z: 0 }, { x: 0.1, y: 64, z: 0 }, 0.35)).toBe(false);
    expect(movedEnough({ x: 0, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }, 0.35)).toBe(true);
  });

  it("blacklists a cell temporarily", () => {
    const list = new TargetBlacklist();
    const tree = { x: 10.2, y: 72, z: 4.8 };
    list.mark(tree, 1000, 0);
    expect(list.has(tree, 100)).toBe(true);
    expect(list.has(tree, 2000)).toBe(false);
  });

  it("offers adjacent fallback offsets", () => {
    const offsets = nearbyOffsets(1);
    expect(offsets.length).toBe(8);
    expect(cellKey({ x: 1.4, y: 70, z: 1.4 })).toBe("1,70,1");
  });

  it("builds a short recovery sequence and blacklists failed movement codes", () => {
    const attempts = recoveryAttempts({ x: 10, y: 70, z: 4 }, 2, 3);
    expect(attempts[0]).toEqual({ x: 10, y: 70, z: 4, range: 2 });
    expect(attempts[1]?.range).toBeGreaterThan(2);
    expect(attempts.some((attempt) => attempt.y === 71)).toBe(true);
    expect(attempts.some((attempt) => attempt.y === 69)).toBe(true);
    expect(attempts.length).toBeGreaterThan(5);
    expect(shouldBlacklistTarget("TIMEOUT")).toBe(true);
    expect(shouldBlacklistTarget("NAV_NO_INITIAL_PROGRESS")).toBe(true);
    expect(shouldBlacklistTarget("BLOCK_NOT_FOUND")).toBe(false);
  });
});
