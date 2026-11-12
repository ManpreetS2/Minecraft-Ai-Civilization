// QA120 defect demonstration for the OPEN PR #104 duplicate-event contract, observed on the integrated candidate (1d9967f). RED by design:
// each test states the correct behaviour (exactly one terminal event for one physical transfer). Not a regression introduced by PR #120.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus, type SimEvent } from "../../../packages/shared/src/index.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { rig } from "../../v88/support/manager-rig.js";
import { installInstantNavigation, sleep } from "../../v88/support/offline-body.js";
import { installSlowChest } from "../../v88/support/slow-world.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

for (const [action, type] of [["withdrawItems", "ItemWithdrawn"], ["depositItems", "ItemDeposited"]] as const) {
  describe(`${action}`, () => {
    it(`QA120-D1: one completed physical transfer (success path, generous deadline) emits exactly one ${type}`, async () => {
      const r = rig(); const bus = new EventBus(); const events: SimEvent[] = []; bus.on((e) => events.push(e));
      const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
      r.bot.blocks.set("4,64,4", { name: "chest" });
      if (action === "depositItems") r.bot.give("bread", 2);
      installSlowChest(r.bot, { item: "bread", type: 7, stock: 4, withdrawMs: 30, depositMs: 30 });
      const boundary = createActionBoundary(() => r.bot._client);
      const plan = { action, task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
      const res = await boundary.run(action, (signal) => executePlan({ body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000, signal } as never, plan, r.store, bus), { timeoutMs: 5_000 });
      await sleep(200);
      expect(res.success).toBe(true);
      expect(events.filter((e) => e.type === type)).toHaveLength(1);
    });
  });
}
