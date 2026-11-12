// Isolated fake-body rig for the personal / household chest actions (home-ops.executeStorage), driven through the REAL executePlan and the
// REAL action boundary with production defaults (grace 250 ms; the manager passes only signal + timeoutMs).
import { EventBus } from "../../../packages/shared/src/index.js";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { SettlementRuntime } from "../../../packages/agent-core/src/settlement-runtime.js";
import { claimHome } from "../../../packages/agent-core/src/homes.js";
import { rig } from "./manager-rig.js";
export { cellClaimKey } from "../../../packages/agent-core/src/claims.js";
import { installSlowChest } from "./slow-world.js";
import { sleep } from "./offline-body.js";

export const CHEST = { x: 4, y: 64, z: 4 };
export type Purpose = "personal" | "household";
export const keyOf = (c = CHEST) => `container:${Math.floor(c.x)},${Math.floor(c.y)},${Math.floor(c.z)}`;

export function homeRig(o: { purpose: Purpose; item: string; type: number; chestStock: number; carry: number; windowMs: number }) {
  const r = rig(); const bus = new EventBus(); const seen: Array<{ type: string; at: number; payload?: unknown }> = [];
  bus.on((e) => seen.push({ type: e.type, at: Date.now(), payload: e.payload }));
  const claimed = claimHome(r.store, { citizenId: r.id, homeId: "home_qa", origin: { x: 0, y: 64, z: 0 }, entrance: { x: 1, y: 64, z: 0 }, bed: { x: 2, y: 64, z: 2 },
    ...(o.purpose === "personal" ? { personalChest: CHEST, storageAccess: "personal" as const } : { householdChest: CHEST, storageAccess: "household" as const }) } as never);
  if (!claimed.success) throw new Error(`claimHome: ${claimed.error}`);
  r.bot.blocks.set(`${CHEST.x},${CHEST.y},${CHEST.z}`, { name: "chest" });
  r.bot.blocks.set("2,64,2", { name: "white_bed" });
  if (o.carry > 0) r.bot.give(o.item, o.carry);
  const chest = installSlowChest(r.bot, { item: o.item, type: o.type, withdrawMs: o.windowMs, depositMs: o.windowMs, stock: o.chestStock });
  const runtime = new SettlementRuntime();
  const boundary = createActionBoundary(() => r.bot._client);
  const ctx = { body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000 } as { signal?: AbortSignal };
  const run = (task: string, action: "depositItems" | "withdrawItems", timeoutMs: number, item = o.item, count = 1) => {
    const plan = { action, task, source: "planner", reason: "qa", item, count } as never;
    return boundary.run(action, (signal) => { ctx.signal = signal; return executePlan(ctx as never, plan, r.store, bus, runtime); }, { timeoutMs }); // production defaults: no graceMs
  };
  /** Like run(), but the CALLER aborts after abortAfterMs (a disconnect / death / shutdown), with a long deadline. */
  const runAborted = (task: string, action: "depositItems" | "withdrawItems", abortAfterMs: number, item = o.item, count = 1) => {
    const plan = { action, task, source: "planner", reason: "qa", item, count } as never; const ac = new AbortController(); setTimeout(() => ac.abort(), abortAfterMs);
    return boundary.run(action, (signal) => { ctx.signal = signal; return executePlan(ctx as never, plan, r.store, bus, runtime); }, { timeoutMs: 20_000, signal: ac.signal });
  };
  /** The caller's signal is ALREADY aborted when the action is scheduled (a disconnect that lands before the action starts). */
  const runPreAborted = (task: string, action: "depositItems" | "withdrawItems", item = o.item, count = 1) => {
    const plan = { action, task, source: "planner", reason: "qa", item, count } as never; const ac = new AbortController(); ac.abort();
    return boundary.run(action, (signal) => { ctx.signal = signal; return executePlan(ctx as never, plan, r.store, bus, runtime); }, { timeoutMs: 20_000, signal: ac.signal });
  };
  /** executePlan WITHOUT the action boundary (no owner, no deadline): the only abandonment signals are ctx.signal and a newer executePlan generation on the same bot. */
  const direct = (task: string, action: "depositItems" | "withdrawItems", signal?: AbortSignal, item = o.item, count = 1) => {
    const plan = { action, task, source: "planner", reason: "qa", item, count } as never;
    return executePlan({ body: r.body, bot: r.bot as never, events: bus, citizenId: r.id, timeoutMs: 22_000, signal } as never, plan, r.store, bus, runtime);
  };
  return { r, bus, seen, chest, runtime, run, runAborted, runPreAborted, direct, sleep };
}
