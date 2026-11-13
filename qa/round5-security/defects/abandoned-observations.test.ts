 
// Round 5 / Mission 2 DESIRED contracts for PR #141 (red = not met by 1ee1556). Not a regression claim: new combined behaviour, characterised and reported as Low.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../../v103/support/offline-body.js";
import { homeRig } from "../../v103/support/home.js";
let restore: () => void; beforeEach(() => { restore = installInstantNavigation(); }); afterEach(() => restore());
type Seen = { type: string; payload?: unknown }; const P = (e: Seen) => (e.payload ?? {}) as Record<string, unknown>;
async function abandoned(dir: "withdraw" | "deposit") {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: dir === "withdraw" ? 4 : 0, carry: dir === "deposit" ? 4 : 0, windowMs: 450 });
  await h.run(`${dir}_personal`, dir === "withdraw" ? "withdrawItems" : "depositItems", 60, "cobblestone", 2); await sleep(1_300);
  return h.seen.filter((e) => e.type === "SystemIncident") as Seen[];
}
describe("pending observations for ONE abandoned physical transfer", () => {
  for (const dir of ["withdraw", "deposit"] as const) {
    it(`QA141-L1 ${dir}: at most one PENDING reconciliation record per physical transfer (a reconciler cannot otherwise tell three records are one movement)`, async () => {
      expect((await abandoned(dir)).filter((e) => P(e).reconciliation === "PENDING").length).toBeLessThanOrEqual(1);
    }, 30_000);
  }
  it("QA141-L2: the abandoned WITHDRAW observation carries the same fields as the abandoned DEPOSIT observation (count, position, access, contents)", async () => {
    const w = (await abandoned("withdraw")).find((e) => P(e).kind === "AbandonedTransferObservation")!; const d = (await abandoned("deposit")).find((e) => P(e).kind === "AbandonedTransferObservation")!;
    expect(Object.keys(P(w)).sort()).toEqual(Object.keys(P(d)).sort());
  }, 30_000);
});
