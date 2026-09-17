import { DEFAULT_CITIZENS } from "./types.js";

const TASK_LABELS: Record<string, string> = {
  gather_wood: "gathering wood",
  gather_food: "finding food",
  mine_stone: "mining stone",
  craft_tools: "crafting tools",
  obtain_item: "obtaining an item",
  build_shelter: "building the shelter",
  seek_shelter: "finding shelter",
  seek_safety: "getting to safety",
  flee_danger: "fleeing danger",
  acquire_food: "looking for food",
  eat: "eating",
  deposit: "storing items",
  deposit_items: "storing items",
  use_storage: "using shared storage",
  withdraw_items: "taking items from storage",
  transfer_item: "giving an item",
  return_to_settlement: "returning to the settlement",
  contribute_to_project: "helping with the settlement project",
  assist_citizen: "helping another citizen",
  help_citizen: "helping someone",
  rest: "resting",
  explore: "exploring",
  defend: "defending themselves",
  observe: "looking around",
  stop_current_task: "stopping current work",
  resource_procurement: "gathering supplies",
  moveTo: "moving",
};

const GOAL_LABELS: Record<string, string> = {
  gather_wood: "gather wood",
  gather_food: "gather food",
  mine_stone: "mine stone",
  craft_tools: "craft tools",
  obtain_item: "obtain an item",
  build_shelter: "build the shelter",
  seek_shelter: "find shelter",
  seek_safety: "get to safety",
  help_citizen: "help another citizen",
  assist_citizen: "help another citizen",
  deposit: "store items",
  deposit_items: "store items",
  use_storage: "use shared storage",
  withdraw_items: "take items from storage",
  transfer_item: "give an item",
  return_to_settlement: "return to the settlement",
  contribute_to_project: "help with the settlement project",
  rest: "rest",
  explore: "explore",
  defend: "defend",
  survive: "survive",
  bootstrap: "bootstrap tools",
  settlement: "help the settlement",
  idle: "idle",
  stop_current_task: "stop current work",
};

const FAILED_TASK_LABELS: Record<string, string> = {
  gather_wood: "gather wood",
  gather_food: "find food",
  mine_stone: "mine stone",
  craft_tools: "craft tools",
  build_shelter: "build the shelter",
  seek_shelter: "find shelter",
  seek_safety: "get to safety",
  flee_danger: "get to safety",
  acquire_food: "find food",
  eat: "eat",
  deposit: "store items",
  use_storage: "use shared storage",
  contribute_to_project: "help with the shelter",
  observe: "look around",
  defend: "defend themselves",
};

const NEED_LABELS: Record<string, string> = {
  NEED_FOOD: "Food",
  NEED_WOOD: "Wood",
  NEED_STONE: "Stone",
  NEED_TOOLS: "Stone tools",
  NEED_BEDS: "Beds",
  NEED_HOUSING: "Shelter",
  NEED_STORAGE: "Storage",
};

const ITEM_ONE: Record<string, string> = {
  oak_door: "an oak door",
  oak_log: "oak log",
  birch_log: "birch log",
  spruce_log: "spruce log",
  wooden_pickaxe: "a wooden pickaxe",
  wooden_axe: "a wooden axe",
  wooden_sword: "a wooden sword",
  stick: "stick",
  oak_planks: "oak plank",
  cobblestone: "cobblestone",
  bread: "bread",
  crafting_table: "a crafting table",
  chest: "a chest",
};

const ITEM_MANY: Record<string, string> = {
  oak_log: "oak logs",
  birch_log: "birch logs",
  spruce_log: "spruce logs",
  wooden_pickaxe: "wooden pickaxes",
  wooden_axe: "wooden axes",
  wooden_sword: "wooden swords",
  stick: "sticks",
  oak_planks: "oak planks",
  cobblestone: "cobblestone",
  bread: "bread",
  crafting_table: "crafting tables",
  chest: "chests",
};

export function citizenDisplayName(idOrName?: string, names: Record<string, string> = {}): string {
  if (!idOrName) return "a citizen";
  if (names[idOrName]) return names[idOrName];
  const seeded = DEFAULT_CITIZENS.find((c) => c.id === idOrName || c.name === idOrName);
  if (seeded) return seeded.name;
  if (idOrName.startsWith("citizen_")) {
    const rest = idOrName.slice("citizen_".length);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return idOrName;
}

export function friendlyLabel(raw?: unknown, fallback = "something"): string {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  return raw.trim().replaceAll("_", " ");
}

export function friendlyTask(task?: unknown): string {
  if (typeof task !== "string" || !task) return "their work";
  return TASK_LABELS[task] ?? friendlyLabel(task, "their work");
}

export function failedTask(task?: unknown): string {
  if (typeof task !== "string" || !task) return "finish that work";
  return FAILED_TASK_LABELS[task] ?? friendlyLabel(task, "finish that work");
}

export function friendlyGoal(goal?: unknown): string {
  if (typeof goal !== "string" || !goal) return "an unknown goal";
  return GOAL_LABELS[goal] ?? friendlyLabel(goal, "an unknown goal");
}

export function friendlyNeed(need?: unknown): string {
  if (Array.isArray(need)) return need.map((item) => friendlyNeed(item)).join(", ");
  if (typeof need !== "string" || !need) return "supplies";
  return NEED_LABELS[need] ?? titleCase(friendlyLabel(need, "supplies"));
}

export function friendlyItem(item?: unknown, count = 1): string {
  if (typeof item !== "string" || !item) return count === 1 ? "an item" : "items";
  if (count === 1) return ITEM_ONE[item] ?? friendlyLabel(item, "item");
  return ITEM_MANY[item] ?? `${friendlyLabel(item, "item")}s`;
}

export function formatLocalTime(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
  });
}

export function formatWorldClock(
  timestamp: string,
  world?: { gameTime?: number; isNight?: boolean },
): string {
  const time = formatLocalTime(timestamp);
  if (world?.gameTime == null || !Number.isFinite(world.gameTime)) return time;
  const day = Math.floor(world.gameTime / 24000) + 1;
  const phase = world.isNight ? "Night" : "Day";
  return `${time} · Minecraft Day ${day} — ${phase}`;
}

export function relationshipPercent(value: number): number {
  return Math.round(Math.max(-1, Math.min(1, value)) * 100);
}

export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function sentenceFromType(type: string): string {
  const spaced = type.replace(/([A-Z])/g, " $1").trim();
  if (!spaced) return "Something happened";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
