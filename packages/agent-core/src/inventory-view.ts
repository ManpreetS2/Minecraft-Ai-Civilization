import { FOOD_ITEM_NAMES, type InventoryItem } from "@civ/shared";
import { countLogs, countPlanks, type IngredientBag } from "./recipes.js";
import type { ReservationBook } from "./claims.js";

export type SettlementInventoryView = {
  logs: number;
  planks: number;
  sticks: number;
  cobblestone: number;
  food: number;
  coal: number;
  tools: number;
  reserved: Record<string, number>;
  availablePlanks: number;
  availableLogs: number;
  availableFood: number;
};

export function bagFromInventories(inventories: InventoryItem[][]): IngredientBag {
  const bag: IngredientBag = {};
  for (const list of inventories) {
    for (const item of list) {
      bag[item.name] = (bag[item.name] ?? 0) + item.count;
    }
  }
  return bag;
}

export function deriveSettlementInventory(
  citizenInventories: InventoryItem[][],
  storageContents: IngredientBag | undefined,
  reservations: ReservationBook,
): SettlementInventoryView {
  const physical = bagFromInventories([...(storageContents ? [objectToItems(storageContents)] : []), ...citizenInventories]);
  const reserved: Record<string, number> = {};
  for (const hold of reservations.list()) {
    reserved[hold.item] = (reserved[hold.item] ?? 0) + hold.quantity;
  }
  const logs = countLogs(physical);
  const planks = countPlanks(physical);
  const food = Object.entries(physical)
    .filter(([name]) => FOOD_ITEM_NAMES.has(name))
    .reduce((sum, [, count]) => sum + count, 0);
  return {
    logs,
    planks,
    sticks: physical.stick ?? 0,
    cobblestone: (physical.cobblestone ?? 0) + (physical.stone ?? 0),
    food,
    coal: (physical.coal ?? 0) + (physical.charcoal ?? 0),
    tools: Object.entries(physical)
      .filter(([name]) => name.includes("pickaxe") || name.includes("_axe"))
      .reduce((sum, [, count]) => sum + count, 0),
    reserved,
    availablePlanks: Math.max(0, planks - (reserved.any_planks ?? 0) - (reserved.oak_planks ?? 0)),
    availableLogs: Math.max(0, logs - (reserved.any_log ?? 0) - (reserved.oak_log ?? 0)),
    availableFood: Math.max(0, food - (reserved.food ?? 0)),
  };
}

function objectToItems(bag: IngredientBag): InventoryItem[] {
  return Object.entries(bag).map(([name, count]) => ({ name, count }));
}

export function containerDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): { deposited: Record<string, number>; withdrawn: Record<string, number> } {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const deposited: Record<string, number> = {};
  const withdrawn: Record<string, number> = {};
  for (const name of names) {
    const diff = (after[name] ?? 0) - (before[name] ?? 0);
    if (diff > 0) deposited[name] = diff;
    if (diff < 0) withdrawn[name] = -diff;
  }
  return { deposited, withdrawn };
}

