// QA88 controls: the personal/household chest actions, un-abandoned, through the real executePlan + boundary. Ordinary assertions.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../support/offline-body.js";
import { homeRig, keyOf, type Purpose } from "../support/home.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

for (const purpose of ["personal", "household"] as Purpose[]) {
  describe(`${purpose} chest, no abandonment`, () => {
    it(`deposit_${purpose}: success, at least one ItemDeposited, one ActionCompleted, chest and inventory agree, claim released`, async () => {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 80 });
      const result = await h.run(`deposit_${purpose}`, "depositItems", 10_000, "cobblestone");
      await sleep(100);
      expect(result.success).toBe(true);
      const types = h.seen.map((e) => e.type);
      expect(types.filter((t) => t === "ItemDeposited").length).toBeGreaterThanOrEqual(1);
      expect(types.filter((t) => t === "ActionCompleted")).toHaveLength(1);
      expect(h.chest.stock).toBe(4); expect(h.r.bot.count("cobblestone")).toBe(0);
      expect(h.runtime.claims.ownerOf("container", keyOf().replace("container:", ""))).toBeUndefined();
    });
    if (purpose === "household") return; // the executor has no withdraw_household task (it falls through to the communal food path)
    it(`withdraw_${purpose}: success, at least one ItemWithdrawn, chest 4->3, inventory 0->1`, async () => {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: 4, carry: 0, windowMs: 80 });
      const result = await h.run(`withdraw_${purpose}`, "withdrawItems", 10_000, "cobblestone", 1);
      await sleep(100);
      expect(result.success).toBe(true);
      expect(h.seen.filter((e) => e.type === "ItemWithdrawn").length).toBeGreaterThanOrEqual(1);
      expect(h.chest.stock).toBe(3); expect(h.r.bot.count("cobblestone")).toBe(1);
    });
  });
}

describe("[QA88-I1] duplicate success events on every chest transfer (pre-existing, not caused by PR #88)", () => {
  it("a normal personal deposit emits ItemDeposited twice: once from the skill (depositItem) and once from home-ops.executeStorage", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 40 });
    await h.run("deposit_personal", "depositItems", 10_000, "cobblestone"); await sleep(60);
    expect(h.seen.filter((e) => e.type === "ItemDeposited")).toHaveLength(2);
  });
});
