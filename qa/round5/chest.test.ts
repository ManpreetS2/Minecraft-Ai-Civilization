import { beforeEach, afterEach, it, expect } from "vitest";
import { installInstantNavigation, sleep } from "../v103/support/offline-body.js";
import { homeRig } from "../v103/support/home.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
it("one abandoned physical deposit produces one pending receipt and conserves inventory", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 450 });
  await h.run("deposit_personal", "depositItems", 60, "cobblestone");
  await sleep(3200);
  const pending = h.seen.filter(e => e.type === "SystemIncident" && (e.payload as Record<string, unknown>).reconciliation === "PENDING");
  expect(pending).toHaveLength(1);
  expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
});
