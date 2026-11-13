import { beforeEach, afterEach, it, expect } from "vitest";
import { homeRig, CHEST, cellClaimKey } from "../v103/support/home.js";
import { installInstantNavigation, sleep } from "../v103/support/offline-body.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
for (const reason of ["late-sync", "unresolved", "death", "disconnect", "shutdown", "repeated-abort", "unavailable-view"]) {
  it(`resolved withdrawal ${reason}: one pending receipt without late success or rollback`, async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: 0, chestStock: 4, windowMs: 20 });
    const state = { stock: 4 }; let confirmed = false;
    Object.assign(h.r.bot, { openContainer: async () => ({
      containerItems: () => { if (confirmed && reason === "unavailable-view") throw new Error("test view unavailable"); return state.stock ? [{ name: "cobblestone", type: 4, count: state.stock }] : []; },
      withdraw: async (_type: number, _meta: null, count: number) => {
        h.r.bot._client.write("window_click"); await sleep(20); confirmed = true;
        if (reason === "late-sync") setTimeout(() => { state.stock -= count; h.r.bot.give("cobblestone", count); }, 150);
      }, deposit: async () => undefined, close() {},
    }) });
    const controller = new AbortController(); setTimeout(() => { controller.abort(reason); if (reason === "repeated-abort") controller.abort(reason); }, 35);
    const result = await h.direct("withdraw_personal", "withdrawItems", controller.signal);
    expect(confirmed).toBe(true); expect(result.success).toBe(false);
    const pending = h.seen.filter(e => e.type === "SystemIncident" && (e.payload as Record<string, unknown>).kind === "AbandonedTransferObservation");
    expect(pending).toHaveLength(1);
    const payload = pending[0]!.payload as Record<string, unknown>;
    expect(payload.reconciliation).toBe("PENDING");
    expect(payload.count).toBe(reason === "late-sync" ? 1 : null);
    expect(payload.measurementStatus).toBe(reason === "late-sync" ? "CONFIRMED_MOVEMENT" : reason === "unavailable-view" ? "UNKNOWN" : "ZERO_OBSERVED");
    expect(h.seen.some(e => e.type === "ItemWithdrawn" || e.type === "ActionCompleted")).toBe(false);
    expect(h.r.bot.count("cobblestone") + state.stock).toBe(4);
  });
}
it("pre-issue cancellation moves nothing and emits no physical pending receipt", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: 0, chestStock: 4, windowMs: 20 });
  await h.runPreAborted("withdraw_personal", "withdrawItems"); await sleep(100);
  expect(h.seen.filter(e => (e.payload as Record<string, unknown>)?.reconciliation === "PENDING")).toHaveLength(0);
  expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
});
it("an unresolved stale action cannot release a newer same-citizen acquisition", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: 0, chestStock: 4, windowMs: 20 });
  Object.assign(h.r.bot, { openContainer: async () => ({ containerItems: () => [{ name: "cobblestone", type: 4, count: 4 }], withdraw: async () => { await sleep(20); }, close() {} }) });
  const controller = new AbortController(); setTimeout(() => controller.abort(), 35);
  const task = h.direct("withdraw_personal", "withdrawItems", controller.signal);
  await sleep(100);
  const key = cellClaimKey(CHEST.x, CHEST.y, CHEST.z);
  expect(h.runtime.claims.tryClaim("container", key, h.r.id, 30000)).toBe(true);
  await task;
  expect(h.runtime.claims.ownerOf("container", key)).toBe(h.r.id);
});
