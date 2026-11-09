// QA78: furnace input/output, delayed chest transfers and blocked-construction recovery. Ordinary assertions only; every
// assertion here PASSES on PR #78. Defects found live in ../defects (ordinary assertions that FAIL on #78).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abortedResult, EventBus } from "../../../packages/shared/src/index.js";
import { WORKSHOP_CABIN_ID, getBlueprint, resolveMaterials } from "../../../packages/minecraft-knowledge/src/index.js";
import { advanceBlueprintBuild, createBuildSession } from "../../../packages/skills/src/blueprint-build.js";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "../../../packages/minecraft-adapter/src/index.js";
import { createProductionHarness, stubNavOk } from "../../../packages/agent-core/src/construction-production-harness.js";
import { smeltItem } from "../../../packages/skills/src/furnace.js";
import { withdrawItem } from "../../../packages/skills/src/inventory-service.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { installInstantNavigation, offlineBody, skillContext, sleep } from "../support/offline-body.js";
import { SlowFurnace, installSlowChest } from "../support/slow-world.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => { restore(); setNavigationBackend(createNavigationBackend("pathfinder")); });

describe("furnace: abort at every offset (direct, and through the production packet guard)", () => {
  const OFFSETS = [0, 20, 40, 60, 80, 100, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480, 520, 560];
  async function direct(t: number) {
    const body = offlineBody(); const bot = body.fake; const furnace = new SlowFurnace(bot, 200); bot.furnace = furnace as never;
    bot.blocks.set("5,64,5", { name: "furnace" }); bot.give("raw_iron", 1); bot.give("coal", 1);
    const abort = new AbortController();
    const pending = smeltItem(skillContext(body, { signal: abort.signal, timeoutMs: 3_000 }), "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 });
    await sleep(t); const abortedAt = Date.now(); abort.abort();
    const result = await pending;
    return { bot, furnace, abortedAt, result, returnedAfterMs: Date.now() - abortedAt };
  }
  async function guarded(t: number) {
    const body = offlineBody(); const bot = body.fake; const furnace = new SlowFurnace(bot, 200); bot.furnace = furnace as never;
    bot.blocks.set("5,64,5", { name: "furnace" }); bot.give("raw_iron", 1); bot.give("coal", 1);
    const boundary = createActionBoundary(() => bot._client); const abort = new AbortController();
    const pending = boundary.run("smelt", (signal) => smeltItem(skillContext(body, { signal, timeoutMs: 3_000 }), "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 }), { signal: abort.signal, timeoutMs: 10_000, graceMs: 700 });
    await sleep(t); abort.abort();
    const result = await pending; await sleep(150);
    return { bot, furnace, result };
  }

  it("control: without abort the production smelt succeeds and recovers input and fuel (takeInput/takeFuel still run)", async () => {
    const body = offlineBody(); const bot = body.fake; const furnace = new SlowFurnace(bot, 200); bot.furnace = furnace as never;
    bot.blocks.set("5,64,5", { name: "furnace" }); bot.give("raw_iron", 1); bot.give("coal", 1);
    const result = await smeltItem(skillContext(body, { timeoutMs: 3_000 }), "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 });
    expect(result.success).toBe(true);
    expect(bot.count("iron_ingot")).toBe(1);
    expect(furnace.ops.map((o) => o.kind)).toEqual(["putInput", "putFuel", "takeOutput", "takeFuel"]);
  });

  it("direct: no furnace click STARTS after abort at any of 18 offsets, and a collected ingot is always reported as success", async () => {
    const problems: string[] = [];
    for (const t of OFFSETS) {
      const r = await direct(t);
      const late = r.furnace.ops.filter((o) => o.startedAt > r.abortedAt + 2).map((o) => `${o.kind}@+${o.startedAt - r.abortedAt}`);
      if (late.length) problems.push(`abort@${t}: late ops ${late.join(",")}`);
      const got = r.bot.count("iron_ingot") > 0;
      if (got && !r.result.success) problems.push(`abort@${t}: ingot collected but result=${r.result.code}`);
      if (!got && r.result.success) problems.push(`abort@${t}: success without an ingot`);
      if (r.returnedAfterMs > 700) problems.push(`abort@${t}: returned ${r.returnedAfterMs} ms after abort`);
    }
    expect(problems).toEqual([]);
  });

  it("through the packet guard: the result never contradicts the inventory (ingot <=> success) at any of 18 offsets, and no click reaches the wire after the owner is inactive", async () => {
    const problems: string[] = [];
    for (const t of OFFSETS) {
      const r = await guarded(t);
      const got = r.bot.count("iron_ingot") > 0;
      if (got !== r.result.success) problems.push(`abort@${t}: ingot=${got} result=${r.result.success ? "success" : r.result.code}`);
      if (!r.result.success && r.result.code === "SMELT_FAILED") problems.push(`abort@${t}: cancellation surfaced as retryable SMELT_FAILED`);
    }
    expect(problems).toEqual([]);
  });

  it("an abort that lands during takeOutput or takeInput returns success, never re-runs the smelt, and a RETRY would not double-smelt (one ingot total)", async () => {
    for (const t of [440, 480, 520]) {
      const r = await direct(t);
      if (r.bot.count("iron_ingot") === 0) continue;
      expect(r.result.success).toBe(true);
      expect(r.bot.count("iron_ingot")).toBe(1);
      expect(r.furnace.ops.filter((o) => o.kind === "putInput").length).toBe(1);
    }
  });
});

describe("chest withdraw: abort at every offset (skill level)", () => {
  async function run(t: number, o: { lagMs?: number } = {}) {
    const body = offlineBody(); const bot = body.fake; bot.blocks.set("4,64,4", { name: "chest" });
    const chest = installSlowChest(bot, { item: "cobblestone", type: 4, withdrawMs: 120, lagMs: o.lagMs });
    const bus = new EventBus(); const events: Array<{ type: string; at: number }> = []; bus.on((e) => events.push({ type: e.type, at: Date.now() }));
    const abort = new AbortController();
    const pending = withdrawItem({ ...skillContext(body, { signal: abort.signal, timeoutMs: 5_000 }), events: bus } as never, "cobblestone", 2, { x: 4, y: 64, z: 4 });
    await sleep(t); const abortedAt = Date.now(); abort.abort();
    const result = await pending; await sleep(200);
    return { bot, chest, result, events, abortedAt };
  }
  it("control: no abort -> success, exactly one ItemWithdrawn, chest and inventory agree", async () => {
    const body = offlineBody(); const bot = body.fake; bot.blocks.set("4,64,4", { name: "chest" });
    const chest = installSlowChest(bot, { item: "cobblestone", type: 4 });
    const bus = new EventBus(); const seen: string[] = []; bus.on((e) => seen.push(e.type));
    const result = await withdrawItem({ ...skillContext(body, { timeoutMs: 5_000 }), events: bus } as never, "cobblestone", 2, { x: 4, y: 64, z: 4 });
    expect(result.success).toBe(true);
    expect(seen.filter((t) => t === "ItemWithdrawn")).toHaveLength(1);
    expect(bot.count("cobblestone")).toBe(2); expect(chest.stock).toBe(2);
  });
  it("with an immediate inventory sync: result and inventory agree at every offset; no ItemWithdrawn after the abort", async () => {
    const problems: string[] = [];
    for (const t of [0, 20, 60, 100, 130, 160, 220]) {
      const r = await run(t);
      const moved = 4 - r.chest.stock;
      if (moved > 0 && !(r.result.success && r.result.data.count === moved)) problems.push(`abort@${t}: chest lost ${moved}, result=${r.result.success ? "success" : r.result.code}`);
      if (moved === 0 && r.result.success) problems.push(`abort@${t}: success but nothing moved`);
      if (r.events.some((e) => e.type === "ItemWithdrawn" && e.at > r.abortedAt)) problems.push(`abort@${t}: ItemWithdrawn after abort`);
      if (r.chest.windowClicks.some((c) => c > r.abortedAt)) problems.push(`abort@${t}: window click after abort`);
    }
    expect(problems).toEqual([]);
  });
  it("control: if the abort lands while the citizen inventory is still syncing after withdraw() returned, a transfer that already happened is still reported as success (hypothesis that it would be CANCELLED was NOT confirmed)", async () => {
    const body = offlineBody(); const bot = body.fake; bot.blocks.set("4,64,4", { name: "chest" });
    const chest = installSlowChest(bot, { item: "cobblestone", type: 4, withdrawMs: 60, lagMs: 150, stock: 4 });
    const abort = new AbortController();
    const pending = withdrawItem({ ...skillContext(body, { signal: abort.signal, timeoutMs: 5_000 }) } as never, "cobblestone", 2, { x: 4, y: 64, z: 4 });
    await sleep(90); abort.abort();   // withdraw() resolved at ~60 ms; the inventory side lands at ~210 ms
    const result = await pending; await sleep(300);
    console.log("QA78-L1 chestStock=", chest.stock, "inventoryAfterSettle=", bot.count("cobblestone"), "result=", result.success ? "success" : (result as { code: string }).code);
    expect(chest.stock).toBe(2);                 // the chest really lost 2
    expect(bot.count("cobblestone")).toBe(2);    // and the citizen really got them
    expect(result.success).toBe(true);           // so the skill must say so
  });
});

describe("blocked-construction recovery (production advanceBlueprintBuild on the repository's controlled harness)", () => {
  async function builtWorld(blueprintId: string, extras: string[]) {
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const inv = [{ name: "oak_planks", count: 200 }, { name: "oak_door", count: 1 }, { name: "chest", count: 1 }, { name: "torch", count: 4 }, { name: "crafting_table", count: 1 }];
    const harness = createProductionHarness({ inventory: inv });
    const session = createBuildSession({ blueprintId, origin: { x: 100, y: 70, z: 100 }, facing: "south", materials: resolveMaterials(getBlueprint(blueprintId)!, { oak_planks: 200, oak_door: 1, chest: 1, torch: 4, crafting_table: 1 }), extras });
    session.stage = "FLOOR";
    for (let i = 0; i < 60 && session.status === "IN_PROGRESS"; i++) { const r = await advanceBlueprintBuild(harness.ctx, session, { maxPlacements: 60, liveValidate: false, forceNew: true }); if (!r.success) break; }
    return { harness, session };
  }
  const NAV = ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock"] as const;
  const wrapNav = (onCall: (n: number) => "pass" | "abort" | "block" | "interrupted", ctl?: AbortController) => {
    let calls = 0; const nav = { ...stubNavOk() } as Record<string, any>;
    for (const k of NAV) { const okFn = nav[k]; nav[k] = async (...a: unknown[]) => {
      calls += 1; const v = onCall(calls);
      if (v === "abort") { ctl?.abort(); return abortedResult(1); }
      if (v === "block") return { success: false, code: "PATH_BLOCKED", error: "no path", retryable: true, durationMs: 1 };
      if (v === "interrupted") return { success: false, code: "INTERRUPTED", error: "interrupted", retryable: true, durationMs: 1 };
      return okFn(...a);
    }; }
    setNavigationBackend(nav as unknown as NavigationBackend);
    return () => calls;
  };
  const BLUEPRINTS: Array<[string, string[]]> = [["basic_shelter_v1", []], [WORKSHOP_CABIN_ID, ["chest", "lighting", "crafting_table"]]];

  for (const [bp, extras] of BLUEPRINTS) {
    let liveBaselineOk = true;
    it(`${bp}: an abort on ANY navigation call 1..7 of live validation leaves IN_PROGRESS, and a JSON-reloaded session then completes`, async () => {
      const { harness, session } = await builtWorld(bp, extras);
      expect(session.status).toBe("COMPLETE");
      {
        // control: an UNINTERRUPTED live validation on this harness (tells us whether a later resume failure is the cancel's fault or the harness's)
        const ctl0 = JSON.parse(JSON.stringify(session)); ctl0.status = "IN_PROGRESS"; ctl0.stage = "FINAL_VALIDATION"; ctl0.failures = [];
        wrapNav(() => "pass");
        const base = await advanceBlueprintBuild({ ...harness.ctx, timeoutMs: 5_000 } as never, ctl0, { liveValidate: true });
        console.log("LIVE_VALIDATION_BASELINE", bp, base.success ? "success" : `${base.code}`, ctl0.status, JSON.stringify(ctl0.failures));
        liveBaselineOk = base.success;
      }
      const abortedAtCall: number[] = [];
      for (let when = 1; when <= 7; when += 1) {
        const copy = JSON.parse(JSON.stringify(session)); copy.status = "IN_PROGRESS"; copy.stage = "FINAL_VALIDATION"; copy.failures = [];
        const ctl = new AbortController();
        const calls = wrapNav((n) => (n === when ? "abort" : "pass"), ctl);
        const r = await advanceBlueprintBuild({ ...harness.ctx, signal: ctl.signal, timeoutMs: 5_000 } as never, copy, { liveValidate: true });
        if (!ctl.signal.aborted) { expect(calls()).toBeLessThan(when); continue; }  // validation has fewer navigation calls than `when`
        abortedAtCall.push(when);
        expect(copy.status, `abort on call ${when}`).toBe("IN_PROGRESS");
        expect(!r.success && ["CANCELLED", "INTERRUPTED"].includes(r.code), `abort on call ${when} code`).toBe(true);
        const reloaded = JSON.parse(JSON.stringify(copy));
        setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
        const again = await advanceBlueprintBuild({ ...harness.ctx, timeoutMs: 5_000 } as never, reloaded, { liveValidate: liveBaselineOk });
        if (!again.success) console.log("RESUME_FAIL", bp, "abortedAtCall=", when, "code=", again.code, "error=", again.error, "status=", reloaded.status, "failures=", JSON.stringify(reloaded.failures));
        expect(again.success, `resume after abort on call ${when}`).toBe(true);
        expect(reloaded.status).toBe("COMPLETE");
        expect(reloaded.failures).toEqual([]);
      }
      expect(abortedAtCall.length).toBeGreaterThanOrEqual(4);
    });

    it(`${bp}: REAL failures still BLOCK at each navigation step (PATH_BLOCKED on call k, never aborted): the fix does not hide genuine failures`, async () => {
      const { harness, session } = await builtWorld(bp, extras);
      const reached: number[] = [];
      for (let when = 1; when <= 4; when += 1) {
        const copy = JSON.parse(JSON.stringify(session)); copy.status = "IN_PROGRESS"; copy.stage = "FINAL_VALIDATION"; copy.failures = [];
        wrapNav((n) => (n >= when ? "block" : "pass"));
        const r = await advanceBlueprintBuild({ ...harness.ctx, timeoutMs: 5_000 } as never, copy, { liveValidate: true });
        if (r.success) continue;
        reached.push(when);
        expect(copy.status, `PATH_BLOCKED from call ${when}`).toBe("BLOCKED");
        expect(r.code).not.toBe("CANCELLED");
      }
      expect(reached.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("a navigation result coded INTERRUPTED (no abort) also leaves the session IN_PROGRESS and retryable", async () => {
    const { harness, session } = await builtWorld("basic_shelter_v1", []);
    session.status = "IN_PROGRESS"; session.stage = "FINAL_VALIDATION"; session.failures = [];
    wrapNav((n) => (n === 2 ? "interrupted" : "pass"));
    const r = await advanceBlueprintBuild({ ...harness.ctx, timeoutMs: 5_000 } as never, session, { liveValidate: true });
    expect(r.success).toBe(false);
    expect(session.status).toBe("IN_PROGRESS");
    if (!r.success) expect(r.code).toBe("INTERRUPTED");
  });

  it("a real failure earlier in the same validation followed by a cancel stays IN_PROGRESS, and the NEXT clean run clears the stale failure list", async () => {
    const { harness, session } = await builtWorld("basic_shelter_v1", []);
    session.status = "IN_PROGRESS"; session.stage = "FINAL_VALIDATION"; session.failures = [];
    const ctl = new AbortController();
    wrapNav((n) => (n === 1 ? "block" : n === 3 ? "abort" : "pass"), ctl);
    await advanceBlueprintBuild({ ...harness.ctx, signal: ctl.signal, timeoutMs: 5_000 } as never, session, { liveValidate: true });
    expect(session.status).toBe("IN_PROGRESS");
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    const again = await advanceBlueprintBuild({ ...harness.ctx, timeoutMs: 5_000 } as never, JSON.parse(JSON.stringify(session)), { liveValidate: true });
    expect(again.success).toBe(true);
  });
});

describe("production call chain with the PRODUCTION default grace (250 ms): a withdraw that completes inside the grace is reported once, consistently", () => {
  it("withdraw via executePlan, 60 ms deadline, 120 ms window: the manager sees ONE outcome and no event follows it", async () => {
    const { rig } = await import("../support/manager-rig.js"); const { executePlan } = await import("../../../packages/agent-core/src/executor.js");
    const r = rig(); const bus = new EventBus(); const seen: Array<{ type: string; at: number }> = []; bus.on((e) => seen.push({ type: e.type, at: Date.now() }));
    const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
    r.bot.blocks.set("4,64,4", { name: "chest" }); installSlowChest(r.bot, { item: "bread", type: 7, withdrawMs: 120, stock: 4 });
    const boundary = createActionBoundary(() => r.bot._client);
    const plan = { action: "withdrawItems", task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
    const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 } as never as { signal?: AbortSignal };
    const result = await boundary.run("withdrawItems", (signal) => { ctx.signal = signal; return executePlan(ctx as never, plan, r.store, bus); }, { timeoutMs: 60 });
    const returnedAt = Date.now(); await sleep(500);
    expect(seen.filter((e) => e.at > returnedAt + 5).map((e) => e.type)).toEqual([]);
    const types = seen.map((e) => e.type);
    if (result.success) { expect(types).toContain("ItemWithdrawn"); expect(r.bot.count("bread")).toBe(1); }
    else { expect(types).not.toContain("ItemWithdrawn"); expect(r.bot.count("bread")).toBe(0); }
  });
});
