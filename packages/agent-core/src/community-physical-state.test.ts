import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scopeSettlementForCitizen } from "./community-comms.js";
import { planCitizen } from "./planner.js";
import { CivilizationStore } from "./store.js";
import {
  CommunityPhysicalState,
  migratePhysicalState,
  physicalBlockKey,
  physicalMigrationReport,
} from "./community-physical-state.js";

const stores: CivilizationStore[] = [];
const dirs: string[] = [];
const audit = { actor: "orchestrator-config" as const, reason: "disposable offline experiment" };
const pos = { x: 10, y: 64, z: 12 };
function open(path = ":memory:") {
  const store = new CivilizationStore(path);
  stores.push(store);
  return store;
}
function file() {
  const dir = mkdtempSync(join(tmpdir(), "t3-physical-"));
  dirs.push(dir);
  return join(dir, "synthetic.sqlite");
}
function setup(path = ":memory:") {
  const s = open(path);
  s.upsertCommunity("north", "North", audit);
  s.upsertCommunity("south", "South", audit);
  s.addCommunityMember("north", "citizen_atlas", audit);
  s.addCommunityMember("north", "citizen_maya", audit);
  s.addCommunityMember("south", "citizen_theo", audit);
  s.addCommunityMember("south", "citizen_ava", audit);
  const physical = new CommunityPhysicalState(s);
  return {
    s,
    physical,
    a: physical.forCitizen("citizen_atlas"),
    b: physical.forCitizen("citizen_theo"),
    teammate: physical.forCitizen("citizen_maya"),
  };
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("community physical state: supporting boundary, not live executor acceptance", () => {
  it("starts two communities empty and leaves ambiguous legacy state unassigned", () => {
    const s = open();
    const legacy = s.getSettlement();
    legacy.wood = 200;
    legacy.storageContents = { diamond: 10 };
    s.saveSettlement(legacy);
    const preserved = s.getSettlement();
    const report = physicalMigrationReport(s.db);
    expect(report.legacyDisposition).toBe("preserve-unassigned");
    expect(report.legacySettlementIds).toEqual(["settlement_first"]);
    const { a, b } = (() => {
      s.upsertCommunity("north", "North", audit);
      s.upsertCommunity("south", "South", audit);
      s.addCommunityMember("north", "citizen_atlas", audit);
      s.addCommunityMember("south", "citizen_theo", audit);
      const p = new CommunityPhysicalState(s);
      return { a: p.forCitizen("citizen_atlas"), b: p.forCitizen("citizen_theo") };
    })();
    expect(a.read().state.storageContents).toEqual({});
    expect(b.read().state.wood).toBe(0);
    expect(s.getSettlement()).toEqual(preserved);
  });

  it("shares only the caller's community observations and project state", () => {
    const { a, b, teammate } = setup();
    const snap = a.read();
    snap.state.storageContents = { oak_log: 3 };
    snap.state.projectJson = '{"privatePlan":"north shelter"}';
    expect(a.save(snap)).toBe(true);
    expect(teammate.read().state).toEqual(snap.state);
    expect(b.read().state.storageContents).toEqual({});
    expect(b.read().state.projectJson).toBeUndefined();
  });

  it("rejects stale updates instead of losing another body's observation", () => {
    const { a, teammate } = setup();
    const stale = teammate.read();
    const first = a.read();
    first.state.wood = 4;
    expect(a.save(first)).toBe(true);
    stale.state.wood = 7;
    expect(teammate.save(stale)).toBe(false);
    expect(a.read()).toMatchObject({ revision: 1, state: { wood: 4 } });
  });

  it("refuses a foreign snapshot and negative or fractional physical counts", () => {
    const { a, b } = setup();
    expect(() => a.save(b.read())).toThrow(/foreign/);
    for (const count of [-1, 0.5, NaN, Infinity]) {
      const snap = a.read();
      snap.state.wood = count;
      expect(() => a.save(snap)).toThrow(/count/);
    }
  });

  it("rejects an invented nonzero initial revision transactionally", () => {
    const { a } = setup();
    const snap = a.read();
    snap.revision = 5;
    expect(() => a.save(snap)).toThrow(/revision/);
    expect(a.read().revision).toBe(0);
  });

  it("prevents phantom reservations and foreign releases", () => {
    const { a, b, teammate } = setup();
    expect(a.reserve("oak_log", 1)).toBeUndefined();
    const snap = a.read();
    snap.state.storageContents = { oak_log: 3 };
    a.save(snap);
    const hold = a.reserve("oak_log", 2)!;
    expect(hold).toBeTypeOf("string");
    expect(teammate.reserve("oak_log", 2)).toBeUndefined();
    expect(b.reserve("oak_log", 1)).toBeUndefined();
    expect(teammate.releaseReservation(hold)).toBe(false);
    expect(b.releaseReservation(hold)).toBe(false);
    expect(a.releaseReservation(hold)).toBe(true);
    expect(teammate.reserve("oak_log", 3)).toBeTypeOf("string");
  });

  it("serializes contention across separate SQLite connections and restart", () => {
    const path = file();
    const { a } = setup(path);
    const snap = a.read();
    snap.state.storageContents = { oak_log: 2 };
    a.save(snap);
    const other = new CommunityPhysicalState(open(path)).forCitizen("citizen_maya");
    expect(a.reserve("oak_log", 2)).toBeTypeOf("string");
    expect(other.reserve("oak_log", 1)).toBeUndefined();
    expect(other.read().state.storageContents).toEqual({ oak_log: 2 });
    expect(a.claimBlock("overworld", pos)).toBe(true);
    expect(other.claimBlock("overworld", pos)).toBe(false);
  });

  it("arbitrates world resources globally without exposing a rival's claim metadata", () => {
    const { a, b } = setup();
    expect(a.claimBlock("overworld", pos)).toBe(true);
    expect(b.claimBlock("overworld", pos)).toBe(false);
    expect(b.releaseBlock("overworld", pos)).toBe(false);
    expect(b.claimBlock("the_nether", pos)).toBe(true);
    expect(a.releaseBlock("overworld", pos)).toBe(true);
    expect(b.claimBlock("overworld", pos)).toBe(true);
  });

  it("expires holds and claims with bounded time", () => {
    const { a, b } = setup();
    const snap = a.read();
    snap.state.storageContents = { oak_log: 1 };
    a.save(snap);
    a.reserve("oak_log", 1, 10, 100);
    expect(a.reserve("oak_log", 1, 10, 105)).toBeUndefined();
    expect(a.reserve("oak_log", 1, 10, 111)).toBeTypeOf("string");
    a.claimBlock("overworld", pos, 10, 100);
    expect(b.claimBlock("overworld", pos, 10, 111)).toBe(true);
  });

  it("keeps personal chests private even from teammates until an explicit owner grant", () => {
    const { a, b, teammate } = setup();
    const key = physicalBlockKey("overworld", pos);
    expect(a.registerAsset("chest", "overworld", pos)).toBe(true);
    expect(teammate.accessibleAssets()).toEqual([]);
    expect(b.accessibleAssets()).toEqual([]);
    expect(teammate.grantAsset(key, "citizen_theo")).toBe(false);
    expect(a.grantAsset(key, "citizen_maya")).toBe(true);
    expect(teammate.accessibleAssets()).toHaveLength(1);
    expect(a.revokeAsset(key, "citizen_maya")).toBe(true);
    expect(teammate.accessibleAssets()).toEqual([]);
  });

  it("requires explicit grants for rival access and persists them after reopen", () => {
    const path = file();
    const { a } = setup(path);
    a.registerAsset("crafting_table", "overworld", pos);
    a.grantAsset(physicalBlockKey("overworld", pos), "citizen_theo");
    const restarted = new CommunityPhysicalState(open(path)).forCitizen("citizen_theo");
    expect(restarted.accessibleAssets()).toMatchObject([
      { kind: "crafting_table", ownerId: "citizen_atlas", position: pos },
    ]);
  });

  it("cannot double-assign a bed or take an already owned workstation", () => {
    const { a, b, teammate } = setup();
    expect(a.registerAsset("bed", "overworld", pos)).toBe(true);
    expect(teammate.registerAsset("bed", "overworld", pos)).toBe(false);
    expect(b.registerAsset("crafting_table", "overworld", pos)).toBe(false);
    expect(b.accessibleAssets()).toEqual([]);
  });

  it("invalidates queued work on affiliation changes without rewriting identity or memories", () => {
    const { s, a, b, physical } = setup();
    const original = s.getCitizen("citizen_atlas");
    a.claimBlock("overworld", pos);
    s.removeCommunityMember("north", "citizen_atlas", audit);
    s.addCommunityMember("south", "citizen_atlas", audit);
    expect(() => a.read()).toThrow(/affiliation/);
    expect(() => a.releaseWork()).toThrow(/affiliation/);
    expect(physical.forCitizen("citizen_atlas").read().state.id).toBe("south");
    expect(b.claimBlock("overworld", pos)).toBe(true);
    expect(s.getCitizen("citizen_atlas")).toEqual(original);
    expect(
      s
        .listCommunityAudit()
        .filter((r) => r.citizenId === "citizen_atlas")
        .map((r) => r.action),
    ).toEqual(["add_member", "remove_member", "add_member"]);
  });

  it("cleans only own work on death, interrupted construction or disconnect", () => {
    const { a, b } = setup();
    a.claimBlock("overworld", pos);
    b.claimBlock("overworld", { ...pos, x: 11 });
    a.releaseWork();
    expect(b.claimBlock("overworld", pos)).toBe(true);
    expect(a.claimBlock("overworld", { ...pos, x: 11 })).toBe(false);
  });

  it("fails closed for unknown identities and unaffiliated citizens", () => {
    const { physical } = setup();
    expect(() => physical.forCitizen("forged")).toThrow(/membership/);
    expect(() => physical.forCitizen("citizen_kai")).toThrow(/membership/);
  });

  it("repeated migrations preserve originals and verified backup contents", () => {
    const path = file();
    const s = open(path);
    const before = s.getSettlement();
    const backup = `${path}.backup`;
    s.db.prepare("VACUUM INTO ?").run(backup);
    migratePhysicalState(s.db);
    migratePhysicalState(s.db);
    const copy = new Database(backup, { readonly: true });
    try {
      expect(copy.pragma("quick_check", { simple: true })).toBe("ok");
      expect(copy.prepare("SELECT * FROM settlement").all()).toEqual(
        s.db.prepare("SELECT * FROM settlement").all(),
      );
    } finally {
      copy.close();
    }
    expect(s.getSettlement()).toEqual(before);
    expect(
      s.db.prepare("SELECT * FROM sim_meta WHERE key='community-physical-v1'").all(),
    ).toHaveLength(1);
  });

  it("rolls back additive DDL when an existing incompatible table is found", () => {
    const s = open();
    s.db.exec("CREATE TABLE community_physical_state(broken TEXT)");
    expect(() => migratePhysicalState(s.db)).toThrow();
    expect(
      s.db.prepare("SELECT name FROM sqlite_master WHERE name='physical_resource_holds'").all(),
    ).toEqual([]);
    expect(
      s.db.prepare("SELECT value FROM sim_meta WHERE key='community-physical-v1'").get(),
    ).toBeUndefined();
  });

  it("rejects non-finite positions and invalid reservation quantities", () => {
    const { a } = setup();
    expect(() => a.claimBlock("overworld", { ...pos, x: NaN })).toThrow();
    for (const qty of [-1, 0, 0.5, Infinity]) expect(() => a.reserve("oak_log", qty)).toThrow();
  });
});

describe("real planner/store boundary with simulated inputs", () => {
  it.each([2, 4])("keeps %i bodies' settlement inputs separate", (count) => {
    const { s, a } = setup();
    const snap = a.read();
    snap.state.storageContents = { oak_log: 8 };
    snap.state.wood = 8;
    a.save(snap);
    const ids =
      count === 2
        ? ["citizen_atlas", "citizen_theo"]
        : ["citizen_atlas", "citizen_maya", "citizen_theo", "citizen_ava"];
    for (const id of ids) {
      const scoped = scopeSettlementForCitizen(s, id, s.getSettlement());
      const north = s.getCommunityDirectory().communityOf(id) === "north";
      expect(scoped.settlement.wood).toBe(north ? 8 : 0);
      const inventory: Array<{ name: string; count: number }> = [];
      const plan = planCitizen({
        citizenId: id,
        settlement: scoped.settlement,
        assignedNeeds: [],
        observation: {
          username: id,
          connected: true,
          spawned: true,
          health: 20,
          food: 20,
          inventory,
          players: [],
          nearby: [],
          position: { x: north ? 0 : 100, y: 64, z: 0 },
          gameTime: 1000,
          isNight: false,
        },
      });
      expect(plan.action).toBeTypeOf("string");
      expect(inventory).toEqual([]); // No borrowed inventory or constructed blocks from planner output.
    }
  });

  it("allows owner-only home abandonment and records the transition", () => {
    const { s, a, b } = setup();
    const key = physicalBlockKey("overworld", pos);
    a.registerAsset("bed", "overworld", pos);
    expect(b.abandonAsset(key)).toBe(false);
    expect(a.abandonAsset(key)).toBe(true);
    expect(b.registerAsset("bed", "overworld", pos)).toBe(true);
    expect(
      s.db
        .prepare("SELECT action FROM physical_state_audit WHERE action='abandon_asset:bed'")
        .all(),
    ).toHaveLength(1);
  });
});

it("does not count inherited object properties as physical inventory", () => {
  const { a } = setup();
  for (const item of ["constructor", "toString", "__proto__"])
    expect(a.reserve(item, 1)).toBeUndefined();
});
