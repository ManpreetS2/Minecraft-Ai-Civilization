// Child process for QA78 timer/escape-hatch probes. Production createActionBoundary only; the client is a recording double.
// Prints one JSON line when the process survives. An uncaught exception / unhandled rejection exits non-zero with the message on stderr.
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { fail } from "../../../packages/shared/src/index.js";

const mode = process.argv[2] ?? "";
const wire: string[] = [];
const client = { write(name: string) { wire.push(name); } };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const realSetTimeout = globalThis.setTimeout;
const boundary = createActionBoundary(() => client);
const abort = new AbortController();
let release!: () => void;
const released = new Promise<void>((r) => { release = r; });
const afterAbort = (signal: AbortSignal) => new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
const CANCELLED = fail("CANCELLED", "cancelled", 1, false);

// How each mode makes a LATE (owner already inactive) write happen from an abandoned action.
const late: Record<string, (signal: AbortSignal) => Promise<unknown> | unknown> = {
  "timer-created-during-action": async (signal) => { setTimeout(() => client.write("arm_animation"), 60); await afterAbort(signal); },
  "interval-created-during-action": async (signal) => { const h = setInterval(() => client.write("arm_animation"), 30); (h as { unref?: () => void }).unref?.(); await afterAbort(signal); },
  "other-error-in-timer": async (signal) => { setTimeout(() => { throw new Error("boom-not-a-refusal"); }, 60); await afterAbort(signal); },
  "late-timer-after-boundary-returned": async (signal) => { await afterAbort(signal); await released; setTimeout(() => client.write("arm_animation"), 10); },
  "nexttick-after-abort": async (signal) => { await afterAbort(signal); await sleep(30); process.nextTick(() => client.write("arm_animation")); },
  "setimmediate-after-abort": async (signal) => { await afterAbort(signal); await sleep(30); setImmediate(() => client.write("arm_animation")); },
  "microtask-after-abort": async (signal) => { await afterAbort(signal); await sleep(30); queueMicrotask(() => client.write("arm_animation")); },
  "unawaited-promise-after-abort": async (signal) => { await afterAbort(signal); await sleep(30); void (async () => { client.write("arm_animation"); })(); },
  "promisified-settimeout-during-action": async (signal) => { const { promisify } = await import("node:util"); await promisify(setTimeout)(20); await afterAbort(signal); },
  "sync-throwing-skill": () => { throw new Error("skill threw synchronously"); },
};

if (mode === "sync-throwing-skill") {
  const before = globalThis.setTimeout;
  const r = await boundary.run("x", late[mode] as never, { timeoutMs: 5_000 }).then(() => "resolved", (e: Error) => `rejected:${e.message}`);
  console.log(JSON.stringify({ survived: true, outcome: r, timersRestored: globalThis.setTimeout === before, timersStillOriginal: globalThis.setTimeout === realSetTimeout }));
  process.exit(0);
}
if (!late[mode]) { console.error(`unknown mode ${mode}`); process.exit(3); }

const run = boundary.run("x", async (signal) => { await late[mode](signal); return mode === "late-timer-after-boundary-returned" ? (await released, CANCELLED) : CANCELLED; }, { signal: abort.signal, timeoutMs: 5_000, graceMs: 40 });
setTimeout(() => abort.abort(), 50);
if (mode === "late-timer-after-boundary-returned") {
  const settledOrAbandoned = await Promise.race([run, sleep(400).then(() => "abandoned")]);
  void settledOrAbandoned;
  const restored = globalThis.setTimeout === realSetTimeout;
  release();               // the abandoned skill now schedules a NEW timer after the boundary already returned and un-wrapped timers
  await sleep(200);
  console.log(JSON.stringify({ survived: true, wire, timersRestoredBeforeLateTimer: restored }));
  process.exit(0);
}
await run;
await sleep(300);
console.log(JSON.stringify({ survived: true, wire }));
process.exit(0);
