import { describe, expect, it } from "vitest";
import { isMovementStall } from "./step-jump.js";
import { TargetBlacklist, cellKey, movedEnough, shouldBlacklistTarget } from "./path-recovery.js";
import { keepalivePolicy, armShutdownClient } from "./connection-health.js";

/**
 * OPS-001 (stuck-stop recovery + shutdown hygiene) for the adapter's pure policy helpers. Offline only.
 */
describe("OPS-001 stuck detection (isMovementStall)", () => {
  const base = { activity: "pathing" as const, pathStarted: true };

  it("fires only while pathing, and only after the progress / no-progress thresholds", () => {
    expect(isMovementStall({ ...base, progressed: true, msSinceMove: 999 })).toBe(false);
    expect(isMovementStall({ ...base, progressed: true, msSinceMove: 1_000 })).toBe(true);
    expect(isMovementStall({ ...base, progressed: false, msSinceMove: 1_499 })).toBe(false);
    expect(isMovementStall({ ...base, progressed: false, msSinceMove: 1_500 })).toBe(true);
  });

  it("never fires while the body is legitimately not walking (digging, sleeping, in a container, loading, idle) or before a path started", () => {
    for (const activity of ["busy", "sleeping", "container", "loading", "idle"] as const) {
      expect(isMovementStall({ activity, pathStarted: true, progressed: true, msSinceMove: 60_000 })).toBe(false);
    }
    expect(isMovementStall({ activity: "pathing", pathStarted: false, progressed: false, msSinceMove: 60_000 })).toBe(false);
  });

  it("honours caller-supplied thresholds", () => {
    expect(isMovementStall({ ...base, progressed: true, msSinceMove: 300, stallAfterProgressMs: 250 })).toBe(true);
    expect(isMovementStall({ ...base, progressed: false, msSinceMove: 300, stallNoProgressMs: 250 })).toBe(true);
    expect(isMovementStall({ ...base, progressed: false, msSinceMove: 300, stallNoProgressMs: 5_000 })).toBe(false);
  });
});

describe("OPS-001 target blacklist after a stop", () => {
  it("every stuck / timeout / unreachable style code blacklists the target; cancel, interrupt and plain misses do not", () => {
    for (const code of ["STUCK", "NAV_NO_INITIAL_PROGRESS", "TIMEOUT", "PATH_BLOCKED", "PATH_FAILED", "TARGET_UNREACHABLE", "HAZARD_BLOCKED", "VERIFY_FAILED", "WORLD_CHANGED"]) {
      expect(shouldBlacklistTarget(code), code).toBe(true);
    }
    for (const code of ["CANCELLED", "INTERRUPTED", "ABORTED", "CURFEW_STOP", "BLOCK_NOT_FOUND", "INVENTORY_FULL", "MISSING_TOOL", "NOT_CONNECTED"]) {
      expect(shouldBlacklistTarget(code), code).toBe(false);
    }
  });

  it("a blacklisted cell expires exactly at its deadline and is then forgotten (a stuck spot is retried later)", () => {
    const list = new TargetBlacklist();
    const t0 = 5_000;
    list.mark({ x: 10.2, y: 64, z: 4.4 }, 8_000, t0);
    expect(list.has({ x: 10, y: 64, z: 4 }, t0 + 7_999)).toBe(true); // same cell after rounding
    expect(list.has({ x: 10, y: 64, z: 4 }, t0 + 8_000)).toBe(false);
    expect(list.size(t0 + 8_000)).toBe(0);
  });

  it("re-marking extends the deadline; different cells are independent", () => {
    const list = new TargetBlacklist();
    list.mark({ x: 1, y: 64, z: 1 }, 1_000, 0);
    list.mark({ x: 1, y: 64, z: 1 }, 5_000, 900);
    list.mark({ x: 9, y: 64, z: 9 }, 100, 0);
    expect(list.has({ x: 1, y: 64, z: 1 }, 3_000)).toBe(true);
    expect(list.has({ x: 9, y: 64, z: 9 }, 3_000)).toBe(false);
    expect(list.size(3_000)).toBe(1);
  });

  it("movedEnough separates real movement from jitter; cellKey is stable for sub-block jitter", () => {
    expect(movedEnough({ x: 0, y: 64, z: 0 }, { x: 0.1, y: 64, z: 0.1 })).toBe(false);
    expect(movedEnough({ x: 0, y: 64, z: 0 }, { x: 0.35, y: 64, z: 0 })).toBe(true);
    expect(cellKey({ x: 3.4, y: 64.2, z: -2.4 })).toBe(cellKey({ x: 2.6, y: 63.8, z: -1.6 }));
  });
});

describe("OPS-001 shutdown / transport-loss recovery policy", () => {
  it("keepalive timeouts and resets are swallowed during shutdown but fail the active task otherwise; other errors propagate", () => {
    const timeout = new Error("client timed out after 30000 milliseconds");
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    expect(keepalivePolicy({ shuttingDown: true, error: timeout })).toBe("swallow_shutdown");
    expect(keepalivePolicy({ shuttingDown: false, error: timeout })).toBe("fail_active_task");
    expect(keepalivePolicy({ shuttingDown: false, error: reset })).toBe("fail_active_task");
    expect(keepalivePolicy({ shuttingDown: true, error: new Error("something else") })).toBe("propagate");
    expect(keepalivePolicy({ shuttingDown: false, error: "string error" })).toBe("propagate");
  });

  it("armShutdownClient survives a client whose every teardown call throws, and still installs an error swallower first", () => {
    const calls: string[] = [];
    const client = {
      removeAllListeners: () => { calls.push("remove"); throw new Error("already closed"); },
      on: (_e: string, _l: (e: unknown) => void) => { calls.push("on"); throw new Error("nope"); },
      end: () => { calls.push("end"); throw new Error("socket gone"); },
    };
    expect(() => armShutdownClient(client, "bye")).not.toThrow();
    expect(calls).toEqual(["remove", "on", "end"]); // one failing step never skips the next
    expect(() => armShutdownClient(undefined)).not.toThrow();
  });

  it("armShutdownClient: the swallow listener really absorbs a late transport error", () => {
    const handlers: Array<(e: unknown) => void> = [];
    let ended: string | undefined;
    armShutdownClient({ removeAllListeners: () => { handlers.length = 0; }, on: (_e, l) => void handlers.push(l), end: (r) => { ended = r; } }, "shutdown");
    expect(ended).toBe("shutdown");
    expect(handlers).toHaveLength(1);
    expect(() => handlers[0]?.(new Error("late ECONNRESET"))).not.toThrow();
  });
});
