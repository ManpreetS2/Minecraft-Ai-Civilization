import { describe, expect, it } from "vitest";
import { OperationTracker } from "./operation-tracker.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("OperationTracker", () => {
  it("drains deferred work before closing and blocks late writes", async () => {
    const tracker = new OperationTracker();
    const gate = deferred<string>();
    let wroteAfterClose = false;

    const op = tracker.track(
      gate.promise.then((value) => {
        if (tracker.canWrite()) {
          return value;
        }
        wroteAfterClose = true;
        return value;
      }),
    );

    const drain = tracker.drainAndClose(2_000);
    expect(tracker.isShuttingDown).toBe(true);
    expect(tracker.canAcceptWork()).toBe(false);
    expect(tracker.canWrite()).toBe(true);

    gate.resolve("ok");
    await op;
    const result = await drain;
    expect(result.attempted).toBe(1);
    expect(result.remaining).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.fullyDrained).toBe(true);
    expect(tracker.isClosed).toBe(true);
    expect(tracker.canWrite()).toBe(false);
    expect(wroteAfterClose).toBe(false);

    const again = await tracker.drainAndClose();
    expect(again.fullyDrained).toBe(true);
  });

  it("shares one drain across concurrent callers", async () => {
    const tracker = new OperationTracker();
    const gate = deferred<void>();
    void tracker.track(gate.promise);
    const first = tracker.drainAndClose(2_000);
    const second = tracker.drainAndClose(2_000);
    expect(second).toBe(first);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.fullyDrained).toBe(true);
  });

  it("does not create unhandled rejections when an active or draining op rejects", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const active = new OperationTracker();
      let rejectActive!: (error: unknown) => void;
      const activeOp = new Promise<never>((_, reject) => {
        rejectActive = reject;
      });
      const activeTracked = active.track(activeOp);
      expect(active.size).toBe(1);
      rejectActive(new Error("active action failed"));
      await expect(activeTracked).rejects.toThrow("active action failed");
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
      expect(active.size).toBe(0);

      const draining = new OperationTracker();
      let rejectDraining!: (error: unknown) => void;
      const drainingOp = new Promise<never>((_, reject) => {
        rejectDraining = reject;
      });
      const drainingTracked = draining.track(drainingOp);
      const drain = draining.drainAndClose(2_000);
      expect(draining.isShuttingDown).toBe(true);
      rejectDraining(new Error("drain action failed"));
      await expect(drainingTracked).rejects.toThrow("drain action failed");
      const result = await drain;
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
      expect(result.fullyDrained).toBe(true);
      expect(result.remaining).toBe(0);
      expect(draining.size).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("reports incomplete drain honestly on timeout", async () => {
    const tracker = new OperationTracker();
    const gate = deferred<void>();
    void tracker.track(gate.promise);
    const result = await tracker.drainAndClose(30);
    expect(result.timedOut).toBe(true);
    expect(result.fullyDrained).toBe(false);
    expect(result.remaining).toBeGreaterThan(0);
    expect(tracker.canWrite()).toBe(false);
    gate.resolve();
    await gate.promise;
  });
});
