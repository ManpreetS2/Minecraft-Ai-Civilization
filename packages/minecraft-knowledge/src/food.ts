import type { McData, McFood } from "./data.js";

export type FoodInfo = {
  name: string;
  foodPoints: number;
  saturation: number;
};

const FALLBACK_FOOD: Record<string, FoodInfo> = {
  apple: { name: "apple", foodPoints: 4, saturation: 2.4 },
  bread: { name: "bread", foodPoints: 5, saturation: 6 },
  cooked_beef: { name: "cooked_beef", foodPoints: 8, saturation: 12.8 },
  cooked_porkchop: { name: "cooked_porkchop", foodPoints: 8, saturation: 12.8 },
  cooked_chicken: { name: "cooked_chicken", foodPoints: 6, saturation: 7.2 },
  carrot: { name: "carrot", foodPoints: 3, saturation: 3.6 },
  potato: { name: "potato", foodPoints: 1, saturation: 0.6 },
  baked_potato: { name: "baked_potato", foodPoints: 5, saturation: 6 },
  sweet_berries: { name: "sweet_berries", foodPoints: 2, saturation: 0.4 },
  melon_slice: { name: "melon_slice", foodPoints: 2, saturation: 1.2 },
  beef: { name: "beef", foodPoints: 3, saturation: 1.8 },
  porkchop: { name: "porkchop", foodPoints: 3, saturation: 1.8 },
  chicken: { name: "chicken", foodPoints: 2, saturation: 1.2 },
  rotten_flesh: { name: "rotten_flesh", foodPoints: 4, saturation: 0.8 },
};

export function foodIndex(data: McData): Record<string, FoodInfo> {
  const index: Record<string, FoodInfo> = { ...FALLBACK_FOOD };
  const fromData = data.foodsByName ?? Object.fromEntries((data.foods ?? []).map((food) => [food.name, food]));
  for (const [name, food] of Object.entries(fromData)) {
    index[name] = toInfo(food);
  }
  return index;
}

function toInfo(food: McFood): FoodInfo {
  return { name: food.name, foodPoints: food.foodPoints, saturation: food.saturation };
}

export function isFood(item: string, index: Record<string, FoodInfo>): boolean {
  return Boolean(index[item]);
}

export function foodValue(item: string, index: Record<string, FoodInfo>): number | undefined {
  return index[item]?.foodPoints;
}

export function saturationValue(item: string, index: Record<string, FoodInfo>): number | undefined {
  return index[item]?.saturation;
}

export function canEatNow(args: { hunger?: number; item: string }, index: Record<string, FoodInfo>): boolean {
  if (!isFood(args.item, index)) return false;
  return (args.hunger ?? 20) < 20;
}

export function getFoodOptions(inventory: Array<{ name: string; count: number }>, index: Record<string, FoodInfo>): FoodInfo[] {
  const seen = new Set<string>();
  const options: FoodInfo[] = [];
  for (const item of inventory) {
    if (!index[item.name] || seen.has(item.name) || item.count <= 0) continue;
    seen.add(item.name);
    options.push(index[item.name]!);
  }
  return options.sort((a, b) => b.foodPoints - a.foodPoints);
}
