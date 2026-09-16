import type { Vec3 } from "@civ/shared";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "@civ/skills";
import type { CivilizationStore } from "./store.js";

export type WorkstationKind = "crafting_table" | "chest" | "furnace";

export type KnownWorkstations = {
  craftingTables: Vec3[];
  chests: Vec3[];
  furnaces: Vec3[];
};

export function emptyWorkstations(): KnownWorkstations {
  return { craftingTables: [], chests: [], furnaces: [] };
}

export function blockNameAt(ctx: SkillContext, pos: Vec3): string | undefined {
  return ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)))?.name;
}

export function verifyWorkstation(ctx: SkillContext, pos: Vec3, kind: WorkstationKind): boolean {
  const name = blockNameAt(ctx, pos);
  if (!name) return false;
  if (kind === "chest") return name === "chest" || name === "trapped_chest" || name === "barrel";
  return name === kind;
}

export function rememberWorkstation(
  store: CivilizationStore,
  kind: WorkstationKind,
  pos: Vec3,
): KnownWorkstations {
  const settlement = store.getSettlement();
  const current = settlement.workstations ?? emptyWorkstations();
  const list =
    kind === "crafting_table" ? current.craftingTables : kind === "chest" ? current.chests : current.furnaces;
  if (!list.some((entry) => sameBlock(entry, pos))) {
    list.push({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  }
  settlement.workstations = current;
  if (kind === "chest" && !settlement.storage) {
    settlement.storage = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
  }
  store.saveSettlement(settlement);
  return current;
}

export function forgetWorkstation(
  store: CivilizationStore,
  kind: WorkstationKind,
  pos: Vec3,
): void {
  const settlement = store.getSettlement();
  const current = settlement.workstations ?? emptyWorkstations();
  const filter = (entry: Vec3) => !sameBlock(entry, pos);
  if (kind === "crafting_table") current.craftingTables = current.craftingTables.filter(filter);
  if (kind === "chest") current.chests = current.chests.filter(filter);
  if (kind === "furnace") current.furnaces = current.furnaces.filter(filter);
  settlement.workstations = current;
  if (kind === "chest" && settlement.storage && sameBlock(settlement.storage, pos)) {
    settlement.storage = undefined;
    settlement.storageContents = {};
  }
  store.saveSettlement(settlement);
}

export function knownCraftingTable(ctx: SkillContext, store: CivilizationStore): Vec3 | undefined {
  const settlement = store.getSettlement();
  const known = [...(settlement.workstations?.craftingTables ?? [])];
  for (const pos of known) {
    if (verifyWorkstation(ctx, pos, "crafting_table")) return pos;
    forgetWorkstation(store, "crafting_table", pos);
  }
  return undefined;
}

export function knownChest(ctx: SkillContext, store: CivilizationStore): Vec3 | undefined {
  const settlement = store.getSettlement();
  if (settlement.storage && verifyWorkstation(ctx, settlement.storage, "chest")) {
    return settlement.storage;
  }
  if (settlement.storage) {
    forgetWorkstation(store, "chest", settlement.storage);
  }
  for (const pos of settlement.workstations?.chests ?? []) {
    if (verifyWorkstation(ctx, pos, "chest")) return pos;
    forgetWorkstation(store, "chest", pos);
  }
  return undefined;
}

export function sameBlock(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}
