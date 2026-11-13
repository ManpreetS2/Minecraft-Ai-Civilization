import { beforeEach, afterEach, it, expect } from "vitest";
import { homeRig, CHEST, cellClaimKey } from "../v103/support/home.js";
import { installInstantNavigation, sleep } from "../v103/support/offline-body.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
for (const direction of ["withdraw", "deposit"] as const) for (const mode of ["abandoned", "normal", "no-effect"] as const) {
  it(`${direction} ${mode}: delayed slot confirmation preserves one receipt or a proven no-effect observation window`, async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, carry: direction === "deposit" ? 4 : 0, chestStock: direction === "withdraw" ? 4 : 0, windowMs: 20 });
    const state = { stock: direction === "withdraw" ? 4 : 0 };
    let confirmations = 0;
    const move = async (dir: "withdraw" | "deposit", count: number) => {
      h.r.bot._client.write("window_click"); await sleep(20); confirmations++;
      if (mode !== "no-effect") setTimeout(() => {
        if (dir === "withdraw") { state.stock -= count; h.r.bot.give("cobblestone", count); }
        else {
          const item = h.r.bot.inventory.items().find(i => i.name === "cobblestone");
          if (!item) throw new Error("missing physical item");
          item.count -= count; state.stock += count;
        }
      }, 150);
    };
    Object.assign(h.r.bot, { openContainer: async () => ({
      containerItems: () => state.stock ? [{ name: "cobblestone", type: 4, count: state.stock }] : [],
      withdraw: (_type: number, _meta: null, count: number) => move("withdraw", count),
      deposit: (_type: number, _meta: null, count: number) => move("deposit", count), close() {},
    }) });
    h.bus.on(event => h.r.manager.events.emit(event));
    const action = direction === "withdraw" ? "withdrawItems" : "depositItems";
    const result = mode === "normal" ? await h.run(`${direction}_personal`, action, 10000) : await h.runAborted(`${direction}_personal`, action, 35);
    await sleep(mode === "no-effect" ? 3000 : 300);
    expect(confirmations).toBe(1);
    if (mode === "no-effect") expect(h.runtime.claims.ownerOf("container", cellClaimKey(CHEST.x, CHEST.y, CHEST.z))).toBeUndefined();
    const pending = h.seen.filter(e => e.type === "SystemIncident" && (e.payload as Record<string, unknown>).kind === "AbandonedTransferObservation");
    const terminal = h.seen.filter(e => ["ItemDeposited", "ItemWithdrawn"].includes(e.type));
    expect(h.r.bot.count("cobblestone") + state.stock).toBe(4);
    expect(result.success).toBe(mode === "normal");
    expect(pending).toHaveLength(mode === "abandoned" ? 1 : 0);
    expect(terminal).toHaveLength(mode === "normal" ? 1 : 0);
    if (mode === "abandoned") {
      const payload = pending[0]!.payload as Record<string, unknown>;
      expect(payload.authoritativeStorageUpdated).toBe(false);
      expect(payload.count).toBe(direction === "withdraw" ? 1 : 4);
      for (const key of ["position", "access", "contents", "citizenBefore", "citizenAfter", "containerBefore", "containerAfter"]) expect(payload).toHaveProperty(key);
      const stored = h.r.store.recentEvents().filter(e => e.type === "SystemIncident" && e.payload.kind === "AbandonedTransferObservation");
      expect(stored).toHaveLength(1); expect(stored[0]!.payload).toEqual(payload);
    }
  });
}
