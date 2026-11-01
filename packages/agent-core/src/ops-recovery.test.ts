import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, fail, ok } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { mineBlock, type SkillContext } from "@civ/skills";
import { executePlan } from "./executor.js";
import { CivilizationStore } from "./store.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import { cellClaimKey } from "./claims.js";
import {
  lastOutcomeFrom,
  mergeUnresolved,
  physicalWorkComplete,
  RETRYABLE_FAILURE_LIMIT,
  shouldBackoffToObserve,
  suppressedActions,
  suppressedHomeIds,
  unresolvedStillApplies,
  type UnresolvedBlock,
  type UnresolvedFacts,
} from "./task-recovery.js";
import {
  FAILURE_BACKOFF_STREAK,
  foodSearchHasAlternateOpportunity,
  homeSleepBackoffReason,
  shouldBackoffFoodSearch,
  shouldBackoffHomeSleepRoute,
} from "./failure-backoff.js";
import type { LastOutcome, PlannedTask } from "./planner.js";

/**
 * OPS-001 (stuck-stop and failure recovery). Offline only; no production edits.
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


const newStore = () => new CivilizationStore(join(mkdtempSync(join(tmpdir(), "ops-recov-")), "civ.sqlite"));
const woodPlan = { goal: "gather_wood", task: "gather_wood", action: "mineBlock", source: "planner", reason: "t", priority: 0.5 } as PlannedTask;
const plan = (over: Partial<PlannedTask> = {}): PlannedTask => ({ ...woodPlan, ...over });
const failing = (code: string, retryable = true) => fail(code as never, `${code} happened`, 1, retryable);
const last = (over: Partial<LastOutcome> = {}): LastOutcome => ({ task: "gather_wood", action: "mineBlock", success: false, code: "BLOCK_NOT_FOUND", streak: 1, retryable: true, ...over });
const facts = (over: Partial<UnresolvedFacts> = {}): UnresolvedFacts => ({ hasStorage: false, hasRod: false, hasPickaxe: false, hasShore: false, hasOre: false, availableHomeIds: [], ...over });

describe("OPS-001 stuck-stop: navigation STUCK / TIMEOUT never turns into fake progress", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("mineBlock: a STUCK approach is returned as-is, blacklists the target, and never digs", async () => {
    let navCalls = 0;
    setNavigationBackend(stubNav({ navigateToInteractWithBlock: async () => { navCalls += 1; return fail("STUCK", "stuck heading to block", 5, true); } }));
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }] });
    const marks: Array<{ pos: Pos; ms?: number }> = [];
    (w.ctx.body as unknown as { unreachable: { mark: (p: Pos, ms?: number) => void } }).unreachable.mark = (pos, ms) => void marks.push({ pos, ms });
    const result = await mineBlock(w.ctx, ["oak_log"], 32);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("STUCK");
    expect(w.digs()).toBe(0);
    expect(w.count("oak_log")).toBe(0);
    expect(navCalls).toBeGreaterThanOrEqual(1);
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]?.pos).toMatchObject({ x: 6, y: 64, z: 5 });
  });

  it("mineBlock: a CANCELLED approach is NOT blacklisted (a cancel is not evidence the block is unreachable)", async () => {
    setNavigationBackend(stubNav({ navigateToInteractWithBlock: async () => fail("CANCELLED", "aborted", 1, false) }));
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }] });
    let marked = 0;
    (w.ctx.body as unknown as { unreachable: { mark: () => void } }).unreachable.mark = () => void (marked += 1);
    const result = await mineBlock(w.ctx, ["oak_log"], 32);
    expect(result.success).toBe(false);
    expect(marked).toBe(0);
    expect(w.digs()).toBe(0);
  });

  it("a gather that keeps failing is eventually told to back off instead of looping forever", async () => {
    setNavigationBackend(stubNav());
    const store = newStore();
    let previous: LastOutcome | undefined;
    const trail: boolean[] = [];
    for (let i = 0; i < RETRYABLE_FAILURE_LIMIT; i += 1) {
      const w = world({ logs: [] }); // nothing to gather => BLOCK_NOT_FOUND each time
      const result = await executePlan(w.ctx, woodPlan, store, new EventBus(), new SettlementRuntime());
      expect(physicalWorkComplete(result)).toBe(false);
      previous = lastOutcomeFrom(woodPlan, result, previous);
      trail.push(shouldBackoffToObserve(previous));
    }
    expect(trail).toEqual([false, false, true]);
    store.close();
  });
});

describe("OPS-001 failure recovery: executor failure paths", () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("bot.dig throwing a non-Error value becomes a DIG_FAILED result (no throw), no event, no claim left behind", async () => {
    setNavigationBackend(stubNav());
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }], dig: async () => { throw "weird"; } });
    const events = new EventBus();
    const seen: string[] = [];
    events.on((e) => seen.push(e.type));
    const runtime = new SettlementRuntime();
    const result = await executePlan(w.ctx, woodPlan, newStore(), events, runtime);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("DIG_FAILED");
      expect(result.error).toBe("weird");
      expect(result.retryable).toBe(true);
    }
    expect(seen).not.toContain("ResourceCollected");
    expect(runtime.claims.ownerOf("tree", cellClaimKey(6, 64, 5))).toBeUndefined();
  });

  it("recovers on the next attempt: a transient dig failure followed by a good dig succeeds and the retry is verified", async () => {
    setNavigationBackend(stubNav());
    let call = 0;
    const w = world({
      logs: [{ x: 6, y: 64, z: 5 }],
      dig: async (_b, h) => {
        call += 1;
        if (call === 1) throw new Error("dig interrupted");
        h.remove();
        h.give();
      },
    });
    const result = await executePlan(w.ctx, woodPlan, newStore(), new EventBus(), new SettlementRuntime());
    expect(result.success).toBe(true);
    expect(w.count("oak_log")).toBe(1);
  });

  it("a navigation backend that THROWS (socket reset) escapes executePlan as a rejection; the caller must catch it", async () => {
    setNavigationBackend(stubNav({ navigateToInteractWithBlock: async () => { throw new Error("socket reset"); } }));
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }] });
    await expect(executePlan(w.ctx, woodPlan, newStore(), new EventBus(), new SettlementRuntime())).rejects.toThrow("socket reset");
    expect(w.digs()).toBe(0);
  });

  // CONFIRMED (OPS-001): executor.ts:649-668 mineClaimedTarget (claim taken in tryClaim, release at :662) takes a 60 s claim, awaits mineBlock(), and
  // releases only on the NORMAL return path (no try/finally). If mineBlock rejects (nav backend throws, e.g. socket reset),
  // the claim leaks for its full TTL and manager.ts:666-ff only records the failure; it never releases claims on a
  // failed task (only death/respawn does, via lifecycle.ts). Other citizens cannot take that tree/ore for up to 60 s.
  it.fails("KNOWN BUG: a navigation throw inside the claimed-excavation fallback must not leak the citizen's claim", async () => {
    let navCalls = 0;
    setNavigationBackend(
      stubNav({
        navigateToInteractWithBlock: async (_b, t) => {
          navCalls += 1;
          if (navCalls >= 2) throw new Error("socket reset"); // 1st call: collectResource; 2nd: the fallback's mineBlock
          return ok({ position: { ...t }, distance: 1 }, 1);
        },
      }),
    );
    const w = world({ logs: [{ x: 6, y: 64, z: 5 }], dig: async () => { throw new Error("dig interrupted"); } });
    const runtime = new SettlementRuntime();
    await executePlan(w.ctx, woodPlan, newStore(), new EventBus(), runtime).catch(() => undefined);
    expect(navCalls).toBe(2); // the fallback really ran and threw
    expect(runtime.claims.ownerOf("tree", cellClaimKey(6, 64, 5))).toBeUndefined();
  });

  it("claims are TTL-bounded: even a leaked claim expires and the rival can take over", () => {
    const runtime = new SettlementRuntime();
    const t0 = 1_000_000;
    expect(runtime.claims.tryClaim("tree", "6,64,5", "citizen_atlas", 60_000, t0)).toBe(true);
    expect(runtime.claims.tryClaim("tree", "6,64,5", "citizen_maya", 60_000, t0 + 59_999)).toBe(false);
    expect(runtime.claims.tryClaim("tree", "6,64,5", "citizen_maya", 60_000, t0 + 60_000)).toBe(true);
    expect(runtime.claims.ownerOf("tree", "6,64,5", t0 + 60_001)).toBe("citizen_maya");
  });

  it("a claim can only be released by its owner (a stale release from a dead task cannot free a rival's claim)", () => {
    const runtime = new SettlementRuntime();
    runtime.claims.tryClaim("ore", "1,2,3", "citizen_atlas", 60_000);
    expect(runtime.claims.release("ore", "1,2,3", "citizen_maya")).toBe(false);
    expect(runtime.claims.ownerOf("ore", "1,2,3")).toBe("citizen_atlas");
    expect(runtime.claims.release("ore", "1,2,3", "citizen_atlas")).toBe(true);
  });
});

describe("OPS-001 failure recovery: backoff policy boundaries", () => {
  it("shouldBackoffToObserve: fires at exactly RETRYABLE_FAILURE_LIMIT consecutive failures, never before", () => {
    expect(RETRYABLE_FAILURE_LIMIT).toBe(3);
    expect(shouldBackoffToObserve(last({ streak: 2 }))).toBe(false);
    expect(shouldBackoffToObserve(last({ streak: 3 }))).toBe(true);
    expect(shouldBackoffToObserve(last({ streak: 40 }))).toBe(true);
    expect(shouldBackoffToObserve(undefined)).toBe(false);
    expect(shouldBackoffToObserve(last({ success: true, streak: 9 }))).toBe(false);
  });

  it.each(["CANCELLED", "INTERRUPTED", "CURFEW_STOP", "NOT_SLEEP_TIME"])("%s is never a back-off reason, however long the streak", (code) => {
    expect(shouldBackoffToObserve(last({ code, streak: 99 }))).toBe(false);
  });

  it("retryable:false failures never back off here (they are handled as unresolved blocks instead); STUCK/TIMEOUT do", () => {
    expect(shouldBackoffToObserve(last({ code: "ACCESS_DENIED", retryable: false, streak: 9 }))).toBe(false);
    expect(shouldBackoffToObserve(last({ code: "STUCK", streak: 3 }))).toBe(true);
    expect(shouldBackoffToObserve(last({ code: "TIMEOUT", streak: 3 }))).toBe(true);
    expect(shouldBackoffToObserve(last({ code: "STUCK", retryable: undefined, streak: 3 }))).toBe(true);
  });

  it("lastOutcomeFrom: streak counts per task, resets on a different task, and resets to 0 on verified success", () => {
    const f = failing("STUCK");
    const a1 = lastOutcomeFrom(plan({ task: "go_home" }), f);
    const a2 = lastOutcomeFrom(plan({ task: "go_home" }), f, a1);
    expect([a1.streak, a2.streak]).toEqual([1, 2]);
    expect(lastOutcomeFrom(plan({ task: "gather_wood" }), f, a2).streak).toBe(1);
    const good = lastOutcomeFrom(plan({ task: "go_home" }), ok({ collected: 1 }, 1), a2);
    expect(good).toMatchObject({ success: true, streak: 0, workComplete: true });
  });

  // SUSPECTED (OPS-001): lastOutcomeFrom (task-recovery.ts:163) increments the streak for CANCELLED / INTERRUPTED too, and
  // shouldBackoffToObserve only ignores the cancel itself, so two genuine failures + one user cancel + one more failure
  // reaches streak 4 and backs off after only 3 real failures; a cancel never resets the count. Characterisation only.
  it("characterisation: a cancel in the middle of a failure streak still counts toward the streak", () => {
    const f = failing("STUCK");
    let o = lastOutcomeFrom(plan(), f);
    o = lastOutcomeFrom(plan(), f, o);
    o = lastOutcomeFrom(plan(), failing("CANCELLED", false), o);
    expect(o.streak).toBe(3);
    expect(shouldBackoffToObserve(o)).toBe(false); // the cancel itself is exempt
    o = lastOutcomeFrom(plan(), f, o);
    expect(o.streak).toBe(4);
    expect(shouldBackoffToObserve(o)).toBe(true); // only 3 real failures happened
  });

  // SUSPECTED (OPS-001): task-recovery.ts:164 marks a "success but not physically complete" result retryable:false, and
  // shouldBackoffToObserve (:141) returns false for retryable === false, so a skill that keeps returning ok({collected:0})
  // can never trigger backoff. Not reachable from collectResource today (it returns a failure when gained<=0).
  it("characterisation: an endlessly 'successful but incomplete' skill result never backs off", () => {
    const incomplete = ok({ collected: 0 }, 1);
    let o: LastOutcome | undefined;
    for (let i = 0; i < 10; i += 1) o = lastOutcomeFrom(plan(), incomplete, o);
    expect(o?.streak).toBe(10);
    expect(o?.retryable).toBe(false);
    expect(shouldBackoffToObserve(o)).toBe(false);
  });

  it("food search backoff: only exhausted-search codes on an acquire-food task at the streak limit", () => {
    const base = last({ task: "acquire_food", action: "gatherFood", code: "FOOD_NOT_FOUND", streak: FAILURE_BACKOFF_STREAK });
    expect(shouldBackoffFoodSearch(base)).toBe(true);
    expect(shouldBackoffFoodSearch({ ...base, streak: FAILURE_BACKOFF_STREAK - 1 })).toBe(false);
    expect(shouldBackoffFoodSearch({ ...base, code: "STUCK" })).toBe(false);
    expect(shouldBackoffFoodSearch({ ...base, task: "gather_wood", action: "mineBlock" })).toBe(false);
    expect(shouldBackoffFoodSearch({ ...base, success: true })).toBe(false);
    expect(foodSearchHasAlternateOpportunity({ animalsNearby: false, canFish: false, farmReachable: true })).toBe(true);
    expect(foodSearchHasAlternateOpportunity({ animalsNearby: false, canFish: false, farmReachable: false })).toBe(false);
  });

  it("home/sleep route backoff: STUCK, TIMEOUT, PATH_BLOCKED, NAV_NO_INITIAL_PROGRESS at the limit; reason names the obstacle", () => {
    for (const code of ["STUCK", "TIMEOUT", "PATH_BLOCKED", "NAV_NO_INITIAL_PROGRESS", "BED_UNREACHABLE", "INTERIOR_UNREACHABLE"]) {
      const o = last({ task: "sleep_at_home", action: "sleep", code, streak: 3 });
      expect(shouldBackoffHomeSleepRoute(o)).toBe(true);
      expect(shouldBackoffHomeSleepRoute({ ...o, streak: 2 })).toBe(false);
    }
    expect(shouldBackoffHomeSleepRoute(last({ task: "sleep_at_home", action: "sleep", code: "CANCELLED", streak: 9 }))).toBe(false);
    const reason = homeSleepBackoffReason(last({ task: "sleep_at_home", code: "STUCK", streak: 3, error: "route; obstacle=crafting_table; x" }));
    expect(reason).toContain("obstacle=crafting_table");
    expect(reason).toContain("3×");
  });
});

describe("OPS-001 failure recovery: unresolved blocks lift when the world changes", () => {
  const blocks = (items: UnresolvedBlock[]) => items;

  it("mergeUnresolved: records non-retryable failures once per action, ignores cancel/stuck, clears on completion", () => {
    const denied = failing("ACCESS_DENIED", false);
    let list = mergeUnresolved(undefined, plan({ action: "storeItems", task: "store" }), denied, false);
    list = mergeUnresolved(list, plan({ action: "storeItems", task: "store" }), denied, false);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ action: "storeItems", code: "ACCESS_DENIED" });
    expect(mergeUnresolved(list, plan({ action: "mineBlock" }), failing("CANCELLED", false), false)).toHaveLength(1);
    expect(mergeUnresolved(list, plan({ action: "mineBlock" }), failing("STUCK"), false)).toHaveLength(1); // retryable codes are not parked
    expect(mergeUnresolved(list, plan({ action: "storeItems", task: "store" }), ok({ collected: 1 }, 1), true)).toEqual([]);
  });

  it("each parked block lifts only when its own precondition is met", () => {
    const denied: UnresolvedBlock = { action: "storeItems", task: "store", code: "ACCESS_DENIED" };
    expect(unresolvedStillApplies(denied, facts())).toBe(true);
    expect(unresolvedStillApplies(denied, facts({ hasStorage: true }))).toBe(false);
    const tool: UnresolvedBlock = { action: "mineOre", task: "mine_ore", code: "MISSING_TOOL" };
    expect(unresolvedStillApplies(tool, facts())).toBe(true);
    expect(unresolvedStillApplies(tool, facts({ hasPickaxe: true }))).toBe(false);
    const exhausted: UnresolvedBlock = { action: "fishShore", task: "fish_shore", code: "SEARCH_EXHAUSTED" };
    expect(unresolvedStillApplies(exhausted, facts())).toBe(true);
    expect(unresolvedStillApplies(exhausted, facts({ hasShore: true }))).toBe(false);
    const conflict: UnresolvedBlock = { action: "claimHome", code: "CLAIM_CONFLICT", item: "home_h9" };
    expect(unresolvedStillApplies(conflict, facts({ availableHomeIds: ["home_h1"] }))).toBe(true);
    expect(unresolvedStillApplies(conflict, facts({ availableHomeIds: ["home_h9"] }))).toBe(false);
  });

  it("suppressed actions / homes follow the blocks and vanish as facts change", () => {
    const list = blocks([
      { action: "storeItems", task: "store", code: "ACCESS_DENIED" },
      { action: "claimHome", code: "CLAIM_CONFLICT", item: "home_h9" },
    ]);
    expect([...suppressedActions(list, facts())].sort()).toEqual(["claimHome", "storeItems", "store"].sort());
    expect([...suppressedHomeIds(list, facts())]).toEqual(["home_h9"]);
    expect([...suppressedActions(list, facts({ hasStorage: true, availableHomeIds: ["home_h9"] }))]).toEqual([]);
    expect([...suppressedHomeIds(list, facts({ availableHomeIds: ["home_h9"] }))]).toEqual([]);
    expect(suppressedActions(undefined, facts()).size).toBe(0);
  });
});
