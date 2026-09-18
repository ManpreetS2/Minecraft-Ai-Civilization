import { FOOD_ITEM_NAMES } from "./types.js";

export type DropPurpose = "DISCARD" | "TRANSFER" | "EMERGENCY_SPACE" | "DEV_TEST";

export type TransferFailureCause =
  | "OTHER_ENTITY_PICKED_UP"
  | "ITEM_NOT_COLLECTED"
  | "RECIPIENT_FULL"
  | "RECIPIENT_MOVED"
  | "ITEM_DESPAWNED"
  | "DROP_FAILED"
  | "PICKUP_FAILED";

export type InventoryStackSnapshot = {
  name: string;
  count: number;
  slot: number;
  stackSize: number;
  durability?: number;
  maxDurability?: number;
  nbt?: unknown;
  components?: unknown;
};

export type EquipmentSnapshot = {
  head?: InventoryStackSnapshot;
  torso?: InventoryStackSnapshot;
  legs?: InventoryStackSnapshot;
  feet?: InventoryStackSnapshot;
  offHand?: InventoryStackSnapshot;
};

export type InventoryReservationView = {
  id: string;
  item: string;
  count: number;
  purpose: string;
  ownerId?: string;
};

export type InventorySnapshot = {
  stacks: InventoryStackSnapshot[];
  counts: Record<string, number>;
  heldItem?: InventoryStackSnapshot;
  quickBarSlot?: number;
  equipment: EquipmentSnapshot;
  freeSlots: number;
  reservations: InventoryReservationView[];
};

export type CompactCarriedFacts = {
  foodCarried: Array<{ name: string; count: number }>;
  toolsCarried: string[];
  importantResources: Array<{ name: string; count: number }>;
  inventoryLoad: number;
  freeSlots: number;
  freeCapacity: Record<string, number>;
  reservedResources: Array<{ item: string; count: number; purpose: string }>;
  heldItem?: string;
  lines: string[];
};

export type StorageSlotRange = {
  start: number;
  end: number;
};

/** Player main inventory + hotbar. Excludes armor, offhand, and crafting grid. */
export function storageSlotRange(inventory: { inventoryStart?: number; inventoryEnd?: number; hotbarStart?: number }): StorageSlotRange {
  const start = Math.max(9, typeof inventory.inventoryStart === "number" ? inventory.inventoryStart : 9);
  const hotbarStart = typeof inventory.hotbarStart === "number" ? inventory.hotbarStart : 36;
  const defaultEnd = hotbarStart + 8;
  const rawEnd = typeof inventory.inventoryEnd === "number" ? inventory.inventoryEnd : defaultEnd;
  const end = Math.min(rawEnd, defaultEnd, 44);
  return { start, end: Math.max(start, end) };
}

export function computeFreeCapacity(args: {
  slots: Array<{ name?: string; count?: number; stackSize?: number } | null | undefined>;
  range: StorageSlotRange;
  itemName: string;
  stackSize: number;
}): number {
  const size = Math.max(1, args.stackSize);
  let capacity = 0;
  for (let slot = args.range.start; slot <= args.range.end; slot += 1) {
    const item = args.slots[slot];
    if (!item || !item.name) {
      capacity += size;
      continue;
    }
    if (item.name !== args.itemName) continue;
    const max = Math.max(1, item.stackSize ?? size);
    capacity += Math.max(0, max - (item.count ?? 0));
  }
  return capacity;
}

export function countEmptyStorageSlots(args: {
  slots: Array<{ name?: string } | null | undefined>;
  range: StorageSlotRange;
}): number {
  let empty = 0;
  for (let slot = args.range.start; slot <= args.range.end; slot += 1) {
    if (!args.slots[slot]?.name) empty += 1;
  }
  return empty;
}

export function countsFromStacks(stacks: Array<{ name: string; count: number }>): Record<string, number> {
  const bag: Record<string, number> = {};
  for (const stack of stacks) {
    bag[stack.name] = (bag[stack.name] ?? 0) + stack.count;
  }
  return bag;
}

export function availableUnreserved(physical: number, reserved: number): number {
  return Math.max(0, physical - Math.max(0, reserved));
}

export function confirmDrop(args: {
  item: string;
  requested: number;
  before: number;
  after: number;
}): boolean {
  void args.item;
  if (args.requested <= 0) return false;
  return args.before - args.after === args.requested;
}

export function confirmTransfer(args: {
  item: string;
  count: number;
  giverBefore: number;
  giverAfter: number;
  receiverBefore: number;
  receiverAfter: number;
}): boolean {
  const given = args.giverBefore - args.giverAfter;
  const received = args.receiverAfter - args.receiverBefore;
  return given === args.count && received === args.count && given > 0 && received > 0;
}

export function classifyIncompleteTransfer(args: {
  giverLost: number;
  receiverGained: number;
  requested: number;
  recipientCouldReceive: boolean;
  otherCollector?: boolean;
  dropFailed?: boolean;
  pickupFailed?: boolean;
  recipientMoved?: boolean;
  despawned?: boolean;
}): TransferFailureCause {
  if (args.dropFailed || args.giverLost <= 0) return "DROP_FAILED";
  if (args.otherCollector) return "OTHER_ENTITY_PICKED_UP";
  if (!args.recipientCouldReceive) return "RECIPIENT_FULL";
  if (args.recipientMoved) return "RECIPIENT_MOVED";
  if (args.despawned) return "ITEM_DESPAWNED";
  if (args.pickupFailed || args.receiverGained <= 0) return "PICKUP_FAILED";
  if (args.receiverGained < args.requested) return "ITEM_NOT_COLLECTED";
  return "ITEM_NOT_COLLECTED";
}

const IMPORTANT = new Set([
  "oak_log",
  "oak_planks",
  "cobblestone",
  "crafting_table",
  "chest",
  "stick",
  "bread",
  "cooked_beef",
  "torch",
  "coal",
]);

export function compactCarriedFacts(args: {
  snapshot: InventorySnapshot;
  isFood: (name: string) => boolean;
  isTool: (name: string) => boolean;
  freeCapacity?: Record<string, number>;
}): CompactCarriedFacts {
  const counts = args.snapshot.counts;
  const foodCarried = Object.entries(counts)
    .filter(([name, count]) => count > 0 && (args.isFood(name) || FOOD_ITEM_NAMES.has(name)))
    .map(([name, count]) => ({ name, count }));
  const toolsCarried = Object.entries(counts)
    .filter(([name, count]) => count > 0 && args.isTool(name))
    .map(([name]) => name);
  const importantResources = Object.entries(counts)
    .filter(([name, count]) => count > 0 && (IMPORTANT.has(name) || name.endsWith("_log") || name.endsWith("_planks") || name.endsWith("_door")))
    .map(([name, count]) => ({ name, count }));
  const occupied = args.snapshot.stacks.length;
  const total = occupied + args.snapshot.freeSlots;
  const inventoryLoad = total <= 0 ? 1 : occupied / total;
  const reservedResources = args.snapshot.reservations.map((hold) => ({
    item: hold.item,
    count: hold.count,
    purpose: hold.purpose,
  }));
  const lines = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([name, count]) => `${name}: ${count}`);
  if (args.snapshot.heldItem) lines.push(`held: ${args.snapshot.heldItem.name}`);
  lines.push(`freeSlots: ${args.snapshot.freeSlots}`);
  if (reservedResources.length > 0) {
    for (const hold of reservedResources.slice(0, 6)) {
      lines.push(`reserved ${hold.item}: ${hold.count} for ${hold.purpose}`);
    }
  }
  return {
    foodCarried,
    toolsCarried,
    importantResources,
    inventoryLoad,
    freeSlots: args.snapshot.freeSlots,
    freeCapacity: args.freeCapacity ?? {},
    reservedResources,
    heldItem: args.snapshot.heldItem?.name,
    lines,
  };
}
