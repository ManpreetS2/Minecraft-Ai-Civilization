/* eslint-disable @typescript-eslint/no-explicit-any -- Independent QA source snapshot; runtime assertions unchanged. */
// Round 5 / Mission 2: PR #141 (1ee1556) = #120 + #133 (lease) + #135 (single physical event). Only home-ops.ts is a genuine merge of #133 and #135; executor.ts also gained an
// undeclared `withdraw_household` routing branch. These tests target those changed boundaries through the REAL executePlan + action boundary. Offline fake body only.
// Needs qa/v103/support (overlaid from QA PR #118) next to this directory.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus, type SimEvent } from "../../../packages/shared/src/index.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { SettlementRuntime } from "../../../packages/agent-core/src/settlement-runtime.js";
import { installInstantNavigation, sleep } from "../../v103/support/offline-body.js";
import { homeRig } from "../../v103/support/home.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
const TERMINAL = ["ItemDeposited", "ItemWithdrawn"];
type Seen = { type: string; payload?: unknown };
const terminal = (s: Seen[]) => s.filter((e) => TERMINAL.includes(e.type));
const incidents = (s: Seen[]) => s.filter((e) => e.type === "SystemIncident");
const P = (e: Seen) => (e.payload ?? {}) as Record<string, any>;

describe("withdraw_household routing (new in the combined source; before, it fell through to the SETTLEMENT chest)", () => {
  it("an owner's withdraw_household moves items from the HOUSEHOLD chest only; the settlement chest is untouched; one event labelled household", async () => {
    const h = homeRig({ purpose: "household", item: "cobblestone", type: 4, chestStock: 4, carry: 0, windowMs: 30 });
    const st = h.r.store.getSettlement(); st.storage = { x: 9, y: 64, z: 9 }; st.storageContents = { cobblestone: 50 }; h.r.store.saveSettlement(st);
    h.r.bot.blocks.set("9,64,9", { name: "chest" });
    const res = await h.run("withdraw_household", "withdrawItems", 10_000, "cobblestone", 2); await sleep(150);
    expect(res.success).toBe(true);
    expect(h.r.bot.count("cobblestone")).toBe(2); expect(h.chest.stock).toBe(2);
    expect(h.r.store.getSettlement().storageContents).toEqual({ cobblestone: 50 });
    const t = terminal(h.seen); expect(t).toHaveLength(1); expect(P(t[0]!).access).toBe("household");
  });
  it("positive control: personal and household routes both work for their owner and are labelled with their own purpose", async () => {
    for (const purpose of ["personal", "household"] as const) {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: 3, carry: 0, windowMs: 30 });
      const res = await h.run(`withdraw_${purpose}`, "withdrawItems", 10_000, "cobblestone", 1); await sleep(150);
      expect(res.success).toBe(true); expect(P(terminal(h.seen)[0]!).access).toBe(purpose);
    }
  });
  it("cross-purpose: a citizen who only has a PERSONAL chest cannot withdraw via withdraw_household (and vice versa); no transfer, no event", async () => {
    for (const [has, ask] of [["personal", "household"], ["household", "personal"]] as const) {
      const h = homeRig({ purpose: has, item: "cobblestone", type: 4, chestStock: 4, carry: 0, windowMs: 30 });
      const res = await h.run(`withdraw_${ask}`, "withdrawItems", 10_000, "cobblestone", 1); await sleep(150);
      expect(res.success, `${has} chest asked as ${ask}`).toBe(false); expect(terminal(h.seen)).toEqual([]); expect(h.chest.stock).toBe(4); expect(h.r.bot.count("cobblestone")).toBe(0);
    }
  });
  it("a stranger (different citizen id, no home) cannot use the owner's household or personal chest through any of the four tasks; chest unchanged, no terminal event", async () => {
    const h = homeRig({ purpose: "household", item: "cobblestone", type: 4, chestStock: 4, carry: 3, windowMs: 30 });
    const bus = new EventBus(); const seen: SimEvent[] = []; bus.on((e) => seen.push(e)); const runtime = new SettlementRuntime();
    for (const task of ["withdraw_household", "withdraw_personal", "deposit_household", "deposit_personal"]) {
      const action = task.startsWith("withdraw") ? "withdrawItems" : "depositItems";
      const plan = { action, task, source: "planner", reason: "qa", item: "cobblestone", count: 1 } as never;
      const res = await executePlan({ body: h.r.body, bot: h.r.bot as never, events: bus, citizenId: "stranger_not_in_any_home", timeoutMs: 22_000 } as never, plan, h.r.store, bus, runtime);
      expect(res.success, task).toBe(false);
    }
    await sleep(200); expect(terminal(seen)).toEqual([]); expect(h.chest.stock).toBe(4); expect(h.r.bot.count("cobblestone")).toBe(3);
  });
});

describe("`access` on a physical event is authorized by the executor, not by plan content", () => {
  it("hostile plan fields (storageAccess/access/purpose = communal) never override the authorized purpose", async () => {
    for (const purpose of ["personal", "household"] as const) {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: 3, carry: 0, windowMs: 30 });
      const plan = { action: "withdrawItems", task: `withdraw_${purpose}`, source: "planner", reason: "qa", item: "cobblestone", count: 1, storageAccess: "communal", access: "communal", purpose: "communal" } as never;
      const res = await executePlan({ body: h.r.body, bot: h.r.bot as never, events: h.bus, citizenId: h.r.id, timeoutMs: 22_000 } as never, plan, h.r.store, h.bus, h.runtime); await sleep(150);
      expect(res.success).toBe(true); const t = terminal(h.seen); expect(t).toHaveLength(1); expect(P(t[0]!).access).toBe(purpose);
    }
  });
  it("hostile ctx-level storageAccess supplied by the caller is overwritten by the executor's own purpose", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 3, carry: 0, windowMs: 30 });
    const plan = { action: "withdrawItems", task: "withdraw_personal", source: "planner", reason: "qa", item: "cobblestone", count: 1 } as never;
    await executePlan({ body: h.r.body, bot: h.r.bot as never, events: h.bus, citizenId: h.r.id, timeoutMs: 22_000, storageAccess: "communal" } as never, plan, h.r.store, h.bus, h.runtime); await sleep(150);
    expect(P(terminal(h.seen)[0]!).access).toBe("personal");
  });
});

describe("terminal event payload integrity (new fields citizenBefore/After, containerBefore/After, contents, count)", () => {
  for (const purpose of ["personal", "household"] as const) for (const dir of ["withdraw", "deposit"] as const) {
    it(`${purpose} ${dir}: count == |container delta| == |citizen delta| == physical movement; contents[item] == containerAfter`, async () => {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: dir === "withdraw" ? 5 : 1, carry: dir === "deposit" ? 5 : 0, windowMs: 30 });
      const before = { bot: h.r.bot.count("cobblestone"), chest: h.chest.stock };
      const res = await h.run(`${dir}_${purpose}`, dir === "withdraw" ? "withdrawItems" : "depositItems", 10_000, "cobblestone", 3); await sleep(150);
      expect(res.success).toBe(true); const t = terminal(h.seen); expect(t).toHaveLength(1); const p = P(t[0]!);
      const moved = Math.abs(h.chest.stock - before.chest); expect(moved).toBeGreaterThan(0); expect(Math.abs(h.r.bot.count("cobblestone") - before.bot)).toBe(moved);
      expect(p.count).toBe(moved); expect(Math.abs(p.containerAfter - p.containerBefore)).toBe(moved); expect(Math.abs(p.citizenAfter - p.citizenBefore)).toBe(moved);
      expect(p.containerAfter).toBe(h.chest.stock); expect(p.citizenAfter).toBe(h.r.bot.count("cobblestone")); expect(p.contents?.cobblestone).toBe(h.chest.stock);
    });
  }
});

describe("abandoned home transfer: no authoritative event, one physical observation that matches the movement, storage never claimed as updated", () => {
  for (const purpose of ["personal", "household"] as const) for (const dir of ["withdraw", "deposit"] as const) {
    it(`${purpose} ${dir}: abandoned mid-transfer -> zero ItemDeposited/ItemWithdrawn; exactly one AbandonedTransferObservation whose before/after match the physical movement; authoritativeStorageUpdated is false; conservation holds`, async () => {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: dir === "withdraw" ? 4 : 0, carry: dir === "deposit" ? 4 : 0, windowMs: 450 });
      const res = await h.run(`${dir}_${purpose}`, dir === "withdraw" ? "withdrawItems" : "depositItems", 60, "cobblestone", 2); await sleep(1_300);
      expect(res.success).toBe(false); expect(terminal(h.seen)).toEqual([]);
      expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
      const inc = incidents(h.seen); const phys = inc.filter((e) => P(e).kind === "AbandonedTransferObservation"); expect(phys).toHaveLength(1);
      const p = P(phys[0]!); expect(p.reconciliation).toBe("PENDING"); expect(p.direction).toBe(dir);
      expect(Math.abs(p.citizenAfter - p.citizenBefore)).toBe(Math.abs(h.chest.stock - (dir === "withdraw" ? 4 : 0)));
      expect(Math.abs(p.containerAfter - p.containerBefore)).toBe(Math.abs(p.citizenAfter - p.citizenBefore));
      expect(p.containerAfter).toBe(h.chest.stock); expect(p.citizenAfter).toBe(h.r.bot.count("cobblestone"));
      for (const e of inc) if (P(e).kind === "AbandonedActionObservation") expect(P(e).authoritativeStorageUpdated).toBe(false);
    }, 30_000);
  }
  it("a newer same-citizen action started after the abandoned one is not attributed the stale frame's late physical event, and keeps its lease until it finishes", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 6, carry: 0, windowMs: 400 });
    const first = h.run("withdraw_personal", "withdrawItems", 60, "cobblestone", 1);
    expect((await first).success).toBe(false);
    const second = await h.run("withdraw_personal", "withdrawItems", 10_000, "cobblestone", 1); // contends with the stale frame's late completion
    await sleep(1_200);
    const t = terminal(h.seen); expect(t.length).toBeLessThanOrEqual(1);
    if (second.success) expect(t).toHaveLength(1); else expect(t).toEqual([]);
    expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(6);
  }, 30_000);
});
