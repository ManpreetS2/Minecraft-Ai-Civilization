import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, fail, ok, type ActionResult } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { collectResource, type SkillContext } from "@civ/skills";
import { executePlan } from "./executor.js";
import { CivilizationStore } from "./store.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import { cellClaimKey } from "./claims.js";
import { OperationTracker } from "./operation-tracker.js";
import { lastOutcomeFrom, shouldBackoffToObserve } from "./task-recovery.js";
import { applyBodyRespawn, applyTemporaryBodyDeath, applyTerminalDeath } from "./lifecycle.js";
import type { PlannedTask } from "./planner.js";

/**
 * OPS-001 (cancellation / interruption of in-flight work). Offline only: fake bot, fake navigation backend,
 * temp SQLite. No production edits.
 */

type Pos = { x: number; y: number; z: number };
type Item = { name: string; count: number; slot: number };

function stubNav(over: Partial<NavigationBackend> = {}): NavigationBackend {
  const done = (t: Pos) => Promise.resolve(ok({ position: { ...t }, distance: 1 }, 1));
  return {
    name: "ops-stub",
    navigateToPosition: (_b, t) => done(t),
    navigateNear: (_b, t) => done(t),
    navigateToInteractWithBlock: (_b, t) => done(t),
    navigateToPlaceBlock: (_b, t) => done(t),
    followEntity: async () => ok({ username: "x", position: { x: 5.5, y: 64, z: 5.5 } }, 1),
    escapeFrom: async (_b, f) => ok({ position: f, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
    ...over,
  };
}

/** A tiny world of oak logs. `dig` is injectable so tests can abort / hang mid-dig. */
function world(opts: {
  logs: Pos[];
  controller?: AbortController;
  dig?: (block: { position: Pos }, helpers: { remove: () => void; give: () => void }) => Promise<void>;
}) {
  const logs = new Map(opts.logs.map((p) => [`${p.x},${p.y},${p.z}`, { ...p }]));
  const items: Item[] = [];
  const slots: Array<Item | null> = Array.from({ length: 46 }, () => null);
  const put = (name: string, count: number) => {
    const existing = items.find((i) => i.name === name);
    if (existing) {
      existing.count += count;
      return;
    }
    const it = { name, count, slot: 9 + items.length };
    items.push(it);
    slots[it.slot] = it;
  };
  put("wooden_axe", 1);
  let digs = 0;
  const keyOf = (p: Pos) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  const bot = {
    entity: { position: { x: 5.5, y: 64, z: 5.5, distanceTo: () => 1 }, eyeHeight: 1.62 },
    heldItem: { name: "wooden_axe", count: 1 },
    entities: {},
    registry: { blocksByName: { oak_log: { id: 17 } } },
    tool: { async equipForBlock() { return undefined; } },
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    findBlocks() {
      return [...logs.values()].map((p) => ({ ...p }));
    },
    blockAt(p: Pos) {
      const hit = logs.get(keyOf(p));
      if (hit) return { name: "oak_log", position: { ...hit } };
      return { name: "air", position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } };
    },
    async lookAt() {},
    async dig(block: { position: Pos }) {
      digs += 1;
      const remove = () => logs.delete(keyOf(block.position));
      const give = () => put("oak_log", 1);
      if (opts.dig) return opts.dig(block, { remove, give });
      remove();
      give();
    },
  };
  const ctx = {
    events: new EventBus(),
    citizenId: "citizen_atlas",
    bot: bot as unknown as SkillContext["bot"],
    timeoutMs: 2000,
    signal: opts.controller?.signal,
    body: { nearbyEntities: () => [], unreachable: { has: () => false, mark: () => undefined }, position: () => ({ x: 5.5, y: 64, z: 5.5 }) },
  } as unknown as SkillContext;
  return { ctx, digs: () => digs, logsLeft: () => logs.size, count: (n: string) => items.filter((i) => i.name === n).reduce((s, i) => s + i.count, 0) };
}

const tmpDirs: string[] = [];
const openStores: CivilizationStore[] = [];
const mkTmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const store of openStores.splice(0)) {
    try {
      store.close();
    } catch {
      // already closed
    }
  }
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // best effort (Windows may still hold a handle)
    }
  }
});
const trackStore = (store: CivilizationStore): CivilizationStore => {
  openStores.push(store);
  return store;
};
const newStore = () => trackStore(new CivilizationStore(join(mkTmp("ops-cancel-"), "civ.sqlite")));
const woodPlan = { goal: "gather_wood", task: "gather_wood", action: "mineBlock", source: "planner", reason: "t", priority: 0.5 } as PlannedTask;

describe("OPS-001 cancellation: collectResource", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("aborted before it starts: INTERRUPTED, nothing dug, inventory untouched, not complete, no backoff", async () => {
    setNavigationBackend(stubNav());
    const controller = new AbortController();
    controller.abort();
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }], controller });
    const result = await collectResource(w.ctx, ["oak_log"], 1, 48);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INTERRUPTED");
    expect(result.details).toMatchObject({ collected: 0, inventoryPreserved: true, workComplete: false });
    expect(w.digs()).toBe(0);
    expect(w.count("oak_log")).toBe(0);
    expect(w.logsLeft()).toBe(1);

    const outcome = lastOutcomeFrom(woodPlan, result, { task: "gather_wood", action: "mineBlock", success: false, code: "TARGET_UNREACHABLE", streak: 9 });
    expect(outcome.workComplete).toBe(false);
    expect(outcome.skillStatus).toBe("INTERRUPTED");
    expect(shouldBackoffToObserve(outcome)).toBe(false); // a cancel must never be punished as a failure streak
  });

  it("abort lands DURING the first dig: that block is kept (partial progress reported), no second dig starts", async () => {
    setNavigationBackend(stubNav());
    const controller = new AbortController();
    const w = world({
      logs: [{ x: 6, y: 64, z: 5 }, { x: 7, y: 64, z: 5 }, { x: 8, y: 64, z: 5 }],
      controller,
      dig: async (_block, h) => {
        controller.abort(); // user cancels while the dig is in flight
        h.remove();
        h.give();
      },
    });
    const result = await collectResource(w.ctx, ["oak_log"], 3, 48);
    expect(w.digs()).toBe(1);
    expect(w.count("oak_log")).toBe(1); // the already-dug log stays in the inventory
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INTERRUPTED");
    expect(result.details).toMatchObject({ collected: 1, inventoryPreserved: true, workComplete: false });
    expect(w.logsLeft()).toBe(2);
  });

  it("abort lands DURING navigation (backend reports CANCELLED): the dig never happens", async () => {
    const controller = new AbortController();
    setNavigationBackend(
      stubNav({
        navigateToInteractWithBlock: async () => {
          controller.abort();
          return fail("CANCELLED", "navigation aborted", 1, false);
        },
      }),
    );
    // Block is within reach, so the failed approach is waved through to the pre-dig signal check.
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }], controller });
    const result = await collectResource(w.ctx, ["oak_log"], 1, 48);
    expect(w.digs()).toBe(0);
    expect(w.count("oak_log")).toBe(0);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("INTERRUPTED");
  });

  // FIXED (OPS-002): collectResource used to await bot.dig() with no race against ctx.signal and nothing called
  // bot.stopDigging(), so a dig that never settled pinned the citizen even after cancelCitizenWork() aborted its signal.
  it("aborting while bot.dig is hung stops the dig and settles collectResource promptly as INTERRUPTED", async () => {
    setNavigationBackend(stubNav());
    const controller = new AbortController();
    // The abort fires from inside the dig call itself, so the ordering is deterministic (no timer race).
    const w = world({
      logs: [{ x: 6, y: 64, z: 5 }],
      controller,
      dig: () => {
        controller.abort();
        return new Promise<void>(() => undefined);
      },
    });
    let stopped = 0;
    (w.ctx.bot as unknown as { stopDigging: () => void }).stopDigging = () => void (stopped += 1);
    const run = collectResource(w.ctx, ["oak_log"], 1, 48);
    const outcome = await Promise.race([
      run.then((r) => ({ settled: true as const, r })),
      new Promise<{ settled: false }>((resolve) => setTimeout(() => resolve({ settled: false }), 400)),
    ]);
    expect(w.digs()).toBe(1);
    expect(outcome.settled).toBe(true);
    expect(stopped).toBe(1);
    if (outcome.settled) {
      expect(outcome.r.success).toBe(false);
      if (!outcome.r.success) expect(outcome.r.code).toBe("INTERRUPTED");
    }
  });

  it("an abort that arrives later (timer) during a hung dig also settles it, and a throwing stopDigging cannot break the cancel", async () => {
    setNavigationBackend(stubNav());
    const controller = new AbortController();
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }], controller, dig: () => new Promise<void>(() => undefined) });
    (w.ctx.bot as unknown as { stopDigging: () => void }).stopDigging = () => {
      throw new Error("bot gone");
    };
    const run = collectResource(w.ctx, ["oak_log"], 1, 48);
    setTimeout(() => controller.abort(), 150);
    const r = await Promise.race([run, new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1500))]);
    expect(r).not.toBe("hung");
    if (r !== "hung") expect(r.success).toBe(false);
  });

  it("an abandoned dig that later REJECTS (stopDigging makes mineflayer reject) causes no unhandled rejection", async () => {
    setNavigationBackend(stubNav());
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const controller = new AbortController();
      let rejectDig!: (e: Error) => void;
      const w = world({
        logs: [{ x: 6, y: 64, z: 5 }],
        controller,
        dig: () => new Promise<void>((_, reject) => { rejectDig = reject; controller.abort(); }),
      });
      (w.ctx.bot as unknown as { stopDigging: () => void }).stopDigging = () => rejectDig(new Error("Digging aborted"));
      const r = await collectResource(w.ctx, ["oak_log"], 1, 48);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.code).toBe("INTERRUPTED"); // not DIG_FAILED: a cancel is not a dig failure
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("OPS-001 cancellation: executePlan", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("an already-cancelled gather plan fails without digging, emitting ResourceCollected, or leaving a claim behind", async () => {
    setNavigationBackend(stubNav());
    const controller = new AbortController();
    controller.abort();
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }], controller });
    const events = new EventBus();
    const seen: string[] = [];
    events.on((e) => seen.push(e.type));
    const runtime = new SettlementRuntime();
    const result: ActionResult = await executePlan(w.ctx, woodPlan, newStore(), events, runtime);
    expect(result.success).toBe(false);
    if (!result.success) expect(["CANCELLED", "INTERRUPTED"]).toContain(result.code);
    expect(w.digs()).toBe(0);
    expect(w.count("oak_log")).toBe(0);
    expect(seen).not.toContain("ResourceCollected");
    expect(runtime.claims.ownerOf("tree", cellClaimKey(6, 64, 5))).toBeUndefined();
  });

  it("cancel mid-dig through the executor leaves the citizen's claim released (no 60 s ghost claim)", async () => {
    setNavigationBackend(stubNav());
    const controller = new AbortController();
    // First dig (collectResource) throws so the claimed-excavation fallback runs; the second dig is cancelled in flight.
    let call = 0;
    const w = world({
      logs: [{ x: 6, y: 64, z: 5 }],
      controller,
      dig: async (_b, h) => {
        call += 1;
        if (call === 1) throw new Error("dig interrupted");
        controller.abort();
        h.remove();
        h.give();
      },
    });
    const runtime = new SettlementRuntime();
    await executePlan(w.ctx, woodPlan, newStore(), new EventBus(), runtime);
    expect(call).toBe(2); // the fallback really ran
    expect(runtime.claims.ownerOf("tree", cellClaimKey(6, 64, 5))).toBeUndefined();
  });
});

describe("OPS-001 cancellation: per-citizen abort + body death lifecycle", () => {
  const makeCitizen = (store: CivilizationStore, id: string) => {
    const record = store.getCitizen(id);
    if (!record) throw new Error(`missing ${id}`);
    const calls = { stop: 0, deceased: 0 };
    return {
      record,
      busy: true,
      abort: new AbortController(),
      body: { stopPathfinding: () => void (calls.stop += 1), markDeceased: () => void (calls.deceased += 1) },
      calls,
    };
  };

  it("temporary body death aborts ONLY that citizen, stops pathing, frees only their claims/holds, persists 'respawning'", () => {
    const path = join(mkTmp("ops-life-"), "civ.sqlite");
    const store = new CivilizationStore(path);
    const runtime = new SettlementRuntime();
    const atlas = makeCitizen(store, "citizen_atlas");
    const maya = makeCitizen(store, "citizen_maya");
    runtime.claims.tryClaim("tree", "1,64,1", "citizen_atlas");
    runtime.claims.tryClaim("tree", "2,64,2", "citizen_maya");
    runtime.reservations.reserve("citizen_atlas", "construction", "oak_planks", 8);
    runtime.reservations.reserve("citizen_maya", "construction", "oak_planks", 4);

    applyTemporaryBodyDeath({ citizen: atlas, store, runtime });

    expect(atlas.abort.signal.aborted).toBe(true);
    expect(maya.abort.signal.aborted).toBe(false);
    expect(atlas.busy).toBe(false);
    expect(maya.busy).toBe(true);
    expect(atlas.calls.stop).toBe(1);
    expect(maya.calls.stop).toBe(0);
    expect(runtime.claims.ownerOf("tree", "1,64,1")).toBeUndefined();
    expect(runtime.claims.ownerOf("tree", "2,64,2")).toBe("citizen_maya");
    expect(runtime.reservations.reservedOf("oak_planks")).toBe(4);
    expect(atlas.record.status).toBe("respawning");
    store.close();
    const reopened = new CivilizationStore(path);
    expect(reopened.getCitizen("citizen_atlas")?.status).toBe("respawning");
    reopened.close();
  });

  it("terminal death aborts, stops pathing, releases holds, and the death + position survive a restart", () => {
    const path = join(mkTmp("ops-life-"), "civ.sqlite");
    const store = new CivilizationStore(path);
    const runtime = new SettlementRuntime();
    const kai = makeCitizen(store, "citizen_kai");
    runtime.claims.tryClaim("ore", "3,12,3", "citizen_kai");
    const at = "2026-10-31T12:00:00.000Z";
    applyTerminalDeath({
      event: { id: "e1", type: "CitizenDied", timestamp: at, citizenId: "citizen_kai", payload: { position: { x: 3, y: 12, z: 3 } } } as never,
      store,
      runtime,
      citizen: kai,
    });
    expect(kai.abort.signal.aborted).toBe(true);
    expect(kai.busy).toBe(false);
    expect(kai.calls).toEqual({ stop: 1, deceased: 1 });
    expect(runtime.claims.ownerOf("ore", "3,12,3")).toBeUndefined();
    store.close();

    const reopened = new CivilizationStore(path);
    const restored = reopened.getCitizen("citizen_kai");
    expect(restored?.status).toBe("dead");
    expect(restored?.diedAt).toBe(at);
    expect(restored?.deathPosition).toEqual({ x: 3, y: 12, z: 3 });
    reopened.close();
  });

  it("terminal death with a malformed payload position falls back to the last known position", () => {
    const store = newStore();
    const kai = makeCitizen(store, "citizen_kai");
    kai.record.lastKnownPosition = { x: 9, y: 70, z: 9 };
    applyTerminalDeath({
      event: { id: "e2", type: "CitizenDied", timestamp: "2026-10-31T12:00:00.000Z", citizenId: "citizen_kai", payload: { position: { x: "1", y: 2 } } } as never,
      store,
      runtime: new SettlementRuntime(),
      citizen: kai,
    });
    expect(store.getCitizen("citizen_kai")?.deathPosition).toEqual({ x: 9, y: 70, z: 9 });
    store.close();
  });

  it("a second death event never rewrites the persisted time of death, and a late 'temporary' death cannot un-kill", () => {
    const store = newStore();
    const runtime = new SettlementRuntime();
    const kai = makeCitizen(store, "citizen_kai");
    const first = "2026-10-31T12:00:00.000Z";
    const mk = (timestamp: string) => ({ id: timestamp, type: "CitizenDied", timestamp, citizenId: "citizen_kai", payload: { position: { x: 1, y: 2, z: 3 } } }) as never;
    applyTerminalDeath({ event: mk(first), store, runtime, citizen: kai });
    applyTerminalDeath({ event: mk("2026-10-31T13:00:00.000Z"), store, runtime, citizen: kai });
    applyTemporaryBodyDeath({ citizen: kai, store, runtime });
    const row = store.getCitizen("citizen_kai");
    expect(row?.status).toBe("dead");
    expect(row?.diedAt).toBe(first);
    store.close();
  });

  it("applyBodyRespawn clears busy and goes online without touching the abort controller", () => {
    const store = newStore();
    const atlas = makeCitizen(store, "citizen_atlas");
    atlas.record.status = "respawning";
    applyBodyRespawn(atlas);
    expect(atlas.busy).toBe(false);
    expect(atlas.record.status).toBe("online");
    expect(atlas.abort.signal.aborted).toBe(false);
    store.close();
  });

  // SUSPECTED (OPS-001): lifecycle.ts:24 returns early when the runtime has no citizen object for the event, so a
  // death for a citizen not currently in the manager's map (e.g. a death event replayed right after a restart, before the
  // body is rebuilt) is never persisted via store.markDeceased. Characterisation only: this documents today's behaviour.
  it("characterisation: a terminal death with no runtime citizen is silently dropped (store NOT marked)", () => {
    const store = newStore();
    // Precondition (without it the assertion below is vacuous): the citizen EXISTS in the store and is online.
    const theo = store.getCitizen("citizen_theo");
    if (!theo) throw new Error("citizen_theo is not seeded");
    store.upsertCitizen({ ...theo, status: "online" });
    expect(store.getCitizen("citizen_theo")?.status).toBe("online");
    applyTerminalDeath({
      event: { id: "e3", type: "CitizenDied", timestamp: "2026-10-31T12:00:00.000Z", citizenId: "citizen_theo", payload: {} } as never,
      store,
      runtime: new SettlementRuntime(),
      citizen: undefined,
    });
    expect(store.getCitizen("citizen_theo")?.status).toBe("online"); // still alive in the store: the death was lost
    expect(store.isDeceased("citizen_theo")).toBe(false);
    store.close();
  });
});

describe("OPS-001 cancellation: OperationTracker shutdown with abort", () => {
  it("ops that honour the abort signal drain fully; an op that ignores it is reported honestly as timed out", async () => {
    const tracker = new OperationTracker();
    const controller = new AbortController();
    const cooperative = new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
    const stubborn = new Promise<void>(() => undefined);
    void tracker.track(cooperative);
    void tracker.track(stubborn);
    controller.abort();
    const drain = await tracker.drainAndClose(60);
    expect(drain).toMatchObject({ attempted: 2, remaining: 1, timedOut: true, fullyDrained: false });
    expect(tracker.canWrite()).toBe(false);
    expect(tracker.size).toBe(1);
  });

  it("a timed-out drain result stays truthful even after the straggler finally settles", async () => {
    const tracker = new OperationTracker();
    let release!: () => void;
    void tracker.track(new Promise<void>((r) => (release = r)));
    const first = await tracker.drainAndClose(30);
    expect(first.fullyDrained).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 5));
    expect(tracker.size).toBe(0);
    const again = await tracker.drainAndClose(30);
    expect(again).toEqual(first); // cached, never upgraded to "fully drained" retroactively
  });

  it("work started after shutdown began is returned untouched but not tracked, so it cannot hold up the drain", async () => {
    const tracker = new OperationTracker();
    let release!: () => void;
    void tracker.track(new Promise<void>((r) => (release = r)));
    const drain = tracker.drainAndClose(500);
    const late = tracker.track(new Promise<void>(() => undefined));
    expect(late).toBeInstanceOf(Promise);
    expect(tracker.size).toBe(1); // only the pre-shutdown op
    release();
    expect((await drain).fullyDrained).toBe(true);
  });

  it("rejected in-flight ops still count as settled for the drain", async () => {
    const tracker = new OperationTracker();
    const op = tracker.track(Promise.reject(new Error("boom")));
    await expect(op).rejects.toThrow("boom");
    const drain = await tracker.drainAndClose(100);
    expect(drain.fullyDrained).toBe(true);
  });
});
