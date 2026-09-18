import { describe, expect, it } from "vitest";
import {
  availableUnreserved,
  classifyIncompleteTransfer,
  compactCarriedFacts,
  computeFreeCapacity,
  confirmDrop,
  confirmTransfer,
  countEmptyStorageSlots,
  storageSlotRange,
  type InventorySnapshot,
} from "@civ/shared";
import { ItemReservationBook } from "./inventory-reservations.js";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";

function slotsFrom(pairs: Array<{ slot: number; name: string; count: number; stackSize?: number }>) {
  const slots: Array<{ name?: string; count?: number; stackSize?: number } | null> = Array.from({ length: 46 }, () => null);
  for (const pair of pairs) slots[pair.slot] = pair;
  return slots;
}

describe("authoritative inventory model", () => {
  it("uses storage slots only and real stack sizes", () => {
    const range = storageSlotRange({ inventoryStart: 9, inventoryEnd: 44 });
    expect(range).toEqual({ start: 9, end: 44 });
    const slots = slotsFrom([
      { slot: 9, name: "oak_log", count: 60, stackSize: 64 },
      { slot: 10, name: "snowball", count: 16, stackSize: 16 },
    ]);
    expect(countEmptyStorageSlots({ slots, range })).toBe(34);
    expect(storageSlotRange({ inventoryStart: 9, inventoryEnd: 45, hotbarStart: 36 })).toEqual({ start: 9, end: 44 });
    expect(computeFreeCapacity({ slots, range, itemName: "oak_log", stackSize: 64 })).toBe(34 * 64 + 4);
    expect(computeFreeCapacity({ slots, range, itemName: "snowball", stackSize: 16 })).toBe(34 * 16);
    expect(computeFreeCapacity({ slots, range, itemName: "wooden_pickaxe", stackSize: 1 })).toBe(34);
  });

  it("does not count armor, crafting, or offhand as generic storage", () => {
    const range = storageSlotRange({ inventoryStart: 9, inventoryEnd: 44 });
    const slots = slotsFrom([
      { slot: 0, name: "oak_log", count: 1, stackSize: 64 },
      { slot: 5, name: "iron_helmet", count: 1, stackSize: 1 },
      { slot: 45, name: "shield", count: 1, stackSize: 1 },
    ]);
    expect(computeFreeCapacity({ slots, range, itemName: "oak_log", stackSize: 64 })).toBe(36 * 64);
  });

  it("verifies exact drop and transfer deltas", () => {
    expect(confirmDrop({ item: "oak_log", requested: 5, before: 64, after: 59 })).toBe(true);
    expect(confirmDrop({ item: "oak_log", requested: 5, before: 64, after: 60 })).toBe(false);
    expect(
      confirmTransfer({
        item: "oak_log",
        count: 8,
        giverBefore: 12,
        giverAfter: 4,
        receiverBefore: 0,
        receiverAfter: 8,
      }),
    ).toBe(true);
    expect(availableUnreserved(12, 8)).toBe(4);
  });

  it("classifies incomplete transfers without calling them gifts", () => {
    expect(
      classifyIncompleteTransfer({
        giverLost: 8,
        receiverGained: 0,
        requested: 8,
        recipientCouldReceive: true,
        otherCollector: true,
      }),
    ).toBe("OTHER_ENTITY_PICKED_UP");
    expect(
      classifyIncompleteTransfer({
        giverLost: 8,
        receiverGained: 0,
        requested: 8,
        recipientCouldReceive: false,
      }),
    ).toBe("RECIPIENT_FULL");
  });

  it("builds compact cognition facts from a snapshot, not raw slots", () => {
    const knowledge = minecraftKnowledge();
    const snapshot: InventorySnapshot = {
      stacks: [{ name: "oak_log", count: 12, slot: 9, stackSize: 64 }],
      counts: { oak_log: 12, cooked_beef: 5, wooden_pickaxe: 1 },
      heldItem: { name: "wooden_pickaxe", count: 1, slot: 36, stackSize: 1 },
      freeSlots: 9,
      equipment: {},
      reservations: [{ id: "r1", item: "oak_log", count: 8, purpose: "shelter" }],
    };
    const facts = compactCarriedFacts({
      snapshot,
      isFood: (name) => knowledge.isFood(name),
      isTool: (name) => knowledge.isTool(name),
    });
    expect(facts.lines).toContain("oak_log: 12");
    expect(facts.lines).toContain("freeSlots: 9");
    expect(facts.lines.some((line) => line.includes("reserved oak_log: 8"))).toBe(true);
    expect(facts.heldItem).toBe("wooden_pickaxe");
    expect(facts.foodCarried.some((item) => item.name === "cooked_beef")).toBe(true);
    expect(JSON.stringify(facts)).not.toMatch(/slot":/);
  });

  it("tracks reservations above physical counts", () => {
    const book = new ItemReservationBook();
    book.reserve({ reservationId: "shelter", item: "oak_log", count: 8, purpose: "shelter" });
    expect(book.reservedOf("oak_log")).toBe(8);
    expect(availableUnreserved(12, book.reservedOf("oak_log"))).toBe(4);
    expect(book.release("shelter")).toBe(true);
    expect(book.reservedOf("oak_log")).toBe(0);
  });
});
