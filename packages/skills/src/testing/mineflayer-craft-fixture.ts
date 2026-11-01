/**
 * CRAFT-001 test helper: an offline "mock Mineflayer bot" with realistic shapes for the pieces the
 * bootstrap chain touches. NOT used by production code. Never connects to Minecraft.
 *
 * What is modelled (ported from the installed library sources, mineflayer 4.39 / prismarine-recipe 1.5 /
 * mineflayer-tool 1.2 / minecraft-data recipes for the version used by @civ/minecraft-knowledge):
 *  - Recipe objects exactly as prismarine-recipe builds them: RecipeItem {id, metadata, count}; shaped recipes
 *    carry `inShape` rows where EMPTY cells are `{id:-1}` (never null); shapeless recipes carry `ingredients`
 *    with `count: -1`; `delta` (negative ingredients, positive result); `requiresTable` computed from the shape.
 *  - `bot.recipesAll(id, meta, craftingTable)` / `bot.recipesFor(id, meta, minCount, craftingTable)` with the same
 *    filtering rules as mineflayer (table recipes hidden without a table; recipesFor also checks inventory deltas).
 *  - `bot.craft(recipe, count, craftingTable)`: throws "Recipe requires craftingTable..." when a 3x3 recipe has no
 *    table; with a table it calls `bot.activateBlock(table)`, opens a `minecraft:crafting` window stub, consumes
 *    the exact ingredient cells one craft at a time, grants the result, then closes the window.
 *  - mineflayer-tool style `bot.tool.equipForBlock` (filters by block.canHarvest(heldItemId), throws NoItem).
 *  - Dig -> block removed, a dropped-item ENTITY appears on the ground (not in inventory). Pickup only happens when
 *    the bot moves within ~1.3 blocks of the drop (the nav mock moves the bot), so excavation != possession.
 *  - placeBlock verifies the held item, reach, and a free target cell, then writes the block into the world.
 * UNVERIFIED against a live server: packet timing, window slot sync, real pathfinding.
 */
import { Vec3 } from "vec3";
import { ok } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import type { NavigationBackend } from "@civ/minecraft-adapter";
import type { SkillContext } from "../context.js";

type EnumItem = null | number | { id: number; metadata?: number | null; count?: number };
type EnumRecipe = {
  result: { id: number; count?: number };
  inShape?: EnumItem[][];
  outShape?: EnumItem[][];
  ingredients?: EnumItem[];
};

/** prismarine-recipe RecipeItem */
export type RecipeItem = { id: number; metadata: number | null; count: number };
/** prismarine-recipe Recipe */
export type PrismarineRecipe = {
  result: RecipeItem;
  inShape: RecipeItem[][] | null;
  outShape: RecipeItem[][] | null;
  ingredients: RecipeItem[] | null;
  delta: RecipeItem[];
  requiresTable: boolean;
};

function recipeItemFromEnum(value: EnumItem): RecipeItem {
  if (value === null) return { id: -1, metadata: null, count: 1 };
  if (typeof value === "number") return { id: value, metadata: null, count: 1 };
  return { id: value.id, metadata: value.metadata ?? null, count: value.count || 1 };
}

export function buildPrismarineRecipe(source: EnumRecipe): PrismarineRecipe {
  const result = recipeItemFromEnum(source.result);
  const inShape = source.inShape ? source.inShape.map((row) => row.map(recipeItemFromEnum)) : null;
  const outShape = source.outShape ? source.outShape.map((row) => row.map(recipeItemFromEnum)) : null;
  const ingredients = source.ingredients
    ? source.ingredients.map((entry) => ({ ...recipeItemFromEnum(entry), count: -1 }))
    : null;

  const delta: RecipeItem[] = [];
  const add = (item: RecipeItem) => {
    const existing = delta.find((entry) => entry.id === item.id && entry.metadata === item.metadata);
    if (existing) existing.count += item.count;
    else delta.push({ ...item });
  };
  if (inShape) for (const row of inShape) for (const cell of row) if (cell.id !== -1) add({ ...cell, count: -1 });
  if (outShape) for (const row of outShape) for (const cell of row) if (cell.id !== -1) add({ ...cell, count: 1 });
  if (ingredients) for (const entry of ingredients) add(entry);
  add(result);

  let spaceLeft = 4;
  let requiresTable = false;
  if (inShape) {
    if (inShape.length > 2) requiresTable = true;
    for (const row of inShape) {
      if (row.length > 2) requiresTable = true;
      for (const cell of row) if (cell) spaceLeft -= 1;
    }
  }
  if (ingredients) spaceLeft -= ingredients.length;
  if (spaceLeft < 0) requiresTable = true;
  return { result, inShape, outShape, ingredients, delta, requiresTable };
}

type Cell = string; // block name
type FixtureItem = { name: string; type: number; count: number; slot: number; metadata: null };
export type DroppedItem = { id: number; name: string; position: Vec3; item: { name: string; count: number } };

export type SharedCraftWorld = {
  blocks: Map<string, Cell>;
  dropped: DroppedItem[];
  entities: Record<string, unknown>;
  nextEntityId: number;
};

export function createSharedCraftWorld(): SharedCraftWorld {
  return { blocks: new Map(), dropped: [], entities: {}, nextEntityId: 100 };
}

export type CraftFixtureOptions = {
  sharedWorld?: SharedCraftWorld;
  start?: { x: number; y: number; z: number };
  /** Starting inventory; the CRAFT-001 scenario passes nothing (empty). */
  inventory?: Array<{ name: string; count: number }>;
  /** Trees as `{x, z, height, log}` trunks standing on the ground (ground top is y=63, feet at y=64). */
  trees?: Array<{ x: number; z: number; height: number; log?: string }>;
  /** Pre-existing crafting table positions. */
  craftingTables?: Array<{ x: number; y: number; z: number }>;
  /** Make `bot.craft` reject (to prove failures are surfaced, not invented). */
  failCrafts?: boolean;
};

const GROUND_Y = 63;
const FEET_Y = 64;
const PICKUP_RADIUS = 1.3;
const _BLOCK_REACH = 4.5;

export function createMineflayerCraftFixture(options: CraftFixtureOptions = {}) {
  const knowledge = minecraftKnowledge();
  const data = knowledge.data;
  const recipesTable = (data.recipes ?? {}) as Record<string, EnumRecipe[]>;

  const shared = options.sharedWorld ?? createSharedCraftWorld();
  const world = shared.blocks;
  const key = (x: number, y: number, z: number) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const blockNameAt = (x: number, y: number, z: number): string => {
    const found = world.get(key(x, y, z));
    if (found) return found;
    return y <= GROUND_Y ? "stone" : "air";
  };
  for (const tree of options.trees ?? []) {
    for (let h = 0; h < tree.height; h += 1) world.set(key(tree.x, FEET_Y + h, tree.z), tree.log ?? "oak_log");
  }
  for (const table of options.craftingTables ?? []) world.set(key(table.x, table.y, table.z), "crafting_table");

  const stats = {
    digs: [] as string[],
    placed: [] as Array<{ name: string; position: { x: number; y: number; z: number } }>,
    windowOpens: 0,
    activateBlockCalls: 0,
    craftCalls: [] as Array<{ result: string; crafts: number; withTable: boolean }>,
    pickups: [] as string[],
  };

  const items: FixtureItem[] = [];
  const slots: Array<FixtureItem | null> = Array.from({ length: 46 }, () => null);
  const stackSize = (name: string) => data.itemsByName[name]?.stackSize ?? 64;
  const firstFreeSlot = () => {
    for (let slot = 9; slot <= 44; slot += 1) if (!slots[slot]) return slot;
    return -1;
  };
  function addItem(name: string, count: number): number {
    const meta = data.itemsByName[name];
    if (!meta) throw new Error(`fixture: unknown item ${name}`);
    let remaining = count;
    for (const stack of items) {
      if (stack.name !== name || stack.count >= stackSize(name)) continue;
      const take = Math.min(remaining, stackSize(name) - stack.count);
      stack.count += take;
      remaining -= take;
      if (remaining <= 0) return count;
    }
    while (remaining > 0) {
      const slot = firstFreeSlot();
      if (slot < 0) break; // inventory full: the rest is NOT added
      const take = Math.min(remaining, stackSize(name));
      const stack: FixtureItem = { name, type: meta.id, count: take, slot, metadata: null };
      items.push(stack);
      slots[slot] = stack;
      remaining -= take;
    }
    return count - remaining;
  }
  function removeItem(id: number, count: number): boolean {
    let remaining = count;
    for (const stack of [...items]) {
      if (stack.type !== id) continue;
      const take = Math.min(remaining, stack.count);
      stack.count -= take;
      remaining -= take;
      if (stack.count <= 0) {
        items.splice(items.indexOf(stack), 1);
        slots[stack.slot] = null;
        if (bot.heldItem === stack) bot.heldItem = null;
      }
      if (remaining <= 0) return true;
    }
    return remaining <= 0;
  }
  for (const entry of options.inventory ?? []) addItem(entry.name, entry.count);

  const count = (id: number): number => items.filter((stack) => stack.type === id).reduce((sum, stack) => sum + stack.count, 0);

  function blockObject(x: number, y: number, z: number) {
    const name = blockNameAt(x, y, z);
    const meta = data.blocksByName[name];
    const position = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    return {
      name,
      metadata: name === "sweet_berry_bush" ? 3 : 0,
      type: meta?.id ?? 0,
      position,
      boundingBox: meta?.boundingBox ?? (name === "air" ? "empty" : "block"),
      diggable: meta?.diggable ?? true,
      harvestTools: meta?.harvestTools as Record<string, boolean> | undefined,
      // prismarine-block: no harvestTools => any (or no) tool works; otherwise the held item id must be listed.
      canHarvest(heldItemType: number | null) {
        if (!meta?.harvestTools) return true;
        return heldItemType != null && Boolean(meta.harvestTools[String(heldItemType)]);
      },
    };
  }

  const dropped = shared.dropped;
  const dropFor = (blockName: string): string | undefined => {
    if (blockName === "stone") return "cobblestone";
    // These fixture bushes are mature (age 3), with a deterministic legal minimum drop.
    if (blockName === "sweet_berry_bush") return "sweet_berries";
    if (blockName.endsWith("_log") || blockName === "cobblestone") return blockName;
    return undefined;
  };

  const windowStub = { type: "minecraft:crafting", id: 1 } as { type: string; id: number };
  const bot = {
    entity: { position: new Vec3(options.start?.x ?? 0.5, options.start?.y ?? FEET_Y, options.start?.z ?? 0.5), eyeHeight: 1.62, onGround: true },
    heldItem: null as FixtureItem | null,
    currentWindow: null as typeof windowStub | null,
    entities: shared.entities,
    time: { timeOfDay: 1000 },
    health: 20,
    food: 20,
    registry: {
      blocksByName: data.blocksByName as Record<string, { id: number; name: string }>,
      blocks: data.blocks as Record<string, { id: number; name: string }>,
      itemsByName: data.itemsByName as Record<string, { id: number; name: string }>,
      items: data.items as Record<string, { id: number; name: string }>,
      recipes: data.recipes as Record<string, unknown> | undefined,
    },
    inventory: {
      items: () => items,
      slots,
      inventoryStart: 9,
      inventoryEnd: 45,
      count: (id: number) => count(id),
      emptySlotCount: () => slots.slice(9, 45).filter((slot) => !slot).length,
    },
    blockAt(position: Vec3) {
      return blockObject(position.x, position.y, position.z);
    },
    findBlocks(opts: { matching: number | number[]; maxDistance?: number; count?: number }) {
      const wanted = new Set(Array.isArray(opts.matching) ? opts.matching : [opts.matching]);
      const max = opts.maxDistance ?? 16;
      const out: Array<{ d: number; p: Vec3 }> = [];
      for (const [cellKey, name] of world) {
        const meta = data.blocksByName[name];
        if (!meta || !wanted.has(meta.id)) continue;
        const [x, y, z] = cellKey.split(",").map(Number) as [number, number, number];
        const d = bot.entity.position.distanceTo(new Vec3(x + 0.5, y + 0.5, z + 0.5));
        if (d <= max) out.push({ d, p: new Vec3(x, y, z) });
      }
      return out.sort((a, b) => a.d - b.d).slice(0, opts.count ?? 1).map((entry) => entry.p);
    },
    findBlock(opts: { matching: number | number[]; maxDistance?: number }) {
      const hit = bot.findBlocks({ ...opts, count: 1 })[0];
      return hit ? blockObject(hit.x, hit.y, hit.z) : null;
    },
    tool: {
      // mineflayer-tool 1.2 equipForBlock(requireHarvest) semantics
      async equipForBlock(block: ReturnType<typeof blockObject>, opts: { requireHarvest?: boolean } = {}) {
        const candidates: Array<FixtureItem | undefined> = [...items];
        if (bot.inventory.emptySlotCount() >= 1) candidates.unshift(undefined);
        const usable = opts.requireHarvest ? candidates.filter((item) => block.canHarvest(item ? item.type : null)) : candidates;
        if (usable.length === 0) {
          if (opts.requireHarvest) throw Object.assign(new Error("Bot does not have a harvestable tool!"), { name: "NoItem" });
          return;
        }
        // prefer a real tool over bare hands when the block lists harvest tools or a matching tool exists
        const best = usable.find((item) => item && /_(axe|pickaxe)$/.test(item.name)) ?? usable[0];
        bot.heldItem = best ?? null;
      },
    },
    async equip(item: FixtureItem) {
      bot.heldItem = item;
    },
    async consume() {
      const item = bot.heldItem;
      const value = item ? knowledge.foodValue(item.name) : undefined;
      if (!item || !value || bot.food >= 20 || !removeItem(item.type, 1)) throw new Error("cannot consume");
      bot.food = Math.min(20, bot.food + value);
    },
    async unequip() {
      bot.heldItem = null;
    },
    async lookAt() {},
    async activateBlock(block: { name: string }) {
      stats.activateBlockCalls += 1;
      if (block.name !== "crafting_table") return;
      stats.windowOpens += 1;
      bot.currentWindow = windowStub;
    },
    async closeWindow() {
      bot.currentWindow = null;
    },
    async dig(block: ReturnType<typeof blockObject>) {
      const here = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
      if (here.distanceTo(new Vec3(block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5)) > 6) {
        throw new Error("Block out of reach");
      }
      const name = blockNameAt(block.position.x, block.position.y, block.position.z);
      if (name === "air") throw new Error("Cannot dig air");
      const held = bot.heldItem?.type ?? null;
      const harvested = blockObject(block.position.x, block.position.y, block.position.z).canHarvest(held);
      world.set(key(block.position.x, block.position.y, block.position.z), "air");
      stats.digs.push(name);
      const drop = harvested ? dropFor(name) : undefined;
      if (drop) {
        // the drop falls to the ground: find the first solid cell below
        let y = block.position.y;
        while (blockNameAt(block.position.x, y - 1, block.position.z) === "air") y -= 1;
        const entityId = shared.nextEntityId++;
        const dropCount = name === "sweet_berry_bush" ? 2 : 1;
        const entry: DroppedItem = {
          id: entityId,
          name: "item",
          position: new Vec3(block.position.x + 0.5, y + 0.25, block.position.z + 0.5),
          item: { name: drop, count: dropCount },
        };
        dropped.push(entry);
        bot.entities[String(entityId)] = {
          id: entityId,
          name: "item",
          type: "other",
          objectType: "Item",
          position: entry.position,
          getDroppedItem: () => ({ name: drop, count: dropCount }),
        };
      }
    },
    async placeBlock(reference: ReturnType<typeof blockObject>, face: Vec3) {
      const held = bot.heldItem;
      if (!held) throw new Error("must be holding an item to place a block");
      const dest = reference.position.plus(face);
      if (blockNameAt(dest.x, dest.y, dest.z) !== "air") throw new Error("target cell is not empty");
      const here = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
      if (here.distanceTo(new Vec3(dest.x + 0.5, dest.y + 0.5, dest.z + 0.5)) > 6) throw new Error("placement out of reach");
      world.set(key(dest.x, dest.y, dest.z), held.name);
      stats.placed.push({ name: held.name, position: { x: dest.x, y: dest.y, z: dest.z } });
      removeItem(held.type, 1);
    },
    recipesAll(itemType: number, _metadata: number | null, craftingTable: unknown): PrismarineRecipe[] {
      return (recipesTable[String(itemType)] ?? [])
        .map(buildPrismarineRecipe)
        .filter((recipe) => !recipe.requiresTable || Boolean(craftingTable));
    },
    recipesFor(itemType: number, _metadata: number | null, minResultCount: number | null, craftingTable: unknown): PrismarineRecipe[] {
      const minCount = minResultCount ?? 1;
      return (recipesTable[String(itemType)] ?? [])
        .map(buildPrismarineRecipe)
        .filter((recipe) => {
          if (recipe.requiresTable && !craftingTable) return false;
          const crafts = Math.ceil(minCount / recipe.result.count);
          return recipe.delta.every((entry) => count(entry.id) + entry.count * crafts >= 0);
        });
    },
    async craft(recipe: PrismarineRecipe, crafts: number, craftingTable?: { name: string }) {
      if (options.failCrafts) throw new Error("fixture: craft rejected");
      if (recipe.requiresTable && !craftingTable) {
        throw new Error(`Recipe requires craftingTable, but one was not supplied: ${JSON.stringify(recipe)}`);
      }
      stats.craftCalls.push({ result: data.items[recipe.result.id]?.name ?? String(recipe.result.id), crafts, withTable: Boolean(craftingTable) });
      try {
        if (craftingTable) {
          // real mineflayer: bot.activateBlock(table) then await windowOpen
          await bot.activateBlock(craftingTable);
          if (!bot.currentWindow || !bot.currentWindow.type.startsWith("minecraft:crafting")) {
            throw new Error("crafting: non craftingTable used as craftingTable");
          }
        }
        for (let i = 0; i < crafts; i += 1) {
          const needed = new Map<number, number>();
          if (recipe.inShape) for (const row of recipe.inShape) for (const cell of row) if (cell.id !== -1) needed.set(cell.id, (needed.get(cell.id) ?? 0) + 1);
          if (recipe.ingredients) for (const entry of recipe.ingredients) needed.set(entry.id, (needed.get(entry.id) ?? 0) + 1);
          for (const [id, amount] of needed) if (count(id) < amount) throw new Error("missing ingredient");
          for (const [id, amount] of needed) removeItem(id, amount);
          const resultName = data.items[recipe.result.id]?.name;
          if (!resultName) throw new Error("fixture: unknown result item");
          addItem(resultName, recipe.result.count);
        }
      } catch (error) {
        bot.currentWindow = null;
        throw new Error(String(error));
      }
      bot.currentWindow = null;
    },
  };

  function pickupNearby(): void {
    for (const entry of [...dropped]) {
      const dx = entry.position.x - bot.entity.position.x;
      const dz = entry.position.z - bot.entity.position.z;
      const dy = entry.position.y - bot.entity.position.y;
      if (Math.hypot(dx, dz) > PICKUP_RADIUS || Math.abs(dy) > 1.5) continue;
      const added = addItem(entry.item.name, entry.item.count);
      if (added <= 0) continue; // inventory full: stays on the ground
      stats.pickups.push(entry.item.name);
      dropped.splice(dropped.indexOf(entry), 1);
      delete bot.entities[String(entry.id)];
    }
  }

  function moveWithin(target: { x: number; y: number; z: number }, range: number): { x: number; y: number; z: number } {
    const pos = bot.entity.position;
    const dx = pos.x - (target.x + 0.5);
    const dz = pos.z - (target.z + 0.5);
    const dist = Math.hypot(dx, dz);
    if (dist > range) {
      const scale = range / dist;
      pos.x = target.x + 0.5 + dx * scale;
      pos.z = target.z + 0.5 + dz * scale;
    }
    pickupNearby();
    return { x: pos.x, y: pos.y, z: pos.z };
  }
  const arrived = (target: { x: number; y: number; z: number }, range: number) => {
    const position = moveWithin(target, range);
    return Promise.resolve(ok({ position, distance: Math.hypot(position.x - target.x, position.z - target.z) }, 1));
  };

  /** Pathfinder-like mock: GoalNear(range) stops just inside `range`; interact goals stop within block reach. */
  const nav: NavigationBackend = {
    name: "craft-fixture-nav",
    navigateToPosition: (_bot, target, opts) => arrived(target, Math.max(0.5, (opts?.range ?? 1) - 0.1)),
    navigateNear: (_bot, target, range) => arrived(target, Math.max(0.5, (range ?? 1.5) - 0.1)),
    navigateToInteractWithBlock: (_bot, block) => arrived(block, 2.5),
    navigateToPlaceBlock: (_bot, target) => arrived(target, 2.5),
    followEntity: async () => ok({ username: "x", position: { x: 0.5, y: FEET_Y, z: 0.5 } }, 1),
    escapeFrom: async (_bot, from) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };

  const ctx = {
    citizenId: "citizen_craft001",
    timeoutMs: 3_000,
    bot: bot as unknown as SkillContext["bot"],
    body: {
      position: () => ({ x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }),
      nearbyEntities: () => [],
      unreachable: { has: () => false, mark: () => undefined },
    },
  } as unknown as SkillContext;

  return {
    bot,
    ctx,
    nav,
    stats,
    world,
    dropped,
    items,
    /** Count items by name in the REAL inventory (never counts ground drops). */
    count: (name: string) => items.filter((stack) => stack.name === name).reduce((sum, stack) => sum + stack.count, 0),
    totalItems: () => items.reduce((sum, stack) => sum + stack.count, 0),
    blocksNamed: (name: string) => [...world.values()].filter((entry) => entry === name).length,
    currentWindowClosed: () => bot.currentWindow === null,
    blockAtCell: (x: number, y: number, z: number) => blockNameAt(x, y, z),
  };
}

export type MineflayerCraftFixture = ReturnType<typeof createMineflayerCraftFixture>;
