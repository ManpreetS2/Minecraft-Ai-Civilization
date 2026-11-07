import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { depositItem, withdrawItem } from "../../../packages/skills/src/inventory-service.js";
import { smeltItem } from "../../../packages/skills/src/furnace.js";
import { placeBlock } from "../../../packages/skills/src/world.js";
import { huntAnimal } from "../../../packages/skills/src/combat.js";
import { executeStructure } from "../../../packages/skills/src/structure.js";
import { advanceBlueprintBuild, createBuildSession } from "../../../packages/skills/src/blueprint-build.js";
import {
  FakeFurnace,
  installInstantNavigation,
  offlineBody,
  skillContext,
  sleep,
} from "./support/offline-body.js";

/**
 * Regressions against REAL production functions (packages/skills) driven through a controlled offline body.
 * The desired behaviour is an ordinary assertion. A cancelled skill must not mutate after the abort,
 * and a skill that already changed the world reports that change instead of claiming it was cancelled.
 */
let restoreNavigation: () => void;
beforeEach(() => {
  restoreNavigation = installInstantNavigation();
});
afterEach(() => restoreNavigation());

const measured: string[] = [];
const note = (line: string) => void measured.push(line);
afterEach(() => {
  // Printed per test file run so the PR can quote real numbers.
  if (measured.length) console.info(measured.splice(0).join("\n"));
});

describe("AUD-F1 smeltItem keeps working after cancellation", () => {
  async function run() {
    const body = offlineBody();
    const bot = body.fake;
    bot.furnace = new FakeFurnace(700, bot);
    bot.blocks.set("5,64,5", { name: "furnace" });
    bot.give("raw_iron", 1);
    bot.give("coal", 1);
    const abort = new AbortController();
    const ctx = skillContext(body, { signal: abort.signal, timeoutMs: 2_000 });
    const pending = smeltItem(ctx, "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 });
    await sleep(120);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    return { bot, abortedAt, result, returnedAfterMs: Date.now() - abortedAt };
  }

  it("characterisation: measured behaviour after abort", async () => {
    const r = await run();
    const late = r.bot.mutationsAfter(r.abortedAt).map((m) => `${m.kind}@+${m.at - r.abortedAt}ms`);
    note(
      `AUD-F1 smelt: abort at t0; skill returned after ${r.returnedAfterMs} ms with success=${r.result.success}; mutations after abort: ${late.join(", ") || "none"}`,
    );
    expect(r.result.success).toBe(false);
    if (!r.result.success) expect(r.result.code).toBe("CANCELLED");
    expect(late.some((m) => m.startsWith("furnace.takeOutput"))).toBe(false);
    expect(r.returnedAfterMs).toBeLessThan(250);
  });

  it("no furnace operation happens after the signal aborts", async () => {
    const r = await run();
    expect(r.bot.mutationsAfter(r.abortedAt)).toEqual([]);
  });

  it("the skill returns promptly once aborted", async () => {
    const r = await run();
    expect(r.returnedAfterMs).toBeLessThan(250);
  });
});

describe("AUD-C1 chest transfer ignores cancellation after navigation", () => {
  async function run() {
    const body = offlineBody();
    const bot = body.fake;
    bot.windowDelayMs = 200; // server round trip for the chest window
    bot.blocks.set("4,64,4", { name: "chest" });
    bot.give("cobblestone", 4);
    const abort = new AbortController();
    const ctx = skillContext(body, { signal: abort.signal });
    const pending = depositItem(ctx, "cobblestone", 2, { x: 4, y: 64, z: 4 });
    await sleep(60); // navigation (stubbed) already succeeded; the window is still opening
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    return { bot, abortedAt, result };
  }

  it("characterisation: the deposit still lands after the abort", async () => {
    const r = await run();
    const late = r.bot
      .mutationsAfter(r.abortedAt)
      .map((m) => `${m.kind}(${m.detail ?? ""})@+${m.at - r.abortedAt}ms`);
    note(
      `AUD-C1 deposit: abort during openContainer; result success=${r.result.success}; mutations after abort: ${late.join(", ") || "none"}`,
    );
    expect(late.some((m) => m.startsWith("chest.deposit"))).toBe(false);
    expect(r.result.success).toBe(false);
    if (!r.result.success) expect(r.result.code).toBe("CANCELLED");
  });

  it("no chest mutation happens after the signal aborts", async () => {
    const r = await run();
    expect(r.bot.mutationsAfter(r.abortedAt)).toEqual([]);
  });
});

describe("AUD-C2 openContainer has no timeout, so a window that never opens hangs the skill forever", () => {
  it("characterisation: still pending after abort and a generous wait", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.windowOpens = "never"; // chest in use / destroyed / disconnect before windowOpen
    bot.blocks.set("4,64,4", { name: "chest" });
    bot.give("cobblestone", 4);
    const abort = new AbortController();
    const pending = depositItem(
      skillContext(body, { signal: abort.signal, timeoutMs: 300 }),
      "cobblestone",
      2,
      { x: 4, y: 64, z: 4 },
    );
    let settled = false;
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await sleep(60);
    abort.abort();
    await sleep(900); // three times the skill's own timeoutMs
    note(
      `AUD-C2 deposit: window never opens; settled after abort + 900 ms (ctx.timeoutMs=300): ${settled}`,
    );
    expect(settled).toBe(true);
  });

  it("the skill settles within its own timeoutMs when the window never opens", async () => {
      const body = offlineBody();
      body.fake.windowOpens = "never";
      body.fake.blocks.set("4,64,4", { name: "chest" });
      body.fake.give("cobblestone", 4);
      const pending = depositItem(skillContext(body, { timeoutMs: 300 }), "cobblestone", 2, {
        x: 4,
        y: 64,
        z: 4,
      });
      let settled = false;
      void pending.then(
        () => (settled = true),
        () => (settled = true),
      );
      await sleep(900);
      const result = await pending;
      expect(settled).toBe(true);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("TIMEOUT");
        expect(result.retryable).toBe(true);
      }
    },
  );
});

describe("AUD-P1 placeBlock only checks the signal during navigation", () => {
  async function run() {
    const body = offlineBody();
    const bot = body.fake;
    bot.timing.equipMs = 150;
    bot.blocks.set("2,63,0", { name: "stone" });
    bot.give("cobblestone", 4);
    const abort = new AbortController();
    const pending = placeBlock(skillContext(body, { signal: abort.signal }), "cobblestone", {
      x: 2,
      y: 64,
      z: 0,
    });
    await sleep(60); // navigation (stubbed) has succeeded; equip is in flight
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    return { bot, abortedAt, result };
  }

  it("characterisation: the block is placed after the abort", async () => {
    const r = await run();
    const late = r.bot.mutationsAfter(r.abortedAt).map((m) => `${m.kind}@+${m.at - r.abortedAt}ms`);
    note(
      `AUD-P1 placeBlock: abort during equip (150 ms); result success=${r.result.success}; mutations after abort: ${late.join(", ")}`,
    );
    expect(late.some((m) => m.startsWith("placeBlock"))).toBe(false);
    expect(r.result.success).toBe(false);
    if (!r.result.success) expect(r.result.code).toBe("CANCELLED");
  });

  it("no block is placed after the signal aborts", async () => {
    const r = await run();
    expect(r.bot.mutationsAfter(r.abortedAt).filter((m) => m.kind === "placeBlock")).toEqual([]);
  });
});

describe("AUD-P2 a cancelled placement is reported as BUILD_BLOCKED by executeStructure", () => {
  it("characterisation: aborted before the first block", async () => {
    const body = offlineBody();
    body.fake.give("cobblestone", 4);
    const abort = new AbortController();
    abort.abort();
    const result = await executeStructure(
      skillContext(body, { signal: abort.signal }),
      {
        id: "audit",
        blocks: [{ dx: 0, dy: 0, dz: 0, block: "cobblestone", purpose: "shelter_blueprint" }],
      },
      { x: 2, y: 64, z: 0 },
    );
    note(
      `AUD-P2 executeStructure(aborted): success=${result.success} code=${result.success ? "-" : result.code}`,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
  });

  it("a cancellation is reported as CANCELLED, not as a build failure", async () => {
      const body = offlineBody();
      body.fake.give("cobblestone", 4);
      const abort = new AbortController();
      abort.abort();
      const result = await executeStructure(
        skillContext(body, { signal: abort.signal }),
        {
          id: "audit",
          blocks: [{ dx: 0, dy: 0, dz: 0, block: "cobblestone", purpose: "shelter_blueprint" }],
        },
        { x: 2, y: 64, z: 0 },
      );
      expect(result.success === false && result.code).toBe("CANCELLED");
    },
  );
});

describe("AUD-H1 huntAnimal never checks the signal", () => {
  async function run() {
    const body = offlineBody();
    const bot = body.fake;
    const cow = {
      id: 42,
      name: "cow",
      type: "animal",
      position: bot.entity.position.offset(1.5, 0, 0),
      health: 10,
    };
    bot.entities[cow.id] = cow;
    const abort = new AbortController();
    const pending = huntAnimal(
      skillContext(body, { signal: abort.signal, timeoutMs: 1_500 }),
      "cow",
    );
    await sleep(500);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    return { bot, abortedAt, result, returnedAfterMs: Date.now() - abortedAt };
  }

  it("characterisation: attacks continue until the skill's own deadline", async () => {
    const r = await run();
    const attacks = r.bot.mutationsAfter(r.abortedAt).filter((m) => m.kind === "attack").length;
    note(
      `AUD-H1 huntAnimal: abort at +500 ms; skill returned after ${r.returnedAfterMs} ms; attacks after abort: ${attacks}`,
    );
    expect(attacks).toBe(0);
    expect(r.result.success).toBe(false);
    if (!r.result.success) expect(r.result.code).toBe("CANCELLED");
  });

  it("no attack is issued after the signal aborts", async () => {
    const r = await run();
    expect(r.bot.mutationsAfter(r.abortedAt).filter((m) => m.kind === "attack")).toEqual([]);
  });
});

describe("successful actions and late resolutions", () => {
  it("smelts when the furnace is not cancelled", async () => {
    const body = offlineBody();
    body.fake.furnace = new FakeFurnace(0, body.fake);
    body.fake.blocks.set("5,64,5", { name: "furnace" });
    body.fake.give("raw_iron", 1);
    body.fake.give("coal", 1);
    const result = await smeltItem(skillContext(body), "raw_iron", "iron_ingot", 1, { x: 5, y: 64, z: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.produced).toBeGreaterThanOrEqual(1);
    expect(body.fake.count("iron_ingot")).toBeGreaterThanOrEqual(1);
  });

  it("reports the ingot when cancellation arrives after takeOutput has already moved it", async () => {
    const body = offlineBody();
    const furnace = new FakeFurnace(0, body.fake);
    body.fake.furnace = furnace;
    body.fake.blocks.set("5,64,5", { name: "furnace" });
    body.fake.give("raw_iron", 1);
    body.fake.give("coal", 1);
    const abort = new AbortController();
    const take = furnace.takeOutput.bind(furnace);
    furnace.takeOutput = async () => {
      abort.abort();
      await take();
    };
    const result = await smeltItem(skillContext(body, { signal: abort.signal }), "raw_iron", "iron_ingot", 1, {
      x: 5,
      y: 64,
      z: 5,
    });
    expect(result.success).toBe(true);
    expect(body.fake.count("iron_ingot")).toBeGreaterThanOrEqual(1);
  });

  it("deposits when the chest is not cancelled", async () => {
    const body = offlineBody();
    body.fake.blocks.set("4,64,4", { name: "chest" });
    body.fake.give("cobblestone", 4);
    const result = await depositItem(skillContext(body), "cobblestone", 2, { x: 4, y: 64, z: 4 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deposited).toBe(2);
    expect(body.fake.chest.get("cobblestone")).toBe(2);
  });

  it("withdraws when the chest is not cancelled", async () => {
    const body = offlineBody();
    body.fake.blocks.set("4,64,4", { name: "chest" });
    body.fake.chest.set("cobblestone", 3);
    const result = await withdrawItem(skillContext(body), "cobblestone", 2, { x: 4, y: 64, z: 4 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.count).toBe(2);
    expect(body.fake.count("cobblestone")).toBe(2);
  });

  it("closes a window that opens after cancellation and does not deposit", async () => {
    const body = offlineBody();
    body.fake.windowDelayMs = 200;
    body.fake.blocks.set("4,64,4", { name: "chest" });
    body.fake.give("cobblestone", 4);
    const abort = new AbortController();
    const pending = depositItem(skillContext(body, { signal: abort.signal }), "cobblestone", 2, { x: 4, y: 64, z: 4 });
    await sleep(30);
    abort.abort();
    const result = await pending;
    await sleep(250);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
    expect(body.fake.mutations.filter((mutation) => mutation.kind === "chest.deposit")).toEqual([]);
    expect(body.fake.chest.get("cobblestone")).toBeUndefined();
  });

  it("places a block when the skill is not cancelled", async () => {
    const body = offlineBody();
    body.fake.blocks.set("2,63,0", { name: "stone" });
    body.fake.give("cobblestone", 4);
    const result = await placeBlock(skillContext(body), "cobblestone", { x: 2, y: 64, z: 0 });
    expect(result.success).toBe(true);
    expect(body.fake.blocks.get("2,64,0")?.name).toBe("cobblestone");
  });

  it("reports a placement that already landed even if the signal aborts inside placeBlock", async () => {
    const body = offlineBody();
    body.fake.blocks.set("2,63,0", { name: "stone" });
    body.fake.give("cobblestone", 4);
    const abort = new AbortController();
    const place = body.fake.placeBlock.bind(body.fake);
    body.fake.placeBlock = async (ref, face) => {
      abort.abort();
      await place(ref, face);
    };
    const result = await placeBlock(skillContext(body, { signal: abort.signal }), "cobblestone", { x: 2, y: 64, z: 0 });
    expect(result.success).toBe(true);
    expect(body.fake.blocks.get("2,64,0")?.name).toBe("cobblestone");
  });

  it("hunts successfully when the animal is removed by the attack", async () => {
    const body = offlineBody();
    const cow = {
      id: 7,
      name: "cow",
      type: "animal",
      position: body.fake.entity.position.offset(1.5, 0, 0),
      health: 10,
    };
    body.fake.entities[cow.id] = cow;
    const attack = body.fake.attack.bind(body.fake);
    body.fake.attack = (entity) => {
      attack(entity);
      delete body.fake.entities[entity.id];
    };
    const result = await huntAnimal(skillContext(body, { timeoutMs: 2_000 }), "cow");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.killed).toBe(true);
    expect(body.fake.mutations.filter((mutation) => mutation.kind === "attack").length).toBe(1);
  });

  it("leaves a blueprint session in progress when placement is cancelled", async () => {
    const body = offlineBody();
    body.fake.timing.equipMs = 150;
    body.fake.give("oak_planks", 64);
    body.fake.give("oak_door", 1);
    body.fake.give("chest", 1);
    body.fake.give("torch", 2);
    const session = createBuildSession({ origin: { x: 2, y: 64, z: 0 }, structureType: "BASIC_SHELTER" });
    session.stage = "FLOOR";
    const abort = new AbortController();
    const pending = advanceBlueprintBuild(skillContext(body, { signal: abort.signal }), session, {
      maxPlacements: 1,
      liveValidate: false,
      forceNew: true,
    });
    await sleep(40);
    abort.abort();
    const result = await pending;
    expect(result.success).toBe(false);
    if (!result.success) expect(["CANCELLED", "INTERRUPTED"]).toContain(result.code);
    expect(session.status).toBe("IN_PROGRESS");
    expect(body.fake.mutations.filter((mutation) => mutation.kind === "placeBlock")).toEqual([]);
  });
});
