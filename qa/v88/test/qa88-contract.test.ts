// QA88 task 5: the QA78 assertion `expect(r.bot.count("bread")).toBe(0)` after an UNSUCCESSFUL result. This file states the contract that
// replaces it, as ordinary assertions that PASS on PR #88, and proves with the wire log why `bread === 0` can never be a requirement.
// Scenario = the QA78 one: deadline 60 ms, window 120 ms, production grace 250 ms, so the click is written BEFORE the deadline and the items move inside the grace.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../support/offline-body.js";
import { homeRig } from "../support/home.js";
import { EventBus } from "../../../packages/shared/src/index.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { rig } from "../support/manager-rig.js";
import { installSlowChest } from "../support/slow-world.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

async function settlementWithdraw(o: { deadlineMs: number; windowMs: number }) {
  const r = rig(); const bus = new EventBus(); const seen: Array<{ type: string; at: number; payload?: Record<string, unknown> }> = [];
  bus.on((e) => seen.push({ type: e.type, at: Date.now(), payload: e.payload as Record<string, unknown> }));
  const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
  r.bot.blocks.set("4,64,4", { name: "chest" });
  const chest = installSlowChest(r.bot, { item: "bread", type: 7, withdrawMs: o.windowMs, stock: 4 });
  const wire: Array<{ name: string; at: number }> = []; const w = r.bot._client.write.bind(r.bot._client);
  r.bot._client.write = ((n: string, d?: Record<string, unknown>) => { wire.push({ name: n, at: Date.now() }); return w(n, d); }) as never;
  const boundary = createActionBoundary(() => r.bot._client);
  const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 } as { signal?: AbortSignal };
  const plan = { action: "withdrawItems", task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
  const t0 = Date.now(); let deadlineAt = 0;
  const result = await boundary.run("withdrawItems", (signal) => { ctx.signal = signal; signal.addEventListener("abort", () => { deadlineAt = Date.now(); }, { once: true }); return executePlan(ctx as never, plan, r.store, bus); }, { timeoutMs: o.deadlineMs });
  await sleep(500);
  return { r, seen, chest, wire, result, t0, deadlineAt };
}

describe("physical inventory truth after an unsuccessful (CANCELLED/TIMEOUT) chest action", () => {
  it("the window click is already on the wire BEFORE the deadline, so the transfer cannot be un-sent (why `bread === 0` is not a valid requirement)", async () => {
    const x = await settlementWithdraw({ deadlineMs: 60, windowMs: 120 });
    const click = x.wire.find((w) => w.name === "window_click");
    expect(click, "no window_click reached the wire").toBeDefined();
    expect(click!.at).toBeLessThan(x.deadlineAt);               // sent before the action lost permission
    expect(x.chest.stock).toBe(3); expect(x.r.bot.count("bread")).toBe(1);
  });
  it("conservation is the invariant: citizen bread + chest bread = 4 before, during the grace, and after, whatever the result code says", async () => {
    const x = await settlementWithdraw({ deadlineMs: 60, windowMs: 120 });
    expect(x.r.bot.count("bread") + x.chest.stock).toBe(4);
  });
  it("RECOMMENDED CONTRACT, clause by clause, on the QA78 scenario (unsuccessful result)", async () => {
    const x = await settlementWithdraw({ deadlineMs: 60, windowMs: 120 });
    const types = x.seen.map((e) => e.type);
    expect(x.result.success).toBe(false);                                                   // 1. the action is not reported complete
    expect(types).not.toContain("ItemWithdrawn");                                           // 2. no success event for the abandoned transfer
    expect(types).not.toContain("ActionCompleted");                                         // 3. no completion record
    expect(x.r.store.getSettlement().storageContents).toEqual({ bread: 4 });                // 4. authoritative stock is NOT rewritten from stale evidence
    expect(x.r.bot.count("bread")).toBe(1);                                                 // 5. the physical inventory is whatever the world says (here: the click landed)
    const incident = x.seen.find((e) => e.type === "SystemIncident" && (e.payload as { kind?: string }).kind === "AbandonedActionObservation");
    expect(incident, "the physical effect must stay visible as a PENDING observation").toBeDefined();
    expect(incident!.payload).toMatchObject({ reconciliation: "PENDING", authoritativeStorageUpdated: false });
  });
  it("and the click that has NOT yet been sent when permission ends is never sent (the requirement that does hold): deadline 5 ms, window 120 ms", async () => {
    const x = await settlementWithdraw({ deadlineMs: 5, windowMs: 120 });
    expect(x.wire.filter((w) => w.name === "window_click" && w.at > x.deadlineAt)).toEqual([]);
    expect(x.r.bot.count("bread") + x.chest.stock).toBe(4);
  });
  void homeRig;
});
