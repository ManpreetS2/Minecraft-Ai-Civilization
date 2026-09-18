import {
  classifyIncompleteTransfer,
  compactCarriedFacts,
  computeFreeCapacity,
  confirmDrop,
  confirmTransfer,
  countEmptyStorageSlots,
  countsFromStacks,
  createEvent,
  fail,
  ok,
  storageSlotRange,
  type ActionResult,
  type CompactCarriedFacts,
  type DropPurpose,
  type EquipmentSnapshot,
  type InventorySnapshot,
  type InventoryStackSnapshot,
  type TransferFailureCause,
  type Vec3,
} from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { navigationBackend } from "@civ/minecraft-adapter";
import { Vec3 as Vec3Class } from "vec3";
import type { Bot } from "mineflayer";
import type { SkillContext } from "./context.js";
import { ItemReservationBook } from "./inventory-reservations.js";
import { lookAtPosition } from "./look.js";
import { moveTo } from "./movement.js";
import { findBlock } from "./observe.js";

export type EquipDestination = "hand" | "head" | "torso" | "legs" | "feet" | "off-hand";
export type ContainerTarget = Vec3;

type PrismarineItem = {
  name: string;
  type: number;
  count: number;
  slot?: number;
  stackSize?: number;
  durabilityUsed?: number;
  maxDurability?: number;
  nbt?: unknown;
  components?: unknown;
  metadata?: number;
};

const books = new WeakMap<object, ItemReservationBook>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function reservationsFor(ctx: SkillContext): ItemReservationBook {
  if (ctx.reservations) return ctx.reservations;
  const key = ctx.bot;
  let book = books.get(key);
  if (!book) {
    book = new ItemReservationBook();
    books.set(key, book);
  }
  return book;
}

export function reserveItems(
  ctx: SkillContext,
  reservationId: string,
  itemName: string,
  count: number,
  purpose = "task",
): InventoryHoldView {
  const knowledge = minecraftKnowledge();
  const name = knowledge.normalizeItemName(itemName) || itemName;
  const hold = reservationsFor(ctx).reserve({ reservationId, item: name, count, purpose, ownerId: ctx.citizenId });
  ctx.events?.emit(
    createEvent("ResourceReserved", { reservationId: hold.id, item: name, count, purpose }, ctx.citizenId),
  );
  return hold;
}

export function releaseReservation(ctx: SkillContext, reservationId: string): boolean {
  const released = reservationsFor(ctx).release(reservationId);
  if (released) {
    ctx.events?.emit(createEvent("ResourceReleased", { reservationId }, ctx.citizenId));
  }
  return released;
}

export function clearReservations(ctx: SkillContext): void {
  reservationsFor(ctx).clear();
}

type InventoryHoldView = {
  id: string;
  item: string;
  count: number;
  purpose: string;
  ownerId?: string;
};

function normalizeName(name: string): string {
  return minecraftKnowledge().normalizeItemName(name) || name;
}

function stackSizeFor(name: string, item?: PrismarineItem): number {
  if (typeof item?.stackSize === "number" && item.stackSize > 0) return item.stackSize;
  return minecraftKnowledge().stackSize(name);
}

function toStack(item: PrismarineItem, fallbackSlot = -1): InventoryStackSnapshot {
  const name = item.name;
  const stack: InventoryStackSnapshot = {
    name,
    count: item.count,
    slot: typeof item.slot === "number" ? item.slot : fallbackSlot,
    stackSize: stackSizeFor(name, item),
  };
  if (typeof item.durabilityUsed === "number") {
    stack.durability = Math.max(0, (item.maxDurability ?? 0) - item.durabilityUsed);
    stack.maxDurability = item.maxDurability;
  }
  if (item.nbt !== undefined) stack.nbt = item.nbt;
  if (item.components !== undefined) stack.components = item.components;
  return stack;
}

function storageItems(bot: Bot): PrismarineItem[] {
  const inv = bot.inventory;
  const range = storageSlotRange(inv);
  const items: PrismarineItem[] = [];
  for (let slot = range.start; slot <= range.end; slot += 1) {
    const item = inv.slots[slot] as PrismarineItem | null;
    if (item?.name) items.push({ ...item, slot });
  }
  return items;
}

function equipmentSlot(bot: Bot, destination: EquipDestination): number | undefined {
  const getter = (bot as unknown as { getEquipmentDestSlot?: (dest: string) => number }).getEquipmentDestSlot;
  if (typeof getter !== "function") return undefined;
  try {
    return getter.call(bot, destination);
  } catch {
    return undefined;
  }
}

function slotStack(bot: Bot, slot: number | undefined): InventoryStackSnapshot | undefined {
  if (slot === undefined || slot < 0) return undefined;
  const item = bot.inventory.slots[slot] as PrismarineItem | null;
  if (!item?.name) return undefined;
  return toStack(item, slot);
}

export function snapshotInventory(ctx: SkillContext): InventorySnapshot {
  const bot = ctx.bot;
  const stacks = storageItems(bot).map((item) => toStack(item, item.slot ?? -1));
  const range = storageSlotRange(bot.inventory);
  const equipment: EquipmentSnapshot = {
    head: slotStack(bot, equipmentSlot(bot, "head")),
    torso: slotStack(bot, equipmentSlot(bot, "torso")),
    legs: slotStack(bot, equipmentSlot(bot, "legs")),
    feet: slotStack(bot, equipmentSlot(bot, "feet")),
    offHand: slotStack(bot, equipmentSlot(bot, "off-hand")),
  };
  const held = bot.heldItem as PrismarineItem | null;
  return {
    stacks,
    counts: countsFromStacks(stacks),
    heldItem: held?.name ? toStack(held, equipmentSlot(bot, "hand") ?? -1) : undefined,
    quickBarSlot: bot.quickBarSlot,
    equipment,
    freeSlots: countEmptyStorageSlots({ slots: bot.inventory.slots, range }),
    reservations: reservationsFor(ctx).list().map((hold) => ({
      id: hold.id,
      item: hold.item,
      count: hold.count,
      purpose: hold.purpose,
      ownerId: hold.ownerId,
    })),
  };
}

export function countItem(ctx: SkillContext, name: string): number {
  const n = normalizeName(name);
  return snapshotInventory(ctx).counts[n] ?? 0;
}

export function findStacks(ctx: SkillContext, name: string): InventoryStackSnapshot[] {
  const n = normalizeName(name);
  return snapshotInventory(ctx).stacks.filter((stack) => stack.name === n);
}

export function heldItem(ctx: SkillContext): InventoryStackSnapshot | undefined {
  return snapshotInventory(ctx).heldItem;
}

export function freeCapacity(ctx: SkillContext, itemName: string): number {
  const n = normalizeName(itemName);
  const bot = ctx.bot;
  const range = storageSlotRange(bot.inventory);
  return computeFreeCapacity({
    slots: bot.inventory.slots as Array<{ name?: string; count?: number; stackSize?: number } | null>,
    range,
    itemName: n,
    stackSize: stackSizeFor(n),
  });
}

export function canReceive(ctx: SkillContext, itemName: string, count: number): boolean {
  return freeCapacity(ctx, itemName) >= count;
}

export function inventorySpace(ctx: SkillContext): number {
  return snapshotInventory(ctx).freeSlots;
}

export function availableUnreservedCount(ctx: SkillContext, itemName: string): number {
  const n = normalizeName(itemName);
  return Math.max(0, countItem(ctx, n) - reservationsFor(ctx).reservedOf(n));
}

export function hasItem(ctx: SkillContext, name: string, count = 1): boolean {
  return countItem(ctx, name) >= count;
}

export function listInventory(ctx: SkillContext): Array<{ name: string; count: number }> {
  return Object.entries(snapshotInventory(ctx).counts).map(([name, count]) => ({ name, count }));
}

export function canFitDrop(ctx: SkillContext, names: string[]): boolean {
  if (inventorySpace(ctx) > 0) return true;
  return names.some((name) => freeCapacity(ctx, name) > 0);
}

export function compactInventoryFacts(ctx: SkillContext): CompactCarriedFacts {
  const knowledge = minecraftKnowledge();
  const snapshot = snapshotInventory(ctx);
  return compactCarriedFacts({
    snapshot,
    isFood: (name) => knowledge.isFood(name),
    isTool: (name) => knowledge.isTool(name),
    freeCapacity: {
      oak_log: freeCapacity(ctx, "oak_log"),
      cobblestone: freeCapacity(ctx, "cobblestone"),
    },
  });
}

async function waitForCount(
  ctx: SkillContext,
  name: string,
  predicate: (count: number) => boolean,
  timeoutMs = 2_500,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let current = countItem(ctx, name);
  while (Date.now() < deadline) {
    if (predicate(current)) return current;
    await wait(80);
    current = countItem(ctx, name);
  }
  return current;
}

function assertUnreserved(ctx: SkillContext, name: string, count: number): ActionResult<never> | undefined {
  const available = availableUnreservedCount(ctx, name);
  if (available < count) {
    return fail(
      available === 0 && countItem(ctx, name) >= count ? "ITEM_RESERVED" : "ITEM_NOT_FOUND",
      available === 0 && countItem(ctx, name) >= count
        ? `${name} is reserved for another task`
        : `Need ${count} unreserved ${name}, have ${available}`,
      0,
      true,
      { item: name, requested: count, available, reserved: reservationsFor(ctx).reservedOf(normalizeName(name)) },
    );
  }
  return undefined;
}

export async function equipItem(
  ctx: SkillContext,
  itemName: string,
  destination: EquipDestination = "hand",
): Promise<ActionResult<{ item: string; destination: EquipDestination }>> {
  const started = Date.now();
  const name = normalizeName(itemName);
  const item = ctx.bot.inventory.items().find((entry) => entry.name === name);
  if (!item) {
    return fail("ITEM_NOT_FOUND", `No ${name} in inventory`, Date.now() - started, true);
  }
  try {
    await ctx.bot.equip(item, destination);
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  if (destination === "hand") {
    const held = ctx.bot.heldItem?.name;
    if (held !== name) {
      return fail("VERIFY_FAILED", `Expected to hold ${name}, holding ${held ?? "nothing"}`, Date.now() - started, true);
    }
  } else {
    const equipped = slotStack(ctx.bot, equipmentSlot(ctx.bot, destination));
    if (equipped?.name !== name) {
      return fail("VERIFY_FAILED", `Expected ${name} in ${destination}`, Date.now() - started, true);
    }
  }
  return ok({ item: name, destination }, Date.now() - started);
}

export async function unequip(
  ctx: SkillContext,
  destination: EquipDestination = "hand",
): Promise<ActionResult<{ destination: EquipDestination }>> {
  const started = Date.now();
  const before = destination === "hand" ? ctx.bot.heldItem?.name : slotStack(ctx.bot, equipmentSlot(ctx.bot, destination))?.name;
  try {
    await ctx.bot.unequip(destination);
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const after = destination === "hand" ? ctx.bot.heldItem?.name : slotStack(ctx.bot, equipmentSlot(ctx.bot, destination))?.name;
  if (before && after === before) {
    return fail("VERIFY_FAILED", `Still equipped ${after} in ${destination}`, Date.now() - started, true);
  }
  return ok({ destination }, Date.now() - started);
}

export async function setQuickBarSlot(ctx: SkillContext, slot: number): Promise<ActionResult<{ slot: number }>> {
  const started = Date.now();
  if (slot < 0 || slot > 8) {
    return fail("INVALID_ARGUMENT", "quickBar slot must be 0-8", Date.now() - started, false);
  }
  try {
    ctx.bot.setQuickBarSlot(slot);
  } catch (error) {
    return fail("EQUIP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  if (ctx.bot.quickBarSlot !== slot) {
    return fail("VERIFY_FAILED", `quickBarSlot is ${ctx.bot.quickBarSlot}, expected ${slot}`, Date.now() - started, true);
  }
  return ok({ slot }, Date.now() - started);
}

function findDroppedEntities(bot: Bot, itemName: string | undefined, maxDistance: number) {
  const origin = bot.entity?.position;
  if (!origin) return [];
  const wanted = itemName ? normalizeName(itemName) : undefined;
  return Object.values(bot.entities).filter((entity) => {
    if (!entity.position || origin.distanceTo(entity.position) > maxDistance) return false;
    const dropped = (entity as { getDroppedItem?: () => PrismarineItem | null }).getDroppedItem?.();
    const nested = (entity as { item?: { name?: string } }).item;
    const raw = `${entity.name ?? ""} ${entity.displayName ?? ""} ${dropped?.name ?? ""} ${nested?.name ?? ""}`.toLowerCase();
    const isItem = raw.includes("item") || Boolean(dropped) || Boolean(nested);
    if (!isItem) return false;
    if (!wanted) return true;
    if (dropped?.name === wanted || nested?.name === wanted) return true;
    if (raw.includes(wanted)) return true;
    // 1.21 item entities often have name "item" without a readable payload yet.
    return !dropped && !nested;
  });
}

export async function dropItem(
  ctx: SkillContext,
  itemName: string,
  count: number,
  purpose: DropPurpose,
): Promise<ActionResult<{ item: string; count: number; purpose: DropPurpose; droppedEntityId?: number }>> {
  const started = Date.now();
  const name = normalizeName(itemName);
  if (count <= 0) {
    return fail("INVALID_ARGUMENT", "drop count must be positive", Date.now() - started, false);
  }
  const reserved = assertUnreserved(ctx, name, count);
  if (reserved) return { ...reserved, durationMs: Date.now() - started };
  const stacks = findStacks(ctx, name);
  const physical = stacks.reduce((sum, stack) => sum + stack.count, 0);
  if (physical < count) {
    return fail("ITEM_NOT_FOUND", `Have ${physical} ${name}, cannot drop ${count}`, Date.now() - started, true);
  }
  const before = physical;
  const whole = stacks.find((stack) => stack.count === count);
  try {
    await ctx.bot.look(ctx.bot.entity?.yaw ?? 0, 1.2, true).catch(() => undefined);
    await wait(80);
    if (whole && count === whole.count) {
      const item = ctx.bot.inventory.slots[whole.slot];
      if (item?.name === name && typeof ctx.bot.tossStack === "function") {
        await ctx.bot.tossStack(item);
      } else {
        const typeId = item?.type ?? ctx.bot.registry.itemsByName[name]?.id;
        if (typeId === undefined) {
          return fail("ITEM_NOT_FOUND", `No ${name} type id to toss`, Date.now() - started, true);
        }
        await ctx.bot.toss(typeId, null, count);
      }
    } else {
      const type = ctx.bot.inventory.items().find((entry) => entry.name === name)?.type;
      if (type === undefined) {
        return fail("ITEM_NOT_FOUND", `No ${name} stack to toss`, Date.now() - started, true);
      }
      await ctx.bot.toss(type, null, count);
    }
  } catch (error) {
    return fail("DROP_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true, {
      item: name,
      purpose,
    });
  }
  const after = await waitForCount(ctx, name, (value) => value === before - count);
  if (!confirmDrop({ item: name, requested: count, before, after })) {
    return fail("VERIFY_FAILED", `Drop of ${count} ${name} left count ${after} (was ${before})`, Date.now() - started, true, {
      item: name,
      purpose,
      before,
      after,
    });
  }
  const nearby = findDroppedEntities(ctx.bot, name, 6);
  const droppedEntityId = nearby[0]?.id;
  ctx.events?.emit(
    createEvent(
      "ItemDropped",
      { item: name, count, purpose, droppedEntityId, gift: false },
      ctx.citizenId,
    ),
  );
  return ok({ item: name, count, purpose, droppedEntityId }, Date.now() - started);
}

export async function dropStack(
  ctx: SkillContext,
  stack: InventoryStackSnapshot,
  purpose: DropPurpose,
): Promise<ActionResult<{ item: string; count: number; purpose: DropPurpose }>> {
  return dropItem(ctx, stack.name, stack.count, purpose);
}

export async function pickupDroppedItem(
  ctx: SkillContext,
  itemName?: string,
  maxDistance = 8,
): Promise<ActionResult<{ item?: string; collected: number }>> {
  const started = Date.now();
  const name = itemName ? normalizeName(itemName) : undefined;
  if (name && !canReceive(ctx, name, 1)) {
    return fail("INVENTORY_FULL", `Cannot pick up ${name}; inventory is full`, Date.now() - started, true);
  }
  const before = name ? countItem(ctx, name) : ctx.bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  const nearby = findDroppedEntities(ctx.bot, name, maxDistance);
  if (nearby.length === 0) {
    await wait(400);
  }
  const found = nearby.length > 0 ? nearby : findDroppedEntities(ctx.bot, name, maxDistance);
  if (found.length === 0) {
    const sample = Object.values(ctx.bot.entities)
      .slice(0, 12)
      .map((entity) => entity.name ?? entity.displayName ?? String(entity.id));
    return fail("ITEM_NOT_FOUND", `No dropped items nearby${name ? ` matching ${name}` : ""}`, Date.now() - started, true, {
      entities: sample,
    });
  }
  let reached = 0;
  const origin = ctx.bot.entity?.position;
  for (const entity of found.slice(0, 8)) {
    if (ctx.signal?.aborted) break;
    const pos = entity.position;
    if (!pos) continue;
    const dist = origin ? origin.distanceTo(pos) : 99;
    if (dist > 1.6) {
      const move = await moveTo(ctx, { x: pos.x, y: pos.y, z: pos.z }, 0.8);
      if (!move.success) continue;
    }
    reached += 1;
    await wait(2_200);
    const mid = name ? countItem(ctx, name) : ctx.bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
    if (mid > before) break;
  }
  await wait(500);
  const after = name
    ? await waitForCount(ctx, name, (value) => value > before, 3_000)
    : ctx.bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  const collected = Math.max(0, after - before);
  if (collected <= 0) {
    return fail("PICKUP_FAILED", "Walked to drops but inventory did not increase", Date.now() - started, true, {
      reached,
    });
  }
  ctx.events?.emit(createEvent("ItemPickedUp", { item: name, collected, gift: false }, ctx.citizenId));
  return ok({ item: name, collected }, Date.now() - started);
}

async function resolveContainer(
  ctx: SkillContext,
  preferred?: ContainerTarget,
  names: string[] = ["chest", "barrel", "trapped_chest"],
): Promise<ActionResult<{ position: Vec3 }>> {
  const started = Date.now();
  if (preferred) {
    const block = ctx.bot.blockAt(new Vec3Class(Math.floor(preferred.x), Math.floor(preferred.y), Math.floor(preferred.z)));
    if (!block || !names.includes(block.name)) {
      return fail("CONTAINER_NOT_FOUND", "Preferred container is missing", Date.now() - started, true);
    }
    const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, preferred, {
      timeoutMs: ctx.timeoutMs ?? 12_000,
      signal: ctx.signal,
    });
    if (!move.success) return move;
    return ok({ position: preferred }, Date.now() - started);
  }
  const found = await findBlock(ctx, names, 16);
  if (!found.success) return found;
  const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, found.data.position, {
    timeoutMs: ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (!move.success) return move;
  return ok({ position: found.data.position }, Date.now() - started);
}

function containerCounts(chest: { containerItems: () => Array<{ name: string; count: number }> }): Record<string, number> {
  const contents: Record<string, number> = {};
  for (const item of chest.containerItems()) {
    contents[item.name] = (contents[item.name] ?? 0) + item.count;
  }
  return contents;
}

export async function depositItem(
  ctx: SkillContext,
  itemName: string,
  count?: number,
  container?: ContainerTarget,
): Promise<ActionResult<{ deposited: number; item: string; citizenAfter: number; containerAfter: number; position: Vec3 }>> {
  const started = Date.now();
  const name = normalizeName(itemName);
  const want = count ?? availableUnreservedCount(ctx, name);
  if (want <= 0) {
    return fail("ITEM_NOT_FOUND", `No unreserved ${name} to deposit`, Date.now() - started, true);
  }
  const reserved = assertUnreserved(ctx, name, want);
  if (reserved) return { ...reserved, durationMs: Date.now() - started };
  const found = await resolveContainer(ctx, container);
  if (!found.success) return found;
  const block = ctx.bot.blockAt(
    new Vec3Class(Math.floor(found.data.position.x), Math.floor(found.data.position.y), Math.floor(found.data.position.z)),
  );
  if (!block) {
    return fail("CONTAINER_NOT_FOUND", "Container vanished", Date.now() - started, true);
  }
  const citizenBefore = countItem(ctx, name);
  try {
    const chest = await ctx.bot.openContainer(block);
    const containerBefore = containerCounts(chest)[name] ?? 0;
    const stack = ctx.bot.inventory.items().find((item) => item.name === name);
    if (!stack) {
      chest.close();
      return fail("ITEM_NOT_FOUND", `No ${name} in inventory`, Date.now() - started, true);
    }
    await chest.deposit(stack.type, null, Math.min(want, stack.count));
    const containerAfter = containerCounts(chest)[name] ?? 0;
    chest.close();
    const citizenAfter = await waitForCount(ctx, name, (value) => value < citizenBefore);
    const depositedCitizen = citizenBefore - citizenAfter;
    const depositedContainer = containerAfter - containerBefore;
    if (depositedCitizen <= 0 || depositedContainer <= 0) {
      return fail("DEPOSIT_FAILED", `Deposit of ${name} did not move items (citizen ${citizenBefore}->${citizenAfter}, chest ${containerBefore}->${containerAfter})`, Date.now() - started, true);
    }
    ctx.events?.emit(
      createEvent("ItemDeposited", { item: name, count: depositedCitizen, position: found.data.position }, ctx.citizenId),
    );
    return ok(
      {
        deposited: depositedCitizen,
        item: name,
        citizenAfter,
        containerAfter,
        position: found.data.position,
      },
      Date.now() - started,
    );
  } catch (error) {
    return fail("CONTAINER_BUSY", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
}

export async function withdrawItem(
  ctx: SkillContext,
  itemName: string,
  count = 1,
  container?: ContainerTarget,
): Promise<ActionResult<{ item: string; count: number; citizenAfter: number; containerAfter: number }>> {
  const started = Date.now();
  const name = normalizeName(itemName);
  if (!canReceive(ctx, name, count)) {
    return fail("INVENTORY_FULL", `Cannot withdraw ${count} ${name}; not enough capacity`, Date.now() - started, true);
  }
  const found = await resolveContainer(ctx, container);
  if (!found.success) return found;
  const block = ctx.bot.blockAt(
    new Vec3Class(Math.floor(found.data.position.x), Math.floor(found.data.position.y), Math.floor(found.data.position.z)),
  );
  if (!block) {
    return fail("CONTAINER_NOT_FOUND", "Container vanished", Date.now() - started, true);
  }
  const citizenBefore = countItem(ctx, name);
  try {
    const chest = await ctx.bot.openContainer(block);
    const containerBefore = containerCounts(chest)[name] ?? 0;
    const stack = chest.containerItems().find((item) => item.name === name);
    if (!stack) {
      chest.close();
      return fail("ITEM_NOT_FOUND", `Container has no ${name}`, Date.now() - started, true);
    }
    await chest.withdraw(stack.type, null, Math.min(count, stack.count));
    const containerAfter = containerCounts(chest)[name] ?? 0;
    chest.close();
    const citizenAfter = await waitForCount(ctx, name, (value) => value > citizenBefore);
    const gained = citizenAfter - citizenBefore;
    const removed = containerBefore - containerAfter;
    if (gained <= 0 || removed <= 0) {
      return fail("VERIFY_FAILED", `Withdraw of ${name} did not move items`, Date.now() - started, true);
    }
    ctx.events?.emit(createEvent("ItemWithdrawn", { item: name, count: gained }, ctx.citizenId));
    return ok({ item: name, count: gained, citizenAfter, containerAfter }, Date.now() - started);
  } catch (error) {
    return fail("WITHDRAW_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
}

export async function transferItemToCitizen(
  giver: SkillContext,
  receiver: SkillContext,
  itemName: string,
  count: number,
): Promise<
  ActionResult<{
    item: string;
    count: number;
    giverAfter: number;
    receiverAfter: number;
  }>
> {
  const started = Date.now();
  const name = normalizeName(itemName);
  const reservationId = `transfer:${giver.citizenId ?? "giver"}:${name}:${started}`;
  const reserved = assertUnreserved(giver, name, count);
  if (reserved) return { ...reserved, durationMs: Date.now() - started };
  if (!canReceive(receiver, name, count)) {
    return fail("RECIPIENT_FULL", `Recipient cannot receive ${count} ${name}`, Date.now() - started, true);
  }
  reserveItems(giver, reservationId, name, count, "TRANSFER");
  const giverPos = giver.body.position();
  const receiverPos = receiver.body.position();
  if (!giverPos || !receiverPos) {
    releaseReservation(giver, reservationId);
    return fail("NOT_CONNECTED", "Both bodies must be spawned for a transfer", Date.now() - started, true);
  }
  const meet = {
    x: (giverPos.x + receiverPos.x) / 2,
    y: (giverPos.y + receiverPos.y) / 2,
    z: (giverPos.z + receiverPos.z) / 2,
  };
  const movedGiver = await moveTo(giver, meet, 2.5);
  const movedReceiver = await moveTo(receiver, meet, 2.5);
  if (!movedGiver.success && !movedReceiver.success) {
    releaseReservation(giver, reservationId);
    return fail("TARGET_UNREACHABLE", "Could not bring both bodies into transfer range", Date.now() - started, true);
  }
  await lookAtPosition(giver, receiver.body.position() ?? meet);
  releaseReservation(giver, reservationId);
  const giverBefore = countItem(giver, name);
  const receiverBefore = countItem(receiver, name);
  const dropped = await dropItem(giver, name, count, "TRANSFER");
  if (!dropped.success) {
    return fail("TRANSFER_INCOMPLETE", dropped.error, Date.now() - started, true, {
      cause: "DROP_FAILED" satisfies TransferFailureCause,
      item: name,
    });
  }
  const picked = await pickupDroppedItem(receiver, name, 8);
  const giverAfter = countItem(giver, name);
  const receiverAfter = countItem(receiver, name);
  if (
    confirmTransfer({
      item: name,
      count,
      giverBefore,
      giverAfter,
      receiverBefore,
      receiverAfter,
    })
  ) {
    giver.events?.emit(
      createEvent(
        "ResourceTransferred",
        {
          item: name,
          count,
          from: giver.citizenId,
          to: receiver.citizenId,
          gift: false,
          physical: true,
        },
        giver.citizenId,
      ),
    );
    giver.events?.emit(
      createEvent(
        "ItemTransferCompleted",
        { item: name, count, giver: giver.citizenId, receiver: receiver.citizenId, gift: false },
        giver.citizenId,
      ),
    );
    return ok({ item: name, count, giverAfter, receiverAfter }, Date.now() - started);
  }
  const otherCollector = Boolean(
    findDroppedEntities(giver.bot, name, 12).length === 0 && receiverAfter === receiverBefore && giverAfter === giverBefore - count,
  );
  const cause = classifyIncompleteTransfer({
    giverLost: giverBefore - giverAfter,
    receiverGained: receiverAfter - receiverBefore,
    requested: count,
    recipientCouldReceive: canReceive(receiver, name, count),
    otherCollector,
    dropFailed: !dropped.success,
    pickupFailed: !picked.success,
    recipientMoved: Boolean(receiver.body.position() && giver.body.position() && distance3(receiver.body.position()!, giver.body.position()!) > 8),
  });
  return fail("TRANSFER_INCOMPLETE", `Physical transfer of ${count} ${name} did not complete (${cause})`, Date.now() - started, true, {
    cause,
    gift: false,
    giverBefore,
    giverAfter,
    receiverBefore,
    receiverAfter,
    pickupCode: picked.success ? undefined : picked.code,
  });
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function edibleItems(ctx: SkillContext): Array<{ name: string; count: number }> {
  const knowledge = minecraftKnowledge();
  return listInventory(ctx).filter((item) => knowledge.isFood(item.name));
}

export function toolsOwned(ctx: SkillContext): string[] {
  const knowledge = minecraftKnowledge();
  return listInventory(ctx)
    .filter((item) => knowledge.isTool(item.name))
    .map((item) => item.name);
}

export function buildingItems(ctx: SkillContext): Array<{ name: string; count: number }> {
  return listInventory(ctx).filter(
    (item) =>
      item.name.endsWith("_planks") ||
      item.name.endsWith("_log") ||
      item.name === "cobblestone" ||
      item.name === "dirt" ||
      item.name === "crafting_table" ||
      item.name.endsWith("_door"),
  );
}

export function findInventoryItem(ctx: SkillContext, name: string): { name: string; count: number } | undefined {
  const n = normalizeName(name);
  const count = countItem(ctx, n);
  return count > 0 ? { name: n, count } : undefined;
}

export { type DropPurpose };
