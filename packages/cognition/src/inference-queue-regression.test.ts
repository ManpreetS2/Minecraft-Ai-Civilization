import { describe, expect, it } from "vitest";
import { InferenceQueue } from "./queue.js";

describe("InferenceQueue failure recovery", () => {
  it("releases the worker slot after a synchronous job throw and runs the next job", async () => {
    const queue = new InferenceQueue(1);
    const first = queue.enqueue({
      id: "bad",
      citizenId: "gpt-a",
      type: "routine",
      run: () => {
        throw new Error("synchronous planner failure");
      },
    });
    const second = queue.enqueue({
      id: "good",
      citizenId: "claude-a",
      type: "reflection",
      run: async () => "continued",
    });

    await expect(first).rejects.toThrow("synchronous planner failure");
    await expect(second).resolves.toMatchObject({
      value: "continued",
      meta: { citizenId: "claude-a", type: "reflection" },
    });
    expect(queue.snapshot()).toEqual({ queued: 0, inFlight: 0, maxConcurrency: 1 });
  });

  it("continues draining after both a rejected async job and a synchronous throw", async () => {
    const queue = new InferenceQueue(1);
    const first = queue.enqueue({
      id: "async-fail",
      citizenId: "a",
      type: "routine",
      run: async () => {
        throw new Error("asynchronous failure");
      },
    });
    const second = queue.enqueue({
      id: "sync-fail",
      citizenId: "b",
      type: "routine",
      run: () => {
        throw new Error("synchronous failure");
      },
    });
    const third = queue.enqueue({
      id: "recover",
      citizenId: "c",
      type: "routine",
      run: async () => 42,
    });

    await expect(first).rejects.toThrow("asynchronous failure");
    await expect(second).rejects.toThrow("synchronous failure");
    await expect(third).resolves.toMatchObject({ value: 42 });
    expect(queue.snapshot().inFlight).toBe(0);
    expect(queue.snapshot().queued).toBe(0);
  });

  it("rejects invalid concurrency rather than leaving requests pending forever", () => {
    for (const count of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => new InferenceQueue(count)).toThrow(RangeError);
    }
  });
});
