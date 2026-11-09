import { beforeEach, afterEach, expect, it } from "vitest";
import { EventBus, type SimEvent } from "../../../packages/shared/src/index.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { rig } from "../support/manager-rig.js";
import { installInstantNavigation, sleep } from "../support/offline-body.js";
import { installSlowChest } from "../support/slow-world.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
for (const action of ["withdrawItems", "depositItems"] as const) {
  for (const mode of ["timeout", "superseded"] as const) {
    it(`${action}: ${mode} preserves physical transfers as pending observations without overwriting newer stock`, async () => {
      const r = rig(); const bus = new EventBus(); const events: SimEvent[] = []; bus.on(e => events.push(e));
      const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
      r.bot.blocks.set("4,64,4", { name: "chest" });
      if (action === "depositItems") r.bot.give("bread", 2);
      const chest = installSlowChest(r.bot, { item: "bread", type: 7, stock: 4, withdrawMs: 450, depositMs: 450 });
      const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 };
      const plan = { action, task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
      let work: Promise<unknown>;
      if (mode === "timeout") {
        const boundary = createActionBoundary(() => r.bot._client);
        const result = await boundary.run(action, signal => executePlan({ ...ctx, signal }, plan, r.store, bus), { timeoutMs: 60 });
        expect(result.success).toBe(false);
        work = Promise.resolve();
      } else {
        work = executePlan(ctx, plan, r.store, bus);
        await sleep(60);
        await executePlan(ctx, { action: "deferCapability", task: "qa", source: "planner" } as never, r.store, bus);
      }
      const cutoff = events.length;
      const newer = r.store.getSettlement(); newer.storageContents = { bread: 99 }; r.store.saveSettlement(newer);
      await sleep(800); await work;
      expect(chest.stock).toBe(action === "withdrawItems" ? 3 : 6);
      expect(r.bot.count("bread")).toBe(action === "withdrawItems" ? 1 : 0);
      expect(r.store.getSettlement().storageContents).toEqual({ bread: 99 });
      const late = events.slice(cutoff);
      expect(late.filter(e => ["ActionCompleted", "ItemWithdrawn", "ItemDeposited"].includes(e.type))).toEqual([]);
      expect(late.some(e => e.type === "SystemIncident" && e.payload.reconciliation === "PENDING")).toBe(true);
    });
  }
}
