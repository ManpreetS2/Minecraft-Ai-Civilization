import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MinecraftBody } from "@civ/minecraft-adapter";
import { createEvent, fail, loadConfig, ok } from "@civ/shared";
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

function testConfig(path: string) {
  return loadConfig({
    DATABASE_PATH: path,
    LLM_ENABLED: "false",
    AUTO_START_PAPER: "false",
    SIM_CITIZEN_COUNT: "0",
  });
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

  it("does not create unhandled rejections when discarded after close", async () => {
    const tracker = new OperationTracker();
    await tracker.drainAndClose();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      let rejectConnect!: (error: unknown) => void;
      let rejectCognition!: (error: unknown) => void;
      let rejectAction!: (error: unknown) => void;
      const connect = new Promise<never>((_, reject) => {
        rejectConnect = reject;
      });
      const cognition = new Promise<never>((_, reject) => {
        rejectCognition = reject;
      });
      const action = new Promise<never>((_, reject) => {
        rejectAction = reject;
      });
      void tracker.track(connect);
      void tracker.track(cognition);
      void tracker.track(action);
      rejectConnect(new Error("connect failed"));
      rejectCognition(new Error("cognition failed"));
      rejectAction(new Error("action failed"));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
      expect(tracker.size).toBe(0);
      expect(tracker.isClosed).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("still surfaces operational failures to awaiters after close", async () => {
    const tracker = new OperationTracker();
    await tracker.drainAndClose();
    let rejectOp!: (error: unknown) => void;
    const cognition = new Promise<never>((_, reject) => {
      rejectOp = reject;
    });
    const tracked = tracker.track(cognition);
    rejectOp(new Error("cognition failed"));
    await expect(tracked).rejects.toThrow("cognition failed");
  });

  it("does not count late rejected work as drained-in when already closed", async () => {
    const tracker = new OperationTracker();
    const result = await tracker.drainAndClose();
    expect(result.fullyDrained).toBe(true);
    let rejectAction!: (error: unknown) => void;
    const action = new Promise<never>((_, reject) => {
      rejectAction = reject;
    });
    void tracker.track(action);
    rejectAction(new Error("late action"));
    await expect(action).rejects.toThrow("late action");
    expect(tracker.size).toBe(0);
    const again = await tracker.drainAndClose();
    expect(again.fullyDrained).toBe(true);
  });

  it("times out without claiming fullyDrained and clears the timer", async () => {
    const tracker = new OperationTracker();
    const gate = deferred<void>();
    void tracker.track(gate.promise);
    const result = await tracker.drainAndClose(40);
    expect(result.timedOut).toBe(true);
    expect(result.fullyDrained).toBe(false);
    expect(result.remaining).toBeGreaterThan(0);
    expect(tracker.isClosed).toBe(true);
    expect(tracker.canWrite()).toBe(false);
    gate.resolve();
    await Promise.resolve();
  });
});

describe("AgentManager shutdown safety", () => {
  it("is idempotent and does not throw when late callbacks try to persist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-shutdown-"));
    const path = join(dir, "shutdown.sqlite");
    const store = new CivilizationStore(path);
    const decide = deferred<{ goal: "gather_food"; priority: number; reason: string }>();
    const cognition = {
      name: "test-deferred",
      decide: () => decide.promise,
    };

    const manager = new AgentManager(testConfig(path), store, cognition);
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
    expect(store.safeWrite("should-skip", () => store.appendEvent(createEvent("ErrorOccurred", { error: "x" })))).toEqual(
      { ok: false, reason: "closed" },
    );
  });

  it("shares one shutdown across concurrent stop() calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-shutdown-"));
    const path = join(dir, "concurrent.sqlite");
    const store = new CivilizationStore(path);
    const gate = deferred<void>();
    const manager = new AgentManager(testConfig(path), store);
    void manager["ops"].track(gate.promise);

    const first = manager.stop();
    const second = manager.stop();
    expect(second).toBe(first);
    gate.resolve();
    await Promise.all([first, second]);
    expect(store.isOpen()).toBe(false);
    const drain = manager.lastShutdownDrain();
    expect(drain?.fullyDrained).toBe(true);
  });

  it("records incomplete drain when operations remain after timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-shutdown-"));
    const path = join(dir, "timeout.sqlite");
    const store = new CivilizationStore(path);
    const gate = deferred<void>();
    const manager = new AgentManager(testConfig(path), store);
    void manager["ops"].track(gate.promise);

    // Force a short drain by replacing drainAndClose on the tracker instance.
    const original = manager["ops"].drainAndClose.bind(manager["ops"]);
    manager["ops"].drainAndClose = (timeoutMs = 8_000) => original(Math.min(timeoutMs, 30));

    await manager.stop();
    const drain = manager.lastShutdownDrain();
    expect(drain?.timedOut).toBe(true);
    expect(drain?.fullyDrained).toBe(false);
    expect(drain?.remaining).toBeGreaterThan(0);
    expect(store.isOpen()).toBe(false);
    gate.resolve();
  });

  it("rejects start after shutdown and interrupts startup acceptance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-shutdown-"));
    const path = join(dir, "startup.sqlite");
    const store = new CivilizationStore(path);
    const manager = new AgentManager(testConfig(path), store);

    await manager.stop();
    await expect(manager.start(1)).rejects.toThrow(/shutting down|after stop/i);

    const freshStore = new CivilizationStore(join(dir, "startup2.sqlite"));
    const fresh = new AgentManager(testConfig(join(dir, "startup2.sqlite")), freshStore);
    expect(fresh["shouldContinueStartup"]()).toBe(false);
    // running=false initially
    fresh["running"] = true;
    expect(fresh["shouldContinueStartup"]()).toBe(true);
    fresh["ops"].drainAndClose(1);
    await Promise.resolve();
    // After shutdown begins, startup must not continue.
    expect(fresh["ops"].canAcceptWork()).toBe(false);
    expect(fresh["shouldContinueStartup"]()).toBe(false);
    await fresh.stop();
  });
});

class ControllableBody extends MinecraftBody {
  readonly connectGate = deferred<void>();
  connectCalls = 0;
  private online = false;
  private aborted = false;

  override get connected(): boolean {
    return this.online;
  }

  override async connect() {
    this.connectCalls += 1;
    await this.connectGate.promise;
    if (this.aborted || this.isDeceased()) {
      this.online = false;
      return fail("CANCELLED", "startup-interrupted", 0);
    }
    this.online = true;
    return ok({ username: this.username }, 1);
  }

  override async disconnect(reason = "shutdown"): Promise<void> {
    this.aborted = true;
    this.online = false;
    await super.disconnect(reason);
  }
}

describe("tick/shutdown overlap", () => {
  it("waits for a suspended tick and does not read SQLite after close", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-tick-"));
    const path = join(dir, "tick.sqlite");
    const store = new CivilizationStore(path);
    const entered = deferred<void>();
    const resume = deferred<void>();
    let readsAfterClose = 0;
    const orig = store.getSettlement.bind(store);
    store.getSettlement = () => {
      if (!store.isOpen()) {
        readsAfterClose += 1;
        throw new Error("getSettlement after close");
      }
      return orig();
    };

    const manager = new AgentManager(testConfig(path), store, undefined, {
      afterTickReads: async () => {
        entered.resolve();
        await resume.promise;
      },
    });
    manager["running"] = true;
    const tickP = manager["tick"]() as Promise<void>;
    await entered.promise;
    expect(store.isOpen()).toBe(true);

    const stopP = manager.stop();
    resume.resolve();
    await tickP;
    await stopP;

    expect(store.isOpen()).toBe(false);
    expect(readsAfterClose).toBe(0);
    expect(manager.lastShutdownDrain()?.fullyDrained).toBe(true);
  });

  it("reports incomplete shutdown when a suspended tick outlives the drain timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-tick-"));
    const path = join(dir, "tick-timeout.sqlite");
    const store = new CivilizationStore(path);
    const entered = deferred<void>();
    const resume = deferred<void>();
    let readsAfterClose = 0;
    const orig = store.getSettlement.bind(store);
    store.getSettlement = () => {
      if (!store.isOpen()) {
        readsAfterClose += 1;
        throw new Error("getSettlement after close");
      }
      return orig();
    };

    const manager = new AgentManager(testConfig(path), store, undefined, {
      drainTimeoutMs: 40,
      afterTickReads: async () => {
        entered.resolve();
        await resume.promise;
      },
    });
    manager["running"] = true;
    const tickP = manager["tick"]() as Promise<void>;
    await entered.promise;

    await manager.stop();
    expect(store.isOpen()).toBe(false);
    expect(manager.lastShutdownDrain()?.timedOut).toBe(true);
    expect(manager.lastShutdownDrain()?.fullyDrained).toBe(false);

    resume.resolve();
    await tickP;
    expect(readsAfterClose).toBe(0);
  });

  it("does not overlap tick executions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-tick-"));
    const path = join(dir, "overlap.sqlite");
    const store = new CivilizationStore(path);
    let concurrent = 0;
    let maxConcurrent = 0;
    const manager = new AgentManager(testConfig(path), store, undefined, {
      beforeTick: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 30));
        concurrent -= 1;
      },
    });
    manager["running"] = true;
    await Promise.all([manager["tick"]() as Promise<void>, manager["tick"]() as Promise<void>]);
    expect(maxConcurrent).toBe(1);
    await manager.stop();
  });
});

describe("startup connection/shutdown races", () => {
  it("disconnects a late connection and does not leave the bot online", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-conn-"));
    const path = join(dir, "conn.sqlite");
    const store = new CivilizationStore(path);
    const bodies: ControllableBody[] = [];
    const manager = new AgentManager(testConfig(path), store, undefined, {
      bodyFactory: (options) => {
        const body = new ControllableBody({ ...options, lockDir: dir });
        bodies.push(body);
        return body;
      },
    });

    const startP = manager.start(1);
    const deadline = Date.now() + 2_000;
    while (bodies.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.connectCalls).toBe(1);

    const stopP = manager.stop();
    bodies[0]?.connectGate.resolve();
    await startP;
    await stopP;

    expect(bodies[0]?.connected).toBe(false);
    expect(store.isOpen()).toBe(false);
  });

  it("does not start a second citizen connect after shutdown begins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-conn-"));
    const path = join(dir, "conn2.sqlite");
    const store = new CivilizationStore(path);
    const bodies: ControllableBody[] = [];
    const manager = new AgentManager(testConfig(path), store, undefined, {
      bodyFactory: (options) => {
        const body = new ControllableBody({ ...options, lockDir: dir });
        bodies.push(body);
        return body;
      },
    });

    const startP = manager.start(2);
    const deadline = Date.now() + 2_000;
    while (bodies.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(bodies).toHaveLength(1);

    const stopP = manager.stop();
    bodies[0]?.connectGate.resolve();
    await startP;
    await stopP;

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.connected).toBe(false);
  });

  it("rejected connect during shutdown is an awaited failure, not an unhandled rejection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-conn-"));
    const path = join(dir, "conn-reject.sqlite");
    const store = new CivilizationStore(path);
    const bodies: ControllableBody[] = [];
    const manager = new AgentManager(testConfig(path), store, undefined, {
      bodyFactory: (options) => {
        const body = new ControllableBody({ ...options, lockDir: dir });
        bodies.push(body);
        return body;
      },
    });

    const startP = manager.start(1);
    const deadline = Date.now() + 2_000;
    while (bodies.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(bodies).toHaveLength(1);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const stopP = manager.stop();
      bodies[0]?.connectGate.reject(new Error("socket hangup"));
      await expect(startP).rejects.toThrow("socket hangup");
      await stopP;
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("discarded rejected cognition and action promises after stop are not unhandled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-conn-"));
    const path = join(dir, "post-stop.sqlite");
    const store = new CivilizationStore(path);
    const manager = new AgentManager(testConfig(path), store);
    await manager.stop();

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      let rejectCognition!: (error: unknown) => void;
      let rejectAction!: (error: unknown) => void;
      const cognition = new Promise<never>((_, reject) => {
        rejectCognition = reject;
      });
      const action = new Promise<never>((_, reject) => {
        rejectAction = reject;
      });
      void manager["ops"].track(cognition);
      void manager["ops"].track(action);
      rejectCognition(new Error("llm timeout"));
      rejectAction(new Error("dig failed"));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

