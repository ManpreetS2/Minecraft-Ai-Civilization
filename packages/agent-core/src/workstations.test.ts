import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillContext } from "@civ/skills";
import { persistCitizenHomeClaim } from "./available-homes.js";
import { CivilizationStore } from "./store.js";
import { WORLD_LAB_COMMUNAL_CHEST } from "./test-fixtures.js";
import { knownChest, rememberWorkstation, usableSettlementChest } from "./workstations.js";

function tempStore(): CivilizationStore {
  return new CivilizationStore(join(mkdtempSync(join(tmpdir(), "civ-ws-")), "test.sqlite"));
}

function chestCtx(chests: Array<{ x: number; y: number; z: number }>): SkillContext {
  return {
    bot: {
      blockAt(pos: { x: number; y: number; z: number }) {
        const hit = chests.some(
          (chest) =>
            Math.floor(chest.x) === Math.floor(pos.x) &&
            Math.floor(chest.y) === Math.floor(pos.y) &&
            Math.floor(chest.z) === Math.floor(pos.z),
        );
        return hit ? { name: "chest" } : { name: "air" };
      },
    },
  } as unknown as SkillContext;
}

const pondKai = { x: -1042, y: 63, z: 980 };
const pondAtlas = { x: -1042, y: 63, z: 982 };
const mineChest = { x: -954, y: 58, z: 944 };
const h1Chest = { x: -1096, y: 69, z: 729 };

describe("settlement storage permission", () => {
  it("does not adopt pond or mine test-fixture chests as communal storage", () => {
    const store = tempStore();
    rememberWorkstation(store, "chest", pondKai);
    rememberWorkstation(store, "chest", pondAtlas);
    rememberWorkstation(store, "chest", mineChest);
    expect(store.getSettlement().storage).toBeUndefined();
    expect(usableSettlementChest(store, pondKai)).toBe(false);
    const ctx = chestCtx([pondKai, pondAtlas, mineChest]);
    expect(knownChest(ctx, store)).toBeUndefined();
    store.close();
  });

  it("does not treat an unclaimed house chest as settlement.storage", () => {
    const store = tempStore();
    rememberWorkstation(store, "chest", h1Chest);
    expect(store.getSettlement().storage).toBeUndefined();
    expect(knownChest(chestCtx([h1Chest]), store)).toBeUndefined();
    store.close();
  });

  it("may remember the tannery as communal storage", () => {
    const store = tempStore();
    rememberWorkstation(store, "chest", WORLD_LAB_COMMUNAL_CHEST);
    expect(store.getSettlement().storage).toEqual(WORLD_LAB_COMMUNAL_CHEST);
    expect(knownChest(chestCtx([WORLD_LAB_COMMUNAL_CHEST]), store)).toEqual(WORLD_LAB_COMMUNAL_CHEST);
    store.close();
  });

  it("refuses a fixture even if settlement.storage already points at it", () => {
    const store = tempStore();
    const settlement = store.getSettlement();
    settlement.storage = pondKai;
    store.saveSettlement(settlement);
    expect(knownChest(chestCtx([pondKai]), store)).toBeUndefined();
    expect(store.getSettlement().storage).toEqual(pondKai);
    store.close();
  });

  it("still skips a house chest after a citizen claims it", () => {
    const store = tempStore();
    expect(persistCitizenHomeClaim(store, "citizen_kai", "home_h1").success).toBe(true);
    rememberWorkstation(store, "chest", h1Chest);
    expect(store.getSettlement().storage).toBeUndefined();
    expect(knownChest(chestCtx([h1Chest]), store)).toBeUndefined();
    store.close();
  });
});
