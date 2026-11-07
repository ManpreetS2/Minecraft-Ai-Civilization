// Abort sweeps over the PRODUCTION skills on controlled offline bodies (frozen PR #66 fixture, authored before the fix).
// Instead of one abort time per defect, abort is injected at many offsets and invariants are checked at every one.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { smeltItem } from "../../../packages/skills/src/furnace.js";
import { depositItem, withdrawItem } from "../../../packages/skills/src/inventory-service.js";
import { placeBlock } from "../../../packages/skills/src/world.js";
import { huntAnimal } from "../../../packages/skills/src/combat.js";
import { executeStructure } from "../../../packages/skills/src/structure.js";
import { openWindowBounded, waitForSignal, WindowOpenError } from "../../../packages/skills/src/window-open.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { installInstantNavigation, offlineBody, skillContext, sleep, type OfflineBot } from "../support/offline-body.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

interface Op { kind: string; startedAt: number; doneAt?: number }
/** A furnace whose every operation takes time, so abort can land inside it. Mirrors the window API used by smeltItem. */
class SlowFurnace {
  readonly ops: Op[] = [];
  private input = 0; private fuel = 0; private out = 0; private readonly t0 = Date.now();
  constructor(private readonly bot: OfflineBot, private readonly producesAfterMs: number, private readonly d = { put: 30, take: 80, tail: 10 }) {}
  private async op(kind: string, ms: number, apply: () => void) {
    const o: Op = { kind, startedAt: Date.now() }; this.ops.push(o);
    this.bot._client.write("window_click", { kind }); // a real packet: the production guard can refuse it
    await sleep(ms); apply(); o.doneAt = Date.now();
    this.bot.mutations.push({ kind: `furnace.${kind}`, at: o.startedAt });
  }
  fuelItem() { return this.fuel ? { name: "coal", count: this.fuel, type: 3 } : null; }
  inputItem() { return this.input ? { name: "raw_iron", count: this.input, type: 1 } : null; }
  outputItem() { return this.out || (Date.now() - this.t0 >= this.producesAfterMs && this.input) ? { name: "iron_ingot", count: 1, type: 2 } : null; }
  putInput() { return this.op("putInput", this.d.put, () => { this.input = 1; }); }
  putFuel() { return this.op("putFuel", this.d.put, () => { this.fuel = 1; }); }
  takeOutput() { return this.op("takeOutput", this.d.take, () => { this.input = 0; this.out = 0; this.bot.give("iron_ingot", 1); }); }
  takeInput() { return this.op("takeInput", this.d.tail, () => undefined); }
  takeFuel() { return this.op("takeFuel", this.d.tail, () => undefined); }
  close() { /* not a mutation */ }
}

describe("smeltItem: abort sweep", () => {
  async function run(abortAfterMs: number) {
    const body = offlineBody(); const bot = body.fake;
    const furnace = new SlowFurnace(bot, 200); bot.furnace = furnace as never;
    bot.blocks.set("5,64,5", { name: "furnace" }); bot.give("raw_iron", 1); bot.give("coal", 1);
    const abort = new AbortController();
    const pending = smeltItem(skillContext(body, { signal: abort.signal, timeoutMs: 3_000 }), "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 });
    await sleep(abortAfterMs);
    const abortedAt = Date.now(); abort.abort();
    const result = await pending;
    return { bot, furnace, abortedAt, result, returnedAfterMs: Date.now() - abortedAt };
  }
  it("[QA69-L1] no furnace operation STARTS after the abort, at any abort offset (0..450 ms)", async () => {
    const bad: string[] = [];
    for (const t of [0, 10, 40, 80, 120, 180, 230, 280, 330, 380, 430, 480]) {
      const r = await run(t);
      const late = r.furnace.ops.filter((o) => o.startedAt > r.abortedAt).map((o) => `${o.kind}@+${o.startedAt - r.abortedAt}`);
      if (late.length) bad.push(`abort@${t}ms: ${late.join(",")} (result success=${r.result.success})`);
    }
    console.log("SMELT_POST_ABORT_STARTS", bad.join(" || ") || "none");
    expect(bad).toEqual([]);
  });
  it("result is truthful: success iff the smelted ingot actually reached the inventory", async () => {
    const lies: string[] = [];
    for (const t of [0, 40, 120, 230, 280, 330, 380, 430, 480, 600]) {
      const r = await run(t);
      const got = r.bot.count("iron_ingot") > 0;
      if (got !== r.result.success) lies.push(`abort@${t}ms: gotIngot=${got} success=${r.result.success} code=${r.result.success ? "-" : r.result.code}`);
    }
    console.log("SMELT_TRUTHFULNESS", lies.join(" || ") || "all truthful");
    expect(lies).toEqual([]);
  });
  it("returns promptly after abort when it has not yet taken the output", async () => {
    const r = await run(60);
    expect(r.result.success).toBe(false);
    expect(r.returnedAfterMs).toBeLessThan(200);
  });
});

describe("chest deposit / withdraw: abort sweep", () => {
  function chestWindow(bot: OfflineBot, kind: "deposit" | "withdraw", ops: Op[]) {
    const stock = { n: kind === "withdraw" ? 4 : 0 };
    return {
      // container contents reflect state, so the skill's own before/after verification is meaningful
      containerItems: () => (kind === "deposit" ? [...bot.chest].filter(([, c]) => c > 0).map(([name, count]) => ({ name, count, type: 4 })) : stock.n > 0 ? [{ name: "cobblestone", count: stock.n, type: 4 }] : []),
      deposit: async (_t: number, _m: null, count: number) => { const o = { kind: "deposit", startedAt: Date.now() }; ops.push(o); bot._client.write("window_click"); await sleep(80); bot.chest.set("cobblestone", (bot.chest.get("cobblestone") ?? 0) + count); for (const s of bot.slots) if (s?.name === "cobblestone") { s.count -= count; break; } },
      withdraw: async (_t: number, _m: null, count: number) => { const o = { kind: "withdraw", startedAt: Date.now() }; ops.push(o); bot._client.write("window_click"); await sleep(80); stock.n -= count; bot.give("cobblestone", count); },
      close: () => undefined,
      kind,
    };
  }
  async function run(kind: "deposit" | "withdraw", abortAfterMs: number) {
    const body = offlineBody(); const bot = body.fake; const ops: Op[] = [];
    bot.blocks.set("4,64,4", { name: "chest" });
    if (kind === "deposit") bot.give("cobblestone", 4);
    (bot as unknown as { openContainer: () => Promise<unknown> }).openContainer = async () => { await sleep(40); return chestWindow(bot, kind, ops); };
    const abort = new AbortController();
    const ctx = skillContext(body, { signal: abort.signal, timeoutMs: 3_000 });
    const pending = kind === "deposit" ? depositItem(ctx, "cobblestone", 2, { x: 4, y: 64, z: 4 }) : withdrawItem(ctx, "cobblestone", 2, { x: 4, y: 64, z: 4 });
    await sleep(abortAfterMs); const abortedAt = Date.now(); abort.abort();
    const result = await pending;
    return { bot, ops, abortedAt, result };
  }
  for (const kind of ["deposit", "withdraw"] as const) {
    it(`${kind}: control (no abort) succeeds on this fixture`, async () => {
      const r = await run(kind, 10_000_000 > 0 ? 600 : 0); // abort fires after completion
      expect(r.result.success).toBe(true);
    });
    it(`${kind}: no transfer STARTS after abort at any offset, and success is truthful`, async () => {
      const bad: string[] = [];
      for (const t of [0, 10, 30, 60, 90, 130, 170, 230]) {
        const r = await run(kind, t);
        const late = r.ops.filter((o) => o.startedAt > r.abortedAt);
        const moved = kind === "deposit" ? (r.bot.chest.get("cobblestone") ?? 0) > 0 : r.bot.count("cobblestone") > 0;
        if (late.length) bad.push(`abort@${t}ms late=${late.map((o) => o.kind)}`);
        if (moved !== r.result.success) bad.push(`abort@${t}ms moved=${moved} success=${r.result.success} code=${r.result.success ? "-" : r.result.code}`);
      }
      console.log(`${kind.toUpperCase()}_SWEEP`, bad.join(" || ") || "clean");
      expect(bad).toEqual([]);
    });
  }
});

describe("placeBlock / executeStructure / huntAnimal: abort sweep", () => {
  it("placeBlock: no block_place starts after abort, and a failure after abort is CANCELLED", async () => {
    const bad: string[] = [];
    for (const t of [0, 20, 50, 90, 140, 200]) {
      const body = offlineBody(); const bot = body.fake;
      bot.timing.equipMs = 80; bot.timing.lookMs = 60; bot.blocks.set("2,63,0", { name: "stone" }); bot.give("cobblestone", 4);
      const abort = new AbortController();
      const pending = placeBlock(skillContext(body, { signal: abort.signal }), "cobblestone", { x: 2, y: 64, z: 0 });
      await sleep(t); const abortedAt = Date.now(); abort.abort();
      const r = await pending;
      const placed = bot.mutations.filter((m) => m.kind === "placeBlock");
      const late = placed.filter((m) => m.at > abortedAt);
      if (late.length) bad.push(`abort@${t}: placeBlock after abort`);
      if (!r.success && r.code !== "CANCELLED") bad.push(`abort@${t}: code=${r.code}`);
      if (r.success !== (placed.length > 0)) bad.push(`abort@${t}: success=${r.success} placed=${placed.length}`);
    }
    console.log("PLACE_SWEEP", bad.join(" || ") || "clean");
    expect(bad).toEqual([]);
  });
  it("executeStructure: a cancel at any block is CANCELLED (never BUILD_BLOCKED) and nothing is placed after it", async () => {
    const bad: string[] = [];
    for (const t of [0, 40, 100, 160, 260]) {
      const body = offlineBody(); const bot = body.fake;
      bot.timing.equipMs = 40; bot.give("cobblestone", 8);
      for (const x of [2, 3, 4]) bot.blocks.set(`${x},63,0`, { name: "stone" });
      const abort = new AbortController();
      const pending = executeStructure(skillContext(body, { signal: abort.signal }),
        { id: "s", blocks: [0, 1, 2].map((dx) => ({ dx, dy: 0, dz: 0, block: "cobblestone", purpose: "shelter_blueprint" })) } as never, { x: 2, y: 64, z: 0 });
      await sleep(t); const abortedAt = Date.now(); abort.abort();
      const r = await pending;
      if (bot.mutations.some((m) => m.kind === "placeBlock" && m.at > abortedAt)) bad.push(`abort@${t}: placed after abort`);
      if (!r.success && r.code !== "CANCELLED") bad.push(`abort@${t}: code=${r.code}`);
    }
    console.log("STRUCTURE_SWEEP", bad.join(" || ") || "clean");
    expect(bad).toEqual([]);
  });
  it("huntAnimal: no attack after abort at any offset; returns promptly", async () => {
    const bad: string[] = [];
    for (const t of [0, 100, 300, 500, 700]) {
      const body = offlineBody(); const bot = body.fake;
      bot.entities[42] = { id: 42, name: "cow", type: "animal", position: bot.entity.position.offset(1.5, 0, 0), health: 10 };
      const abort = new AbortController();
      const pending = huntAnimal(skillContext(body, { signal: abort.signal, timeoutMs: 2_000 }), "cow");
      await sleep(t); const abortedAt = Date.now(); abort.abort();
      const r = await pending; const ret = Date.now() - abortedAt;
      if (bot.mutations.some((m) => m.kind === "attack" && m.at > abortedAt)) bad.push(`abort@${t}: attack after abort`);
      if (ret > 150) bad.push(`abort@${t}: returned after ${ret} ms`);
      if (r.success) bad.push(`abort@${t}: success`);
    }
    console.log("HUNT_SWEEP", bad.join(" || ") || "clean");
    expect(bad).toEqual([]);
  });
});

describe("openWindowBounded", () => {
  const ctx = (o: { signal?: AbortSignal; timeoutMs?: number } = {}) => ({ signal: o.signal, timeoutMs: o.timeoutMs }) as never;
  const win = () => { const w = { closes: 0, close() { w.closes += 1; } }; return w; };
  it("calls open exactly once; a window arriving after CANCEL is closed exactly once and never returned", async () => {
    const a = new AbortController(); const w = win(); let calls = 0;
    const p = openWindowBounded(ctx({ signal: a.signal, timeoutMs: 1000 }), async () => { calls += 1; await sleep(60); return w; }, Date.now());
    setTimeout(() => a.abort(), 10);
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    await sleep(120);
    expect(calls).toBe(1); expect(w.closes).toBe(1);
  });
  it("a window arriving after the DEADLINE is closed exactly once", async () => {
    const w = win();
    const p = openWindowBounded(ctx({ timeoutMs: 30 }), async () => { await sleep(90); return w; }, Date.now());
    await expect(p).rejects.toMatchObject({ code: "TIMEOUT" });
    await sleep(120); expect(w.closes).toBe(1);
  });
  it("a late REJECTION after timeout/cancel is swallowed (no unhandled rejection) and a never-opening window times out", async () => {
    const seen: unknown[] = []; const h = (e: unknown) => seen.push(e); process.on("unhandledRejection", h);
    try {
      await expect(openWindowBounded(ctx({ timeoutMs: 20 }), () => new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 60)), Date.now())).rejects.toBeInstanceOf(WindowOpenError);
      await expect(openWindowBounded(ctx({ timeoutMs: 20 }), () => new Promise(() => undefined), Date.now())).rejects.toMatchObject({ code: "TIMEOUT" });
      await sleep(120);
    } finally { process.off("unhandledRejection", h); }
    expect(seen).toEqual([]);
  });
  it("an already-expired budget or pre-aborted signal never invokes open()", async () => {
    let calls = 0; const a = new AbortController(); a.abort();
    await expect(openWindowBounded(ctx({ signal: a.signal }), async () => { calls += 1; return win(); }, Date.now())).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(openWindowBounded(ctx({ timeoutMs: 100 }), async () => { calls += 1; return win(); }, Date.now() - 500)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(calls).toBe(0);
  });
  it("a synchronous throw from open(), and a close() that throws on the late path, do not escape as unhandled errors", async () => {
    await expect(openWindowBounded(ctx({ timeoutMs: 100 }), () => { throw new Error("sync"); }, Date.now())).rejects.toThrow("sync");
    const a = new AbortController();
    const bad = { close() { throw new Error("close failed"); } };
    const p = openWindowBounded(ctx({ signal: a.signal, timeoutMs: 1000 }), async () => { await sleep(40); return bad; }, Date.now());
    setTimeout(() => a.abort(), 5);
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    await sleep(80);
  });
  it("success path returns the window unclosed; waitForSignal removes its listener", async () => {
    const w = win();
    expect(await openWindowBounded(ctx({ timeoutMs: 500 }), async () => w, Date.now())).toBe(w);
    expect(w.closes).toBe(0);
    const a = new AbortController(); await waitForSignal(a.signal, 5);
    let n = 0; const sig = { aborted: false, addEventListener: () => { n += 1; }, removeEventListener: () => { n -= 1; } } as unknown as AbortSignal;
    await waitForSignal(sig, 5); expect(n).toBe(0);
  });
});

describe("smeltItem THROUGH the production boundary (packet guard active)", () => {
  async function viaBoundary(abortAfterMs: number) {
    const body = offlineBody(); const bot = body.fake;
    const furnace = new SlowFurnace(bot, 200); bot.furnace = furnace as never;
    bot.blocks.set("5,64,5", { name: "furnace" }); bot.give("raw_iron", 1); bot.give("coal", 1);
    const boundary = createActionBoundary(() => bot._client);
    const abort = new AbortController();
    const pending = boundary.run("smelt", (signal) => smeltItem(skillContext(body, { signal, timeoutMs: 3_000 }), "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 }), { signal: abort.signal, timeoutMs: 10_000, graceMs: 600 });
    await sleep(abortAfterMs); abort.abort();
    const result = await pending;
    return { bot, result, furnace };
  }
  it("[QA69-L1] success is truthful at every abort offset when the guard refuses the post-abort furnace clicks", async () => {
    const lies: string[] = [];
    for (const t of [0, 60, 120, 230, 300, 330, 360, 400, 440, 480, 520]) {
      const r = await viaBoundary(t);
      const got = r.bot.count("iron_ingot") > 0;
      if (got !== r.result.success) lies.push(`abort@${t}ms: ingotInInventory=${got} reported=${r.result.success ? "success" : r.result.code}`);
    }
    console.log("SMELT_VIA_BOUNDARY", lies.join(" || ") || "truthful");
    expect(lies).toEqual([]);
  });
});
