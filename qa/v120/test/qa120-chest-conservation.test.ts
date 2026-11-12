// QA120: independent deadline/lag SWEEP over the integrated chest paths (settlement chest and home personal/household chest), real executePlan,
// real action boundary with production grace, real AgentManager rig, offline controlled bot. Not Paper: a controlled chest window, not a real server.
// Invariants are the ones that must hold for ANY deadline: physical conservation, no success claim for an unsuccessful result, authoritative stock not
// rewritten from abandoned evidence, and nothing written to the wire after the result has returned. Duplicate terminal events are the OPEN
// PR #104 contract and are asserted separately in qa/v120/defects (red by design); they are deliberately NOT counted here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus, type SimEvent } from "../../../packages/shared/src/index.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { rig } from "../../v88/support/manager-rig.js";
import { homeRig } from "../../v88/support/home.js";
import { installInstantNavigation, sleep } from "../../v88/support/offline-body.js";
import { installSlowChest } from "../../v88/support/slow-world.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

const DEADLINES = [1, 8, 25, 45, 60, 90, 130, 180, 260];
const WINDOW = 120;
const WIRE_CLICK = "window_click";
const _count = (events: SimEvent[], type: string) => events.filter((e) => e.type === type).length;

async function settlementRun(action: "withdrawItems" | "depositItems", deadlineMs: number, lagMs: number) {
  const r = rig(); const bus = new EventBus(); const events: SimEvent[] = []; bus.on((e) => events.push(e));
  const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
  r.bot.blocks.set("4,64,4", { name: "chest" });
  if (action === "depositItems") r.bot.give("bread", 2);
  const total = 4 + (action === "depositItems" ? 2 : 0);
  const chest = installSlowChest(r.bot, { item: "bread", type: 7, stock: 4, withdrawMs: WINDOW, depositMs: WINDOW, lagMs });
  const wire: Array<{ name: string; at: number }> = []; const w = r.bot._client.write.bind(r.bot._client);
  r.bot._client.write = ((n: string, d?: Record<string, unknown>) => { wire.push({ name: n, at: Date.now() }); return w(n, d); }) as never;
  const boundary = createActionBoundary(() => r.bot._client);
  const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 } as { signal?: AbortSignal };
  const plan = { action, task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
  const result = await boundary.run(action, (signal) => { ctx.signal = signal; return executePlan(ctx as never, plan, r.store, bus); }, { timeoutMs: deadlineMs });
  const returnedAt = Date.now();
  await sleep(WINDOW + lagMs + 450);
  return { r, events, chest, wire, result, returnedAt, total, held: () => r.bot.count("bread"), stored: r.store.getSettlement().storageContents };
}

describe("settlement chest: deadline x lag sweep", () => {
  for (const action of ["withdrawItems", "depositItems"] as const) {
    for (const lagMs of [0, 80]) {
      it(`${action}, server slot-sync lag ${lagMs} ms: every deadline conserves bread and never claims an unsuccessful transfer`, async () => {
        const violations: string[] = [];
        for (const d of DEADLINES) {
          const x = await settlementRun(action, d, lagMs);
          const tag = `d=${d}`;
          if (x.held() + x.chest.stock !== x.total) violations.push(`${tag}: conservation ${x.held()}+${x.chest.stock} != ${x.total}`);
          const claimed = x.events.filter((e) => ["ItemWithdrawn", "ItemDeposited", "ActionCompleted"].includes(e.type));
          if (x.result.success) {
            if (claimed.length === 0) violations.push(`${tag}: success without any completion event`);
            if (action === "withdrawItems" && x.chest.stock !== 3) violations.push(`${tag}: success but chest stock ${x.chest.stock}`);
          } else {
            if (claimed.length > 0) violations.push(`${tag}: unsuccessful result but events ${claimed.map((e) => e.type).join(",")}`);
            if (JSON.stringify(x.stored) !== JSON.stringify({ bread: 4 })) violations.push(`${tag}: authoritative stock rewritten to ${JSON.stringify(x.stored)} after an unsuccessful result`);
          }
          const lateClicks = x.wire.filter((w) => w.name === WIRE_CLICK && w.at > x.returnedAt + 5);
          if (lateClicks.length > 0) violations.push(`${tag}: ${lateClicks.length} window click(s) written after the action returned`);
        }
        expect(violations).toEqual([]);
      }, 60_000);
    }
  }
});

describe("home chest (personal and household): deadline sweep", () => {
  for (const purpose of ["personal", "household"] as const) {
    for (const action of ["withdrawItems", "depositItems"] as const) {
      it(`${purpose} ${action}: every deadline conserves bread; an unsuccessful result emits no success event`, async () => {
        const violations: string[] = [];
        for (const d of DEADLINES) {
          const h = homeRig({ purpose, item: "bread", type: 7, chestStock: 4, carry: action === "depositItems" ? 2 : 0, windowMs: WINDOW });
          const total = 4 + (action === "depositItems" ? 2 : 0);
          const res = await h.run("home_store", action, d, "bread", 1);
          const returned = Date.now(); await sleep(WINDOW + 450);
          const held = h.r.bot.count("bread");
          if (held + h.chest.stock !== total) violations.push(`d=${d}: conservation ${held}+${h.chest.stock} != ${total}`);
          const claimed = h.seen.filter((e) => ["ItemWithdrawn", "ItemDeposited", "ActionCompleted"].includes(e.type));
          if (!res.success && claimed.length > 0) violations.push(`d=${d}: unsuccessful but ${claimed.map((e) => e.type).join(",")}`);
          if (res.success && claimed.length === 0) violations.push(`d=${d}: success without a completion event`);
          void returned;
        }
        expect(violations).toEqual([]);
      }, 60_000);
    }
  }
});

describe("cancellation by the caller (abort signal) and by disconnect never silently commit or lose items", () => {
  for (const action of ["withdrawItems", "depositItems"] as const) {
    for (const trigger of ["abort-before-click", "abort-mid-window", "disconnect-mid-window"] as const) {
      it(`${action} / ${trigger}: bread is conserved, no completion event, authoritative stock untouched`, async () => {
        const r = rig(); const bus = new EventBus(); const events: SimEvent[] = []; bus.on((e) => events.push(e));
        const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
        r.bot.blocks.set("4,64,4", { name: "chest" });
        if (action === "depositItems") r.bot.give("bread", 2);
        const total = 4 + (action === "depositItems" ? 2 : 0);
        const chest = installSlowChest(r.bot, { item: "bread", type: 7, stock: 4, withdrawMs: 300, depositMs: 300 });
        const boundary = createActionBoundary(() => r.bot._client);
        const ac = new AbortController();
        const plan = { action, task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
        if (trigger === "disconnect-mid-window") { r.bot.once("end", () => ac.abort()); setTimeout(() => r.bot.emit("end", "socket closed"), 60); }
        else if (trigger === "abort-mid-window") setTimeout(() => ac.abort(), 80);
        else ac.abort();
        const result = await boundary.run(action, (signal) => executePlan({ body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000, signal } as never, plan, r.store, bus), { timeoutMs: 5_000, signal: ac.signal });
        await sleep(700);
        expect(result.success).toBe(false);
        expect(r.bot.count("bread") + chest.stock).toBe(total);
        expect(events.filter((e) => ["ItemWithdrawn", "ItemDeposited", "ActionCompleted"].includes(e.type))).toEqual([]);
        expect(r.store.getSettlement().storageContents).toEqual({ bread: 4 });
      }, 30_000);
    }
  }
});
