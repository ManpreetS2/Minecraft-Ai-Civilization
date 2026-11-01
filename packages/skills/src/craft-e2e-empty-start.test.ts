/**
 * CRAFT-001: offline end-to-end bootstrap from an EMPTY inventory, using production skills
 * (collectResource -> craftItem -> obtainItem) against a mock Mineflayer bot with realistic recipe shapes
 * (prismarine-recipe objects, inShape {id:-1} blanks, shapeless count:-1, delta, requiresTable) and a
 * crafting-table window stub. Every step asserts REAL inventory deltas, never ground drops.
 * Live Minecraft behaviour stays UNVERIFIED.
 */
import { afterEach, describe, expect, it } from "vitest";
import { LOG_BLOCK_NAMES } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend } from "@civ/minecraft-adapter";
import { collectResource } from "./collect.js";
import { craftItem } from "./inventory.js";
import { obtainItem } from "./obtain.js";
import {
  createMineflayerCraftFixture,
  type MineflayerCraftFixture,
} from "./testing/mineflayer-craft-fixture.js";

const TREES = [
  { x: 6, z: 3, height: 4 },
  { x: -5, z: 8, height: 4 },
  { x: 3, z: -9, height: 4 },
];
const LOGS = [...LOG_BLOCK_NAMES];

function emptyWorld(): MineflayerCraftFixture {
  const fx = createMineflayerCraftFixture({ trees: TREES });
  setNavigationBackend(fx.nav);
  return fx;
}

/** Explicit budget: these drive the real gather/craft/place loop and the slowest case takes ~5s on a quiet box. */
const E2E_TIMEOUT_MS = 30_000;

describe("CRAFT-001 offline bootstrap from an empty inventory", { timeout: E2E_TIMEOUT_MS }, () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("fixture sanity: starts empty, recipes have prismarine-recipe shapes, drops are entities not inventory", async () => {
    const fx = emptyWorld();
    expect(fx.items.length).toBe(0);
    expect(fx.totalItems()).toBe(0);
    const table = fx.bot.recipesAll(fx.bot.registry.itemsByName.crafting_table!.id, null, true)[0]!;
    expect(table.inShape!.flat().every((cell) => typeof cell.id === "number")).toBe(true);
    expect(table.requiresTable).toBe(false);
    const pickaxe = fx.bot.recipesAll(
      fx.bot.registry.itemsByName.wooden_pickaxe!.id,
      null,
      true,
    )[0]!;
    expect(pickaxe.requiresTable).toBe(true);
    expect(pickaxe.inShape!.flat().some((cell) => cell.id === -1)).toBe(true); // blanks are {id:-1}, not null
    const planks = fx.bot.recipesAll(fx.bot.registry.itemsByName.oak_planks!.id, null, true)[0]!;
    expect(planks.ingredients![0]!.count).toBe(-1); // shapeless ingredients carry count -1
    // table recipes are hidden without a table (mineflayer rule)
    expect(
      fx.bot.recipesAll(fx.bot.registry.itemsByName.wooden_pickaxe!.id, null, false),
    ).toHaveLength(0);
    // nothing craftable from nothing
    expect(
      fx.bot.recipesFor(fx.bot.registry.itemsByName.oak_planks!.id, null, 1, null),
    ).toHaveLength(0);
  });

  it("staged chain: logs -> planks -> sticks -> crafting table (placed) -> wooden pickaxe, with inventory deltas at every step", async () => {
    const fx = emptyWorld();
    expect(fx.totalItems()).toBe(0);

    // 1. gather 3 logs by hand (empty inventory, no axe)
    const gathered = await collectResource(fx.ctx, LOGS, 3, 48);
    expect(gathered.success).toBe(true);
    expect(fx.stats.digs.filter((name) => name.endsWith("_log"))).toHaveLength(3);
    expect(fx.count("oak_log")).toBe(3); // real inventory delta: 0 -> 3
    expect(fx.dropped).toHaveLength(0); // every drop was picked up, none left on the ground

    // 2. logs -> planks (shapeless, 4 per craft, no table window)
    const planks = await craftItem(fx.ctx, "oak_planks", 4);
    expect(planks.success).toBe(true);
    expect(fx.count("oak_planks")).toBe(4);
    expect(fx.count("oak_log")).toBe(2);
    expect(fx.stats.windowOpens).toBe(0);

    // 3. planks -> sticks (2x2 shaped, no table)
    const sticks = await craftItem(fx.ctx, "stick", 4);
    expect(sticks.success).toBe(true);
    expect(fx.count("stick")).toBe(4);
    expect(fx.count("oak_planks")).toBe(2);

    // 4. crafting table needs 4 planks: craft more planks first, then the table (2x2, no window)
    expect((await craftItem(fx.ctx, "oak_planks", 4)).success).toBe(true);
    expect(fx.count("oak_planks")).toBe(6);
    const table = await craftItem(fx.ctx, "crafting_table", 1);
    expect(table.success).toBe(true);
    expect(fx.count("crafting_table")).toBe(1);
    expect(fx.count("oak_planks")).toBe(2);
    expect(fx.blocksNamed("crafting_table")).toBe(0); // in inventory, not yet in the world

    // 5. the pickaxe needs 3 planks + 2 sticks and a table in the world: 2 planks is not enough
    const tooFew = await craftItem(fx.ctx, "wooden_pickaxe", 1);
    expect(tooFew.success).toBe(false);
    expect(fx.count("wooden_pickaxe")).toBe(0);
    expect(fx.count("stick")).toBe(4); // a failed craft consumes nothing
    expect(fx.count("oak_planks")).toBe(2);
  });

  it("obtainItem(wooden_pickaxe) from an empty inventory gathers, crafts, places a table, uses the table window", async () => {
    const fx = emptyWorld();
    expect(fx.totalItems()).toBe(0);
    expect(fx.blocksNamed("crafting_table")).toBe(0);

    const result = await obtainItem(fx.ctx, "wooden_pickaxe", 1);

    expect(result.success, JSON.stringify(result)).toBe(true);
    // possession, observed in the inventory
    expect(fx.count("wooden_pickaxe")).toBe(1);
    // physical effects observed in the world
    expect(fx.blocksNamed("crafting_table")).toBe(1);
    expect(fx.stats.placed.map((entry) => entry.name)).toEqual(["crafting_table"]);
    expect(fx.count("crafting_table")).toBe(0); // the item was consumed by placement
    expect(fx.stats.digs.filter((name) => name.endsWith("_log")).length).toBeGreaterThanOrEqual(3);
    // the table recipe window was really used for the 3x3 pickaxe craft (and only for it)
    expect(fx.stats.windowOpens).toBe(1);
    const pickaxeCraft = fx.stats.craftCalls.find((call) => call.result === "wooden_pickaxe");
    expect(pickaxeCraft?.withTable).toBe(true);
    expect(
      fx.stats.craftCalls
        .filter((call) => call.result !== "wooden_pickaxe")
        .every((call) => !call.withTable),
    ).toBe(true);
    // wood accounting: 3+ logs gathered; planks/sticks/table consumed what the pickaxe chain needs
    // plank-equivalents: 4 per log dug == leftovers + table(4) + pickaxe(3) + the planks spent on the sticks
    // (2 sticks stay in the pickaxe; every other stick pair came from 1 plank)
    const logsDug = fx.stats.digs.filter((name) => name.endsWith("_log")).length;
    const sticksProduced = fx.count("stick") + 2;
    expect(logsDug * 4).toBe(
      fx.count("oak_log") * 4 + fx.count("oak_planks") + 4 + 3 + sticksProduced / 2,
    );
    expect(fx.currentWindowClosed()).toBe(true);
  });

  it("is idempotent: a second obtainItem with the pickaxe held changes nothing", async () => {
    const fx = emptyWorld();
    expect((await obtainItem(fx.ctx, "wooden_pickaxe", 1)).success).toBe(true);
    const digsBefore = fx.stats.digs.length;
    const craftsBefore = fx.stats.craftCalls.length;
    const total = fx.totalItems();
    expect((await obtainItem(fx.ctx, "wooden_pickaxe", 1)).success).toBe(true);
    expect(fx.stats.digs.length).toBe(digsBefore);
    expect(fx.stats.craftCalls.length).toBe(craftsBefore);
    expect(fx.totalItems()).toBe(total);
  });

  it("fails closed with no trees: nothing is invented and the inventory stays empty", async () => {
    const fx = createMineflayerCraftFixture({ trees: [] });
    setNavigationBackend(fx.nav);
    const result = await obtainItem(fx.ctx, "wooden_pickaxe", 1);
    expect(result.success).toBe(false);
    expect(fx.totalItems()).toBe(0);
    expect(fx.count("wooden_pickaxe")).toBe(0);
    expect(fx.blocksNamed("crafting_table")).toBe(0);
  });

  it("surfaces a rejected craft instead of reporting a pickaxe", async () => {
    const fx = createMineflayerCraftFixture({ trees: TREES, failCrafts: true });
    setNavigationBackend(fx.nav);
    const result = await obtainItem(fx.ctx, "wooden_pickaxe", 1);
    expect(result.success).toBe(false);
    expect(fx.count("wooden_pickaxe")).toBe(0);
    expect(fx.count("oak_planks")).toBe(0);
  });
});

describe(
  "deterministic resource capability seeds (fake Mineflayer only)",
  { timeout: E2E_TIMEOUT_MS },
  () => {
    afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));
    it.each([17, 41, 99])("seed %i verifies an empty-start tool and stone chain", async (seed) => {
      const x = 3 + (seed % 4);
      const z = 3 + (seed % 3);
      const fx = createMineflayerCraftFixture({
        trees: [
          { x, z, height: 6 },
          { x: -x, z: -z, height: 4 },
        ],
      });
      setNavigationBackend(fx.nav);
      expect(fx.totalItems()).toBe(0);
      const pickaxe = await obtainItem(fx.ctx, "wooden_pickaxe", 1);
      expect(pickaxe.success, JSON.stringify(pickaxe)).toBe(true);
      expect(fx.count("wooden_pickaxe")).toBe(1);
      expect(fx.blocksNamed("crafting_table")).toBe(1);
      // Natural ground in this fixture is stone; publish a discoverable ground cell, not gifted inventory.
      fx.world.set(`${x + 1},63,${z}`, "stone");
      const stone = await collectResource(fx.ctx, ["stone"], 1, 48);
      expect(stone.success, JSON.stringify(stone)).toBe(true);
      expect(fx.count("cobblestone")).toBe(1);
      expect(fx.stats.digs).toContain("stone");
      expect(fx.stats.pickups).toContain("cobblestone");
      expect(fx.dropped).toHaveLength(0);
      console.log(
        JSON.stringify({
          scenario: "empty-start-capability",
          seed,
          mode: "offline-fixture",
          humanInterventions: 0,
          suppliedInventory: [],
          finalInventory: fx.items.map(({ name, count }) => ({ name, count })),
          verifiedWorldModifications: fx.stats.placed,
          digs: fx.stats.digs,
          crafts: fx.stats.craftCalls,
          modelDecisions: 0,
          skillRequests: ["obtain wooden_pickaxe", "collect stone"],
          health: [20, fx.bot.health],
          hunger: [20, fx.bot.food],
          deaths: 0,
          unmodeled: ["hostiles", "server physics", "provider decisions", "hunger progression"],
        }),
      );
    });
  },
);
