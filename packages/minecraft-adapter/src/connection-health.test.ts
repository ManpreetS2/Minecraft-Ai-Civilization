import { describe, expect, it } from "vitest";
import {
  armShutdownClient,
  isKeepaliveTimeout,
  isTransportReset,
  keepalivePolicy,
} from "./connection-health.js";

describe("test lifecycle keepalive handling", () => {
  it("swallows keepalive after shutdown and fails keepalive during an active task", () => {
    const timeout = new Error("client timed out after 180000 milliseconds");
    expect(isKeepaliveTimeout(timeout)).toBe(true);
    expect(keepalivePolicy({ shuttingDown: true, error: timeout })).toBe("swallow_shutdown");
    expect(keepalivePolicy({ shuttingDown: false, error: timeout })).toBe("fail_active_task");
  });

  it("treats ECONNRESET as a failed active task instead of crashing the process", () => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    expect(isTransportReset(reset)).toBe(true);
    expect(keepalivePolicy({ shuttingDown: false, error: reset })).toBe("fail_active_task");
    expect(keepalivePolicy({ shuttingDown: true, error: reset })).toBe("swallow_shutdown");
    expect(keepalivePolicy({ shuttingDown: false, error: new Error("some other boom") })).toBe("propagate");
  });

  it("reattaches a swallow listener after stripping client listeners so teardown cannot hang", () => {
    const events: string[] = [];
    const listeners: Array<(error: unknown) => void> = [];
    const client = {
      removeAllListeners() {
        listeners.length = 0;
        events.push("removed");
      },
      on(event: string, listener: (error: unknown) => void) {
        if (event === "error") listeners.push(listener);
        events.push(`on:${event}`);
      },
      end(reason?: string) {
        events.push(`end:${reason ?? ""}`);
      },
    };
    armShutdownClient(client, "return-home-test");
    expect(events).toEqual(["removed", "on:error", "end:return-home-test"]);
    expect(listeners).toHaveLength(1);
    expect(() => listeners[0]?.(new Error("client timed out after 180000 milliseconds"))).not.toThrow();
  });
});
