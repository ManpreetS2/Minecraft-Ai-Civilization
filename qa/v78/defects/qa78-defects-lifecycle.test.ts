// QA78 DEFECT DEMONSTRATIONS. These are ORDINARY assertions of the SAFE behaviour. They are expected to be RED on PR #78
// (e99d5ef0) where the defect is present, and turn green when it is fixed. They are kept out of the default config
// (vitest.defects.config.ts) so the regression suite stays green. Nothing here is it.fails / expected-failure.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../packages/shared/src/index.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { depositItem } from "../../../packages/skills/src/inventory-service.js";
import { rig } from "../support/manager-rig.js";
import { installInstantNavigation, offlineBody, skillContext, sleep } from "../support/offline-body.js";
import { installSlowChest } from "../support/slow-world.js";
import { fishBot } from "../support/fish-rig.js";
import { child } from "../support/child.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

describe("[QA78-M1] QA69-L2 is only fixed inside the skill: the production executor still reports success AFTER the boundary recorded TIMEOUT", () => {
  it("withdraw via executePlan (the real production call chain): after TIMEOUT there is no ItemWithdrawn, no ActionCompleted and no settlement-ledger write", async () => {
    const r = rig(); const bus = new EventBus(); const seen: Array<{ type: string; at: number }> = []; bus.on((e) => seen.push({ type: e.type, at: Date.now() }));
    const st = r.store.getSettlement(); st.storage = { x: 4, y: 64, z: 4 }; st.storageContents = { bread: 4 }; r.store.saveSettlement(st);
    r.bot.blocks.set("4,64,4", { name: "chest" });
    const chest = installSlowChest(r.bot, { item: "bread", type: 7, withdrawMs: 450, stock: 4 }); // a slow window confirmation: longer than the production 250 ms grace after the 60 ms deadline
    const boundary = createActionBoundary(() => r.bot._client);
    const plan = { action: "withdrawItems", task: "withdraw_food", source: "planner", reason: "qa", target: "chest" } as never;
    const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 } as never as { signal?: AbortSignal };
    const result = await boundary.run("withdrawItems", (signal) => { ctx.signal = signal; return executePlan(ctx as never, plan, r.store, bus); }, { timeoutMs: 60 }); // production defaults: graceMs is NOT overridden (manager.ts passes only signal+timeoutMs)
    const abandonedAt = Date.now(); const ledgerAtTimeout = JSON.stringify(r.store.getSettlement().storageContents);
    await sleep(700);
    const late = seen.filter((e) => e.at > abandonedAt).map((e) => e.type);
    console.log("QA78-M1 managerSaw=", result.success ? "success" : (result as { code: string }).code, "eventsAfterTimeout=", late.join(",") || "none", "ledger", ledgerAtTimeout, "->", JSON.stringify(r.store.getSettlement().storageContents), "inventoryBread=", r.bot.count("bread"), "chestStock=", chest.stock);
    expect(result.success).toBe(false);
    expect(late.filter((t) => /Withdrawn|ActionCompleted/.test(t))).toEqual([]);
    expect(JSON.stringify(r.store.getSettlement().storageContents)).toBe(ledgerAtTimeout);
  });

  it("deposit has the same defect at the skill level: ItemDeposited is emitted after the boundary reported TIMEOUT", async () => {
    const body = offlineBody(); const bot = body.fake; bot.blocks.set("4,64,4", { name: "chest" }); bot.give("cobblestone", 4);
    installSlowChest(bot, { item: "cobblestone", type: 4, depositMs: 450, stock: 0 });
    const bus = new EventBus(); const seen: Array<{ type: string; at: number }> = []; bus.on((e) => seen.push({ type: e.type, at: Date.now() }));
    const boundary = createActionBoundary(() => bot._client);
    const result = await boundary.run("deposit", (signal) => depositItem({ ...skillContext(body, { signal, timeoutMs: 22_000 }), events: bus } as never, "cobblestone", 2, { x: 4, y: 64, z: 4 }), { timeoutMs: 60 }); // production defaults
    const abandonedAt = Date.now(); await sleep(3_000); // deposit then waits for the inventory count (up to 2.5 s)
    const late = seen.filter((e) => e.at > abandonedAt).map((e) => e.type);
    console.log("QA78-M1b deposit managerSaw=", result.success ? "success" : (result as { code: string }).code, "eventsAfterTimeout=", late.join(",") || "none");
    expect(result.success).toBe(false);
    expect(late.filter((t) => /Deposited/.test(t))).toEqual([]);
  });

});

describe("[QA78-L3] global timer wrapper and refusal escape hatches (child processes, production boundary)", () => {
  it("a timer that an ABANDONED action arms AFTER the boundary returned is not protected (wrapper already restored): process must survive", () => {
    const r = child("timer-child.ts", "late-timer-after-boundary-returned");
    expect(r.code, r.err.split("\n").find((l) => /refused/.test(l)) ?? "").toBe(0);
  });
  for (const mode of ["nexttick-after-abort", "setimmediate-after-abort", "microtask-after-abort", "unawaited-promise-after-abort"]) {
    it(`a refused late write reaching the process through ${mode} must not be an uncaught exception`, () => {
      const r = child("timer-child.ts", mode);
      expect(r.code, r.err.split("\n").find((l) => /refused/.test(l)) ?? "").toBe(0);
    });
  }
  it("promisify(setTimeout) keeps working while an action is active (the wrapper drops util.promisify.custom)", () => {
    const r = child("timer-child.ts", "promisified-settimeout-during-action");
    expect(r.code, r.err.split("\n").find((l) => /TypeError/.test(l)) ?? "").toBe(0);
  });
  it("a skill that throws synchronously does not leave setTimeout/setInterval wrapped for the rest of the process", () => {
    const r = child("timer-child.ts", "sync-throwing-skill");
    expect(r.json).toMatchObject({ timersStillOriginal: true });
  });
});

describe("[QA78-L4] (PR #74 origin) a listener registered during an action cannot be removed after the action ends", () => {
  it("client.off(event, original) after the action leaves the wrapped listener installed", async () => {
    const f = fishBot(); const boundary = createActionBoundary(() => f.client);
    const handler = () => undefined;
    await boundary.run("a", async () => { f.client.on("some_packet", handler); return { success: true, data: {}, durationMs: 1 } as never; }, { timeoutMs: 1_000 });
    f.client.off("some_packet", handler); f.client.removeListener("some_packet", handler);
    expect(f.client.listenerCount("some_packet")).toBe(0);
  });
});
