// QA88 DEFECT DEMONSTRATIONS. Ordinary assertions of the SAFE behaviour; RED on PR #88 (6c70036b) where the defect is present, green when fixed.
// Production call chain: manager -> actionBoundaryFor().run(production defaults) -> executePlan -> executeOwnedPlan -> home-ops.executeStorage.
// The slow window confirms after the 250 ms grace, so the boundary has already recorded TIMEOUT when the physical transfer completes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../support/offline-body.js";
import { cellClaimKey, homeRig, CHEST, type Purpose } from "../support/home.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

const CASES: Array<{ name: string; purpose: Purpose; task: string; action: "depositItems" | "withdrawItems"; carry: number; stock: number; late: RegExp }> = [
  { name: "deposit_personal", purpose: "personal", task: "deposit_personal", action: "depositItems", carry: 4, stock: 0, late: /ItemDeposited/ },
  { name: "withdraw_personal", purpose: "personal", task: "withdraw_personal", action: "withdrawItems", carry: 0, stock: 4, late: /ItemWithdrawn/ },
  { name: "deposit_household", purpose: "household", task: "deposit_household", action: "depositItems", carry: 4, stock: 0, late: /ItemDeposited/ },
];

describe("[QA88-M1] the personal/household chest path (home-ops.executeStorage) is not covered by PR #88's abandoned-transfer gate", () => {
  for (const c of CASES) {
    it(`${c.name}: after the boundary returned TIMEOUT, no success event for the abandoned transfer is emitted`, async () => {
      const h = homeRig({ purpose: c.purpose, item: "cobblestone", type: 4, chestStock: c.stock, carry: c.carry, windowMs: 450 });
      const result = await h.run(c.task, c.action, 60, "cobblestone", 1);
      const returnedAt = Date.now(); await sleep(3_200); // the deposit path then waits for the inventory count (<= 2.5 s)
      const late = h.seen.filter((e) => e.at > returnedAt).map((e) => e.type);
      console.log(`QA88-M1 ${c.name} managerSaw=${result.success ? "success" : (result as { code: string }).code} eventsAfterReturn=${late.join(",") || "none"} chestStock=${h.chest.stock} inventory=${h.r.bot.count("cobblestone")}`);
      expect(result.success).toBe(false);
      expect(late.filter((t) => c.late.test(t) || t === "ActionCompleted")).toEqual([]);
    });
  }

  it("deposit_personal: the abandoned executor must not release a container claim that a NEWER action of the same citizen has refreshed", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 450 });
    const key = cellClaimKey(CHEST.x, CHEST.y, CHEST.z);
    const result = await h.run("deposit_personal", "depositItems", 60, "cobblestone");
    expect(result.success).toBe(false);
    // the manager starts the next action for the same citizen: it takes/refreshes the container lease
    expect(h.runtime.claims.tryClaim("container", key, h.r.id, 30_000)).toBe(true);
    await sleep(3_200);                                   // the abandoned executor finally unwinds
    expect(h.runtime.claims.ownerOf("container", key)).toBe(h.r.id);
  });
});
