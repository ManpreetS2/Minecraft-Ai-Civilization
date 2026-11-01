import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillContext } from "@civ/skills";
import { CivilizationStore } from "./store.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
import { knownChest, knownCraftingTable, rememberWorkstation, forgetWorkstation } from "./workstations.js";
const stores: CivilizationStore[] = [];
const dirs: string[] = [];
afterEach(() => { for (const s of stores.splice(0)) if (s.isOpen()) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const pos = { x: 12, y: 64, z: 8 };
const audit = { actor: "orchestrator-config" as const, reason: "disposable workstation privacy fixture" };
function setup(path = ":memory:") {
  const s = new CivilizationStore(path); stores.push(s);
  s.upsertCommunity("north", "North", audit); s.upsertCommunity("south", "South", audit);
  s.addCommunityMember("north", "citizen_atlas", audit); s.addCommunityMember("north", "citizen_maya", audit); s.addCommunityMember("south", "citizen_theo", audit);
  const state = s.getSettlement(); state.storage = pos; state.workstations = { craftingTables: [pos], chests: [pos], furnaces: [] }; s.saveSettlement(state);
  return s;
}
function context(id?: string, name = "crafting_table", dimension: string | null = "overworld") {
  const blockAt = vi.fn(() => ({ name }));
  return { ctx: { citizenId: id, bot: { game: { dimension: dimension ?? undefined }, blockAt } } as unknown as SkillContext, blockAt };
}
describe("community workstation metadata is perspective-limited", () => {
  it.each(["citizen_atlas", "citizen_maya", "citizen_theo", undefined])("does not replay unowned legacy workstation metadata to %s", (id) => {
    const s = setup(); const a = context(id); const b = context(id, "chest");
    expect(knownCraftingTable(a.ctx, s)).toBeUndefined(); expect(knownChest(b.ctx, s)).toBeUndefined();
    expect(a.blockAt).not.toHaveBeenCalled(); expect(b.blockAt).not.toHaveBeenCalled();
    expect(s.getSettlement().workstations?.craftingTables).toEqual([pos]);
  });
  it("keeps an owned observed workstation usable without broadcasting its coordinates to teammates or rivals", () => {
    const s = setup(); const owner = communityPhysicalState(s).forCitizen("citizen_atlas");
    expect(owner.registerAsset("crafting_table", "overworld", pos)).toBe(true);
    expect(knownCraftingTable(context("citizen_atlas").ctx, s)).toEqual(pos);
    expect(knownCraftingTable(context("citizen_maya").ctx, s)).toBeUndefined();
    expect(knownCraftingTable(context("citizen_theo").ctx, s)).toBeUndefined();
    expect(owner.grantAsset(physicalBlockKey("overworld", pos), "citizen_maya")).toBe(true);
    expect(knownCraftingTable(context("citizen_maya").ctx, s)).toEqual(pos);
    owner.revokeAsset(physicalBlockKey("overworld", pos), "citizen_maya");
    expect(knownCraftingTable(context("citizen_maya").ctx, s)).toBeUndefined();
  });
  it("checks the actual block and current dimension before returning private metadata", () => {
    const s = setup(); const owner = communityPhysicalState(s).forCitizen("citizen_atlas");
    owner.registerAsset("crafting_table", "overworld", pos);
    expect(knownCraftingTable(context("citizen_atlas", "air").ctx, s)).toBeUndefined();
    expect(knownCraftingTable(context("citizen_atlas", "crafting_table", "the_nether").ctx, s)).toBeUndefined();
    expect(knownCraftingTable(context("citizen_atlas", "crafting_table", null).ctx, s)).toBeUndefined();
    expect(owner.accessibleAssets()).toHaveLength(1); // A read is not an ownership deletion.
  });
  it("returns only personally owned or explicitly granted chests", () => {
    const s = setup(); const owner = communityPhysicalState(s).forCitizen("citizen_atlas");
    owner.registerAsset("chest", "overworld", pos);
    expect(knownChest(context("citizen_atlas", "chest").ctx, s)).toEqual(pos);
    expect(knownChest(context("citizen_maya", "chest").ctx, s)).toBeUndefined();
    expect(knownChest(context("citizen_theo", "chest").ctx, s)).toBeUndefined();
  });
  it("rejects actor-free legacy cache writes/deletes and preserves original global rows", () => {
    const s = setup(); const before = s.getSettlement();
    expect(() => rememberWorkstation(s, "chest", { x: 99, y: 64, z: 99 })).toThrow(/community|identity|legacy/i);
    expect(() => forgetWorkstation(s, "chest", pos)).toThrow(/community|identity|legacy/i);
    expect(s.getSettlement()).toEqual(before);
  });
  it("preserves private ownership, explicit grant and revocation across native SQLite restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "t3-workstation-privacy-")); dirs.push(dir);
    const path = join(dir, "offline.sqlite");
    const first = setup(path); const before = first.getSettlement();
    const owner = communityPhysicalState(first).forCitizen("citizen_atlas");
    owner.registerAsset("crafting_table", "overworld", pos);
    owner.grantAsset(physicalBlockKey("overworld", pos), "citizen_maya"); first.close();
    const second = new CivilizationStore(path); stores.push(second);
    expect(knownCraftingTable(context("citizen_maya").ctx, second)).toEqual(pos);
    expect(knownCraftingTable(context("citizen_theo").ctx, second)).toBeUndefined();
    communityPhysicalState(second).forCitizen("citizen_atlas").revokeAsset(physicalBlockKey("overworld", pos), "citizen_maya"); second.close();
    const third = new CivilizationStore(path); stores.push(third);
    expect(knownCraftingTable(context("citizen_maya").ctx, third)).toBeUndefined();
    expect(knownCraftingTable(context("citizen_atlas").ctx, third)).toEqual(pos);
    expect(third.getSettlement()).toEqual(before);
  });
});
