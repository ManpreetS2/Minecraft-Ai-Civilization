import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fail, ok } from "../../../packages/shared/src/index.js";
import { terrainMemory } from "../../../packages/minecraft-adapter/src/terrain-memory.js";
import { depositItem } from "../../../packages/skills/src/inventory-service.js";
import { smeltItem } from "../../../packages/skills/src/furnace.js";
import { placeBlock } from "../../../packages/skills/src/world.js";
import { huntAnimal } from "../../../packages/skills/src/combat.js";
import { createNativeBoundary, LATE_WRITE_REFUSED } from "../src/native-boundary.js";
import {
  FakeFurnace,
  installInstantNavigation,
  offlineBody,
  skillContext,
  sleep,
  type OfflineBody,
} from "./support/offline-body.js";

/**
 * Does ~100 lines we own (src/native-boundary.ts) fix the confirmed defects WITHOUT the YC proxy?
 * Same real production skills and the same offline body as defects.test.ts, now run through the prototype boundary.
 * The boundary hands the skill the REAL bot, so these tests also check what a proxy would have broken.
 */
let restoreNavigation: () => void;
beforeEach(() => {
  restoreNavigation = installInstantNavigation();
});
afterEach(() => restoreNavigation());

const boundaryFor = (body: OfflineBody) => createNativeBoundary(body.fake._client);

describe("native boundary vs the confirmed defects (real skills)", () => {
  it("AUD-F1: no furnace operation after abort, and the call returns promptly", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.furnace = new FakeFurnace(700, bot);
    bot.blocks.set("5,64,5", { name: "furnace" });
    bot.give("raw_iron", 1);
    bot.give("coal", 1);
    const boundary = boundaryFor(body);
    const abort = new AbortController();
    const pending = boundary.run(
      "smelt",
      () =>
        smeltItem(
          skillContext(body, { signal: abort.signal, timeoutMs: 2_000 }),
          "raw_iron",
          "iron_ingot",
          1,
          { x: 5, y: 64, z: 5 },
        ),
      { signal: abort.signal, timeoutMs: 5_000, graceMs: 100 },
    );
    await sleep(120);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    await sleep(900); // let the (now abandoned) polling loop reach the point where it used to take the output
    expect(Date.now() - abortedAt).toBeLessThan(1_300);
    expect(result.success).toBe(false);
    expect(bot.mutationsAfter(abortedAt)).toEqual([]);
    expect(bot.count("iron_ingot")).toBe(0);
  });

  it("AUD-C1: no chest mutation after abort", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.windowDelayMs = 200;
    bot.blocks.set("4,64,4", { name: "chest" });
    bot.give("cobblestone", 4);
    const boundary = boundaryFor(body);
    const abort = new AbortController();
    const pending = boundary.run(
      "deposit",
      () =>
        depositItem(skillContext(body, { signal: abort.signal }), "cobblestone", 2, {
          x: 4,
          y: 64,
          z: 4,
        }),
      { signal: abort.signal, timeoutMs: 5_000, graceMs: 100 },
    );
    await sleep(60);
    const abortedAt = Date.now();
    abort.abort();
    await pending;
    await sleep(300);
    expect(bot.mutationsAfter(abortedAt)).toEqual([]);
    expect(bot.chest.get("cobblestone") ?? 0).toBe(0);
    expect(bot.count("cobblestone")).toBe(4);
  });

  it("AUD-C2: a window that opens after the deadline is not used, and the next action can run", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.windowDelayMs = 700; // opens only after the deadline; stands in for 'never' without leaking a real forever-promise
    bot.blocks.set("4,64,4", { name: "chest" });
    bot.give("cobblestone", 4);
    const boundary = boundaryFor(body);
    const started = Date.now();
    const first = await boundary.run(
      "deposit",
      () =>
        depositItem(skillContext(body, { timeoutMs: 300 }), "cobblestone", 2, {
          x: 4,
          y: 64,
          z: 4,
        }),
      { timeoutMs: 1_000, graceMs: 50 },
    );
    expect(first).toMatchObject({ success: false, code: "TIMEOUT", retryable: true });
    expect(Date.now() - started).toBeLessThan(600);
    expect(boundary.orphans()).toBe(0);
    const next = await boundary.run("noop", async () => ok(1, 0), { timeoutMs: 300 });
    expect(next.success).toBe(true);
    await sleep(700); // the abandoned deposit now resumes
    expect(bot.chest.get("cobblestone") ?? 0).toBe(0);
    expect(bot.count("cobblestone")).toBe(4);
  });

  it("AUD-P1: no block is placed after abort", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.timing.equipMs = 150;
    bot.blocks.set("2,63,0", { name: "stone" });
    bot.give("cobblestone", 4);
    const boundary = boundaryFor(body);
    const abort = new AbortController();
    const pending = boundary.run(
      "place",
      () =>
        placeBlock(skillContext(body, { signal: abort.signal }), "cobblestone", {
          x: 2,
          y: 64,
          z: 0,
        }),
      { signal: abort.signal, timeoutMs: 5_000, graceMs: 100 },
    );
    await sleep(60);
    const abortedAt = Date.now();
    abort.abort();
    await pending;
    await sleep(250);
    expect(bot.mutationsAfter(abortedAt).filter((m) => m.kind === "placeBlock")).toEqual([]);
    expect(bot.blocks.get("2,64,0")).toBeUndefined();
  });

  it("AUD-H1: no attack after abort", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.entities[42] = {
      id: 42,
      name: "cow",
      type: "animal",
      position: bot.entity.position.offset(1.5, 0, 0),
      health: 10,
    };
    const boundary = boundaryFor(body);
    const abort = new AbortController();
    const pending = boundary.run(
      "hunt",
      () => huntAnimal(skillContext(body, { signal: abort.signal, timeoutMs: 1_500 }), "cow"),
      { signal: abort.signal, timeoutMs: 5_000, graceMs: 100 },
    );
    await sleep(500);
    const abortedAt = Date.now();
    abort.abort();
    await pending;
    await sleep(700);
    expect(bot.mutationsAfter(abortedAt).filter((m) => m.kind === "attack")).toEqual([]);
  });
});

describe("what the native boundary keeps working (the points a proxy broke)", () => {
  it("skills still get the real bot: bot._client listeners and bot-keyed state work", async () => {
    const body = offlineBody();
    const boundary = boundaryFor(body);
    const seen: unknown[] = [];
    for (let i = 0; i < 2; i += 1) {
      await boundary.run(
        "probe",
        async () => {
          body.fake._client.on("spawn_entity", () => undefined); // what mineflayer-fish-cycle does
          seen.push(terrainMemory(body.fake as never));
          return ok(1, 0);
        },
        { timeoutMs: 500 },
      );
    }
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toBe(terrainMemory(body.fake as never));
  });

  it("writes with no owner are allowed, so adoption can be incremental (unlike YC's all-or-nothing guard)", async () => {
    const body = offlineBody();
    boundaryFor(body);
    expect(() => body.fake._client.write("block_place", {})).not.toThrow();
    expect(body.fake._client.writes).toContain("block_place");
  });

  it("cleanup packets (dig cancel) are allowed after abort, and the skill's own INTERRUPTED report is preserved", async () => {
    const body = offlineBody();
    const boundary = boundaryFor(body);
    const abort = new AbortController();
    const pending = boundary.run(
      "gather",
      async (signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        body.fake._client.write("block_dig", { status: 1 }); // cancel-dig, as stopDigging does
        return fail("INTERRUPTED", "gather interrupted", 0, true, { collected: 1 });
      },
      { signal: abort.signal, timeoutMs: 5_000, graceMs: 100 },
    );
    await sleep(20);
    abort.abort();
    expect(await pending).toMatchObject({
      success: false,
      code: "INTERRUPTED",
      details: { collected: 1 },
    });
    expect(body.fake._client.writes).toContain("block_dig");
  });

  it("serialises actions on one body and keeps two bodies independent", async () => {
    const a = offlineBody("Atlas", "citizen_atlas");
    const b = offlineBody("Maya", "citizen_maya");
    const boundaryA = boundaryFor(a);
    const boundaryB = boundaryFor(b);
    let running = 0;
    let peakA = 0;
    let overlapAcrossBodies = false;
    const work = (own: { peak?: number }) => async () => {
      running += 1;
      peakA = Math.max(peakA, running);
      await sleep(40);
      running -= 1;
      void own;
      return ok(1, 0);
    };
    await Promise.all([
      boundaryA.run("a1", work({}), { timeoutMs: 1_000 }),
      boundaryA.run("a2", work({}), { timeoutMs: 1_000 }),
    ]);
    expect(peakA).toBe(1);
    running = 0;
    await Promise.all([
      boundaryA.run(
        "a",
        async () => (
          (overlapAcrossBodies = running > 0 || overlapAcrossBodies),
          (running += 1),
          await sleep(40),
          (running -= 1),
          ok(1, 0)
        ),
        { timeoutMs: 1_000 },
      ),
      boundaryB.run(
        "b",
        async () => (
          (overlapAcrossBodies = running > 0 || overlapAcrossBodies),
          (running += 1),
          await sleep(40),
          (running -= 1),
          ok(1, 0)
        ),
        { timeoutMs: 1_000 },
      ),
    ]);
    expect(overlapAcrossBodies).toBe(true); // different bodies run concurrently
  });
});

describe("what the native boundary does NOT cover (stated limits, tested so they stay stated)", () => {
  it("a write fired from an event emitted outside the action has no owner and is not refused", async () => {
    const body = offlineBody();
    const boundary = boundaryFor(body);
    const abort = new AbortController();
    await boundary.run(
      "register",
      async () => {
        body.fake.once("physicsTick", () => body.fake._client.write("block_place", {}));
        return ok(1, 0);
      },
      { signal: abort.signal, timeoutMs: 500 },
    );
    body.fake.emit("physicsTick"); // emitted by the bot's own timers, outside any action
    expect(body.fake._client.writes).toContain("block_place");
  });

  it("refusal is an AbortError with a stable code, so a skill can tell it from a game failure", async () => {
    const body = offlineBody();
    const boundary = boundaryFor(body);
    const abort = new AbortController();
    let caught: unknown;
    const pending = boundary.run(
      "late",
      async () => {
        await sleep(40);
        try {
          body.fake._client.write("window_click", {});
        } catch (error) {
          caught = error;
        }
        return ok(1, 0);
      },
      { signal: abort.signal, timeoutMs: 500, graceMs: 10 },
    );
    await sleep(10);
    abort.abort();
    await pending;
    await sleep(80);
    expect(caught).toMatchObject({ name: "AbortError", code: LATE_WRITE_REFUSED });
  });
});
