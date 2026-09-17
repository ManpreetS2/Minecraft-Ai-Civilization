const ALIASES: Record<string, string> = {
  wooden_door: "oak_door",
  door: "oak_door",
  planks: "oak_planks",
  wood: "oak_log",
  log: "oak_log",
  logs: "oak_log",
  cobble: "cobblestone",
  pickaxe: "wooden_pickaxe",
  wooden_pick: "wooden_pickaxe",
  stone_pick: "stone_pickaxe",
  workbench: "crafting_table",
  craftingtable: "crafting_table",
  table: "crafting_table",
  steak: "cooked_beef",
};

export function normalizeItemName(name: string | undefined): string {
  if (!name) return "";
  let value = name.trim().toLowerCase().replace(/^minecraft:/, "").replaceAll(" ", "_").replaceAll("-", "_");
  value = value.replace(/_+/g, "_");
  return ALIASES[value] ?? value;
}

export function normalizeBlockName(name: string | undefined): string {
  return normalizeItemName(name);
}

export function friendlyName(name: string | undefined): string {
  const normalized = normalizeItemName(name);
  if (!normalized) return "that item";
  return normalized.replaceAll("_", " ");
}

export function looksLikeItemName(name: string | undefined): boolean {
  const normalized = normalizeItemName(name);
  return Boolean(normalized) && /^[a-z0-9_]+$/.test(normalized);
}
