import { describe, expect, it } from "vitest";
import { createEvent, fail, loadConfig, ok } from "@civ/shared";
import { createMemory } from "@civ/memory";
import { AgentManager } from "./manager.js";
import { CivilizationStore } from "./store.js";
import { createActionBoundary, LATE_WRITE_REFUSED, type ClientLike } from "./action-boundary.js";

function client(): ClientLike & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write(name: string) {
      writes.push(name);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("action boundary", () => {
  it("lets an active action write and then refuses a late packet from the same action", async () => {
    const bus = client();
    const boundary = createActionBoundary(() => bus);
    const result = await boundary.run(
      "late",
      async (signal) => {
        bus.write("block_place", {});
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (signal.aborted) bus.write("window_click", {});
        return ok({ placed: true }, 1);
      },
      { timeoutMs: 20, graceMs: 5 },
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("TIMEOUT");
      expect(result.retryable).toBe(false);
    }
    await sleep(50);
    expect(bus.writes).toEqual(["block_place"]);
  });

  it("allows a dig-cancel packet after the action is no longer active", async () => {
    const bus = client();
    const boundary = createActionBoundary(() => bus);
    const abort = new AbortController();
    const pending = boundary.run(
      "dig",
      async (signal) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal.aborted) bus.write("block_dig", { status: 1 });
        return fail("CANCELLED", "stopped", 1, false);
      },
      { signal: abort.signal, timeoutMs: 1_000, graceMs: 200 },
    );
    setTimeout(() => abort.abort(), 5);
    const result = await pending;
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
    expect(bus.writes).toEqual(["block_dig"]);
  });

  it("still allows a write that has no action owner", () => {
    const bus = client();
    const boundary = createActionBoundary(() => bus);
    void boundary;
    bus.write("window_click", {});
    expect(bus.writes).toEqual(["window_click"]);
  });

  it("does not start the next action on the same body until the previous one has returned", async () => {
    const bus = client();
    const boundary = createActionBoundary(() => bus);
    const order: string[] = [];
    const first = boundary.run(
      "first",
      async () => {
        order.push("first-start");
        await sleep(40);
        order.push("first-end");
        return ok({}, 1);
      },
      { timeoutMs: 1_000 },
    );
    const second = boundary.run(
      "second",
      async () => {
        order.push("second-start");
        return ok({}, 1);
      },
      { timeoutMs: 1_000 },
    );
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("runs two bodies at the same time", async () => {
    const left = createActionBoundary(() => client());
    const right = createActionBoundary(() => client());
    let overlap = 0;
    let peak = 0;
    const run = (boundary: ReturnType<typeof createActionBoundary>, name: string) =>
      boundary.run(
        name,
        async () => {
          overlap += 1;
          peak = Math.max(peak, overlap);
          await sleep(30);
          overlap -= 1;
          return ok({}, 1);
        },
        { timeoutMs: 1_000 },
      );
    await Promise.all([run(left, "a"), run(right, "b")]);
    expect(peak).toBe(2);
  });

  it("reports the skill's own success when the mutation finishes inside the grace period", async () => {
    const bus = client();
    const boundary = createActionBoundary(() => bus);
    const abort = new AbortController();
    const pending = boundary.run(
      "place",
      async () => {
        bus.write("block_place", {});
        await sleep(40);
        return ok({ placed: true }, 1);
      },
      { signal: abort.signal, timeoutMs: 1_000, graceMs: 200 },
    );
    await sleep(10);
    abort.abort();
    const result = await pending;
    expect(result.success).toBe(true);
    expect(bus.writes).toEqual(["block_place"]);
  });
});

describe("manager interruption", () => {
  it("aborts the physical action on disconnect and kick without dropping stored memory", () => {
    const config = loadConfig({
      DEMO_PROFILE: "none",
      LLM_PROVIDER: "none",
      LLM_ENABLED: "false",
      CLOUD_LLM_ENABLED: "false",
    });
    const store = new CivilizationStore(":memory:");
    const manager = new AgentManager(config, store);
    store.addMemory(createMemory("citizen_atlas", "episodic", "knows the oak grove", 0.5));
    const remembered = () =>
      (
        store as unknown as {
          db: { prepare(sql: string): { get(id: string): { n: number } } };
        }
      ).db.prepare("SELECT COUNT(*) AS n FROM memories WHERE citizen_id=?").get("citizen_atlas");
    expect(remembered().n).toBe(1);
    const visibleBefore = store.getMemories("citizen_atlas");
    const abort = new AbortController();
    let quits = 0;
    manager["citizens"].set("citizen_atlas", {
      abort,
      record: { id: "citizen_atlas" },
      body: { disconnect: () => { quits += 1; }, quit: () => { quits += 1; } },
    } as never);
    manager.events.emit(createEvent("CitizenDisconnected", {}, "citizen_atlas"));
    expect(abort.signal.aborted).toBe(true);
    expect(quits).toBe(0);
    expect(remembered().n).toBe(1);
    expect(store.getMemories("citizen_atlas")).toEqual(visibleBefore);

    const kicked = new AbortController();
    manager["citizens"].set("citizen_atlas", {
      abort: kicked,
      record: { id: "citizen_atlas" },
      body: { disconnect: () => { quits += 1; } },
    } as never);
    manager.events.emit(createEvent("CitizenKicked", {}, "citizen_atlas"));
    expect(kicked.signal.aborted).toBe(true);
    expect(quits).toBe(0);
    store.close();
  });
});

describe("late write error", () => {
  it("names the refusal so a skill can tell it from a server error", async () => {
    const bus = client();
    const boundary = createActionBoundary(() => bus);
    let code = "";
    await boundary.run(
      "click",
      async (signal) => {
        await sleep(30);
        try {
          if (signal.aborted) bus.write("window_click", {});
        } catch (error) {
          code = (error as { code?: string }).code ?? "";
        }
        return fail("CANCELLED", "stopped", 1, false);
      },
      { timeoutMs: 10, graceMs: 100 },
    );
    expect(code).toBe(LATE_WRITE_REFUSED);
  });
});
