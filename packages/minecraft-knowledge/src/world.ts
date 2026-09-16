export type WorldFeature =
  | "crafting_table"
  | "furnace"
  | "chest"
  | "bed"
  | "door"
  | "fence"
  | "ladder"
  | "water"
  | "farmland"
  | "crop"
  | "other";

export function classifyBlockUse(blockName: string): WorldFeature {
  if (blockName === "crafting_table") return "crafting_table";
  if (blockName === "furnace" || blockName === "blast_furnace" || blockName === "smoker") return "furnace";
  if (blockName === "chest" || blockName === "barrel" || blockName === "trapped_chest") return "chest";
  if (blockName.endsWith("_bed")) return "bed";
  if (blockName.endsWith("_door")) return "door";
  if (blockName.includes("fence") || blockName === "cobblestone_wall") return "fence";
  if (blockName === "ladder" || blockName.includes("vine")) return "ladder";
  if (blockName === "water") return "water";
  if (blockName === "farmland") return "farmland";
  if (["wheat", "carrots", "potatoes", "beetroots", "sweet_berry_bush"].includes(blockName)) return "crop";
  return "other";
}

export const WORLD_CONSTRAINTS = [
  "Blocks occupy space; a citizen cannot walk through solid blocks.",
  "Doors can open and close; closed doors block that cell.",
  "Fences and walls constrain movement without filling the full block volume.",
  "Ladders and vines may be climbable.",
  "Water changes traversal speed and can drown a citizen.",
  "A crafting table is required for 3x3 recipes.",
  "A furnace enables smelting, not crafting.",
  "A chest stores physical items; inventory counters are not a substitute.",
  "Beds can be used at night and during thunderstorms when reachable and unobstructed.",
  "Farmland and crops have growth stages; immature crops yield less.",
  "Dropped items exist in the world and can despawn if left too long.",
] as const;
