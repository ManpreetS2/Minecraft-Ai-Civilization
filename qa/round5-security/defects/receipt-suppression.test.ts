/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- Independent QA source snapshot; runtime assertions unchanged. */
// Round 5 / PR #154 hazard (QA154-M1, DESIRED contract; red = not met). In the abandoned-withdraw branch the pending receipt is now emitted only if the measurement taken
// IMMEDIATELY after chest.withdraw() shows a change. The normal path waits for inventory sync (waitForCount); this branch does not. If slot sync lags the confirmation, a real transfer
// is recorded with no receipt at all. The fake models a server whose container view and inventory both update `lagMs` after the click is confirmed. Real-server timing is NOT proven here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../../v103/support/offline-body.js";
import { homeRig } from "../../v103/support/home.js";
let restore: () => void; beforeEach(() => { restore = installInstantNavigation(); }); afterEach(() => restore());
type Seen = { type: string; payload?: unknown };
it("QA154-M1: a withdraw whose container+inventory sync lags the confirmation and is abandoned at confirmation time must still leave a physical receipt (or the transfer must not happen)", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 4, carry: 0, windowMs: 20 });
  const st = { stock: 4 }; const bot = h.r.bot as any;
  bot.openContainer = async () => ({
    containerItems: () => (st.stock > 0 ? [{ name: "cobblestone", count: st.stock, type: 4 }] : []),
    withdraw: async (_t: number, _m: null, count: number) => { bot._client.write("window_click"); await sleep(20); setTimeout(() => { st.stock -= count; bot.give("cobblestone", count); }, 150); },
    deposit: async () => undefined, close() {},
  });
  await h.runAborted("withdraw_personal", "withdrawItems", 35, "cobblestone", 1); await sleep(800);
  const moved = h.r.bot.count("cobblestone"); expect(moved).toBe(1); // the physical transfer really happened, late
  const rec = (h.seen as Seen[]).filter((e) => e.type === "SystemIncident" && (e.payload as { kind?: string }).kind === "AbandonedTransferObservation");
  const term = (h.seen as Seen[]).filter((e) => e.type === "ItemWithdrawn");
  expect(rec.length + term.length).toBeGreaterThanOrEqual(1);
}, 20_000);
