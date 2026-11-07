import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ok } from "../../../packages/shared/src/index.js";
import { attemptHazardBridge } from "../../../packages/minecraft-adapter/src/hazard-nav.js";
import { craftItem } from "../../../packages/skills/src/inventory.js";
import { obtainItem } from "../../../packages/skills/src/obtain.js";
import { openDoor } from "../../../packages/skills/src/doors.js";
import { closeDoor } from "../../../packages/skills/src/library.js";
import { sleep } from "../../../packages/skills/src/world.js";
import { createActionBoundary, type ClientLike } from "../../../packages/agent-core/src/action-boundary.js";
import { installInstantNavigation, offlineBody, skillContext, type OfflineBody } from "./support/offline-body.js";

/**
 * Reproductions of the audit's unconfirmed patterns against the real production functions.
 * Desired behaviour is an ordinary assertion, so these fail while the defect is present.
 */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let restoreNavigation: () => void;
beforeEach(() => {
  restoreNavigation = installInstantNavigation();
});
afterEach(() => restoreNavigation());

function nightBed(body: OfflineBody): void {
  const bot = body.fake as unknown as {
    time: { timeOfDay: number };
    isRaining: boolean;
    thunderState: number;
    sleep: (bed: unknown) => Promise<void>;
    wake: () => Promise<void>;
  };
  bot.time = { timeOfDay: 18_000 };
  bot.isRaining = false;
  bot.thunderState = 0;
  body.fake.blocks.set("2,64,2", { name: "white_bed" });
}

describe("AUD-X1 craft retry can run a second recipe while the first is still crafting", () => {
  function craftBot() {
    const body = offlineBody();
    const bot = body.fake;
    bot.give("oak_planks", 8);
    const registry = bot.registry as unknown as {
      itemsByName: Record<string, { id: number; name: string }>;
      items: Record<number, { id: number; name: string }>;
    };
    registry.itemsByName.stick = { id: 8, name: "stick" };
    registry.items[8] = { id: 8, name: "stick" };
    const calls: number[] = [];
    let activateAt = 0;
    const recipes = () => [
      { requiresTable: false, result: { id: 8, count: 4 }, ingredients: [{ id: 6, count: 2 }] },
      { requiresTable: false, result: { id: 8, count: 4 }, ingredients: [{ id: 6, count: 2 }] },
    ];
    const fake = bot as unknown as {
      recipesAll: () => unknown[];
      recipesFor: () => unknown[];
      craft: () => Promise<void>;
      activateBlock: () => Promise<void>;
      unequip: () => Promise<void>;
      closeWindow: () => Promise<void>;
    };
    fake.recipesAll = () => recipes();
    fake.recipesFor = () => recipes();
    fake.activateBlock = async () => {
      activateAt = Date.now();
      const planks = bot.slots.find((item) => item?.name === "oak_planks");
      if (planks) planks.count -= 2;
      bot.give("stick", 4);
    };
    fake.craft = async function (this: { activateBlock: (block: { position: { x: number; y: number; z: number } }) => Promise<void> }) {
      calls.push(Date.now());
      await pause(6_400);
      await this.activateBlock({ position: { x: 1, y: 64, z: 0 } });
    };
    fake.unequip = async () => undefined;
    fake.closeWindow = async () => undefined;
    return { body, bot, calls, activateAt: () => activateAt };
  }

  it("does not start a second craft when the first recipe times out", async () => {
    const rig = craftBot();
    const result = await craftItem(skillContext(rig.body, { timeoutMs: 8_000 }), "stick", 4);
    expect(rig.calls).toHaveLength(1);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("TIMEOUT");
    await pause(800);
    expect(rig.bot.count("oak_planks")).toBe(8);
    expect(rig.bot.count("stick")).toBe(0);
  }, 20_000);

  it("returns promptly on cancellation and does not let the in-flight craft mutate afterwards", async () => {
    const rig = craftBot();
    const abort = new AbortController();
    const pending = craftItem(skillContext(rig.body, { signal: abort.signal }), "stick", 4);
    await pause(40);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    expect(Date.now() - abortedAt).toBeLessThan(250);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
    await pause(7_000);
    expect(rig.activateAt() === 0 || rig.activateAt() <= abortedAt).toBe(true);
    expect(rig.bot.count("oak_planks")).toBe(8);
  }, 20_000);

  it("reports sticks that were already crafted when cancellation arrives", async () => {
    const rig = craftBot();
    (rig.bot as unknown as { craft: () => Promise<void> }).craft = async () => {
      rig.calls.push(Date.now());
      const planks = rig.bot.slots.find((item) => item?.name === "oak_planks");
      if (planks) planks.count -= 2;
      rig.bot.give("stick", 4);
      await pause(200);
    };
    const abort = new AbortController();
    const pending = craftItem(skillContext(rig.body, { signal: abort.signal }), "stick", 4);
    await pause(30);
    abort.abort();
    const result = await pending;
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.count).toBeGreaterThanOrEqual(4);
    expect(rig.calls).toHaveLength(1);
  });

  it("crafts once when the recipe finishes and nobody cancels", async () => {
    const rig = craftBot();
    (rig.bot as unknown as { craft: (this: { activateBlock: (block: object) => Promise<void> }) => Promise<void> }).craft =
      async function (this: { activateBlock: (block: object) => Promise<void> }) {
        rig.calls.push(Date.now());
        await this.activateBlock({ position: { x: 1, y: 64, z: 0 } });
      };
    const result = await craftItem(skillContext(rig.body), "stick", 4);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.count).toBe(4);
    expect(rig.bot.count("oak_planks")).toBe(6);
  });
});

describe("AUD-X2 crafting-table placement continues after cancellation", () => {
  it("does not place a table after the signal aborts during look", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.timing.lookMs = 200;
    bot.give("crafting_table", 1);
    bot.give("oak_planks", 8);
    bot.give("stick", 4);
    for (let x = -2; x <= 3; x += 1) {
      for (let z = -2; z <= 3; z += 1) bot.blocks.set(`${x},63,${z}`, { name: "stone" });
    }
    const fake = bot as unknown as {
      findBlock: () => null;
      findBlocks: () => never[];
      registry: { blocksByName: Record<string, { id: number }> };
    };
    fake.findBlock = () => null;
    fake.findBlocks = () => [];
    fake.registry.blocksByName = { crafting_table: { id: 58 } };
    const abort = new AbortController();
    const pending = obtainItem(skillContext(body, { signal: abort.signal }), "wooden_pickaxe", 1);
    await pause(40);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    expect(result.success).toBe(false);
    if (!result.success) expect(["CANCELLED", "INTERRUPTED"]).toContain(result.code);
    expect(bot.mutationsAfter(abortedAt).filter((mutation) => mutation.kind === "placeBlock")).toEqual([]);
  });

  it("places the table when the citizen is not interrupted", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.give("crafting_table", 1);
    bot.give("oak_planks", 8);
    bot.give("stick", 4);
    for (let x = -2; x <= 3; x += 1) {
      for (let z = -2; z <= 3; z += 1) bot.blocks.set(`${x},63,${z}`, { name: "stone" });
    }
    const fake = bot as unknown as {
      findBlock: () => null;
      findBlocks: () => never[];
      registry: { blocksByName: Record<string, { id: number }> };
    };
    fake.findBlock = () => null;
    fake.findBlocks = () => [];
    fake.registry.blocksByName = { crafting_table: { id: 58 } };
    const result = await obtainItem(skillContext(body), "wooden_pickaxe", 1);
    expect(bot.mutations.some((mutation) => mutation.kind === "placeBlock")).toBe(true);
    expect(result.success === true || (result.success === false && result.code !== "CANCELLED")).toBe(true);
  });
});

describe("AUD-X3 a door toggle can happen after cancellation", () => {
  it("does not activate the door after the signal aborts", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.timing.lookMs = 200;
    bot.blocks.set("3,64,3", { name: "oak_door" });
    let activated = 0;
    (bot as unknown as { activateBlock: () => Promise<void> }).activateBlock = async () => {
      activated += 1;
      bot.mutations.push({ kind: "activateBlock", at: Date.now() });
    };
    const abort = new AbortController();
    const pending = openDoor(skillContext(body, { signal: abort.signal }), { x: 3, y: 64, z: 3 });
    await pause(40);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    expect(Date.now() - abortedAt).toBeLessThan(250);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
    expect(bot.mutationsAfter(abortedAt).filter((mutation) => mutation.kind === "activateBlock")).toEqual([]);
    expect(activated).toBe(0);
  });

  it("opens the door when nobody cancels", async () => {
    const body = offlineBody();
    body.fake.blocks.set("3,64,3", { name: "oak_door" });
    let open = false;
    (body.fake as unknown as { activateBlock: () => Promise<void> }).activateBlock = async () => {
      open = true;
    };
    const result = await openDoor(skillContext(body), { x: 3, y: 64, z: 3 });
    expect(result.success).toBe(true);
    expect(open).toBe(true);
  });

  it("does not toggle the door shut after cancellation", async () => {
    const body = offlineBody();
    const bot = body.fake;
    bot.blocks.set("3,64,3", { name: "oak_door" });
    let open = false;
    let toggles = 0;
    const block = () => ({
      name: "oak_door",
      position: { x: 3, y: 64, z: 3 },
      getProperties: () => ({ open }),
    });
    bot.blockAt = ((pos: { x: number; y: number; z: number }) => {
      if (Math.floor(pos.x) === 3 && Math.floor(pos.y) === 64 && Math.floor(pos.z) === 3) return block();
      return { name: "air", position: pos, boundingBox: "empty" };
    }) as typeof bot.blockAt;
    const abort = new AbortController();
    (bot as unknown as { activateBlock: () => Promise<void> }).activateBlock = async () => {
      toggles += 1;
      open = !open;
      if (toggles === 1) abort.abort();
    };
    const result = await closeDoor(skillContext(body, { signal: abort.signal }), { x: 3, y: 64, z: 3 });
    expect(toggles).toBe(1);
    expect(open).toBe(true);
    expect(result.success).toBe(false);
    if (!result.success) expect(["CANCELLED", "INTERRUPTED"]).toContain(result.code);
  });
});

describe("AUD-X4 hazard-bridge placement continues after cancellation", () => {
  function bridgeBot(equipMs: number) {
    const cells: Record<string, { name: string; boundingBox: string }> = {};
    for (let x = 0; x <= 12; x += 1) {
      for (let z = 0; z <= 12; z += 1) {
        cells[`${x},63,${z}`] = { name: "grass_block", boundingBox: "block" };
        cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty" };
        cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty" };
      }
    }
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" };
    cells["6,65,5"] = { name: "air", boundingBox: "empty" };
    cells["5,65,5"] = { name: "stone", boundingBox: "block" };
    const placed: number[] = [];
    const bot = {
      username: "Bridge",
      entity: { position: { x: 4.5, y: 64, z: 5.5 }, onGround: true },
      inventory: { items: () => [{ name: "cobblestone", count: 8 }] },
      blockAt(pos: { x: number; y: number; z: number }) {
        const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
        const cell = cells[key] ?? { name: "air", boundingBox: "empty" };
        return {
          ...cell,
          position: {
            x: Math.floor(pos.x),
            y: Math.floor(pos.y),
            z: Math.floor(pos.z),
            offset(dx: number, dy: number, dz: number) {
              return { x: this.x + dx, y: this.y + dy, z: this.z + dz };
            },
          },
        };
      },
      async equip() {
        await pause(equipMs);
      },
      async lookAt() {
        await pause(50);
      },
      async placeBlock() {
        placed.push(Date.now());
        cells["6,65,5"] = { name: "cobblestone", boundingBox: "block" };
      },
      setControlState() {},
      clearControlStates() {},
      supportFeature: () => false,
    };
    return { bot, placed, cells };
  }

  it("does not place the bridge after the signal aborts during equip", async () => {
    const rig = bridgeBot(180);
    const abort = new AbortController();
    const pending = attemptHazardBridge(rig.bot as never, { x: 6, y: 64, z: 5 }, {
      allowConstruction: true,
      signal: abort.signal,
    });
    await pause(40);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    expect(Date.now() - abortedAt).toBeLessThan(250);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
    expect(rig.placed.filter((at) => at > abortedAt)).toEqual([]);
    expect(rig.cells["6,65,5"]?.name).toBe("air");
  });

  it("places the bridge when the citizen is not interrupted", async () => {
    const rig = bridgeBot(0);
    const result = await attemptHazardBridge(rig.bot as never, { x: 6, y: 64, z: 5 }, { allowConstruction: true });
    expect(result.success).toBe(true);
    expect(rig.cells["6,65,5"]?.name).toBe("cobblestone");
  });

  it("reports a bridge that was already placed when cancellation arrives inside placeBlock", async () => {
    const rig = bridgeBot(0);
    const abort = new AbortController();
    const place = rig.bot.placeBlock.bind(rig.bot);
    rig.bot.placeBlock = async () => {
      abort.abort();
      await place();
    };
    const result = await attemptHazardBridge(rig.bot as never, { x: 6, y: 64, z: 5 }, {
      allowConstruction: true,
      signal: abort.signal,
    });
    expect(result.success).toBe(true);
    expect(rig.cells["6,65,5"]?.name).toBe("cobblestone");
  });
});

describe("sleep is bounded and honours cancellation", () => {
  it("does not enter the bed after cancellation, and returns promptly", async () => {
    const body = offlineBody();
    nightBed(body);
    (body.fake as unknown as { sleep: () => Promise<void> }).sleep = async () => {
      await pause(400);
      body.fake.isSleeping = true;
    };
    (body.fake as unknown as { wake: () => Promise<void> }).wake = async () => {
      body.fake.isSleeping = false;
    };
    body.fake.timing.lookMs = 0;
    const abort = new AbortController();
    const pending = sleep(skillContext(body, { signal: abort.signal }), { x: 2, y: 64, z: 2 });
    await pause(20);
    const abortedAt = Date.now();
    abort.abort();
    const result = await pending;
    expect(Date.now() - abortedAt).toBeLessThan(250);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CANCELLED");
    await pause(500);
    // The sleep request may already have been sent. Cancellation must not leave the bot in the bed.
    expect(body.fake.isSleeping).toBe(false);
  });

  it("settles when the server never confirms sleep", async () => {
    const body = offlineBody();
    nightBed(body);
    (body.fake as unknown as { sleep: () => Promise<void> }).sleep = () => new Promise(() => undefined);
    (body.fake as unknown as { wake: () => Promise<void>; quit: () => void }).wake = async () => undefined;
    let quit = 0;
    (body.fake as unknown as { quit: () => void }).quit = () => {
      quit += 1;
    };
    const pending = sleep(skillContext(body, { timeoutMs: 300 }), { x: 2, y: 64, z: 2 });
    const winner = await Promise.race([
      pending.then((result) => ({ settled: true as const, result })),
      pause(800).then(() => ({ settled: false as const, result: undefined })),
    ]);
    expect(winner.settled).toBe(true);
    if (winner.settled) {
      expect(winner.result.success).toBe(false);
      if (!winner.result.success) expect(winner.result.code).toBe("TIMEOUT");
      expect(quit).toBe(0);
    }
  });

  it("sleeps and wakes when nobody cancels", async () => {
    const body = offlineBody();
    nightBed(body);
    (body.fake as unknown as { sleep: () => Promise<void> }).sleep = async () => {
      body.fake.isSleeping = true;
    };
    (body.fake as unknown as { wake: () => Promise<void> }).wake = async () => {
      body.fake.isSleeping = false;
    };
    const result = await sleep(skillContext(body), { x: 2, y: 64, z: 2 });
    expect(result.success).toBe(true);
    expect(body.fake.isSleeping).toBe(false);
  });

  it("reports a sleep that already began when the deadline hits", async () => {
    const body = offlineBody();
    nightBed(body);
    (body.fake as unknown as { sleep: () => Promise<void> }).sleep = async () => {
      body.fake.isSleeping = true;
      await pause(400);
    };
    (body.fake as unknown as { wake: () => Promise<void> }).wake = async () => {
      body.fake.isSleeping = false;
    };
    const result = await sleep(skillContext(body, { timeoutMs: 150 }), { x: 2, y: 64, z: 2 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("INTERRUPTED");
    expect(body.fake.isSleeping).toBe(false);
  });
});

describe("listeners armed by an action cannot write after that action is over", () => {
  it("refuses a packet emitted from outside the action after cancellation", async () => {
    const writes: string[] = [];
    const client: ClientLike = {
      write(name: string) {
        writes.push(name);
      },
    };
    const bot = new EventEmitter();
    const boundary = createActionBoundary(
      () => client,
      () => [bot, client],
    );
    const abort = new AbortController();
    const pending = boundary.run(
      "window",
      async () => {
        bot.on("windowOpen", () => client.write("window_click", { kind: "late" }));
        await pause(500);
        return ok({}, 1);
      },
      { signal: abort.signal, timeoutMs: 1_000, graceMs: 30 },
    );
    await pause(20);
    abort.abort();
    await pending;
    expect(() => bot.emit("windowOpen")).toThrow(/late window_click refused/);
    expect(writes).toEqual([]);
  });

  it("still allows a listener that was registered outside any action", async () => {
    const writes: string[] = [];
    const client: ClientLike = {
      write(name: string) {
        writes.push(name);
      },
    };
    const bot = new EventEmitter();
    bot.on("physicsTick", () => client.write("held_item_slot", { kind: "physics" }));
    const boundary = createActionBoundary(
      () => client,
      () => [bot],
    );
    await boundary.run("idle", async () => ok({}, 1), { timeoutMs: 200 });
    bot.emit("physicsTick");
    expect(writes).toEqual(["held_item_slot"]);
  });

  it("allows a listener while its action is still active", async () => {
    const writes: string[] = [];
    const client: ClientLike = {
      write(name: string) {
        writes.push(name);
      },
    };
    const bot = new EventEmitter();
    const boundary = createActionBoundary(
      () => client,
      () => [bot],
    );
    await boundary.run(
      "fish",
      async () => {
        bot.on("particle", () => client.write("use_item", {}));
        bot.emit("particle");
        return ok({}, 1);
      },
      { timeoutMs: 200 },
    );
    expect(writes).toEqual(["use_item"]);
  });
});
