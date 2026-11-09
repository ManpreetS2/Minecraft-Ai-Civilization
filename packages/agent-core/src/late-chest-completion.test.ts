import { beforeEach, afterEach, expect, it } from "vitest";
import { EventBus, type SimEvent } from "@civ/shared";
import { executePlan } from "./executor.js";
import { createActionBoundary } from "./action-boundary.js";
import { rig } from "../../../qa/v78/support/manager-rig.js";
import { installInstantNavigation, sleep } from "../../../qa/v78/support/offline-body.js";
import { installSlowChest } from "../../../qa/v78/support/slow-world.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
for (const action of ["withdrawItems", "depositItems"] as const) {
  for (const mode of ["timeout", "superseded", "disconnect"] as const) {
    it(`${action}: ${mode} preserves physical transfers as pending observations without overwriting newer stock`, async () => {
      const r = rig(); const bus = new EventBus(); const events: SimEvent[] = []; bus.on(e => events.push(e));
      const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
      r.bot.blocks.set("4,64,4", { name: "chest" });
      if (action === "depositItems") r.bot.give("bread", 2);
      const chest = installSlowChest(r.bot, { item: "bread", type: 7, stock: 4, withdrawMs: 450, depositMs: 450 });
      const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 };
      const plan = { action, task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
      let work: Promise<unknown>;
      if (mode !== "superseded") {
        const disconnected = new AbortController();
        if (mode === "disconnect") {
          r.bot.once("end", () => disconnected.abort());
          setTimeout(() => r.bot.emit("end", "socket closed"), 60);
        }
        const boundary = createActionBoundary(() => r.bot._client);
        const result = await boundary.run(action, signal => executePlan({ ...ctx, signal }, plan, r.store, bus), { timeoutMs: mode === "timeout" ? 60 : 2000, signal: disconnected.signal });
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

it("a repeated withdrawal commits fresh stock while an older transfer remains pending", async () => {
  const r = rig(); const bus = new EventBus();
  const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
  r.bot.blocks.set("4,64,4", { name: "chest" });
  const oldChest = installSlowChest(r.bot, { item: "bread", type: 7, stock: 4, withdrawMs: 450 });
  const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 };
  const plan = { action: "withdrawItems", task: "withdraw_food", source: "planner", target: "chest" } as never;
  const old = executePlan(ctx, plan, r.store, bus);
  await sleep(60);
  installSlowChest(r.bot, { item: "bread", type: 7, stock: 8, withdrawMs: 5 });
  expect((await executePlan(ctx, plan, r.store, bus)).success).toBe(true);
  expect(r.store.getSettlement().storageContents).toEqual({ bread: 7 });
  expect((await old).success).toBe(false);
  expect(oldChest.stock).toBe(3);
  expect(r.bot.count("bread")).toBe(2);
  expect(r.store.getSettlement().storageContents).toEqual({ bread: 7 });
});
