/* eslint-disable @typescript-eslint/no-explicit-any -- Independent QA source snapshot; runtime assertions unchanged. */
// Round 5 / Mission 2 (+ PR #154/#156 adjudication): "one authoritative physical receipt per abandoned transfer, none for a no-effect cancellation, on EVERY abandonment signal".
// Physical truth is the fake chest/inventory; receipts are SystemIncident AbandonedTransferObservation events. Offline fake body only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../../v103/support/offline-body.js";
import { homeRig, type Purpose } from "../../v103/support/home.js";
let restore: () => void; beforeEach(() => { restore = installInstantNavigation(); }); afterEach(() => restore());
type Seen = { type: string; payload?: unknown }; const P = (e: Seen) => (e.payload ?? {}) as Record<string, any>;
const receipts = (s: Seen[]) => s.filter((e) => e.type === "SystemIncident" && P(e).kind === "AbandonedTransferObservation");
const terminal = (s: Seen[]) => s.filter((e) => e.type === "ItemDeposited" || e.type === "ItemWithdrawn");
type Dir = "withdraw" | "deposit"; type Signal = "deadline" | "caller-abort" | "pre-abort";
const CASES: Array<[Purpose, Dir]> = [["personal", "withdraw"], ["personal", "deposit"], ["household", "withdraw"], ["household", "deposit"]];

describe("abandoned home transfer: physical receipts are complete on every abandonment signal (conservation)", () => {
  for (const [purpose, dir] of CASES) for (const signal of ["deadline", "caller-abort", "pre-abort"] as Signal[]) {
    it(`${purpose} ${dir} / ${signal}: receipts == (moved ? 1 : 0), the receipt's deltas equal the physical movement, no terminal event`, async () => {
      const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: dir === "withdraw" ? 4 : 0, carry: dir === "deposit" ? 4 : 0, windowMs: 450 });
      const task = `${dir}_${purpose}`, action = dir === "withdraw" ? "withdrawItems" : "depositItems";
      if (signal === "deadline") await h.run(task, action, 60, "cobblestone", 2);
      else if (signal === "caller-abort") await h.runAborted(task, action, 80, "cobblestone", 2);
      else await h.runPreAborted(task, action, "cobblestone", 2);
      await sleep(1_300);
      const moved = Math.abs(h.chest.stock - (dir === "withdraw" ? 4 : 0)); const r = receipts(h.seen);
      expect(terminal(h.seen)).toEqual([]); expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
      expect(r).toHaveLength(moved > 0 ? 1 : 0);
      if (moved > 0) { const p = P(r[0]!); expect(p.reconciliation).toBe("PENDING"); expect(Math.abs(p.citizenAfter - p.citizenBefore)).toBe(moved); expect(Math.abs(p.containerAfter - p.containerBefore)).toBe(moved); }
    }, 30_000);
  }
  it("overlapping same-citizen generations (the offline fake lets BOTH frames move items; a real client has one container window per bot, NOT proven here): exactly one record per physical movement, stale frame never gets a terminal event", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 400 });
    const first = h.direct("deposit_personal", "depositItems", undefined, "cobblestone"); await sleep(60);
    const second = h.direct("deposit_personal", "depositItems", undefined, "cobblestone"); const [r1, r2] = await Promise.all([first, second]); await sleep(1_300);
    const movements = h.chest.stock / 4; expect(movements).toBe(2); // fake-world artefact, recorded so the accounting below is honest
    expect(r1.success).toBe(false); expect(r2.success).toBe(true);        // stale frame cancelled, current frame completed
    expect(terminal(h.seen)).toHaveLength(1); expect(receipts(h.seen)).toHaveLength(1); expect(receipts(h.seen).length + terminal(h.seen).length).toBe(movements);
  }, 30_000);
});
