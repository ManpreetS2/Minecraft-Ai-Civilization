import type { Vec3 } from "@civ/shared";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "@civ/skills";
import { isCatalogPersonalChest } from "./available-homes.js";
import type { CivilizationStore } from "./store.js";
import { isTestFixtureChest } from "./test-fixtures.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";

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
  if (store.hasCommunities()) throw new Error("Community workstation writes require an authenticated owner; legacy global cache write refused");
  const settlement = store.getSettlement();
  const current = settlement.workstations ?? emptyWorkstations();
  const list =
    kind === "crafting_table" ? current.craftingTables : kind === "chest" ? current.chests : current.furnaces;
  if (!list.some((entry) => sameBlock(entry, pos))) {
    list.push({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  }
  settlement.workstations = current;
  if (kind === "chest" && !settlement.storage && mayBecomeSettlementStorage(store, pos)) {
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
  if (store.hasCommunities()) throw new Error("Community workstation removal requires an authenticated owner; legacy global cache delete refused");
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
  if (store.hasCommunities()) return scopedKnownWorkstation(ctx, store, "crafting_table");
  const settlement = store.getSettlement();
  const known = [...(settlement.workstations?.craftingTables ?? [])];
  for (const pos of known) {
    if (verifyWorkstation(ctx, pos, "crafting_table")) return pos;
    forgetWorkstation(store, "crafting_table", pos);
  }
  return undefined;
}

export function knownChest(ctx: SkillContext, store: CivilizationStore): Vec3 | undefined {
  if (store.hasCommunities()) return scopedKnownWorkstation(ctx, store, "chest");
  const settlement = store.getSettlement();
  if (settlement.storage && usableSettlementChest(store, settlement.storage) && verifyWorkstation(ctx, settlement.storage, "chest")) {
    return settlement.storage;
  }
  if (settlement.storage && !verifyWorkstation(ctx, settlement.storage, "chest") && !isTestFixtureChest(settlement.storage)) {
    forgetWorkstation(store, "chest", settlement.storage);
  }
  for (const pos of settlement.workstations?.chests ?? []) {
    if (!usableSettlementChest(store, pos)) continue;
    if (verifyWorkstation(ctx, pos, "chest")) return pos;
    forgetWorkstation(store, "chest", pos);
  }
  return undefined;
}

/** Ownership/grants authorize metadata; checking a remote block alone does not prove the citizen learned its location. */
function scopedKnownWorkstation(ctx: SkillContext, store: CivilizationStore, kind: WorkstationKind): Vec3 | undefined {
  const citizenId = ctx.citizenId;
  const rawDimension = ctx.bot.game?.dimension;
  if (!citizenId || !store.getCitizen(citizenId) || !store.getCommunityDirectory().communityOf(citizenId) || typeof rawDimension !== "string" || !rawDimension.trim()) return undefined;
  const dimension = rawDimension.replace(/^minecraft:/, "");
  const assets = communityPhysicalState(store).forCitizen(citizenId).accessibleAssets();
  for (const asset of assets) {
    if (asset.kind !== kind || asset.key !== physicalBlockKey(dimension, asset.position)) continue;
    if (kind === "chest" && !usableSettlementChest(store, asset.position)) continue;
    if (verifyWorkstation(ctx, asset.position, kind)) return asset.position;
  }
  // Missing blocks do not authorize a reader to delete someone else's ownership or original legacy rows.
  return undefined;
}

/** Pond/mine fixtures and unclaimed house chests are not communal settlement storage. */
export function usableSettlementChest(store: CivilizationStore, pos: Vec3): boolean {
  if (isTestFixtureChest(pos)) return false;
  if (store.isClaimedPersonalChest(pos)) return false;
  if (isCatalogPersonalChest(pos)) return false;
  return true;
}

function mayBecomeSettlementStorage(store: CivilizationStore, pos: Vec3): boolean {
  return usableSettlementChest(store, pos);
}

export function sameBlock(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}
