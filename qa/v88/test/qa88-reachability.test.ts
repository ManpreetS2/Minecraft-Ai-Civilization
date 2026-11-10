// QA88 task 2/3: which of the QA78 residuals (L2, L3, L4) can a PRODUCTION path actually reach? Facts are measured against the real installed
// libraries and the real source tree; hypothetical paths are marked as such. Ordinary assertions only.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { executePlan } from "../../../packages/agent-core/src/executor.js";
import { runMineflayerFishCycle } from "../../../packages/skills/src/mineflayer-fish-cycle.js";
import { CANCELLED, fishBot, sleep } from "../support/fish-rig.js";

const walk = (d: string, out: string[] = []): string[] => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p, out); } else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p); } return out; };

describe("QA78-L2b (a throwing write during the cancel-retrieve) is NOT reachable with the real protocol client", () => {
  it("real minecraft-protocol Client.write after end() neither throws nor emits an error event", () => {
    const req = createRequire(createRequire(join(process.cwd(), "packages/minecraft-adapter/package.json")).resolve("mineflayer"));
    const { Client } = req("minecraft-protocol") as { Client: new (server: boolean, version: string) => EventEmitter & { write(n: string, p: unknown): void; end(r: string): void; serializer: { writable: boolean } } };
    const c = new Client(false, "1.21.1"); const errors: unknown[] = []; c.on("error", (e) => errors.push(e));
    c.end("qa88"); expect(c.serializer.writable).toBe(false);
    expect(() => c.write("use_item", { hand: 0 })).not.toThrow();
    expect(errors).toEqual([]);
  });
  it("QA78-L2d: mineflayer assigns bot._client only when the bot is created (loader.js), so a client swap under a running cast does not occur in production", () => {
    const req = createRequire(join(process.cwd(), "packages/minecraft-adapter/package.json"));
    const loader = readFileSync(join(req.resolve("mineflayer"), "..", "lib", "loader.js"), "utf8");
    const assigns = loader.split("\n").filter((l) => /_client\s*=[^=]/.test(l));
    expect(assigns.length).toBeGreaterThan(0); expect(assigns.every((l) => /bot\._client\s*=/.test(l))).toBe(true);
    const lib = join(req.resolve("mineflayer"), "..", "lib"); const others = walk2(lib).filter((f) => !f.endsWith("loader.js")).filter((f) => /bot\._client\s*=[^=]/.test(readFileSync(f, "utf8")));
    expect(others).toEqual([]);
  });
});
function walk2(d: string, out: string[] = []): string[] { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk2(p, out); else if (/\.js$/.test(f)) out.push(p); } return out; }

describe("QA78-L3 (global timer wrapper / escape hatches): production reachability", () => {
  it("L3a: no installed dependency uses util.promisify(setTimeout|setInterval|setImmediate), so the wrapper's lost promisify.custom cannot be hit", () => {
    const p = spawnSync("grep", ["-rIlE", "--include=*.js", "--include=*.cjs", "--include=*.mjs", "promisify\\((global\\.|globalThis\\.)?(setTimeout|setInterval|setImmediate)\\)", "node_modules/.pnpm"], { encoding: "utf8", cwd: process.cwd(), timeout: 100_000 });
    expect(p.stdout.trim()).toBe("");
  }, 120_000);
  it("L3b: the production action callback is an async function, so it cannot throw synchronously and skip the boundary's `finally` (timer wrapper cannot leak that way)", () => {
    expect(executePlan.constructor.name).toBe("AsyncFunction");
    const mgr = readFileSync(join(process.cwd(), "packages/agent-core/src/manager.ts"), "utf8");
    expect(mgr).toMatch(/\(signal\) => \{\s*ctx\.signal = signal;\s*return executePlan\(/);
  });
  it("L3c: production source contains no process.nextTick / queueMicrotask, and no floating `void bot.`/`void ctx.bot.` calls; the only setImmediate is a promise resolver", () => {
    const hits: string[] = [];
    for (const f of [...walk(join(process.cwd(), "packages")), ...walk(join(process.cwd(), "apps"))].filter((x) => !/live-[a-z-]+-(test|demo)\.ts$/.test(x))) { // live harnesses are not the production runtime
      readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (/process\.nextTick|queueMicrotask|^\s*void (ctx\.)?(bot|body)\.|setImmediate/.test(l) && !/^\s*\/\//.test(l)) hits.push(`${f.slice(process.cwd().length + 1)}:${i + 1}: ${l.trim()}`); });
    }
    expect(hits.filter((h) => !/shared\/src\/event-loop\.ts/.test(h))).toEqual([]);
  });
  it("L3c: process-level handlers exist only in the live-mechanics test/demo harnesses, so an escaped refusal WOULD terminate the production orchestrator (hence the importance of there being no such path)", () => {
    const hits = [...walk(join(process.cwd(), "packages")), ...walk(join(process.cwd(), "apps"))].filter((f) => /process\.on\(\s*["'](uncaughtException|unhandledRejection)/.test(readFileSync(f, "utf8"))).map((f) => f.slice(process.cwd().length + 1));
    expect(hits.every((h) => /live-mechanics-(test|demo)\.ts$/.test(h)), hits.join(",")).toBe(true);
  });
});

describe("QA78-L4 (a listener registered during an action cannot be removed after the action ended): reachable only for a SLOW unwind", () => {
  async function run(unwindMs: number) {
    const f = fishBot(); const boundary = createActionBoundary(() => f.client, () => [f.client]); const abort = new AbortController();
    const handler = () => undefined;
    const p = boundary.run("nav", async (signal) => {
      f.client.on("respawn", handler);                                   // like pathing.ts: moveTo registers `lost` on bot events
      try { await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true })); await sleep(unwindMs); }
      finally { f.client.removeListener("respawn", handler); }          // ...and removes it in `finally`
      return CANCELLED;
    }, { signal: abort.signal, timeoutMs: 5_000 });                      // production default grace 250 ms
    await sleep(5); abort.abort(); await p; await sleep(unwindMs + 100);
    return f.client.listenerCount("respawn");
  }
  it("control: an action that unwinds inside the 250 ms grace removes its own listener (no leak) — the normal cooperative case", async () => { expect(await run(60)).toBe(0); });
  it("a navigation that unwinds AFTER the grace leaks one listener per abandoned action (characterisation of the reachable case: pathing.ts registers `end/kicked/death/respawn` handlers)", async () => {
    expect(await run(450)).toBe(1);
  });
  it("source fact: production pathing registers and removes its bot listeners in the same function's try/finally (so only the slow-unwind case above can leak)", () => {
    const src = readFileSync(join(process.cwd(), "packages/minecraft-adapter/src/pathing.ts"), "utf8");
    expect(src).toMatch(/for \(const event of events\) bot\.on\(event, lost\);[\s\S]*finally \{[\s\S]*bot\.removeListener\(event, lost\)/);
  });
});

describe("QA78-L2a (abort before the bobber is bound leaves the cast out): consequence on a server that toggles the rod", () => {
  /** Minimal server model: use_item toggles the rod. Casting spawns a bobber after 40 ms; retrieving destroys it. */
  function server() {
    const f = fishBot(); let out = false; const orig = f.client.write.bind(f.client); let spawned = 500;
    f.client.write = ((name: string) => { orig(name);
      if (name !== "use_item") return;
      if (!out) { out = true; const id = spawned++; setTimeout(() => { if (out) f.spawnBobber(id); }, 40); }
      else { out = false; for (const k of Object.keys(f.bot.entities)) { delete f.bot.entities[Number(k)]; f.client.emit("entity_destroy", { entityIds: [Number(k)] }); } }
    }) as never;
    return { f, isOut: () => out };
  }
  it("cancel at 10 ms (before bind): the line stays out; the NEXT fishing action's first use_item RETRIEVES instead of casting, so that action finds no bobber (one wasted action, self-healing)", async () => {
    const { f, isOut } = server(); const a1 = new AbortController();
    const c1 = runMineflayerFishCycle(f.bot, { timeoutMs: 3_000, signal: a1.signal }); await sleep(10); a1.abort(); await c1;
    await sleep(80);
    expect(isOut()).toBe(true);                                         // the first cast was never retrieved
    const c2 = await runMineflayerFishCycle(f.bot, { timeoutMs: 1_500 });
    expect(c2.result).toBe("no-bobber");                                // its "cast" was really a reel-in
    expect(isOut()).toBe(false);
    const c3 = runMineflayerFishCycle(f.bot, { timeoutMs: 800 }); await sleep(300);
    expect(isOut()).toBe(true);                                         // the third attempt is the first that really casts
    await c3;
  }, 20_000);
});
