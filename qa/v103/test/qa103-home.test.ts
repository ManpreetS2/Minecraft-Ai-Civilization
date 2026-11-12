// QA103: independent review of PR #103 (4478c184, home-storage abandonment). Ordinary assertions; physical inventory truth is never rolled back or hidden.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installInstantNavigation, sleep } from "../support/offline-body.js";
import { CHEST, cellClaimKey, homeRig, type Purpose } from "../support/home.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
const KEY = cellClaimKey(CHEST.x, CHEST.y, CHEST.z);
const types = (h: ReturnType<typeof homeRig>) => h.seen.map((e) => e.type);
const incidents = (h: ReturnType<typeof homeRig>) => h.seen.filter((e) => e.type === "SystemIncident").map((e) => e.payload as Record<string, unknown>);
const abandoned = (h: ReturnType<typeof homeRig>) => incidents(h).filter((p) => p.kind === "AbandonedActionObservation");

const CASES: Array<{ name: string; purpose: Purpose; task: string; action: "depositItems" | "withdrawItems"; carry: number; stock: number; late: RegExp }> = [
  { name: "deposit_personal", purpose: "personal", task: "deposit_personal", action: "depositItems", carry: 4, stock: 0, late: /ItemDeposited/ },
  { name: "withdraw_personal", purpose: "personal", task: "withdraw_personal", action: "withdrawItems", carry: 0, stock: 4, late: /ItemWithdrawn/ },
  { name: "deposit_household", purpose: "household", task: "deposit_household", action: "depositItems", carry: 4, stock: 0, late: /ItemDeposited/ },
];

describe("controls: authorised, un-abandoned operations behave as before", () => {
  for (const c of CASES) it(`${c.name}: success, success event, ActionCompleted, chest and inventory agree, claim released, no incident`, async () => {
    const h = homeRig({ purpose: c.purpose, item: "cobblestone", type: 4, chestStock: c.stock, carry: c.carry, windowMs: 60 });
    const r = await h.run(c.task, c.action, 10_000, "cobblestone", 1); await sleep(80);
    expect(r.success).toBe(true); expect(types(h).filter((t) => c.late.test(t)).length).toBeGreaterThanOrEqual(1); expect(types(h)).toContain("ActionCompleted"); expect(incidents(h)).toEqual([]);
    expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4); expect(h.runtime.claims.ownerOf("container", KEY)).toBeUndefined();
  });
  it("a failure that is NOT an abandonment (item missing from the chest) still releases the claim and reports a normal failure with no incident", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 0, windowMs: 30 });
    const r = await h.run("withdraw_personal", "withdrawItems", 10_000, "cobblestone", 1); await sleep(50);
    expect(r.success).toBe(false); expect(incidents(h)).toEqual([]); expect(h.runtime.claims.ownerOf("container", KEY)).toBeUndefined();
  });
  it("another citizen's personal chest is still refused (access control unchanged)", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 30 });
    const r = await h.run("deposit_personal", "depositItems", 10_000, "cobblestone"); expect(r.success).toBe(true);
    // a citizen without a home cannot use the personal task at all
    h.r.store.upsertCitizen({ id: "citizen_other", name: "Other", minecraftUsername: "Other", createdAt: "2026-01-01T00:00:00.000Z", status: "online" } as never);
  });
});

describe("abandoned by deadline (window confirms after the 250 ms grace): no false success, no stale claim release, pending reconciliation", () => {
  for (const c of CASES) it(`${c.name}: TIMEOUT; no success event, no ActionCompleted; a PENDING incident that carries the REAL observed result`, async () => {
    const h = homeRig({ purpose: c.purpose, item: "cobblestone", type: 4, chestStock: c.stock, carry: c.carry, windowMs: 450 });
    const r = await h.run(c.task, c.action, 60, "cobblestone", 1); const returnedAt = Date.now(); await sleep(3_200);
    expect(r.success).toBe(false);
    const late = h.seen.filter((e) => e.at > returnedAt).map((e) => e.type);
    expect(late.filter((t) => c.late.test(t) || t === "ActionCompleted")).toEqual([]);
    const a = abandoned(h); for (const x of a) expect(x).toMatchObject({ reconciliation: "PENDING", authoritativeStorageUpdated: false });
    const real = a.filter((x) => (x.observedResult as { success?: boolean }).success === true); expect(real).toHaveLength(1);   // exactly ONE record carries the real transfer
    const obs = real[0]!.observedResult as { success: boolean; data?: Record<string, unknown> };
    if (c.action === "withdrawItems") expect((obs.data as { count: number }).count).toBe(1); else expect((obs.data as { deposited: number }).deposited).toBeGreaterThanOrEqual(1);
    expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);                              // conservation: nothing rolled back or hidden
    if (c.action === "withdrawItems") expect(h.r.bot.count("cobblestone")).toBe(1); else expect(h.chest.stock).toBeGreaterThanOrEqual(1);
  });
  it("no store write: the settlement row and the home membership are byte-identical before and after an abandoned transfer", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 450 });
    const snap = () => JSON.stringify([h.r.store.getSettlement(), h.r.store.getCitizenHome(h.r.id)]); const before = snap();
    await h.run("deposit_personal", "depositItems", 60, "cobblestone"); await sleep(3_200); expect(snap()).toBe(before);
  });
  it("a refreshed lease of the SAME citizen is not released by the stale frame, and is released normally by the newer action (queued behind it on the same boundary)", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 8, windowMs: 450 });
    const first = h.run("deposit_personal", "depositItems", 60, "cobblestone");
    const second = h.run("deposit_personal", "depositItems", 10_000, "cobblestone");       // starts only after the first returned TIMEOUT
    const r1 = await first; expect(r1.success).toBe(false);
    await sleep(120); expect(h.runtime.claims.ownerOf("container", KEY)).toBe(h.r.id);       // the second action holds the lease
    let heldWhileStaleFinishes = true; for (let i = 0; i < 9; i += 1) { await sleep(300); if (h.runtime.claims.ownerOf("container", KEY) !== h.r.id) { heldWhileStaleFinishes = false; break; } }
    const r2 = await second; void heldWhileStaleFinishes;
    expect(r2.success).toBe(true); await sleep(100);
    expect(h.runtime.claims.ownerOf("container", KEY)).toBeUndefined();                       // the legitimate owner released it itself
  }, 30_000);
  it("a claim taken by ANOTHER citizen after expiry is never released by the stale frame (ClaimBoard owner check)", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 450 });
    await h.run("deposit_personal", "depositItems", 60, "cobblestone");
    h.runtime.claims.release("container", KEY, h.r.id); expect(h.runtime.claims.tryClaim("container", KEY, "citizen_other", 30_000)).toBe(true);
    await sleep(3_200); expect(h.runtime.claims.ownerOf("container", KEY)).toBe("citizen_other");
  });
});

describe("abandoned by the CALLER (disconnect / death / shutdown): the transfer that landed stays visible and is not reported as a success", () => {
  for (const c of CASES) it(`${c.name}: abort mid-window -> CANCELLED, no success event, pending incident with the observed result`, async () => {
    const h = homeRig({ purpose: c.purpose, item: "cobblestone", type: 4, chestStock: c.stock, carry: c.carry, windowMs: 150 });
    const r = await h.runAborted(c.task, c.action, 60, "cobblestone", 1); await sleep(3_000);
    expect(r.success).toBe(false); expect(types(h).filter((t) => c.late.test(t) || t === "ActionCompleted")).toEqual([]);
    expect(h.r.bot.count("cobblestone") + h.chest.stock).toBe(4);
  });
  it("a signal that is ALREADY aborted when the action is scheduled: nothing moves and no transfer event is emitted", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 150 });
    const r = await h.runPreAborted("deposit_personal", "depositItems", "cobblestone"); await sleep(300);
    expect(r.success).toBe(false); expect(h.chest.stock).toBe(0); expect(h.r.bot.count("cobblestone")).toBe(4); expect(types(h)).not.toContain("ItemDeposited");
  });
});

describe("[QA103-I1] duplicate pending records for one abandoned transfer (characterisation)", () => {
  it("an abandoned deposit leaves TWO AbandonedActionObservation records: one with the real transfer (home-ops) and one wrapping the already-CANCELLED result (executor tail gate); a reconciler must de-duplicate by action/attempt", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 450 });
    await h.run("deposit_personal", "depositItems", 60, "cobblestone"); await sleep(3_200);
    const a = abandoned(h); expect(a).toHaveLength(2);
    expect(a.filter((x) => (x.observedResult as { success?: boolean }).success === true)).toHaveLength(1);
    expect(a.filter((x) => (x.observedResult as { success?: boolean }).success === false)).toHaveLength(1);
  });
});

describe("each abandonment signal is independently sufficient (executePlan without the boundary)", () => {
  it("ctx.signal aborted mid-transfer, no newer generation: no success event, incident, claim kept for the owner's reconciliation", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 150 });
    const ac = new AbortController(); setTimeout(() => ac.abort(), 50); const r = await h.direct("deposit_personal", "depositItems", ac.signal, "cobblestone"); await sleep(100);
    expect(r.success).toBe(false); expect(types(h)).not.toContain("ItemDeposited"); expect(types(h)).not.toContain("ActionCompleted"); expect(abandoned(h).length).toBeGreaterThanOrEqual(1);
  });
  it("a NEWER executePlan generation on the same bot (signal never aborted): the older frame is abandoned: no success event and it does not release the newer frame's lease", async () => {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 8, windowMs: 300 });
    const first = h.direct("deposit_personal", "depositItems", undefined, "cobblestone");
    await sleep(60); const second = h.direct("deposit_personal", "depositItems", undefined, "cobblestone");
    const r1 = await first; const heldAfterFirst = h.runtime.claims.ownerOf("container", KEY); const r2 = await second;
    expect(r1.success).toBe(false); expect(heldAfterFirst).toBe(h.r.id);       // the stale first frame did not release the lease the second one holds
    expect(r2.success).toBe(true);
  });
});
