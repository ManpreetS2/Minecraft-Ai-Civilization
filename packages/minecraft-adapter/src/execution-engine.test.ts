import { describe, expect, it } from "vitest";
import { deriveConnectionHealth, isKeepaliveTimeout } from "./connection-health.js";
import { scoreResourceTarget } from "./path-probe.js";
import { recoveryAttempts, shouldBlacklistTarget, TargetBlacklist } from "./path-recovery.js";
import { occupantNear, registerOccupancy, clearOccupancy } from "./occupancy.js";
import { PROTECTED_BLOCK_NAMES } from "./path-recovery.js";
import { createNavigationBackend } from "./navigation.js";

describe("connection health", () => {
  it("treats keepalive timeouts as degraded reconnect signals, not death", () => {
    expect(isKeepaliveTimeout(new Error("client timed out after 30000 milliseconds"))).toBe(true);
    expect(
      deriveConnectionHealth({
        connected: true,
        spawned: true,
        reconnecting: false,
        deceased: false,
        eventLoopLagMs: 400,
      }),
    ).toBe("DEGRADED");
    expect(
      deriveConnectionHealth({
        connected: false,
        spawned: false,
        reconnecting: true,
        deceased: false,
      }),
    ).toBe("RECONNECTING");
  });
});

describe("candidate target selection", () => {
  it("does not pick Euclidean-nearest when the close target is unreachable", () => {
    const close = scoreResourceTarget({
      distance: 4,
      probeCost: 90,
      claimed: false,
      blacklisted: false,
      hazards: 0,
      interactionOk: false,
    });
    const farther = scoreResourceTarget({
      distance: 10,
      probeCost: 12,
      claimed: false,
      blacklisted: false,
      hazards: 0,
      interactionOk: true,
    });
    expect(farther).toBeGreaterThan(close);
  });

  it("rejects blacklisted and claimed targets", () => {
    expect(
      scoreResourceTarget({
        distance: 2,
        probeCost: 2,
        claimed: false,
        blacklisted: true,
        hazards: 0,
        interactionOk: true,
      }),
    ).toBeLessThan(-500);
    expect(
      scoreResourceTarget({
        distance: 2,
        probeCost: 2,
        claimed: true,
        blacklisted: false,
        hazards: 0,
        interactionOk: true,
      }),
    ).toBeLessThan(0);
  });
});

describe("path probe and recovery", () => {
  it("blacklists unreachable interaction failures", () => {
    expect(shouldBlacklistTarget("TARGET_UNREACHABLE")).toBe(true);
    expect(shouldBlacklistTarget("NO_INTERACTION_POSITION")).toBe(true);
    expect(shouldBlacklistTarget("WORLD_CHANGED")).toBe(true);
    expect(shouldBlacklistTarget("NOT_CONNECTED")).toBe(false);
  });

  it("offers alternate interaction positions instead of one coordinate forever", () => {
    const attempts = recoveryAttempts({ x: 10, y: 64, z: 10 }, 2, 4);
    expect(attempts.length).toBeGreaterThan(2);
    expect(new Set(attempts.map((a) => `${a.x},${a.z}`)).size).toBeGreaterThan(1);
  });

  it("expires blacklist entries", () => {
    const list = new TargetBlacklist();
    const pos = { x: 1, y: 64, z: 1 };
    list.mark(pos, 10, 1_000);
    expect(list.has(pos, 1_005)).toBe(true);
    expect(list.has(pos, 1_020)).toBe(false);
  });
});

describe("citizen congestion", () => {
  it("detects another citizen occupying an approach cell", () => {
    clearOccupancy("atlas");
    registerOccupancy("atlas", { x: 8, y: 64, z: 8 }, 5_000, 1_000);
    expect(occupantNear({ x: 8.2, y: 64, z: 8.1 }, "theo", 1.1, 1_100)?.username).toBe("atlas");
    expect(occupantNear({ x: 8.2, y: 64, z: 8.1 }, "atlas", 1.1, 1_100)).toBeUndefined();
    clearOccupancy("atlas");
  });
});

describe("protected blocks", () => {
  it("protects village workstations and storage from pathfinder digging", () => {
    expect(PROTECTED_BLOCK_NAMES).toEqual(expect.arrayContaining(["chest", "crafting_table", "furnace", "bell", "composter"]));
  });
});

describe("navigation backend", () => {
  it("keeps pathfinder as the default and baritone as an optional adapter", () => {
    expect(createNavigationBackend(undefined).name).toBe("mineflayer-pathfinder");
    expect(createNavigationBackend("baritone").name).toBe("mineflayer-baritone");
  });
});
