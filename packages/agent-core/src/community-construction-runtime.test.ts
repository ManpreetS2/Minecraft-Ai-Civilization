/** Per-community construction runtime and SQLite persistence. Offline simulated bodies; not live Minecraft evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WORKSHOP_CABIN_ID } from "@civ/minecraft-knowledge";
import { EventBus } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { CivilizationStore } from "./store.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import { executePlan } from "./executor.js";
import { communityConstruction } from "./community-construction.js";
import { createProductionHarness, stubNavOk } from "./construction-production-harness.js";
import type { SkillContext } from "@civ/skills";

const audit = { actor: "orchestrator-config" as const, reason: "construction runtime regression" };
const MATERIALS = [
  { name: "oak_planks", count: 200 }, { name: "oak_door", count: 1 }, { name: "chest", count: 1 },
  { name: "torch", count: 1 }, { name: "crafting_table", count: 1 },
];
const plan = {
  goal: "contribute_to_project", task: "build_structure", action: "buildStructure" as const,
  source: "planner" as const, reason: "runtime", priority: 1, item: WORKSHOP_CABIN_ID,
};
const dirs: string[] = [];
const stores: CivilizationStore[] = [];

function open(path = ":memory:"): CivilizationStore {
  const store = new CivilizationStore(path);
  stores.push(store);
  return store;
}
function seeded(store: CivilizationStore): void {
  store.upsertCommunity("north", "North", audit);
  store.upsertCommunity("south", "South", audit);
  store.addCommunityMember("north", "citizen_atlas", audit);
  store.addCommunityMember("south", "citizen_theo", audit);
}
function body(id: string | undefined, origin: { x: number; y: number; z: number }): SkillContext {
  const h = createProductionHarness({ origin, inventory: MATERIALS });
  h.seedPad({ x: origin.x, y: origin.y, z: origin.z }, 30, 30, origin.y);
  h.ctx.citizenId = id;
  Object.assign(h.ctx.bot, { entities: {} });
  return h.ctx;
}
beforeEach(() => setNavigationBackend(stubNavOk() as unknown as NavigationBackend));
afterEach(() => {
  setNavigationBackend(createNavigationBackend("pathfinder"));
  vi.restoreAllMocks();
  for (const s of stores.splice(0)) if (s.isOpen()) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("per-community construction runtime", () => {
  it("lets two communities build simultaneously without sharing or overwriting project state", async () => {
    const store = open();
    seeded(store);
    const runtime = new SettlementRuntime();
    const before = JSON.stringify(store.getSettlement());
    const [a, b] = await Promise.all([
      executePlan(body("citizen_atlas", { x: 100, y: 70, z: 100 }), plan, store, new EventBus(), runtime),
      executePlan(body("citizen_theo", { x: 400, y: 70, z: 400 }), plan, store, new EventBus(), runtime),
    ]);
    expect(a.success, JSON.stringify(a)).toBe(true);
    expect(b.success, JSON.stringify(b)).toBe(true);
    const north = communityConstruction(store).forCitizen("citizen_atlas").load();
    const south = communityConstruction(store).forCitizen("citizen_theo").load();
    expect(north?.site).toBeDefined();
    expect(south?.site).toBeDefined();
    expect(north?.site).not.toEqual(south?.site);
    expect((north as { ownerCitizenId?: string }).ownerCitizenId).toBe("citizen_atlas");
    expect((south as { ownerCitizenId?: string }).ownerCitizenId).toBe("citizen_theo");
    // lastPersistOk is the in-memory result of the save itself, so it is never part of the stored row.
    const mem = (id: string) => ({ ...runtime.forCommunity(id).project, lastPersistOk: undefined });
    expect(mem("north")).toMatchObject({ ...north, lastPersistOk: undefined });
    expect(mem("south")).toMatchObject({ ...south, lastPersistOk: undefined });
    expect((runtime.forCommunity("north").project as { lastPersistOk?: boolean }).lastPersistOk).toBe(true);
    expect(runtime.project).toBeUndefined();
    expect(JSON.stringify(store.getSettlement())).toEqual(before);
  });

  it("restores each community's own project after a SQLite restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "community-construction-"));
    dirs.push(dir);
    const path = join(dir, "civ.sqlite");
    const first = open(path);
    seeded(first);
    await executePlan(body("citizen_atlas", { x: 100, y: 70, z: 100 }), plan, first, new EventBus(), new SettlementRuntime());
    await executePlan(body("citizen_theo", { x: 400, y: 70, z: 400 }), plan, first, new EventBus(), new SettlementRuntime());
    const north = communityConstruction(first).forCitizen("citizen_atlas").load();
    const south = communityConstruction(first).forCitizen("citizen_theo").load();
    first.close();

    const second = open(path);
    const fresh = new SettlementRuntime();
    expect(communityConstruction(second).forCitizen("citizen_atlas").load()).toEqual(north);
    expect(fresh.forCommunity("north", second).project).toEqual(north);
    expect(fresh.forCommunity("south", second).project).toEqual(south);
  });

  it("refuses unauthenticated and non-member callers without writing anything", async () => {
    const store = open();
    seeded(store);
    const unauthenticated = await executePlan(body(undefined, { x: 100, y: 70, z: 100 }), plan, store, new EventBus());
    const stranger = await executePlan(body("citizen_nobody", { x: 100, y: 70, z: 100 }), plan, store, new EventBus());
    expect(unauthenticated.success).toBe(false);
    expect(stranger.success).toBe(false);
    expect(() => communityConstruction(store).forCitizen("citizen_nobody")).toThrow(/membership/);
    expect(store.db.prepare("SELECT count(*) AS n FROM community_construction_projects").get()).toEqual({ n: 0 });
  });

  it("rejects a stale handle after the citizen leaves its community, and never reads another community's row", async () => {
    const store = open();
    seeded(store);
    await executePlan(body("citizen_theo", { x: 400, y: 70, z: 400 }), plan, store, new EventBus(), new SettlementRuntime());
    const atlas = communityConstruction(store).forCitizen("citizen_atlas");
    expect(atlas.load()).toBeUndefined();
    const theoProject = communityConstruction(store).forCitizen("citizen_theo").load()!;
    store.removeCommunityMember("north", "citizen_atlas", audit);
    expect(() => atlas.save(theoProject)).toThrow(/affiliation/);
    expect(() => atlas.load()).toThrow(/affiliation/);
    expect(communityConstruction(store).forCitizen("citizen_theo").load()).toEqual(theoProject);
  });

  it("reports persisted:false and does not claim success when the SQLite write fails", async () => {
    const store = open();
    seeded(store);
    const real = store.db.prepare.bind(store.db);
    vi.spyOn(store.db, "prepare").mockImplementation(((sql: string) => {
      if (/INSERT[\s\S]*community_construction_projects/i.test(sql)) throw new Error("disk I/O error");
      return real(sql);
    }) as typeof store.db.prepare);
    const handle = communityConstruction(store).forCitizen("citizen_atlas");
    const runtime = new SettlementRuntime();
    const result = await executePlan(body("citizen_atlas", { x: 100, y: 70, z: 100 }), plan, store, new EventBus(), runtime);
    expect(handle.save(runtime.forCommunity("north").project!)).toBe(false);
    const data = (result.success ? result.data : result.details) as { persisted?: boolean } | undefined;
    expect(data?.persisted).not.toBe(true);
    expect(store.db.prepare("SELECT count(*) AS n FROM community_construction_projects").get()).toEqual({ n: 0 });
  });
});

describe("legacy single-settlement persistence honesty", () => {
  it("still persists to the settlement row and reports it", async () => {
    const store = open();
    const before = JSON.stringify(store.getSettlement());
    await executePlan(body("citizen_atlas", { x: 100, y: 70, z: 100 }), plan, store, new EventBus(), new SettlementRuntime());
    expect(JSON.stringify(store.getSettlement())).not.toEqual(before);
    expect(store.getSettlement().projectJson).toBeDefined();
  });
});
