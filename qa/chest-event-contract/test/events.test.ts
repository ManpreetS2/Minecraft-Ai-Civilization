import { beforeEach, afterEach, expect, it } from "vitest";
import { homeRig } from "../../v88/support/home.js";
import { installInstantNavigation, sleep } from "../../v88/support/offline-body.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
for (const purpose of ["personal", "household"] as const) {
  for (const action of ["deposit", "withdraw"] as const) {
    it(`desired contract: ${purpose} ${action} has exactly one success event`, async () => {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: action === "deposit" ? 0 : 4, carry: action === "deposit" ? 4 : 0, windowMs: 40 });
      expect((await h.run(`${action}_${purpose}`, action === "deposit" ? "depositItems" : "withdrawItems", 10_000)).success).toBe(true);
      const successes = h.seen.filter(e => e.type === (action === "deposit" ? "ItemDeposited" : "ItemWithdrawn"));
      console.log({ purpose, action, successPayloads: successes.map(e => e.payload) });
      expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
      expect(successes).toHaveLength(1);
    });
  }
}
for (const mode of ["cancel", "timeout"] as const) {
  for (const action of ["deposit", "withdraw"] as const) {
    it(`${mode} ${action}: zero success events, pending facts and conserved physical items`, async () => {
      const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: action === "deposit" ? 0 : 4, carry: action === "deposit" ? 4 : 0, windowMs: 450 });
      const caller = new AbortController();
      if (mode === "cancel") setTimeout(() => caller.abort(), 60);
      const boundary = createActionBoundary(() => h.r.bot._client);
      const result = await boundary.run(action, signal => executePlan({ body: h.r.body, bot: h.r.bot as never, events: h.bus, citizenId: h.r.id, signal, timeoutMs: 22_000 }, { action: action === "deposit" ? "depositItems" : "withdrawItems", task: `${action}_personal`, item: "cobblestone", count: 1, source: "planner" } as never, h.r.store, h.bus, h.runtime), { timeoutMs: mode === "timeout" ? 60 : 10_000, signal: caller.signal });
      expect(result.success).toBe(false);
      await sleep(1000);
      expect(h.seen.filter(e => /^(ItemDeposited|ItemWithdrawn|ActionCompleted)$/.test(e.type))).toEqual([]);
      expect(h.seen.some(e => e.type === "SystemIncident")).toBe(true);
      expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
    });
  }
}
