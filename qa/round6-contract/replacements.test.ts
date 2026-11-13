import { beforeEach, afterEach, it, expect } from "vitest";
import { installInstantNavigation, sleep } from "../v103/support/offline-body.js";
import { homeRig, type Purpose } from "../v103/support/home.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
const cases: Array<[string, Purpose, "depositItems" | "withdrawItems", number, number]> = [
  ["deposit_personal", "personal", "depositItems", 4, 0],
  ["withdraw_personal", "personal", "withdrawItems", 0, 4],
  ["deposit_household", "household", "depositItems", 4, 0],
];
for (const [task, purpose, action, carry, stock] of cases) {
  it(`proposed replacement QA103 deadline ${task}: one physical pending receipt, no late success, conservation and no storage projection`, async () => {
    const h = homeRig({ purpose, item: "cobblestone", type: 4, carry, chestStock: stock, windowMs: 450 });
    h.bus.on(event => h.r.manager.events.emit(event));
    const snapshot = () => JSON.stringify([h.r.store.getSettlement(), h.r.store.getCitizenHome(h.r.id)]);
    const before = snapshot();
    const result = await h.run(task, action, 60, "cobblestone", 1);
    await sleep(3200);
    expect(result.success).toBe(false);
    const receipts = h.seen.filter(e => e.type === "SystemIncident" && (e.payload as Record<string, unknown>).reconciliation === "PENDING");
    expect(receipts).toHaveLength(1);
    const payload = receipts[0]!.payload as Record<string, number | string>;
    expect(payload.kind).toBe("AbandonedTransferObservation");
    const persisted = h.r.store.recentEvents(100).filter(e => e.type === "SystemIncident" && e.payload.kind === "AbandonedTransferObservation");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.payload).toEqual(receipts[0]!.payload);
    expect(payload.citizenBefore).toBe(carry);
    expect(Number(payload.citizenAfter) + Number(payload.containerAfter)).toBe(4);
    expect(Math.abs(Number(payload.citizenAfter) - carry)).toBeGreaterThan(0);
    expect(h.seen.some(e => ["ItemDeposited", "ItemWithdrawn", "ActionCompleted"].includes(e.type))).toBe(false);
    expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
    expect(snapshot()).toBe(before);
  });
}
it("proposed QA103-I1 replacement: one pending observation, no cancellation wrapper counted as another movement", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: 4, chestStock: 0, windowMs: 450 });
  await h.run("deposit_personal", "depositItems", 60); await sleep(3200);
  expect(h.seen.filter(e => e.type === "SystemIncident" && (e.payload as Record<string, unknown>).reconciliation === "PENDING")).toHaveLength(1);
  expect(h.seen.filter(e => (e.payload as Record<string, unknown>)?.kind === "AbandonedActionObservation")).toHaveLength(0);
});
it("proposed QA103 signal replacement: physical receipt survives direct signal cancellation", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: 4, chestStock: 0, windowMs: 150 });
  const ac = new AbortController(); setTimeout(() => ac.abort(), 50);
  const result = await h.direct("deposit_personal", "depositItems", ac.signal); await sleep(100);
  expect(result.success).toBe(false);
  expect(h.seen.filter(e => e.type === "SystemIncident" && (e.payload as Record<string, unknown>).kind === "AbandonedTransferObservation")).toHaveLength(1);
  expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
  expect(h.seen.some(e => ["ItemDeposited", "ActionCompleted"].includes(e.type))).toBe(false);
});
it("proposed QA78 replacement: cancelled withdrawal retains physical gain and one pending receipt", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: 0, chestStock: 4, windowMs: 120 });
  const result = await h.run("withdraw_personal", "withdrawItems", 60); await sleep(500);
  expect(result.success).toBe(false);
  expect(h.r.bot.count("cobblestone")).toBe(1); expect(h.chest.stock).toBe(3);
  expect(h.seen.filter(e => e.type === "SystemIncident" && (e.payload as Record<string, unknown>).reconciliation === "PENDING")).toHaveLength(1);
  expect(h.seen.some(e => e.type === "ItemWithdrawn")).toBe(false);
});
