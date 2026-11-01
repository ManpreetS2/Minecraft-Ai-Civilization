import { minecraftKnowledge } from "@civ/minecraft-knowledge";

/**
 * Block name -> inventory item(s) that prove possession. Breaking `coal_ore` yields `coal`,
 * `stone` yields `cobblestone`, etc. Everything else (logs, cobblestone, wheat) is the item itself.
 * Shared by collectResource (possession proof) and canFitDrop (room check) so they cannot disagree.
 */
export const BLOCK_DROP_ITEMS: Readonly<Record<string, readonly string[]>> = {
  stone: ["cobblestone"],
  deepslate: ["cobbled_deepslate"],
  coal_ore: ["coal"],
  deepslate_coal_ore: ["coal"],
  iron_ore: ["raw_iron"],
  deepslate_iron_ore: ["raw_iron"],
  copper_ore: ["raw_copper"],
  deepslate_copper_ore: ["raw_copper"],
  gold_ore: ["raw_gold"],
  deepslate_gold_ore: ["raw_gold"],
  diamond_ore: ["diamond"],
  deepslate_diamond_ore: ["diamond"],
  emerald_ore: ["emerald"],
  deepslate_emerald_ore: ["emerald"],
  lapis_ore: ["lapis_lazuli"],
  deepslate_lapis_ore: ["lapis_lazuli"],
  redstone_ore: ["redstone"],
  deepslate_redstone_ore: ["redstone"],
  nether_quartz_ore: ["quartz"],
  nether_gold_ore: ["gold_nugget"],
  grass_block: ["dirt"],
  gravel: ["gravel", "flint"],
};

/** Drops for one block name; unmapped ores get a conservative derived fallback (base item, raw_ item). */
export function dropItemsForBlock(name: string): string[] {
  const mapped = BLOCK_DROP_ITEMS[name];
  if (mapped) return [...mapped];
  if (name.endsWith("_ore")) {
    const base = name.replace(/^deepslate_/, "").replace(/_ore$/, "");
    return [base, `raw_${base}`];
  }
  return [];
}

export function expectedDropItems(names: string[]): Set<string> {
  const knowledge = minecraftKnowledge();
  const out = new Set<string>();
  for (const name of names) {
    const normalized = knowledge.normalizeItemName(name) || name;
    out.add(normalized);
    for (const drop of dropItemsForBlock(normalized)) out.add(drop);
    if (normalized !== name) for (const drop of dropItemsForBlock(name)) out.add(drop);
  }
  return out;
}
