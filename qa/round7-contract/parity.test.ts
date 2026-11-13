import { beforeEach, afterEach, it, expect } from "vitest";
import { homeRig } from "../v103/support/home.js";
import { installInstantNavigation, sleep } from "../v103/support/offline-body.js";
import { executePlan } from "../../packages/agent-core/src/executor.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
const required = ["kind", "reconciliation", "authoritativeStorageUpdated", "direction", "item", "transferId", "actionId", "runId", "citizenId", "correlationComplete", "count", "measurementStatus", "citizenBefore", "citizenAfter", "containerBefore", "containerAfter", "position", "access", "contents"].sort();
for (const direction of ["deposit", "withdraw"] as const) for (const measurement of ["confirmed", "zero-observed", "unavailable", "citizen-unavailable"] as const) {
  it(`${direction} ${measurement}: parity, uncertainty and trusted runtime correlation persist`, async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: direction === "deposit" ? 4 : 0, chestStock: direction === "withdraw" ? 4 : 0, windowMs: 150 });
    let resolved = false;
    if (measurement !== "confirmed") Object.assign(h.r.bot, { openContainer: async () => ({
      containerItems: () => { if (resolved && measurement === "unavailable") throw new Error("view lost"); return direction === "withdraw" ? [{ name: "cobblestone", count: 4, type: 4 }] : []; },
      withdraw: async () => { await sleep(70); resolved = true; }, deposit: async () => { await sleep(70); resolved = true; }, close() {},
    }) });
    if (measurement === "citizen-unavailable") {
      Object.defineProperty(h.r.bot.inventory, "slots", { configurable: true, get: () => { if (resolved) throw new Error("inventory unavailable"); return h.r.bot.slots; } });
    }
    h.bus.on(event => h.r.manager.events.emit(event));
    const controller = new AbortController(); setTimeout(() => controller.abort("shutdown"), 50);
    const result = await executePlan({ body: h.r.body, bot: h.r.bot, events: h.bus, citizenId: h.r.id, signal: controller.signal, runId: "trusted-runtime-run" } as never,
      { action: direction === "deposit" ? "depositItems" : "withdrawItems", task: `${direction}_personal`, source: "planner", reason: "test", item: "cobblestone", count: 1, runId: "spoofed-run", actionId: "spoofed-action" } as never,
      h.r.store, h.bus, h.runtime);
    expect(controller.signal.aborted).toBe(true);
    expect(result.success).toBe(false);
    const receipts = h.r.store.recentEvents().filter(e => e.type === "SystemIncident" && e.payload.kind === "AbandonedTransferObservation");
    expect(receipts).toHaveLength(1); const payload = receipts[0]!.payload;
    expect(Object.keys(payload).sort()).toEqual(required);
    expect(payload.runId).toBe("trusted-runtime-run"); expect(payload.citizenId).toBe(h.r.id);
    expect(payload.actionId).toMatch(/^[a-f0-9-]{36}$/); expect(payload.transferId).toMatch(/^[a-f0-9-]{36}$/);
    expect(payload.actionId).not.toBe(payload.transferId); expect(payload.correlationComplete).toBe(true);
    expect(payload.access).toBe("personal"); expect(payload.authoritativeStorageUpdated).toBe(false);
    expect(payload.count).toBe(measurement === "confirmed" ? direction === "deposit" ? 4 : 1 : null);
    expect(payload.measurementStatus).toBe(measurement === "confirmed" ? "CONFIRMED_MOVEMENT" : measurement === "zero-observed" ? "ZERO_OBSERVED" : "UNKNOWN");
    if (measurement === "unavailable") { expect(payload.containerAfter).toBe(null); expect(payload.contents).toBe(null); }
    if (measurement === "citizen-unavailable") expect(payload.citizenAfter).toBe(null);
    expect(h.seen.some(e => ["ItemDeposited", "ItemWithdrawn", "ActionCompleted"].includes(e.type))).toBe(false);
    expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
  });
}

it("missing run context is explicit null, never a fabricated identifier", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: 0, chestStock: 4, windowMs: 150 });
  const ac = new AbortController(); setTimeout(() => ac.abort(), 50);
  await h.direct("withdraw_personal", "withdrawItems", ac.signal);
  const receipt = h.seen.find(e => (e.payload as Record<string, unknown>)?.kind === "AbandonedTransferObservation")!.payload as Record<string, unknown>;
  expect(receipt.runId).toBe(null); expect(receipt.correlationComplete).toBe(false);
  expect(receipt.actionId).toMatch(/^[a-f0-9-]{36}$/);
});
