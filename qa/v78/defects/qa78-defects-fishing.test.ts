// QA78 DEFECT DEMONSTRATIONS for the fishing cleanup permit (needs PR #78's runBoundedCleanup). Ordinary assertions of the SAFE behaviour;
// expected RED on PR #78 (e99d5ef0), green once fixed. Not it.fails.
import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { runMineflayerFishCycle } from "../../../packages/skills/src/mineflayer-fish-cycle.js";
import { runBoundedCleanup } from "../../../packages/shared/src/action-cleanup.js";
import { CANCELLED, fishBot, sleep } from "../support/fish-rig.js";

describe("[QA78-L2] fishing cleanup residuals", () => {
  it("an abort BEFORE the bobber is bound leaves the cast line out: the cast must be retrieved (2 use_item) once the bobber appears, or never cast", async () => {
    const f = fishBot(); const boundary = createActionBoundary(() => f.client); const abort = new AbortController();
    const run = boundary.run("fish", (signal) => runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal }).then(() => CANCELLED), { signal: abort.signal, timeoutMs: 10_000, graceMs: 600 });
    await sleep(10); abort.abort();           // cast already sent; bobber spawn packet not yet received
    await run; await sleep(50); f.spawnBobber(); await sleep(300);
    console.log("QA78-L2 wire=", f.reached.map((w) => w.name).join(","), "bobberEntityPresent=", Object.keys(f.bot.entities).length);
    expect(f.useItems()).toBe(2);
  });

  it("a write that throws during the cancel-retrieve (socket already closed) must not turn a cancel into a rejected cycle", async () => {
    let arm = false;
    const f = fishBot({ writeThrows: () => (arm ? new Error("write after end") : undefined) });
    const abort = new AbortController();
    const cycle = runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal: abort.signal }).then((r) => r.result, (e: Error) => `rejected:${e.message}`);
    await sleep(30); f.spawnBobber(); await sleep(100);
    arm = true; abort.abort();
    expect(await cycle).toBe("cancelled");
  });

  it("the cleanup permit is not one-shot: within its window ONE named packet may be written any number of times (retrieve is meant to be a single use_item)", async () => {
    const f = fishBot(); const boundary = createActionBoundary(() => f.client); const abort = new AbortController();
    let sent = 0;
    const run = boundary.run("p", async (signal) => {
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true })); await sleep(15);
      runBoundedCleanup(() => { for (let i = 0; i < 25; i += 1) { try { f.client.write("use_item"); sent += 1; } catch { /* refused */ } } }, { packets: ["use_item"], deadlineMs: 250 });
      return CANCELLED;
    }, { signal: abort.signal, timeoutMs: 5_000, graceMs: 600 });
    await sleep(5); abort.abort(); await run;
    console.log("QA78-L2c use_item writes inside one 250 ms permit:", sent);
    expect(sent).toBeLessThanOrEqual(1);
  });

  it("[theoretical] the cancel-retrieve does not check that its client is still the cast's client: if bot._client was swapped, the retrieve lands on the NEW session", async () => {
    const f = fishBot(); const abort = new AbortController();
    const cycle = runMineflayerFishCycle(f.bot, { timeoutMs: 5_000, signal: abort.signal });
    await sleep(30); f.spawnBobber(); await sleep(100);
    const nextWrites: string[] = [];
    f.bot._client = Object.assign(new EventEmitter(), { write(n: string) { nextWrites.push(n); } }) as never;
    abort.abort(); await cycle;
    expect(nextWrites).toEqual([]);
  });
});

