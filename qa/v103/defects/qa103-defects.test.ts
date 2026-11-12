// QA103 DEFECT DEMONSTRATIONS (ordinary assertions of the SAFE behaviour; RED on PR #103 (4478c184) where the weakness is present).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../support/offline-body.js";
import { CHEST, cellClaimKey, homeRig } from "../support/home.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
const KEY = cellClaimKey(CHEST.x, CHEST.y, CHEST.z);
const incidents = (h: ReturnType<typeof homeRig>) => h.seen.filter((e) => e.type === "SystemIncident").map((e) => e.payload as Record<string, unknown>);

describe("[QA103-L1] a cooperative cancel (caller abort; the skill returns inside the grace) leaves the container claim held", () => {
  it("after a prompt abort has fully unwound, the container claim is no longer held by the cancelled action (another citizen can use the chest)", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 80 });
    const r = await h.runAborted("deposit_personal", "depositItems", 20, "cobblestone"); await sleep(400);
    const owner = h.runtime.claims.ownerOf("container", KEY);
    console.log("QA103-L1 result=", r.success ? "success" : (r as { code: string }).code, "claimOwnerAfterUnwind=", owner ?? "none");
    expect(r.success).toBe(false);
    expect(owner).toBeUndefined();
    expect(h.runtime.claims.tryClaim("container", KEY, "citizen_other", 30_000)).toBe(true);
  });
});

describe("[QA103-L2] a cancellation that moved NOTHING is reported as a PENDING reconciliation", () => {
  it("a signal already aborted before the action starts: no AbandonedActionObservation with reconciliation PENDING (there is nothing to reconcile)", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 150 });
    const r = await h.runPreAborted("deposit_personal", "depositItems", "cobblestone"); await sleep(300);
    const pending = incidents(h).filter((p) => p.reconciliation === "PENDING");
    console.log("QA103-L2 pending incidents for a no-op cancel:", JSON.stringify(pending.map((p) => ({ kind: p.kind, observedSuccess: (p.observedResult as { success?: boolean } | undefined)?.success }))));
    expect(r.success).toBe(false); expect(h.chest.stock).toBe(0); expect(h.r.bot.count("cobblestone")).toBe(4);
    expect(pending).toEqual([]);
  });
});
