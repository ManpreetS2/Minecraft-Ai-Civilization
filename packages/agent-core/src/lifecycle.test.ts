import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvent, loadConfig } from "@civ/shared";
import { OperationTracker } from "./lifecycle.js";
import { AgentManager } from "./manager.js";
import { CivilizationStore } from "./store.js";

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
    expect(result.drained).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(tracker.isClosed).toBe(true);
    expect(tracker.canWrite()).toBe(false);
    expect(wroteAfterClose).toBe(false);

    const again = await tracker.drainAndClose();
    expect(again.drained).toBe(0);
  });

  it("times out drain without hanging forever", async () => {
    const tracker = new OperationTracker();
    const gate = deferred<void>();
    void tracker.track(gate.promise);
    const result = await tracker.drainAndClose(50);
    expect(result.timedOut).toBe(true);
    expect(tracker.isClosed).toBe(true);
    gate.resolve();
  });
});

describe("AgentManager shutdown safety", () => {
  it("is idempotent and does not throw when late callbacks try to persist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-shutdown-"));
    const path = join(dir, "shutdown.sqlite");
    const store = new CivilizationStore(path);
    const config = loadConfig({
      DATABASE_PATH: path,
      LLM_ENABLED: "false",
      AUTO_START_PAPER: "false",
      SIM_CITIZEN_COUNT: "0",
    });

    const decide = deferred<{ goal: "gather_food"; priority: number; reason: string }>();
    const cognition = {
      name: "test-deferred",
      decide: () => decide.promise,
    };

    const manager = new AgentManager(config, store, cognition);
    const lateWrite = manager["ops"].track(
      decide.promise.then((decision) => {
        manager["persistLlmCall"]({
          citizenId: "citizen_atlas",
          latencyMs: 1,
          ok: true,
          goal: decision.goal,
          reason: decision.reason,
        });
      }),
    );

    const stopOnce = manager.stop();
    await Promise.resolve();
    decide.resolve({ goal: "gather_food", priority: 0.5, reason: "deferred after stop started" });
    await lateWrite;
    await stopOnce;

    expect(store.isOpen()).toBe(false);
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(store.safeWrite("should-skip", () => store.appendEvent(createEvent("ErrorOccurred", { error: "x" })))).toBe(
      false,
    );
  });
});
