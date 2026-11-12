import { beforeEach, afterEach, expect, it } from "vitest";
import { homeRig, CHEST } from "../../v88/support/home.js";
import { installInstantNavigation } from "../../v88/support/offline-body.js";
import { depositItems } from "../../../packages/skills/src/inventory.js";
import { presentEvent } from "../../../packages/shared/src/format-event.js";
let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());
for (const purpose of ["personal", "household"] as const) for (const action of ["deposit", "withdraw"] as const) {
  it(`${purpose} ${action} preserves observations, access and a single logical completion`, async () => {
    const h = homeRig({ purpose, item: "cobblestone", type: 4, chestStock: action === "deposit" ? 0 : 4, carry: action === "deposit" ? 4 : 0, windowMs: 1 });
    const result = await h.run(`${action}_${purpose}`, action === "deposit" ? "depositItems" : "withdrawItems", 10_000);
    expect(result.success).toBe(true);
    const events = h.seen.filter(e => e.type === (action === "deposit" ? "ItemDeposited" : "ItemWithdrawn"));
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as Record<string, unknown>;
    expect(p).toMatchObject({ item: "cobblestone", count: action === "deposit" ? 4 : 1, citizenBefore: action === "deposit" ? 4 : 0, citizenAfter: action === "deposit" ? 0 : 1, containerBefore: action === "deposit" ? 0 : 4, containerAfter: action === "deposit" ? 4 : 3, position: CHEST, access: purpose });
    expect(h.seen.filter(e => e.type === "ActionCompleted")).toHaveLength(1);
    expect(presentEvent({ type: events[0]!.type, timestamp: new Date().toISOString(), payload: p }).count).toBe(p.count);
  });
}
it("multiple stacks report only the count physically moved from the first stack, without an aggregate duplicate", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 1 });
  h.r.bot.give("cobblestone", 3);
  expect((await h.run("deposit_personal", "depositItems", 10_000)).success).toBe(true);
  const events = h.seen.filter(e => e.type === "ItemDeposited");
  expect(events).toHaveLength(1);
  expect(events[0]!.payload).toMatchObject({ count: 4, citizenBefore: 7, citizenAfter: 3, containerBefore: 0, containerAfter: 4 });
  expect(h.chest.stock + h.r.bot.count("cobblestone")).toBe(7);
});
it("a later item failure preserves the earlier physical event and reports no transfer for the failed item", async () => {
  const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 1 });
  h.r.bot.give("coal", 3);
  const original = h.r.bot.openContainer.bind(h.r.bot);
  h.r.bot.openContainer = (async (...args: unknown[]) => {
    const chest = await (original as (...args: unknown[]) => Promise<{ deposit: (...args: unknown[]) => Promise<void> }>)(...args);
    const deposit = chest.deposit.bind(chest);
    chest.deposit = async (...a: unknown[]) => { if (a[0] === 3) throw new Error("second item refused"); return deposit(...a); };
    return chest;
  }) as typeof h.r.bot.openContainer;
  const result = await depositItems({ body: h.r.body, bot: h.r.bot as never, events: h.bus, citizenId: h.r.id, storageAccess: "personal" }, undefined, CHEST);
  expect(result.success).toBe(true); // Existing wrapper reports verified partial work.
  const events = h.seen.filter(e => e.type === "ItemDeposited");
  expect(events).toHaveLength(1);
  expect(events[0]!.payload).toMatchObject({ item: "cobblestone", count: 4 });
  expect(h.r.bot.count("coal")).toBe(3);
  expect(h.chest.stock).toBe(4);
});
